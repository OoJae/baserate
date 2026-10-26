// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {IAdapter} from "vault-v2/interfaces/IAdapter.sol";

/// @notice Vault V2 liquidity adapter that parks the parent vault's MUSD in wsMUSD (ERC-4626 over sMUSD).
/// @dev Derived from vault-v2's MorphoVaultV1Adapter (tag 2026-08-13). The difference: `allocate` deposits at most
/// `wsMUSD.maxDeposit(adapter)` and keeps the rest as accounted idle MUSD, so a full wsMUSD (or a failing wsMUSD
/// deposit) can never make a vMUSD deposit revert. `deallocate` pays from idle first and rejects the vault's
/// `forceDeallocate` while this adapter is the vault's liquidity adapter (withdrawals reach it anyway). A timelocked
/// rescue moves the wsMUSD position out in kind, to the vault's owner, only when wsMUSD can no longer pay it out.
interface IWsMusdLiquidityAdapter is IAdapter {
    /// @notice Emitted when the parent vault's owner sets the skim recipient.
    event SetSkimRecipient(address indexed newSkimRecipient);

    /// @notice Emitted when stray tokens are skimmed to the skim recipient.
    event Skim(address indexed token, uint256 amount);

    /// @notice Emitted on every allocation.
    /// @param assets MUSD received from the vault in this call.
    /// @param deposited MUSD deposited into wsMUSD in this call (may include previously idle MUSD).
    /// @param idle Accounted idle MUSD held by the adapter afterwards.
    event Allocated(uint256 assets, uint256 deposited, uint256 idle);

    /// @notice Emitted when the vault's curator queues a rescue.
    event RescueSubmitted(uint64 executableAt);

    /// @notice Emitted when the vault's curator or a sentinel cancels the queued rescue.
    event RescueRevoked(address indexed sender);

    /// @notice Emitted when a rescue found wsMUSD still paying: the whole position was redeemed into idle MUSD.
    event RescueUnwound(uint256 shares, uint256 assets);

    /// @notice Emitted when a rescue sent the wsMUSD shares in kind to the vault's owner (wsMUSD failed to pay).
    event RescuedInKind(address indexed recipient, uint256 shares);

    /// @notice Emitted on every deallocation.
    /// @param assets MUSD released to the vault.
    /// @param fromIdle Part of `assets` paid from idle MUSD.
    /// @param withdrawn Part of `assets` withdrawn from wsMUSD.
    event Deallocated(uint256 assets, uint256 fromIdle, uint256 withdrawn);

    error ZeroAddress();
    error AssetMismatch();
    error NotAuthorized();
    error InvalidData();
    error CannotSkimWsMusdShares();
    error RescuePending();
    error NoPendingRescue();
    error RescueTimelocked(uint64 executableAt);
    error InsufficientGas();
    /// @notice The vault's `forceDeallocate` was called on this adapter while it is the vault's liquidity adapter.
    error ForceDeallocateDisabled();

    /// @notice The Vault V2 (vMUSD) this adapter serves; the only caller of `allocate` and `deallocate`.
    function parentVault() external view returns (address);

    /// @notice The wsMUSD vault this adapter deposits into.
    function wsMusd() external view returns (address);

    /// @notice MUSD, the asset of both the parent vault and wsMUSD.
    function asset() external view returns (address);

    /// @notice `keccak256(abi.encode("this", address(this)))`, the adapter's only cap id.
    function adapterId() external view returns (bytes32);

    /// @notice Receiver of skimmed stray tokens; set by the parent vault's owner.
    function skimRecipient() external view returns (address);

    /// @notice MUSD received from the vault but not deposited into wsMUSD (accounted, part of `realAssets`).
    function idle() external view returns (uint256);

    /// @notice The parent vault's recorded allocation for `adapterId`.
    function allocation() external view returns (uint256);

    /// @notice The adapter's cap ids: `[adapterId]`.
    function ids() external view returns (bytes32[] memory);

    /// @notice Value held for the vault: `wsMUSD.previewRedeem(shares) + idle`, regardless of the recorded allocation.
    function heldAssets() external view returns (uint256);

    /// @notice MUSD the vault can deallocate right now as far as a view can tell: `idle + wsMUSD.maxWithdraw(adapter)`.
    /// @dev Optimistic: a view cannot see an sMUSD withdraw that reverts. `BaserateAllocator`'s exits do not rely on it
    /// (they retry M1-first when the wsMUSD leg reverts), and after an in-kind rescue it is `idle` only.
    function availableLiquidity() external view returns (uint256);

    /// @notice Delay between `submitRescue` and `rescue`.
    function RESCUE_TIMELOCK() external view returns (uint256);

    /// @notice Gas stipend of the rescue's attempt to redeem the whole wsMUSD position into idle MUSD.
    function RESCUE_PROBE_GAS() external view returns (uint256);

    /// @notice Timestamp from which the queued rescue can run (0 if none).
    function rescueExecutableAt() external view returns (uint64);

    /// @notice Whether a rescue sent the wsMUSD shares out in kind; from then on allocations stay idle MUSD.
    function rescued() external view returns (bool);

    /// @notice Queues a rescue, executable after `RESCUE_TIMELOCK`. Parent vault curator only.
    function submitRescue() external;

    /// @notice Cancels the queued rescue. Parent vault curator or sentinel.
    function revokeRescue() external;

    /// @notice Runs the queued rescue once its timelock has elapsed. Parent vault curator or sentinel.
    /// @dev Tries `wsMUSD.redeem(all shares)` into idle MUSD with exactly `RESCUE_PROBE_GAS` (reverts
    /// `InsufficientGas` if the call could not get it). If that succeeds nothing leaves the adapter (`unwound`);
    /// otherwise the shares go to the parent vault's owner, `rescued` is set, and the vault books their value as a
    /// loss on its next interest accrual (a sentinel `deallocate(adapter, "", 0)` updates the allocation).
    function rescue() external returns (uint256 shares, bool unwound);

    /// @notice Sets the skim recipient. Parent vault owner only.
    function setSkimRecipient(address newSkimRecipient) external;

    /// @notice Sends the adapter's stray balance of `token` to the skim recipient. Skim recipient only.
    /// @dev wsMUSD shares can never be skimmed, and for MUSD only the balance above the accounted `idle` is stray.
    function skim(address token) external;
}
