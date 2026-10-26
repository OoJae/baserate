// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {IAggregatorV3} from "../../src/interfaces/external/IAggregatorV3.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {PythMock} from "../utils/PythMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";

/// @notice Shared harness: SkipMock etched at the Skip precompile address and a PythMock with fresh BTC and MUSD.
abstract contract BtcMusdOracleBase is Test {
    bytes32 internal constant BTC_FEED = MezoAddresses.PYTH_BTC_USD;
    bytes32 internal constant MUSD_FEED = MezoAddresses.PYTH_MUSD_USD;
    address internal constant SKIP = MezoAddresses.SKIP_BTC_USD;
    uint256 internal constant NOW = 1_792_943_000;
    uint256 internal constant SKIP_PX = 80_000e18;

    SkipMock internal skipOracle;
    PythMock internal pyth;
    BtcMusdOracle internal oracle;

    function setUp() public virtual {
        vm.warp(NOW);
        vm.etch(SKIP, address(new SkipMock()).code);
        skipOracle = SkipMock(SKIP);
        skipOracle.setAnswer(int256(SKIP_PX));
        vm.label(SKIP, "SkipBtcUsd");

        pyth = new PythMock();
        pyth.setPrice(BTC_FEED, 80_100e8, -8, NOW - 100);
        pyth.setPrice(MUSD_FEED, 0.989e8, -8, NOW - 100);
        oracle = new BtcMusdOracle(address(pyth), BTC_FEED, MUSD_FEED);
    }

    /// @dev Pins Skip's answer and timestamp through `vm.mockCall`, bypassing SkipMock's positivity check.
    function _mockSkip(int256 answer, uint256 updatedAt) internal {
        vm.mockCall(
            SKIP,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(7), answer, updatedAt, updatedAt, uint80(0))
        );
    }

    function _pythWord(int256 price, int256 expo, uint256 publishTime) internal pure returns (bytes memory) {
        return abi.encode(price, uint256(0), expo, publishTime);
    }
}

contract BtcMusdOracleTest is BtcMusdOracleBase {
    // ---------------------------------------------------------------- deployment

    function test_constants() public view {
        assertEq(oracle.SKIP(), MezoAddresses.SKIP_BTC_USD, "skip");
        assertEq(oracle.PYTH(), address(pyth), "pyth");
        assertEq(oracle.BTC_FEED(), BTC_FEED, "btc feed");
        assertEq(oracle.MUSD_FEED(), MUSD_FEED, "musd feed");
        assertEq(oracle.SKIP_MAX_AGE(), 60, "skip age");
        assertEq(oracle.PYTH_MAX_AGE(), 3900, "pyth MUSD age");
        assertEq(oracle.PYTH_BTC_BAND_MAX_AGE(), 600, "pyth BTC band age");
        assertEq(oracle.MAX_DEV_BPS(), 1000, "band");
        assertEq(oracle.MUSD_MIN(), 1e18, "musd min");
        assertEq(oracle.MUSD_MAX(), 1.02e18, "musd max");
        assertEq(oracle.MAX_SKIP_ANSWER(), type(uint256).max / 1e36, "max answer");
    }

    function test_constructor_revertsOnZeroPyth() public {
        vm.expectRevert(IBtcMusdOracle.ZeroAddress.selector);
        new BtcMusdOracle(address(0), BTC_FEED, MUSD_FEED);
    }

    function test_constructor_revertsOnZeroFeed() public {
        vm.expectRevert(IBtcMusdOracle.ZeroFeed.selector);
        new BtcMusdOracle(address(pyth), bytes32(0), MUSD_FEED);
        vm.expectRevert(IBtcMusdOracle.ZeroFeed.selector);
        new BtcMusdOracle(address(pyth), BTC_FEED, bytes32(0));
    }

    // ---------------------------------------------------------------- price(): MUSD leg

    function test_price_musdBelowPegIsClampedToOne() public view {
        assertEq(oracle.price(), SKIP_PX * 1e18, "1e36 scale at MUSD = 1.00");
    }

    /// @dev contracts.md 3.1 check: 0.001 BTC is worth 80.66 MUSD, i.e. 62.1 MUSD of maximum borrow at LLTV 0.77.
    function test_price_specExample() public {
        skipOracle.setAnswer(80_661e18);
        pyth.setPrice(BTC_FEED, 80_661e8, -8, NOW);
        uint256 value = 0.001e18 * oracle.price() / 1e36;
        assertEq(value, 80.661e18, "collateral value");
        assertApproxEqAbs(value * 0.77e18 / 1e18, 62.1e18, 0.01e18, "max borrow");
    }

    function test_price_musdInsideRangeIsUsed() public {
        pyth.setPrice(MUSD_FEED, 1.01e8, -8, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e36 / 1.01e18);
        (uint256 leg, bool fresh) = oracle.musdUsd();
        assertEq(leg, 1.01e18);
        assertTrue(fresh);
    }

    function test_price_musdAboveRangeIsClampedTo102() public {
        pyth.setPrice(MUSD_FEED, 1.5e8, -8, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e36 / 1.02e18);
        (uint256 leg,) = oracle.musdUsd();
        assertEq(leg, 1.02e18);
    }

    function test_price_staleMusdDefaultsToOne() public {
        pyth.setPrice(MUSD_FEED, 1.015e8, -8, NOW - 3901);
        assertEq(oracle.price(), SKIP_PX * 1e18);
        (uint256 leg, bool fresh) = oracle.musdUsd();
        assertEq(leg, 1e18);
        assertFalse(fresh);
    }

    function test_price_musdAgeBoundary() public {
        pyth.setPrice(MUSD_FEED, 1.015e8, -8, NOW - 3900);
        assertEq(oracle.price(), SKIP_PX * 1e36 / 1.015e18, "3900 s is still fresh");
    }

    function test_price_invalidMusdDefaultsToOne() public {
        pyth.setMode(MUSD_FEED, PythMock.Mode.REVERT);
        assertEq(oracle.price(), SKIP_PX * 1e18, "reverting feed");
        pyth.setPrice(MUSD_FEED, 1.015e8, -19, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "expo -19");
        pyth.setPrice(MUSD_FEED, -1.015e8, -8, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "negative");
    }

    // ---------------------------------------------------------------- price(): Skip

    function test_price_skipAgeBoundary() public {
        skipOracle.setUpdatedAt(NOW - 60);
        assertEq(oracle.price(), SKIP_PX * 1e18, "60 s ok");
        skipOracle.setUpdatedAt(NOW - 61);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipStale.selector, 61));
        oracle.price();
    }

    function test_price_futureSkipTimestampIsAgeZero() public {
        skipOracle.setUpdatedAt(NOW + 1 days);
        assertEq(oracle.price(), SKIP_PX * 1e18);
        (uint256 px, uint256 updatedAt) = oracle.btcUsd();
        assertEq(px, SKIP_PX);
        assertEq(updatedAt, NOW + 1 days);
    }

    function test_price_revertsOnNonPositiveSkipAnswer() public {
        _mockSkip(0, NOW);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipInvalidAnswer.selector, int256(0)));
        oracle.price();
        _mockSkip(-1e18, NOW);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipInvalidAnswer.selector, int256(-1e18)));
        oracle.price();
    }

    function test_price_revertsOnOversizedSkipAnswer() public {
        int256 tooBig = int256(type(uint256).max / 1e36) + 1;
        _mockSkip(tooBig, NOW);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipInvalidAnswer.selector, tooBig));
        oracle.price();
        pyth.setMode(BTC_FEED, PythMock.Mode.REVERT);
        _mockSkip(tooBig - 1, NOW);
        assertEq(oracle.price(), uint256(tooBig - 1) * 1e18, "largest answer still prices");
    }

    function test_price_revertsWhenSkipDown() public {
        skipOracle.setMode(SkipMock.Mode.REVERT);
        vm.expectRevert(IBtcMusdOracle.SkipUnavailable.selector);
        oracle.price();
    }

    function test_price_revertsOnShortSkipReturn() public {
        vm.mockCall(
            SKIP,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(1), SKIP_PX, NOW, NOW)
        );
        vm.expectRevert(IBtcMusdOracle.SkipUnavailable.selector);
        oracle.price();
    }

    function test_price_makesOneSkipCall() public {
        vm.expectCall(SKIP, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), 1);
        oracle.price();
    }

    // ---------------------------------------------------------------- price(): Pyth BTC band

    function test_price_revertsOnPythDeviation() public {
        pyth.setPrice(BTC_FEED, 70_000e8, -8, NOW);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, SKIP_PX, 70_000e18));
        oracle.price();
    }

    function test_price_deviationBoundaryAbove() public {
        // skip = 1.1 * pyth exactly is inside the band; one more wei is outside.
        pyth.setPrice(BTC_FEED, 80_000e8, -8, NOW);
        skipOracle.setAnswer(88_000e18);
        assertEq(oracle.price(), 88_000e36);
        skipOracle.setAnswer(88_000e18 + 1);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, 88_000e18 + 1, 80_000e18));
        oracle.price();
    }

    function test_price_deviationBoundaryBelow() public {
        pyth.setPrice(BTC_FEED, 80_000e8, -8, NOW);
        skipOracle.setAnswer(72_000e18);
        assertEq(oracle.price(), 72_000e36);
        skipOracle.setAnswer(72_000e18 - 1);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, 72_000e18 - 1, 80_000e18));
        oracle.price();
    }

    function test_price_ignoresStaleDivergentPyth() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 3901);
        assertEq(oracle.price(), SKIP_PX * 1e18);
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, 40_000e18);
        assertFalse(fresh);
    }

    function test_price_bandEnforcedAt600s() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 600);
        (, bool fresh) = oracle.pythBtc();
        assertTrue(fresh, "600 s: band on");
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, SKIP_PX, 40_000e18));
        oracle.price();
    }

    /// @notice R2X-2: a Pyth BTC print more than 600 s old stops gating, so a lagging Pyth can freeze liquidations
    /// through a fast crash for at most 10 minutes after its last push (it was 3,900 s, about 65 minutes).
    function test_price_bandOffAt601s() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 601);
        assertEq(oracle.price(), SKIP_PX * 1e18, "601 s: band off");
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, 40_000e18, "still reported");
        assertFalse(fresh);
    }

    /// @dev The MUSD leg keeps its own 3,900 s bound (hourly pushes): a Pyth MUSD print too old for the BTC band is
    /// still used.
    function test_price_musdLegOutlivesTheBand() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 3900);
        pyth.setPrice(MUSD_FEED, 1.015e8, -8, NOW - 3900);
        assertEq(oracle.price(), SKIP_PX * 1e36 / 1.015e18, "band off, MUSD leg used");
        (, bool btcFresh) = oracle.pythBtc();
        (uint256 leg, bool musdFresh) = oracle.musdUsd();
        assertFalse(btcFresh);
        assertTrue(musdFresh);
        assertEq(leg, 1.015e18);
    }

    function test_price_futurePythPublishTimeIsFresh() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW + 1 hours);
        (, bool fresh) = oracle.pythBtc();
        assertTrue(fresh);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, SKIP_PX, 40_000e18));
        oracle.price();
    }

    function test_price_ignoresPythWithInvalidExpo() public {
        pyth.setPrice(BTC_FEED, 1, -19, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "expo -19");
        pyth.setPrice(BTC_FEED, 1, 1, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "expo +1");
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, 0);
        assertFalse(fresh);
    }

    function test_price_ignoresShortPythReturn() public {
        pyth.setRaw(BTC_FEED, abi.encode(int256(1), uint256(0), int256(-8)));
        assertEq(oracle.price(), SKIP_PX * 1e18);
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, 0);
        assertFalse(fresh);
    }

    function test_price_ignoresLongPythReturn() public {
        // A divergent but well-formed prefix followed by an extra word: rejected because it is not exactly 128 bytes.
        pyth.setRaw(BTC_FEED, abi.encodePacked(_pythWord(1e8, -8, NOW), uint256(0)));
        assertEq(oracle.price(), SKIP_PX * 1e18);
    }

    function test_price_ignoresDirtyInt64Price() public {
        pyth.setRaw(BTC_FEED, _pythWord(int256(type(int64).max) + 1, -8, NOW));
        assertEq(oracle.price(), SKIP_PX * 1e18);
        (uint256 px,) = oracle.pythBtc();
        assertEq(px, 0);
    }

    function test_price_ignoresNonPositivePythPrice() public {
        pyth.setPrice(BTC_FEED, 0, -8, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "zero");
        pyth.setPrice(BTC_FEED, -80_000e8, -8, NOW);
        assertEq(oracle.price(), SKIP_PX * 1e18, "negative");
    }

    function test_price_ignoresRevertingPyth() public {
        pyth.setMode(BTC_FEED, PythMock.Mode.REVERT);
        pyth.setMode(MUSD_FEED, PythMock.Mode.REVERT);
        assertEq(oracle.price(), SKIP_PX * 1e18);
    }

    function test_price_survivesPythGasBomb() public {
        pyth.setMode(BTC_FEED, PythMock.Mode.GAS_BOMB);
        pyth.setMode(MUSD_FEED, PythMock.Mode.GAS_BOMB);
        uint256 before = gasleft();
        assertEq(oracle.price(), SKIP_PX * 1e18);
        assertLt(before - gasleft(), 2 * oracle.PYTH_GAS_LIMIT() + 50_000, "bounded by the gas cap");
    }

    function test_price_survivesPythReturnBomb() public {
        pyth.setMode(BTC_FEED, PythMock.Mode.RETURN_BOMB);
        pyth.setMode(MUSD_FEED, PythMock.Mode.RETURN_BOMB);
        assertEq(oracle.price(), SKIP_PX * 1e18);
    }

    function test_price_pythWithoutCode() public {
        BtcMusdOracle o = new BtcMusdOracle(makeAddr("noCode"), BTC_FEED, MUSD_FEED);
        assertEq(o.price(), SKIP_PX * 1e18);
        (uint256 px, bool fresh) = o.pythBtc();
        assertEq(px, 0);
        assertFalse(fresh);
    }

    function test_pythBtc_scalesExponent() public {
        pyth.setPrice(BTC_FEED, 80_000, 0, NOW);
        (uint256 px,) = oracle.pythBtc();
        assertEq(px, 80_000e18, "expo 0");
        pyth.setPrice(BTC_FEED, 8e18, -14, NOW);
        (px,) = oracle.pythBtc();
        assertEq(px, 8e18 * 1e4, "expo -14");
        pyth.setPrice(BTC_FEED, 8, -18, NOW);
        (px,) = oracle.pythBtc();
        assertEq(px, 8, "expo -18");
    }

    // ---------------------------------------------------------------- status()

    function test_status_healthy() public view {
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok, "ok");
        assertEq(s.price, oracle.price(), "price");
        assertEq(s.skipPrice, SKIP_PX, "skip");
        assertEq(s.skipAge, 0, "skip age");
        assertEq(s.pythBtcPrice, 80_100e18, "pyth btc");
        assertEq(s.pythBtcAge, 100, "pyth btc age");
        assertTrue(s.pythBtcFresh, "pyth btc fresh");
        assertEq(s.musdPrice, 0.989e18, "raw musd");
        assertEq(s.musdAge, 100, "musd age");
        assertTrue(s.musdFresh, "musd fresh");
        // |80000 - 80100| / 80100 = 12.48 bps, rounded up.
        assertEq(s.deviationBps, 13, "deviation");
    }

    function test_status_skipDown() public {
        skipOracle.setMode(SkipMock.Mode.REVERT);
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.price, 0);
        assertEq(s.skipPrice, 0);
        assertEq(s.skipAge, type(uint256).max);
        assertEq(s.pythBtcPrice, 80_100e18, "pyth still reported");
        assertTrue(s.musdFresh);
        assertEq(s.deviationBps, 0);
    }

    function test_status_shortSkipReturn() public {
        vm.mockCall(SKIP, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), hex"01");
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.skipPrice, 0);
        assertEq(s.skipAge, type(uint256).max);
    }

    function test_status_skipStale() public {
        skipOracle.setUpdatedAt(NOW - 61);
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.price, 0);
        assertEq(s.skipPrice, SKIP_PX, "answer still reported");
        assertEq(s.skipAge, 61);
    }

    function test_status_skipNonPositive() public {
        _mockSkip(-5, NOW - 10);
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.skipPrice, 0);
        assertEq(s.skipAge, 10);
        assertEq(s.deviationBps, 0);
    }

    function test_status_skipOversized() public {
        _mockSkip(type(int256).max, NOW);
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.price, 0);
        assertEq(s.skipPrice, uint256(type(int256).max));
        assertEq(s.deviationBps, 0);
    }

    function test_status_deviationBreached() public {
        pyth.setPrice(BTC_FEED, 70_000e8, -8, NOW);
        BtcMusdOracle.Status memory s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.price, 0);
        assertTrue(s.pythBtcFresh);
        assertEq(s.deviationBps, 1429, "10000/70000 rounded up");
    }

    function test_status_deviationBoundaryMatchesBand() public {
        pyth.setPrice(BTC_FEED, 80_000e8, -8, NOW);
        skipOracle.setAnswer(88_000e18);
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok);
        assertEq(s.deviationBps, 1000);
        skipOracle.setAnswer(88_000e18 + 1);
        s = oracle.status();
        assertFalse(s.ok);
        assertEq(s.deviationBps, 1001, "rounded up past the band");
    }

    function test_status_staleDivergentPythReportedButIgnored() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 4000);
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok);
        assertFalse(s.pythBtcFresh);
        assertEq(s.pythBtcAge, 4000);
        assertEq(s.deviationBps, 10_000);
        assertEq(s.price, SKIP_PX * 1e18);
    }

    function test_status_bandAgeBoundary() public {
        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 600);
        BtcMusdOracle.Status memory s = oracle.status();
        assertEq(s.pythBtcAge, 600);
        assertTrue(s.pythBtcFresh, "600 s: band on");
        assertFalse(s.ok, "band trips");
        assertEq(s.price, 0);

        pyth.setPrice(BTC_FEED, 40_000e8, -8, NOW - 601);
        s = oracle.status();
        assertEq(s.pythBtcAge, 601);
        assertFalse(s.pythBtcFresh, "601 s: band off");
        assertTrue(s.ok, "prices on Skip alone");
        assertEq(s.price, SKIP_PX * 1e18);
        assertEq(s.deviationBps, 10_000, "deviation still reported");
        assertTrue(s.musdFresh, "the MUSD leg keeps its own 3,900 s bound");
    }

    function test_status_invalidPyth() public {
        pyth.setMode(BTC_FEED, PythMock.Mode.GAS_BOMB);
        pyth.setRaw(MUSD_FEED, hex"deadbeef");
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok);
        assertEq(s.price, SKIP_PX * 1e18);
        assertEq(s.pythBtcPrice, 0);
        assertEq(s.pythBtcAge, type(uint256).max);
        assertFalse(s.pythBtcFresh);
        assertEq(s.musdPrice, 0);
        assertEq(s.musdAge, type(uint256).max);
        assertFalse(s.musdFresh);
        assertEq(s.deviationBps, 0);
    }

    function test_status_futureTimestampsAreAgeZero() public {
        skipOracle.setUpdatedAt(NOW + 5);
        pyth.setPrice(BTC_FEED, 80_000e8, -8, NOW + 5);
        pyth.setPrice(MUSD_FEED, 1.01e8, -8, NOW + 5);
        BtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok);
        assertEq(s.skipAge, 0);
        assertEq(s.pythBtcAge, 0);
        assertEq(s.musdAge, 0);
        assertEq(s.price, SKIP_PX * 1e36 / 1.01e18);
    }

    function test_status_makesOneSkipCall() public {
        vm.expectCall(SKIP, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), 1);
        oracle.status();
    }

    function test_btcUsd_revertsWhenStale() public {
        skipOracle.setUpdatedAt(NOW - 120);
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipStale.selector, 120));
        oracle.btcUsd();
    }

    function test_btcUsd_ignoresPythDeviation() public {
        pyth.setPrice(BTC_FEED, 1e8, -8, NOW);
        (uint256 px, uint256 updatedAt) = oracle.btcUsd();
        assertEq(px, SKIP_PX);
        assertEq(updatedAt, NOW);
    }
}
