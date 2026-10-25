// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Baserate Collateral BTC (bcBTC): a 1:1 native-BTC receipt that only factory-registered BorrowAccount
/// clones can mint and that can only move between those clones and Morpho.
/// @dev The design spec calls this token brBTC; it ships as bcBTC to avoid Bedrock's brBTC ticker.
/// Transfer gate: a transfer passes only if `from == MORPHO` (withdrawCollateral, liquidate) or
/// `to == MORPHO && isAccount(from)` (supplyCollateral pulling from a clone). Anyone holding bcBTC can unwrap it.
interface ICollateralBTC {
    /// @notice Emitted when a registered account wraps native BTC.
    event Wrapped(address indexed account, uint256 amount);
    /// @notice Emitted when `from` burns `amount` and native BTC is sent to `to`.
    event Unwrapped(address indexed from, address indexed to, uint256 amount);

    /// @notice The caller of `wrap` is not a factory-registered account.
    error NotAccount(address caller);
    /// @notice A transfer outside the clone <-> Morpho gate.
    error TransferRestricted(address from, address to);
    /// @notice The native BTC send in `unwrap` failed.
    error NativeSendFailed(address to, uint256 amount);
    /// @notice A zero amount was passed or sent.
    error ZeroAmount();
    /// @notice A zero address was passed where a recipient is required.
    error ZeroAddress();

    /// @notice The BorrowAccountFactory that deployed this token and owns the account registry.
    function FACTORY() external view returns (address);

    /// @notice The Morpho Blue singleton, the only counterparty a clone may transfer to.
    function MORPHO() external view returns (address);

    /// @notice Wraps `msg.value` native BTC 1:1 into bcBTC minted to the caller.
    /// @dev Reverts with `NotAccount` unless the caller is a factory-registered BorrowAccount.
    /// @return minted The amount minted, equal to `msg.value`.
    function wrap() external payable returns (uint256 minted);

    /// @notice Burns `amount` of the caller's bcBTC and sends the same amount of native BTC to `to`.
    /// @dev Open to any holder (clones and liquidators). Burns before the native send.
    function unwrap(uint256 amount, address to) external;
}
