// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/external/IAggregatorV3.sol";

/// @notice Stand-in for Mezo's Skip BTC/USD precompile, etched at its address in fork and unit tests.
/// @dev Mirrors the live precompile: 18 decimals, `answeredInRound == 0`, and a revert on a non-positive price.
/// LIVE reports `updatedAt = block.timestamp`, FIXED reports a pinned timestamp, REVERT simulates an outage.
contract SkipMock is IAggregatorV3 {
    enum Mode {
        LIVE,
        FIXED,
        REVERT
    }

    Mode public mode;
    int256 public answer;
    uint80 public roundId;
    uint256 public fixedUpdatedAt;

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function setAnswer(int256 newAnswer) external {
        answer = newAnswer;
        roundId++;
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function setUpdatedAt(uint256 updatedAt) external {
        fixedUpdatedAt = updatedAt;
        mode = Mode.FIXED;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(mode != Mode.REVERT, "SkipMock: oracle down");
        require(answer > 0, "SkipMock: invalid price");
        uint256 updatedAt = mode == Mode.FIXED ? fixedUpdatedAt : block.timestamp;
        return (roundId, answer, updatedAt, updatedAt, 0);
    }
}
