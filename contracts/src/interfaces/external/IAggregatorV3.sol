// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Chainlink-style reader for Mezo's Skip BTC/USD precompile (0x7b7c...0015).
/// @dev The precompile exposes only `decimals()` (18) and `latestRoundData()`; `description()` reverts.
/// `updatedAt` is the block time of the last x/oracle update and `answeredInRound` is always 0.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
