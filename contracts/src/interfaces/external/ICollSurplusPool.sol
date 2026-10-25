// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Read surface of MUSD's CollSurplusPool, which holds BTC owed to borrowers whose troves were redeemed.
interface ICollSurplusPool {
    function getCollateral(address account) external view returns (uint256);
}
