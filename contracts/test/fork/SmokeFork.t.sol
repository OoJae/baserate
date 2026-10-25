// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IMorpho} from "morpho-blue/interfaces/IMorpho.sol";

import {IMUSDSavingsRate} from "../../src/interfaces/external/IMUSDSavingsRate.sol";
import {IPythLite} from "../../src/interfaces/external/IPythLite.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice Phase 0 gate: forks resolve, the Skip mock serves the fork-block price, and the external wiring holds.
contract SmokeForkTest is MezoFork {
    function test_testnetWiring() public {
        _fork(Net.TESTNET);
        _assertWiring();
    }

    function test_mainnetWiring() public {
        _fork(Net.MAINNET);
        _assertWiring();
    }

    function _assertWiring() internal view {
        IMorpho morpho = IMorpho(net.morpho);
        assertTrue(morpho.isLltvEnabled(net.lltv), "lltv enabled");
        assertTrue(morpho.isIrmEnabled(net.irm), "irm enabled");

        (, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = skipOracle.latestRoundData();
        assertGt(answer, 0, "skip answer");
        assertEq(updatedAt, block.timestamp, "skip live");
        assertEq(answeredInRound, 0, "skip answeredInRound");

        IPythLite.Price memory p = IPythLite(net.pyth).getPriceUnsafe(MezoAddresses.PYTH_BTC_USD);
        assertGt(p.price, 0, "pyth btc");

        IMUSDSavingsRate smusd = IMUSDSavingsRate(net.smusd);
        assertEq(smusd.musdToken(), net.musd, "smusd asset");
        assertGt(smusd.yieldIndex(), 0, "smusd index");
    }
}
