// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";

/// @notice Settable Morpho oracle for M1 tests: `price()` returns the configured 1e36-scaled price, or reverts while
/// in revert mode (simulating a Skip outage or a Pyth-deviation freeze of BtcMusdOracle).
contract MockMorphoOracle is IOracle {
    error OracleDown();

    uint256 internal _price;
    bool public reverting;

    constructor(uint256 initialPrice) {
        _price = initialPrice;
    }

    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }

    function setReverting(bool on) external {
        reverting = on;
    }

    /// @notice Price of 1 wei of bcBTC in MUSD wei, scaled by 1e36.
    function price() external view returns (uint256) {
        if (reverting) revert OracleDown();
        return _price;
    }

    /// @notice The configured price, readable even in revert mode.
    function rawPrice() external view returns (uint256) {
        return _price;
    }
}
