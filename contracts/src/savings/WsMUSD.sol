// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IWsMUSD} from "../interfaces/IWsMUSD.sol";
import {IMUSDSavingsRate} from "../interfaces/external/IMUSDSavingsRate.sol";

/// @title Wrapped Savings MUSD (wsMUSD)
/// @notice Immutable ERC-4626 over Mezo's sMUSD (MUSDSavingsRate). Asset: MUSD. Every deposit is staked 1:1 in sMUSD
/// and the yield sMUSD accrues through its index is harvested with `claimYield()`, re-deposited and vested.
/// @dev Accounting is internal, never balance-based: `totalAssets = _stored + vested + instant`, where
/// - `_stored` is fully vested principal and yield;
/// - `_unvested` vests linearly from `_lastSync` to `_periodEnd`;
/// - `instant` is the part of not-yet-claimed sMUSD yield (pending >= MIN_HARVEST) that counts immediately,
///   `pending * min(now - _lastHarvest, VESTING) / VESTING`, so yield that lands in the current block counts 0.
/// Donations, auto-claimed yield and any other surplus vest over `VESTING` with no instant part. `totalAssets()` is
/// exactly what a `sync()` in the same block realizes, so previews equal execution and donations never move the
/// share price instantly. The vault never calls PCV: sMUSD itself calls `distributeMUSD()` when its `pcv` is set.
/// No pause, no proxy, no lowering of the cap. Precompile cost: 0.
contract WsMUSD is ERC4626, ReentrancyGuardTransient, IWsMUSD {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @inheritdoc IWsMUSD
    uint256 public constant VESTING = 3 days;
    /// @inheritdoc IWsMUSD
    uint256 public constant MIN_HARVEST = 1e15;
    /// @inheritdoc IWsMUSD
    uint256 public constant CAP_TIMELOCK = 72 hours;

    /// @inheritdoc IWsMUSD
    IMUSDSavingsRate public immutable SMUSD;
    /// @inheritdoc IWsMUSD
    address public immutable CAP_ADMIN;

    IERC20 internal immutable MUSD;

    /// @inheritdoc IWsMUSD
    uint256 public depositCap;
    /// @inheritdoc IWsMUSD
    uint256 public pendingCap;

    /// @dev Fully vested assets backing the shares.
    uint256 internal _stored;
    /// @dev Assets vesting linearly from `_lastSync` to `_periodEnd`.
    uint256 internal _unvested;
    /// @dev Start of the current linear vesting segment (moved by every sync and by `redeemInKind`).
    uint64 internal _lastSync;
    /// @dev End of the vesting period.
    uint64 internal _periodEnd;
    /// @dev Last full sync. Pending sMUSD yield is treated as accruing from here when computing its instant part.
    uint64 internal _lastHarvest;
    /// @inheritdoc IWsMUSD
    uint64 public pendingCapAt;

    /// @param musd MUSD token (the ERC-4626 asset).
    /// @param smusd MUSDSavingsRate proxy; its `musdToken()` must be `musd`.
    /// @param capAdmin Governor Safe that queues and revokes cap raises (passed explicitly for CREATE2 deploys).
    /// @param initialCap Initial deposit cap, in MUSD.
    constructor(address musd, address smusd, address capAdmin, uint256 initialCap)
        ERC20("Wrapped Savings MUSD", "wsMUSD")
        ERC4626(IERC20(musd))
    {
        if (musd == address(0) || smusd == address(0) || capAdmin == address(0)) revert ZeroAddress();
        address smusdAsset = IMUSDSavingsRate(smusd).musdToken();
        if (smusdAsset != musd) revert AssetMismatch(musd, smusdAsset);

        MUSD = IERC20(musd);
        SMUSD = IMUSDSavingsRate(smusd);
        CAP_ADMIN = capAdmin;
        depositCap = initialCap;

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        _lastSync = nowTs;
        _periodEnd = nowTs;
        _lastHarvest = nowTs;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ERC-4626 entry points: nonReentrant, then sync, then OpenZeppelin logic
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Deposits `assets` MUSD (staked into sMUSD) and mints shares to `receiver`.
    /// @dev Syncs first, so the price used is exactly `previewDeposit` at this block.
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256)
    {
        _sync();
        return super.deposit(assets, receiver);
    }

    /// @notice Mints exactly `shares` to `receiver`, pulling `previewMint(shares)` MUSD.
    function mint(uint256 shares, address receiver) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
        _sync();
        return super.mint(shares, receiver);
    }

    /// @notice Withdraws exactly `assets` MUSD to `receiver`, burning `previewWithdraw(assets)` shares from `owner`.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256)
    {
        _sync();
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice Burns `shares` from `owner` and sends `previewRedeem(shares)` MUSD to `receiver`.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256)
    {
        _sync();
        return super.redeem(shares, receiver, owner);
    }

    /// @inheritdoc IWsMUSD
    /// @dev The permit runs in try/catch so a front-run permit cannot block the deposit; the deposit then proceeds
    /// if the allowance suffices (MUSD reverts otherwise).
    function depositWithPermit(uint256 assets, address receiver, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 shares)
    {
        try IERC20Permit(address(MUSD)).permit(msg.sender, address(this), assets, deadline, v, r, s) {} catch {}
        _sync();
        shares = super.deposit(assets, receiver);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Sync and in-kind exit
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IWsMUSD
    function sync() external nonReentrant returns (uint256 harvested) {
        harvested = _sync();
    }

    /// @inheritdoc IWsMUSD
    /// @dev Realizes vesting only. The price is `(_stored + vested + 1) / (totalSupply + 1)`: the in-kind redeemer
    /// forgoes its share of the not-yet-claimed instant yield, which stays with the remaining holders, so the share
    /// price never falls. The only sMUSD calls are `balanceOf` and `transfer`.
    function redeemInKind(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        returns (uint256 smusdOut, uint256 musdOut)
    {
        _realizeVesting();

        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);

        uint256 stored = _stored;
        uint256 assets = shares.mulDiv(stored + 1, totalSupply() + 1, Math.Rounding.Floor);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        _stored = stored - assets;

        (smusdOut, musdOut) = _splitInKind(assets);
        if (smusdOut != 0) IERC20(address(SMUSD)).safeTransfer(receiver, smusdOut);
        if (musdOut != 0) MUSD.safeTransfer(receiver, musdOut);

        emit RedeemedInKind(msg.sender, receiver, owner, shares, smusdOut, musdOut);
    }

    /// @inheritdoc IWsMUSD
    function previewRedeemInKind(uint256 shares) external view returns (uint256 smusdOut, uint256 musdOut) {
        uint256 assets = shares.mulDiv(_stored + _vestedNow() + 1, totalSupply() + 1, Math.Rounding.Floor);
        return _splitInKind(assets);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Deposit cap (raise-only, 72 h timelock)
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IWsMUSD
    function submitCapRaise(uint256 newCap) external nonReentrant {
        if (msg.sender != CAP_ADMIN) revert NotCapAdmin(msg.sender);
        uint256 cap = depositCap;
        if (newCap <= cap) revert CapNotRaised(cap, newCap);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 executableAt = uint64(block.timestamp + CAP_TIMELOCK);
        pendingCap = newCap;
        pendingCapAt = executableAt;
        emit CapRaiseSubmitted(newCap, executableAt);
    }

    /// @inheritdoc IWsMUSD
    function acceptCapRaise() external nonReentrant {
        uint64 executableAt = pendingCapAt;
        if (executableAt == 0) revert NoPendingCapRaise();
        if (block.timestamp < executableAt) revert CapRaiseTimelocked(executableAt);
        uint256 oldCap = depositCap;
        uint256 newCap = pendingCap;
        depositCap = newCap;
        delete pendingCap;
        delete pendingCapAt;
        emit CapRaised(oldCap, newCap);
    }

    /// @inheritdoc IWsMUSD
    function revokeCapRaise() external nonReentrant {
        if (msg.sender != CAP_ADMIN) revert NotCapAdmin(msg.sender);
        if (pendingCapAt == 0) revert NoPendingCapRaise();
        uint256 revoked = pendingCap;
        delete pendingCap;
        delete pendingCapAt;
        emit CapRaiseRevoked(revoked);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Assets backing the shares: vested assets, plus vesting progress, plus the instant part of pending
    /// sMUSD yield. Equals `_stored` right after a sync in the same block. Never reverts.
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        (uint256 vested,, uint256 instant) = _previewSync();
        return _stored + vested + instant;
    }

    /// @notice Remaining room under the deposit cap: `depositCap - totalAssets()`, floored at 0.
    function maxDeposit(address) public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 cap = depositCap;
        if (cap == type(uint256).max) return cap;
        uint256 assets = totalAssets();
        return cap > assets ? cap - assets : 0;
    }

    /// @notice Shares mintable without exceeding the deposit cap (`previewMint` of the result is <= `maxDeposit`).
    function maxMint(address receiver) public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (maxAssets == type(uint256).max) return maxAssets;
        return _convertToShares(maxAssets, Math.Rounding.Floor);
    }

    /// @inheritdoc IWsMUSD
    function pendingYield() external view returns (uint256) {
        return _pendingYield();
    }

    /// @inheritdoc IWsMUSD
    function vestingState()
        external
        view
        returns (uint256 stored, uint256 unvested, uint64 lastSync, uint64 periodEnd)
    {
        return (_stored, _unvested, _lastSync, _periodEnd);
    }

    /// @inheritdoc IWsMUSD
    function lastHarvest() external view returns (uint64) {
        return _lastHarvest;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ERC-4626 asset movement hooks
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Pull MUSD, stake it 1:1 in sMUSD and account it as vested.
    function _transferIn(address from, uint256 assets) internal override {
        if (assets == 0) return;
        _stored += assets;
        // `from` is always the ERC-4626 caller (OZ passes `_msgSender()`), never an arbitrary address.
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        MUSD.safeTransferFrom(from, address(this), assets);
        MUSD.forceApprove(address(SMUSD), assets);
        SMUSD.deposit(assets);
    }

    /// @dev Pay from idle MUSD first, then unstake the rest from sMUSD. sMUSD's withdraw auto-claims pending yield;
    /// that extra MUSD stays idle and is absorbed as surplus by the next sync.
    function _transferOut(address to, uint256 assets) internal override {
        if (assets == 0) return;
        _stored -= assets;
        uint256 idle = MUSD.balanceOf(address(this));
        if (idle < assets) SMUSD.withdraw(assets - idle);
        MUSD.safeTransfer(to, assets);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal accounting
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Shared by `totalAssets()` and `_sync()`.
    /// @return vested Part of `_unvested` vested since `_lastSync`.
    /// @return harvest Pending sMUSD yield that a sync would claim (0 below MIN_HARVEST).
    /// @return instant Part of `harvest` counted immediately.
    function _previewSync() internal view returns (uint256 vested, uint256 harvest, uint256 instant) {
        vested = _vestedNow();
        uint256 pending = _pendingYield();
        if (pending >= MIN_HARVEST) {
            harvest = pending;
            instant = _instantPart(pending);
        }
    }

    /// @dev Realizes vesting, harvests yield, absorbs surplus and re-deposits idle MUSD. Afterwards (same block)
    /// `totalAssets() == _stored`, and `_stored` equals the `totalAssets()` previewed before the sync.
    function _sync() internal returns (uint256 harvested) {
        (uint256 vested, uint256 harvest,) = _previewSync();
        uint256 stored = _stored;
        uint256 unvested = _unvested;
        uint256 accounted = stored + unvested;
        stored += vested;
        unvested -= vested;

        if (harvest != 0) {
            uint256 before = MUSD.balanceOf(address(this));
            // Every caller of `_sync` holds the transient reentrancy lock; sMUSD has no callbacks.
            // forge-lint: disable-next-line(reentrancy-no-eth)
            try SMUSD.claimYield() {
                uint256 afterBal = MUSD.balanceOf(address(this));
                uint256 received = afterBal > before ? afterBal - before : 0;
                harvested = received < harvest ? received : harvest;
            } catch {}
        }

        uint256 instant = _instantPart(harvested);
        stored += instant;
        uint256 added = harvested - instant;

        uint256 held = SMUSD.balanceOf(address(this)) + MUSD.balanceOf(address(this));
        uint256 surplus = 0;
        if (held > accounted + harvested) {
            surplus = held - accounted - harvested;
            if (surplus < MIN_HARVEST) surplus = 0;
        }
        added += surplus;
        unvested += added;

        _stored = stored;
        _unvested = unvested;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        uint64 periodEnd = _periodEnd;
        if (added != 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            periodEnd = uint64(block.timestamp + VESTING);
            _periodEnd = periodEnd;
        }
        _lastSync = nowTs;
        _lastHarvest = nowTs;
        // forge-lint: disable-next-line(reentrancy-events)
        if (harvested != 0 || surplus != 0) emit Synced(harvested, instant, surplus, stored, unvested, periodEnd);

        // Re-stake idle MUSD (harvest, surplus, auto-claims). Balance-neutral for the accounting above.
        uint256 idle = MUSD.balanceOf(address(this));
        if (idle >= MIN_HARVEST) {
            MUSD.forceApprove(address(SMUSD), idle);
            try SMUSD.deposit(idle) {}
            catch {
                MUSD.forceApprove(address(SMUSD), 0);
            }
        }
    }

    /// @dev Moves vested assets into `_stored` and restarts the linear segment at `now` (same end, same rate).
    /// Leaves `_lastHarvest` alone so the instant part of pending yield, and hence `totalAssets()`, is unchanged.
    function _realizeVesting() internal {
        uint256 vested = _vestedNow();
        if (vested != 0) {
            _stored += vested;
            _unvested -= vested;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        _lastSync = uint64(block.timestamp);
    }

    /// @dev `_unvested * (min(now, end) - start) / (end - start)`, rounded down.
    function _vestedNow() internal view returns (uint256) {
        uint256 unvested = _unvested;
        if (unvested == 0) return 0;
        uint256 start = _lastSync;
        uint256 end = _periodEnd;
        if (block.timestamp >= end || end <= start) return unvested;
        return unvested * (block.timestamp - start) / (end - start);
    }

    /// @dev `amount * min(now - _lastHarvest, VESTING) / VESTING`, rounded down.
    function _instantPart(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 elapsed = block.timestamp - _lastHarvest;
        if (elapsed >= VESTING) return amount;
        return amount * elapsed / VESTING;
    }

    /// @dev Exactly sMUSD's `_updateYieldFor` followed by `claimableYield`:
    /// `claimableYield(this) + balanceOf(this) * (yieldIndex - supplyYieldIndex(this)) / 1e18`.
    /// Reads are bounded staticcalls, so a broken sMUSD makes this 0 instead of reverting `totalAssets()`.
    function _pendingYield() internal view returns (uint256) {
        (bool ok1, uint256 claimable) = _readUint(abi.encodeCall(IMUSDSavingsRate.claimableYield, (address(this))));
        (bool ok2, uint256 balance) = _readUint(abi.encodeCall(IMUSDSavingsRate.balanceOf, (address(this))));
        (bool ok3, uint256 index) = _readUint(abi.encodeCall(IMUSDSavingsRate.yieldIndex, ()));
        (bool ok4, uint256 userIndex) = _readUint(abi.encodeCall(IMUSDSavingsRate.supplyYieldIndex, (address(this))));
        if (!(ok1 && ok2 && ok3 && ok4)) return 0;
        if (index <= userIndex || balance == 0) return claimable;
        (bool okMul, uint256 product) = Math.tryMul(balance, index - userIndex);
        if (!okMul) return 0;
        (bool okAdd, uint256 pending) = Math.tryAdd(claimable, product / 1e18);
        return okAdd ? pending : 0;
    }

    /// @dev Staticcall to sMUSD that copies at most one word of return data.
    function _readUint(bytes memory data) internal view returns (bool ok, uint256 value) {
        address target = address(SMUSD);
        assembly ("memory-safe") {
            ok := staticcall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x20)
            ok := and(ok, gt(returndatasize(), 0x1f))
            value := mload(0x00)
        }
    }

    /// @dev sMUSD 1:1 first, MUSD for any shortfall.
    function _splitInKind(uint256 assets) internal view returns (uint256 smusdOut, uint256 musdOut) {
        uint256 smusdBalance = SMUSD.balanceOf(address(this));
        smusdOut = assets < smusdBalance ? assets : smusdBalance;
        musdOut = assets - smusdOut;
    }
}
