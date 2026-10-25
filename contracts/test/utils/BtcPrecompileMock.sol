// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

/// @notice Read-only stand-in for Mezo's BTC ERC-20 precompile (0x7b7C...0000), etched in fork tests.
/// @dev On the live chain the precompile and native BTC share one balance, so `balanceOf(a) == a.balance`; the fork
/// keeps native balances, so mirroring them reproduces the precompile's reads exactly. Under a local fork the real
/// precompile's stub bytecode calls its own address and reverts, which would make every Slipstream swap or quote
/// that touches BTC fail. Transfers are deliberately not mocked: RiskLens only needs `balanceOf` (Slipstream reads
/// `BTC.balanceOf(pool)` once per quote before the quoter's callback reverts).
contract BtcPrecompileMock {
    function balanceOf(address account) external view returns (uint256) {
        return account.balance;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function symbol() external pure returns (string memory) {
        return "BTC";
    }
}
