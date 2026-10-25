// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {IMUSDSavingsRate} from "./external/IMUSDSavingsRate.sol";

/// @notice Wrapped Savings MUSD: an immutable ERC-4626 over Mezo's claim-based sMUSD (MUSDSavingsRate).
/// @dev The asset is MUSD; the vault holds sMUSD 1:1 and harvests its separately-accrued yield with `claimYield()`.
/// Harvested yield and every surplus vest linearly over `VESTING` from the sync that absorbs them; unclaimed yield
/// counts nothing. `totalAssets()` is exactly the value a `sync()` in the same block produces (whether or not the claim
/// succeeds), so ERC-4626 previews never over-promise, the share price never decreases, and nothing that lands in a
/// block (donations, sMUSD protocol yield) moves the share price in that block.
interface IWsMUSD is IERC4626 {
    /// @notice Emitted when a sync adds harvested sMUSD yield or a surplus (donations, auto-claims) to the vesting.
    /// @param harvested sMUSD yield claimed in this sync and added to the vesting.
    /// @param instant Always 0: nothing is credited immediately (kept for ABI compatibility).
    /// @param surplus Other unaccounted balance added to the vesting.
    /// @param stored Fully vested assets after the sync.
    /// @param unvested Assets still vesting after the sync.
    /// @param periodEnd Timestamp at which `unvested` is fully vested.
    event Synced(
        uint256 harvested, uint256 instant, uint256 surplus, uint256 stored, uint256 unvested, uint64 periodEnd
    );

    /// @notice Emitted when shares are redeemed for sMUSD (plus MUSD for any sMUSD shortfall).
    event RedeemedInKind(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 shares,
        uint256 smusdOut,
        uint256 musdOut
    );

    /// @notice Emitted when the cap admin queues a deposit-cap raise.
    event CapRaiseSubmitted(uint256 newCap, uint64 executableAt);

    /// @notice Emitted when a queued deposit-cap raise takes effect.
    event CapRaised(uint256 oldCap, uint256 newCap);

    /// @notice Emitted when the cap admin cancels a queued deposit-cap raise.
    event CapRaiseRevoked(uint256 revokedCap);

    error ZeroAddress();
    error AssetMismatch(address expected, address actual);
    error NotCapAdmin(address caller);
    error CapNotRaised(uint256 currentCap, uint256 proposedCap);
    error NoPendingCapRaise();
    error CapRaiseTimelocked(uint64 executableAt);

    /// @notice Pulls MUSD with an EIP-2612 permit (tolerating a front-run permit) and deposits it.
    function depositWithPermit(uint256 assets, address receiver, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256 shares);

    /// @notice Harvests pending sMUSD yield, absorbs any surplus and re-deposits idle MUSD. Permissionless.
    function sync() external returns (uint256 harvested);

    /// @notice Burns `shares` from `owner` and pays `receiver` `previewRedeem(shares)` in sMUSD 1:1, plus MUSD for any
    /// sMUSD shortfall.
    /// @dev Escape hatch that makes no sMUSD deposit, withdraw or claim calls.
    function redeemInKind(uint256 shares, address receiver, address owner)
        external
        returns (uint256 smusdOut, uint256 musdOut);

    /// @notice Simulates `redeemInKind(shares, ...)` at the current block.
    function previewRedeemInKind(uint256 shares) external view returns (uint256 smusdOut, uint256 musdOut);

    /// @notice sMUSD yield accrued to this vault and not yet claimed (mirrors sMUSD `_updateYieldFor`).
    function pendingYield() external view returns (uint256);

    /// @notice Raw vesting accounting: fully vested assets, assets vesting from `lastSync` to `periodEnd`.
    function vestingState() external view returns (uint256 stored, uint256 unvested, uint64 lastSync, uint64 periodEnd);

    /// @notice Timestamp of the last sync whose sMUSD `claimYield` did not revert; it stands still while claims fail.
    /// Informational: it plays no part in the accounting.
    function lastHarvest() external view returns (uint64);

    /// @notice Maximum `totalAssets()` the vault accepts through deposit and mint.
    function depositCap() external view returns (uint256);

    /// @notice Deposit cap queued by the cap admin (0 if none).
    function pendingCap() external view returns (uint256);

    /// @notice Timestamp from which the queued cap raise can be accepted (0 if none).
    function pendingCapAt() external view returns (uint64);

    /// @notice Queues a deposit-cap raise, executable after `CAP_TIMELOCK`. Cap admin only; raise only.
    function submitCapRaise(uint256 newCap) external;

    /// @notice Applies the queued cap raise once its timelock has elapsed. Permissionless.
    function acceptCapRaise() external;

    /// @notice Cancels the queued cap raise. Cap admin only.
    function revokeCapRaise() external;

    /// @notice The wrapped MUSDSavingsRate (sMUSD) contract.
    function SMUSD() external view returns (IMUSDSavingsRate);

    /// @notice The governor Safe allowed to queue and revoke cap raises.
    function CAP_ADMIN() external view returns (address);

    /// @notice Linear vesting period for harvested yield and absorbed surplus.
    function VESTING() external view returns (uint256);

    /// @notice Dust floor below which pending yield is not claimed and surplus is not absorbed or re-deposited.
    function MIN_HARVEST() external view returns (uint256);

    /// @notice Delay between `submitCapRaise` and `acceptCapRaise`.
    function CAP_TIMELOCK() external view returns (uint256);
}
