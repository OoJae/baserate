// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The subset of Mezo's MUSDSavingsRate (sMUSD) that Baserate uses.
/// @dev sMUSD is not ERC-4626: shares are minted 1:1 for MUSD and yield accrues through a separate index that
/// holders realize with `claimYield()`. `deposit`, `withdraw` and `claimYield` are `nonReentrant`; `withdraw`
/// auto-claims pending yield. Verified against implementation 0x92D12f0a60906b39d81acD9bf8977b6c824cD98C (testnet).
interface IMUSDSavingsRate {
    error AmountTooSmall();
    error InsufficientBalance();
    error ZeroAmount();

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external returns (uint256);
    function receiveProtocolYield(uint256 amount) external;

    function claimableYield(address account) external view returns (uint256);
    function supplyYieldIndex(address account) external view returns (uint256);
    function yieldIndex() external view returns (uint256);
    function pendingYield() external view returns (uint256);
    function musdToken() external view returns (address);
    function pcv() external view returns (address);
    function strategy() external view returns (address);
    function vaultGauge() external view returns (address);

    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
