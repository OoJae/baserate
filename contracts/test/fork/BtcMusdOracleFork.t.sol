// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {IPythLite} from "../../src/interfaces/external/IPythLite.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {MezoFork} from "../utils/MezoFork.sol";
import {SkipMock} from "../utils/SkipMock.sol";

/// @notice BtcMusdOracle against the real Pyth deployments at the pinned blocks, with SkipMock seeded with the real
/// Skip answer at the same block (Mezo precompiles hang under a local fork).
contract BtcMusdOracleForkTest is MezoFork {
    BtcMusdOracle internal oracle;

    function _setUpNet(Net which) internal {
        _fork(which);
        oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        vm.label(net.pyth, "Pyth");
    }

    // ---------------------------------------------------------------- testnet

    function test_testnet_priceMatchesSkip() public {
        _setUpNet(Net.TESTNET);
        _assertPriceMatchesSkip();
    }

    function test_testnet_statusSane() public {
        _setUpNet(Net.TESTNET);
        _assertStatusSane();
    }

    function test_testnet_skipFailuresFreezePriceButNotStatus() public {
        _setUpNet(Net.TESTNET);
        _assertSkipFailures();
    }

    function test_testnet_divergentSkipTripsRealPythBand() public {
        _setUpNet(Net.TESTNET);
        _assertBandTrips();
    }

    function test_testnet_pythGasHeadroom() public {
        _setUpNet(Net.TESTNET);
        _assertPythGasHeadroom();
    }

    // ---------------------------------------------------------------- mainnet

    function test_mainnet_priceMatchesSkip() public {
        _setUpNet(Net.MAINNET);
        _assertPriceMatchesSkip();
    }

    function test_mainnet_statusSane() public {
        _setUpNet(Net.MAINNET);
        _assertStatusSane();
    }

    function test_mainnet_skipFailuresFreezePriceButNotStatus() public {
        _setUpNet(Net.MAINNET);
        _assertSkipFailures();
    }

    function test_mainnet_divergentSkipTripsRealPythBand() public {
        _setUpNet(Net.MAINNET);
        _assertBandTrips();
    }

    function test_mainnet_pythGasHeadroom() public {
        _setUpNet(Net.MAINNET);
        _assertPythGasHeadroom();
    }

    // ---------------------------------------------------------------- shared assertions

    function _skipAnswer() internal view returns (uint256) {
        return uint256(skipOracle.answer());
    }

    function _assertPriceMatchesSkip() internal view {
        uint256 skipPx = _skipAnswer();
        uint256 px = oracle.price();
        // MUSD/USD is clamped to [1.00, 1.02]; with MUSD at or below peg, price() is exactly Skip at 1e36 scale.
        assertApproxEqRel(px, skipPx * 1e18, 1e14, "price within 1 bps of Skip");
        (uint256 leg,) = oracle.musdUsd();
        assertEq(px, skipPx * 1e36 / leg, "formula");
        // 0.001 BTC of collateral is worth Skip/1000 MUSD (about 80.6 MUSD at the pinned blocks).
        assertApproxEqRel(0.001e18 * px / 1e36, skipPx / 1000, 1e14, "collateral value");
    }

    function _assertStatusSane() internal view {
        uint256 skipPx = _skipAnswer();
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok, "ok");
        assertEq(s.price, oracle.price(), "status price");
        assertEq(s.skipPrice, skipPx, "skip price");
        assertEq(s.skipAge, 0, "skip age (live mock)");

        IPythLite.Price memory btc = IPythLite(net.pyth).getPriceUnsafe(MezoAddresses.PYTH_BTC_USD);
        assertEq(s.pythBtcPrice, uint256(uint64(btc.price)) * 10 ** uint256(int256(18 + btc.expo)), "pyth btc scale");
        assertEq(s.pythBtcAge, block.timestamp - btc.publishTime, "pyth btc age");
        assertTrue(s.pythBtcFresh, "pyth btc fresh at the pinned block");
        assertLe(s.pythBtcAge, oracle.PYTH_BTC_BAND_MAX_AGE(), "pyth btc band age bound (600 s)");
        assertLt(s.deviationBps, 50, "skip and pyth agree within 0.5%");

        assertTrue(s.musdFresh, "pyth musd fresh at the pinned block");
        assertGe(s.musdPrice, 0.95e18, "musd lower sanity");
        assertLe(s.musdPrice, 1.05e18, "musd upper sanity");
        (uint256 leg, bool fresh) = oracle.musdUsd();
        assertTrue(fresh, "leg fresh");
        assertGe(leg, oracle.MUSD_MIN(), "leg floor");
        assertLe(leg, oracle.MUSD_MAX(), "leg cap");

        (uint256 pythPx, bool pythFresh) = oracle.pythBtc();
        assertEq(pythPx, s.pythBtcPrice, "pythBtc view");
        assertTrue(pythFresh, "pythBtc fresh");
        (uint256 btcPx, uint256 updatedAt) = oracle.btcUsd();
        assertEq(btcPx, skipPx, "btcUsd");
        assertEq(updatedAt, block.timestamp, "btcUsd updatedAt");
    }

    function _assertSkipFailures() internal {
        skipOracle.setUpdatedAt(block.timestamp - 61);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipStale.selector, 61));
        oracle.price();
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok, "stale not ok");
        assertEq(s.skipAge, 61, "stale age");
        assertTrue(s.pythBtcFresh, "pyth still read");

        skipOracle.setMode(SkipMock.Mode.REVERT);
        vm.expectRevert(IBtcMusdOracle.SkipUnavailable.selector);
        oracle.price();
        s = oracle.status();
        assertFalse(s.ok, "down not ok");
        assertEq(s.skipPrice, 0, "down price");
        assertEq(s.skipAge, type(uint256).max, "down age");
        assertGt(s.pythBtcPrice, 0, "pyth still read");
    }

    function _assertBandTrips() internal {
        (uint256 pythPx,) = oracle.pythBtc();
        uint256 edge = pythPx * 11 / 10;
        skipOracle.setAnswer(int256(edge));
        assertEq(oracle.price(), edge * 1e18, "edge of band still prices");
        skipOracle.setAnswer(int256(edge + 1e18));
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, edge + 1e18, pythPx));
        oracle.price();
        assertFalse(oracle.status().ok, "status reports the trip");
    }

    function _assertPythGasHeadroom() internal view {
        uint256 before = gasleft();
        IPythLite(net.pyth).getPriceUnsafe(MezoAddresses.PYTH_BTC_USD);
        uint256 used = before - gasleft();
        assertLt(used * 10, oracle.PYTH_GAS_LIMIT(), "real Pyth read uses under 10% of the gas cap");
    }
}
