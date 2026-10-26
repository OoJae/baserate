// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {IWsMusdLiquidityAdapter} from "../interfaces/IWsMusdLiquidityAdapter.sol";

// forge-lint: disable-start(screaming-snake-case-immutable)

/// @title WsMusdLiquidityAdapter
/// @notice vMUSD's liquidity adapter: every vMUSD deposit is allocated here and parked in wsMUSD (savings yield,
/// fully liquid); withdrawals are served from here before anything touches the M1 market.
/// @dev Derived from morpho-org/vault-v2 `MorphoVaultV1Adapter` at tag 2026-08-13 (GPL-2.0-or-later, Copyright (c)
/// 2025 Morpho Association), with five changes:
/// - `allocate` deposits `min(idle + assets, wsMUSD.maxDeposit(this))` inside try/catch and keeps the rest as
///   accounted idle MUSD. A full wsMUSD cap, or a wsMUSD/sMUSD deposit that reverts, therefore never blocks a vMUSD
///   deposit (the "vMUSD deposit DoS" in docs/design/red-team.md). Idle MUSD is redeposited on later allocations.
/// - `deallocate` pays from idle MUSD first and withdraws only the remainder from wsMUSD.
/// - `deallocate` rejects the vault's `forceDeallocate` while this adapter is the vault's liquidity adapter (its
///   penalty is 0 and every withdrawal reaches the adapter anyway, so a force-deallocation could only park vMUSD's
///   wsMUSD position idle, forfeiting its share of wsMUSD's vesting yield; round-2 audit R2X-4).
/// - `realAssets = wsMUSD.previewRedeem(shares) + idle`. Idle is tracked internally, so stray MUSD donated to the
///   adapter is not counted and can be skimmed; wsMUSD shares can never be skimmed.
/// - A timelocked rescue for a wsMUSD exit that no longer works (sMUSD's withdraw reverting): the vault's curator
///   submits it, the curator or a sentinel can revoke it, and after `RESCUE_TIMELOCK` the curator or a sentinel runs
///   it. It first tries to redeem the whole wsMUSD position into idle MUSD, with a guaranteed `RESCUE_PROBE_GAS`
///   stipend; if that works nothing leaves the adapter. Only if it reverts are the wsMUSD shares sent in kind to the
///   vault's owner for manual unwinding (wsMUSD `redeemInKind` to sMUSD needs no sMUSD withdraw), and the adapter
///   stops depositing into wsMUSD. The vault then books the shares' value as a loss until the owner returns it, so
///   the rescue can never take value a working wsMUSD would pay out to vMUSD holders.
/// Vault V2 adapter rules: only the parent vault can allocate/deallocate; markets are entered and exited only there;
/// the single id `keccak256(abi.encode("this", address(this)))` is returned on both; the vault holds an unlimited
/// MUSD approval so it can pull deallocated assets; the adapter never calls back into the vault's state-changing
/// functions. wsMUSD (immutable, no callbacks) cannot re-enter the vault or the adapter.
/// wsMUSD is seeded with dead shares at deployment, which the vault-v2 inflation-attack note requires; its vesting
/// accounting also means donations never move its share price instantly. Rounding losses on deposit/withdraw are
/// realizable (at most a few wei per call).
/// Shouldn't be used alongside another adapter that re-uses its id.
contract WsMusdLiquidityAdapter is IWsMusdLiquidityAdapter, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @inheritdoc IWsMusdLiquidityAdapter
    address public immutable parentVault;
    /// @inheritdoc IWsMusdLiquidityAdapter
    address public immutable wsMusd;
    /// @inheritdoc IWsMusdLiquidityAdapter
    address public immutable asset;
    /// @inheritdoc IWsMusdLiquidityAdapter
    bytes32 public immutable adapterId;

    /// @inheritdoc IWsMusdLiquidityAdapter
    uint256 public constant RESCUE_TIMELOCK = 72 hours;
    /// @inheritdoc IWsMusdLiquidityAdapter
    uint256 public constant RESCUE_PROBE_GAS = 3_000_000;
    /// @dev Gas kept back for the rescue's own work after the probe.
    uint256 internal constant RESCUE_GAS_MARGIN = 100_000;

    /// @inheritdoc IWsMusdLiquidityAdapter
    address public skimRecipient;
    /// @inheritdoc IWsMusdLiquidityAdapter
    uint64 public rescueExecutableAt;
    /// @inheritdoc IWsMusdLiquidityAdapter
    bool public rescued;
    /// @inheritdoc IWsMusdLiquidityAdapter
    uint256 public idle;

    /// @param _parentVault The vMUSD Vault V2.
    /// @param _wsMusd The wsMUSD vault; its asset must equal the vault's asset.
    constructor(address _parentVault, address _wsMusd) {
        if (_parentVault == address(0) || _wsMusd == address(0)) revert ZeroAddress();
        address asset_ = IVaultV2(_parentVault).asset();
        if (asset_ != IERC4626(_wsMusd).asset()) revert AssetMismatch();

        parentVault = _parentVault;
        wsMusd = _wsMusd;
        asset = asset_;
        adapterId = keccak256(abi.encode("this", address(this)));

        IERC20(asset_).forceApprove(_parentVault, type(uint256).max);
        IERC20(asset_).forceApprove(_wsMusd, type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Skim
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IWsMusdLiquidityAdapter
    function setSkimRecipient(address newSkimRecipient) external nonReentrant {
        if (msg.sender != IVaultV2(parentVault).owner()) revert NotAuthorized();
        skimRecipient = newSkimRecipient;
        emit SetSkimRecipient(newSkimRecipient);
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function skim(address token) external nonReentrant {
        address recipient = skimRecipient;
        if (msg.sender != recipient) revert NotAuthorized();
        if (token == wsMusd) revert CannotSkimWsMusdShares();
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (token == asset) amount -= idle;
        IERC20(token).safeTransfer(recipient, amount);
        emit Skim(token, amount);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Rescue (timelocked, curator and sentinels of the parent vault)
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IWsMusdLiquidityAdapter
    function submitRescue() external nonReentrant {
        if (msg.sender != IVaultV2(parentVault).curator()) revert NotAuthorized();
        if (rescueExecutableAt != 0) revert RescuePending();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 executableAt = uint64(block.timestamp + RESCUE_TIMELOCK);
        rescueExecutableAt = executableAt;
        emit RescueSubmitted(executableAt);
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function revokeRescue() external nonReentrant {
        _onlyCuratorOrSentinel();
        if (rescueExecutableAt == 0) revert NoPendingRescue();
        delete rescueExecutableAt;
        emit RescueRevoked(msg.sender);
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function rescue() external nonReentrant returns (uint256 shares, bool unwound) {
        _onlyCuratorOrSentinel();
        uint64 executableAt = rescueExecutableAt;
        if (executableAt == 0) revert NoPendingRescue();
        if (block.timestamp < executableAt) revert RescueTimelocked(executableAt);
        delete rescueExecutableAt;

        shares = IERC20(wsMusd).balanceOf(address(this));
        // The probe must get its full stipend, so a failure can never be a caller starving it of gas.
        if (gasleft() < RESCUE_PROBE_GAS * 64 / 63 + RESCUE_GAS_MARGIN) revert InsufficientGas();
        // `idle` is written after the call; the lock blocks re-entry and wsMUSD has no callbacks.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        try IERC4626(wsMusd).redeem{gas: RESCUE_PROBE_GAS}(shares, address(this), address(this)) returns (
            uint256 assets
        ) {
            // wsMUSD still pays: the position is now idle MUSD, held for the vault as before.
            idle += assets;
            unwound = true;
            emit RescueUnwound(shares, assets);
        } catch {
            rescued = true;
            address recipient = IVaultV2(parentVault).owner();
            IERC20(wsMusd).safeTransfer(recipient, shares);
            emit RescuedInKind(recipient, shares);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Vault V2 adapter
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Parks `assets` MUSD (already transferred by the vault) in wsMUSD, as far as wsMUSD accepts deposits.
    /// @dev Does not log the ids (the vault does). Returns the ids and the change in allocation, which includes the
    /// wsMUSD yield earned since the previous (de)allocation.
    function allocate(bytes memory data, uint256 assets, bytes4, address)
        external
        nonReentrant
        returns (bytes32[] memory, int256)
    {
        if (data.length != 0) revert InvalidData();
        if (msg.sender != parentVault) revert NotAuthorized();

        uint256 idleAssets = idle + assets;
        // After an in-kind rescue wsMUSD is known not to pay out: keep everything idle.
        uint256 room = rescued ? 0 : IERC4626(wsMusd).maxDeposit(address(this));
        uint256 toDeposit = idleAssets < room ? idleAssets : room;
        uint256 deposited = 0;
        if (toDeposit != 0) {
            // A reverting wsMUSD/sMUSD deposit must not block vMUSD deposits: keep the MUSD idle instead.
            // `idle` is written after the call; only the parent vault can get here and the lock blocks re-entry.
            // forge-lint: disable-next-line(reentrancy-no-eth)
            try IERC4626(wsMusd).deposit(toDeposit, address(this)) {
                deposited = toDeposit;
                idleAssets -= toDeposit;
            } catch {}
        }
        idle = idleAssets;
        emit Allocated(assets, deposited, idleAssets);

        return (ids(), _change());
    }

    /// @notice Releases `assets` MUSD to the vault: idle MUSD first, then a wsMUSD withdrawal for the remainder.
    /// @dev Reverts (wsMUSD `ERC4626ExceededMaxWithdraw`) if the adapter holds less than `assets`. Vault V2 passes the
    /// selector it was called with: `forceDeallocate` is rejected (`ForceDeallocateDisabled`) while this adapter is
    /// the vault's liquidity adapter with empty liquidity data, because every withdrawal already reaches it then and a
    /// free force-deallocation could only park vMUSD's savings leg idle (round-2 audit R2X-4). Withdrawals
    /// (`withdraw`/`redeem`), allocator and sentinel `deallocate` calls are unaffected, and `forceDeallocate` works
    /// again whenever the vault's exit path no longer reaches this adapter, so it stays an in-kind exit of last resort.
    function deallocate(bytes memory data, uint256 assets, bytes4 selector, address)
        external
        nonReentrant
        returns (bytes32[] memory, int256)
    {
        if (data.length != 0) revert InvalidData();
        if (msg.sender != parentVault) revert NotAuthorized();
        if (selector == IVaultV2.forceDeallocate.selector && _isVaultLiquidityAdapter()) {
            revert ForceDeallocateDisabled();
        }

        uint256 idleAssets = idle;
        uint256 fromIdle = assets < idleAssets ? assets : idleAssets;
        uint256 withdrawn = assets - fromIdle;
        idle = idleAssets - fromIdle;
        if (withdrawn != 0) IERC4626(wsMusd).withdraw(withdrawn, address(this), address(this));
        emit Deallocated(assets, fromIdle, withdrawn);

        return (ids(), _change());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IWsMusdLiquidityAdapter
    function ids() public view returns (bytes32[] memory ids_) {
        ids_ = new bytes32[](1);
        ids_[0] = adapterId;
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function allocation() public view returns (uint256) {
        return IVaultV2(parentVault).allocation(adapterId);
    }

    /// @notice Current value of the vault's position: `wsMUSD.previewRedeem(shares) + idle`, or 0 when the vault
    /// records no allocation for this adapter (as in MorphoVaultV1Adapter).
    function realAssets() external view returns (uint256) {
        return allocation() != 0 ? heldAssets() : 0;
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function heldAssets() public view returns (uint256) {
        IERC4626 ws = IERC4626(wsMusd);
        return ws.previewRedeem(ws.balanceOf(address(this))) + idle;
    }

    /// @inheritdoc IWsMusdLiquidityAdapter
    function availableLiquidity() external view returns (uint256) {
        return idle + IERC4626(wsMusd).maxWithdraw(address(this));
    }

    /// @dev Whether the vault's own exit path (`withdraw`/`redeem`) deallocates from this adapter: it is the vault's
    /// liquidity adapter and the liquidity data is empty (anything else would revert `InvalidData` here).
    function _isVaultLiquidityAdapter() internal view returns (bool) {
        IVaultV2 vault = IVaultV2(parentVault);
        return vault.liquidityAdapter() == address(this) && vault.liquidityData().length == 0;
    }

    function _onlyCuratorOrSentinel() internal view {
        IVaultV2 vault = IVaultV2(parentVault);
        if (msg.sender != vault.curator() && !vault.isSentinel(msg.sender)) revert NotAuthorized();
    }

    /// @dev New position value minus the vault's recorded allocation.
    function _change() internal view returns (int256) {
        return SafeCast.toInt256(heldAssets()) - SafeCast.toInt256(allocation());
    }
}
// forge-lint: disable-end(screaming-snake-case-immutable)
