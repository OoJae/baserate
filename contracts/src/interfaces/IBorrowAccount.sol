// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

/// @notice A per-owner EIP-1167 clone that holds one M1 position (bcBTC collateral, MUSD debt) on Morpho Blue.
/// @dev The owner is the clone's immutable argument; there is no initializer. Every state-changing entry point is
/// callable only by the owner or the factory (the factory only ever acts on `accountOf(msg.sender)`), except
/// `borrowByModule` (enabled, factory-approved modules) and `receive`. No entry point accepts the clone itself as a
/// receiver, so the clone ends every call holding 0 MUSD and 0 bcBTC; tokens sent to it directly can be swept.
interface IBorrowAccount {
    /// @notice Emitted by `openAndBorrow`.
    event Opened(address indexed owner, uint256 collateralAdded, uint256 musdOut);
    /// @notice Emitted on every borrow. `debt` is the post-borrow debt, `ltvBps` the post-borrow LTV (rounded up).
    event Borrowed(address indexed owner, uint256 musdOut, uint256 fee, uint256 debt, uint256 ltvBps);
    /// @notice Emitted by `repay`.
    event Repaid(address indexed owner, uint256 repaid, uint256 remainingDebt);
    /// @notice Emitted by the full exit (`repayAndWithdraw*`).
    event Exited(address indexed owner, uint256 repaid, uint256 btcOut);
    /// @notice Emitted when collateral is wrapped and supplied.
    event CollateralAdded(address indexed owner, uint256 amount, uint256 collateral);
    /// @notice Emitted by `withdrawCollateral`.
    event CollateralWithdrawn(address indexed owner, uint256 amount, address indexed btcTo);
    /// @notice Emitted by `setModule`.
    event ModuleSet(address indexed module, bool enabled);
    /// @notice Emitted by `rescueNative`.
    event NativeRescued(address indexed to, uint256 amount);
    /// @notice Emitted by `sweep`.
    event Swept(address indexed token, address indexed to, uint256 amount);

    /// @notice The caller is neither the owner nor the factory (or not the owner for owner-only calls).
    error Unauthorized();
    /// @notice The post-action LTV exceeds the applicable limit.
    error LtvTooHigh(uint256 ltvBps, uint256 limitBps);
    /// @notice A borrow on a position whose collateral is above its profile's cap.
    error PositionCapExceeded(uint256 collateral, uint256 positionCap);
    /// @notice M1 `totalBorrowAssets` would exceed the global borrow cap.
    error GlobalCapExceeded(uint256 totalBorrowAssets, uint256 globalBorrowCap);
    /// @notice New positions and borrows are paused.
    error BorrowPaused();
    /// @notice Module draws are paused.
    error CreditPaused();
    /// @notice The module is not enabled on this account or not approved by the factory.
    error ModuleNotApproved(address module);
    /// @notice The CANARY account's owner is no longer a canary operator.
    error NotCanaryOperator(address owner);
    /// @notice A zero amount.
    error ZeroAmount();
    /// @notice A zero recipient.
    error ZeroAddress();
    /// @notice The clone itself was given as a recipient.
    error InvalidReceiver(address receiver);
    /// @notice `repay` with no outstanding debt.
    error NoDebt();
    /// @notice The exit found neither debt nor collateral.
    error NoPosition();
    /// @notice The exit's exact debt exceeds the caller's `maxRepay`.
    error RepayExceedsMax(uint256 debt, uint256 maxRepay);
    /// @notice The native BTC send in `rescueNative` failed.
    error NativeSendFailed(address to, uint256 amount);

    /// @notice The clone's owner (its immutable argument). Returns 0 on the implementation itself.
    function owner() external view returns (address);

    /// @notice The factory that deployed the implementation and every clone.
    function FACTORY() external view returns (address);

    /// @notice Morpho Blue.
    function MORPHO() external view returns (address);

    /// @notice The M1 market id.
    function MARKET_ID() external view returns (Id);

    /// @notice The M1 market parameters (MUSD loan, bcBTC collateral, oracle, IRM, LLTV).
    function marketParams() external view returns (MarketParams memory);

    /// @notice True when `module` may call `borrowByModule` (still subject to factory approval).
    function moduleEnabled(address module) external view returns (bool);

    /// @notice Collateral supplied to M1, in bcBTC wei.
    function collateral() external view returns (uint256);

    /// @notice Expected debt including interest accrued up to now, rounded up (MorphoBalancesLib).
    function debt() external view returns (uint256);

    /// @notice Wraps `msg.value`, supplies it and, if `musdOut > 0`, borrows to `receiver`. Blocked while paused.
    /// The position cap applies only when borrowing.
    /// @param musdOut MUSD sent to `receiver`; the debt also includes the origination fee.
    /// @param maxLtvBps Post-borrow LTV must be <= min(maxLtvBps, profile ceiling).
    /// @param receiver Recipient of the borrowed MUSD (not this clone).
    function openAndBorrow(uint256 musdOut, uint256 maxLtvBps, address receiver) external payable;

    /// @notice Borrows `musdOut` MUSD to `receiver` against existing collateral. Refused while the collateral is above
    /// the profile's position cap.
    function borrow(uint256 musdOut, uint256 maxLtvBps, address receiver) external;

    /// @notice Wraps `msg.value` and supplies it as collateral. Never paused and never limited by the position cap,
    /// so a position can always be defended with more BTC.
    function addCollateral() external payable;

    /// @notice Supplies the clone's own idle native BTC (for example a CollSurplusPool claim), then optionally
    /// borrows. Without a borrow all idle BTC is supplied, whatever the position cap. With a borrow only the room left
    /// under the position cap is supplied, so the borrow can pass its cap check.
    /// @return supplied The BTC supplied; any excess stays idle and can be rescued by the owner.
    function supplyIdle(uint256 musdOut, uint256 maxLtvBps, address receiver) external returns (uint256 supplied);

    /// @notice Pulls up to `assets` MUSD from the owner and repays. If `assets` covers the debt, repays exactly the
    /// debt by shares. No oracle call.
    /// @return repaid MUSD actually pulled and repaid.
    function repay(uint256 assets) external returns (uint256 repaid);

    /// @notice Full exit: accrues, pulls exactly the debt from the owner, repays by shares, withdraws all collateral
    /// and unwraps it to `btcTo`. No oracle call, so it works while the oracle reverts.
    function repayAndWithdraw(address btcTo) external;

    /// @notice `repayAndWithdraw` preceded by an MUSD permit (owner -> this clone, `maxRepay`). The permit runs in
    /// try/catch so a front-run permit does not block the exit; the exact debt must be <= `maxRepay`.
    function repayAndWithdrawWithPermit(
        uint256 maxRepay,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address btcTo
    ) external;

    /// @notice Withdraws `amount` collateral and unwraps it to `btcTo`. With debt outstanding, the post-withdraw LTV
    /// must be <= the profile ceiling (one oracle read); for a CANARY account whose owner is no longer a canary
    /// operator, <= the lower of the CANARY and STANDARD ceilings. Without debt there is no oracle call.
    function withdrawCollateral(uint256 amount, address btcTo) external;

    /// @notice Wave 2 credit-line hook: an enabled, factory-approved module borrows on the owner's behalf under the
    /// same checks. Blocked while borrows or credit are paused.
    function borrowByModule(uint256 musdOut, uint256 maxLtvBps, address receiver) external;

    /// @notice Enables or disables a module (owner only). Enabling requires factory approval.
    function setModule(address module, bool enabled) external;

    /// @notice Sends the clone's idle native BTC to `to` (owner only).
    function rescueNative(address to) external;

    /// @notice Sends the clone's whole balance of `token` (for example MUSD transferred to it directly) to `to`
    /// (owner only). bcBTC cannot leave this way: its transfer gate only lets a clone send it to Morpho.
    /// @return amount The amount swept.
    function sweep(address token, address to) external returns (uint256 amount);
}
