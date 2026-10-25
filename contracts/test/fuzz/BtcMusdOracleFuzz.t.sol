// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {PythMock} from "../utils/PythMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";
import {BtcMusdOracleBase} from "../unit/BtcMusdOracle.t.sol";

/// @notice Oracle math under fuzzing: Pyth scaling and exponent range, the MUSD clamp, the deviation boundary, Skip age
/// and answer validation, and `status()` agreeing with `price()` on arbitrary inputs without ever reverting.
contract BtcMusdOracleFuzzTest is BtcMusdOracleBase {
    uint256 internal constant MAX_SKIP_ANSWER = type(uint256).max / 1e36;

    function _clamp(uint256 x) internal pure returns (uint256) {
        return x < 1e18 ? 1e18 : x > 1.02e18 ? 1.02e18 : x;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /// @dev Shape 0: well-formed. 1: truncated to 96 bytes. 2: one extra word. 3: reverts.
    function _setPythShape(bytes32 feed, int256 px, int256 expo, uint256 publishTime, uint256 shape) internal {
        bytes memory full = abi.encode(px, uint256(0), expo, publishTime);
        shape %= 4;
        if (shape == 0) {
            pyth.setRaw(feed, full);
        } else if (shape == 1) {
            pyth.setRaw(feed, abi.encode(px, uint256(0), expo));
        } else if (shape == 2) {
            pyth.setRaw(feed, abi.encodePacked(full, uint256(1)));
        } else {
            pyth.setMode(feed, PythMock.Mode.REVERT);
        }
    }

    function testFuzz_pythScaling(int64 rawPrice, int32 expo, uint256 age) public {
        rawPrice = int64(bound(rawPrice, 1, type(int64).max));
        expo = int32(bound(expo, -18, 0));
        age = bound(age, 0, 3900);
        pyth.setPrice(BTC_FEED, rawPrice, expo, NOW - age);
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, uint256(uint64(rawPrice)) * 10 ** uint256(int256(18 + expo)), "scaled");
        assertTrue(fresh, "fresh");
    }

    function testFuzz_pythOutOfRangeExpoIsIgnored(int64 rawPrice, int32 expo) public {
        vm.assume(expo < -18 || expo > 0);
        rawPrice = int64(bound(rawPrice, 1, type(int64).max));
        pyth.setPrice(BTC_FEED, rawPrice, expo, NOW);
        pyth.setPrice(MUSD_FEED, rawPrice, expo, NOW);
        (uint256 px, bool fresh) = oracle.pythBtc();
        assertEq(px, 0);
        assertFalse(fresh);
        (uint256 leg, bool musdFresh) = oracle.musdUsd();
        assertEq(leg, 1e18);
        assertFalse(musdFresh);
        assertEq(oracle.price(), SKIP_PX * 1e18);
    }

    function testFuzz_musdLegIsClamped(int64 rawPrice, uint256 age) public {
        rawPrice = int64(bound(rawPrice, 1, type(int64).max));
        age = bound(age, 0, 10_000);
        pyth.setPrice(MUSD_FEED, rawPrice, -8, NOW - age);
        bool fresh = age <= 3900;
        uint256 expected = fresh ? _clamp(uint256(uint64(rawPrice)) * 1e10) : 1e18;

        (uint256 leg, bool legFresh) = oracle.musdUsd();
        assertEq(leg, expected, "leg");
        assertEq(legFresh, fresh, "fresh");
        assertGe(leg, 1e18, "floor");
        assertLe(leg, 1.02e18, "cap");

        uint256 px = oracle.price();
        assertEq(px, SKIP_PX * 1e36 / expected, "price");
        assertLe(px, SKIP_PX * 1e18, "never above the USD price");
    }

    function testFuzz_priceFormula(uint256 skipPx, int64 musdRaw) public {
        skipPx = bound(skipPx, 1, MAX_SKIP_ANSWER);
        musdRaw = int64(bound(musdRaw, 1, type(int64).max));
        skipOracle.setAnswer(int256(skipPx));
        pyth.setPrice(BTC_FEED, 1, -8, NOW - 3901); // stale: band off
        pyth.setPrice(MUSD_FEED, musdRaw, -8, NOW);
        assertEq(oracle.price(), skipPx * 1e36 / _clamp(uint256(uint64(musdRaw)) * 1e10));
    }

    function testFuzz_deviationBand(int64 pythRaw, uint256 skipPx) public {
        pythRaw = int64(bound(pythRaw, 1, type(int64).max));
        uint256 pythPx = uint256(uint64(pythRaw)) * 1e10;
        skipPx = bound(skipPx, 1, pythPx * 13 / 10);
        skipOracle.setAnswer(int256(skipPx));
        pyth.setPrice(BTC_FEED, pythRaw, -8, NOW);

        uint256 diff = _absDiff(skipPx, pythPx);
        bool breach = diff * 1e4 > 1000 * pythPx;
        if (breach) vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, skipPx, pythPx));
        oracle.price();

        BtcMusdOracle.Status memory s = oracle.status();
        assertEq(s.ok, !breach, "ok");
        assertEq(s.deviationBps, _ceilDiv(diff * 1e4, pythPx), "deviation rounded up");
        assertEq(s.deviationBps > 1000, breach, "deviationBps agrees with the band");
    }

    function testFuzz_deviationBoundaryExact(int64 pythRaw) public {
        pythRaw = int64(bound(pythRaw, 1, type(int64).max));
        uint256 pythPx = uint256(uint64(pythRaw)) * 1e10; // divisible by 10, so the +-10% edges are exact
        pyth.setPrice(BTC_FEED, pythRaw, -8, NOW);

        skipOracle.setAnswer(int256(pythPx * 11 / 10));
        assertEq(oracle.price(), pythPx * 11 / 10 * 1e18, "upper edge inside");
        skipOracle.setAnswer(int256(pythPx * 11 / 10 + 1));
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, pythPx * 11 / 10 + 1, pythPx));
        oracle.price();

        skipOracle.setAnswer(int256(pythPx * 9 / 10));
        assertEq(oracle.price(), pythPx * 9 / 10 * 1e18, "lower edge inside");
        skipOracle.setAnswer(int256(pythPx * 9 / 10 - 1));
        vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, pythPx * 9 / 10 - 1, pythPx));
        oracle.price();
    }

    function testFuzz_skipAge(uint256 updatedAt) public {
        updatedAt = bound(updatedAt, 0, NOW + 365 days);
        skipOracle.setUpdatedAt(updatedAt);
        uint256 age = updatedAt >= NOW ? 0 : NOW - updatedAt;
        if (age > 60) vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipStale.selector, age));
        oracle.price();

        BtcMusdOracle.Status memory s = oracle.status();
        assertEq(s.skipAge, age, "age");
        assertEq(s.ok, age <= 60, "ok");
    }

    function testFuzz_skipAnswer(int256 answer) public {
        _mockSkip(answer, NOW);
        pyth.setPrice(BTC_FEED, 1, -8, NOW - 3901); // isolate Skip validation from the band
        bool valid = answer > 0 && uint256(answer) <= MAX_SKIP_ANSWER;
        BtcMusdOracle.Status memory s = oracle.status();
        assertEq(s.ok, valid, "ok");
        assertEq(s.skipPrice, answer > 0 ? uint256(answer) : 0, "skipPrice");
        if (valid) {
            assertEq(oracle.price(), uint256(answer) * 1e18, "price");
            assertEq(s.price, uint256(answer) * 1e18, "status price");
        } else {
            vm.expectRevert(abi.encodeWithSelector(IBtcMusdOracle.SkipInvalidAnswer.selector, answer));
            oracle.price();
        }
    }

    /// @dev Mixed scenario over every input; `status()` must never revert and must agree with `price()`.
    function testFuzz_statusAgreesWithPrice(
        uint256 skipPx,
        uint256 skipAge,
        bool skipUp,
        uint256 devBps,
        bool pythBelow,
        uint256 btcAge,
        uint256 btcShape,
        int256 musdPx,
        int256 musdExpo,
        uint256 musdAge,
        uint256 musdShape
    ) public {
        skipPx = bound(skipPx, 1e10, 9e26);
        skipAge = bound(skipAge, 0, 120);
        devBps = bound(devBps, 0, 2000);
        btcAge = bound(btcAge, 0, 7200);
        musdPx = bound(musdPx, -10, 2e8);
        musdExpo = bound(musdExpo, -20, 2);
        musdAge = bound(musdAge, 0, 7200);

        if (skipUp) {
            skipOracle.setAnswer(int256(skipPx));
            skipOracle.setUpdatedAt(NOW - skipAge);
        } else {
            skipOracle.setMode(SkipMock.Mode.REVERT);
        }
        uint256 pythPx = pythBelow ? skipPx * (1e4 - devBps) / 1e4 : skipPx * (1e4 + devBps) / 1e4;
        _setPythShape(BTC_FEED, int256(pythPx / 1e10), -8, NOW - btcAge, btcShape);
        _setPythShape(MUSD_FEED, musdPx, musdExpo, NOW - musdAge, musdShape);

        BtcMusdOracle.Status memory s = oracle.status();
        try oracle.price() returns (uint256 px) {
            assertTrue(s.ok, "price ok => status ok");
            assertEq(px, s.price, "same price");
            assertGt(px, 0, "non-zero");
        } catch {
            assertFalse(s.ok, "price reverts => status not ok");
            assertEq(s.price, 0, "no price when not ok");
        }
        if (s.pythBtcFresh) assertEq(s.ok, skipUp && skipAge <= 60 && s.deviationBps <= 1000, "band via deviationBps");
    }

    /// @dev Arbitrary Pyth return data for both feeds never makes `status()` revert, and `price()` only reverts through
    /// the band (a decodable, fresh, divergent BTC price).
    function testFuzz_arbitraryPythReturnData(bytes calldata btcRet, bytes calldata musdRet) public {
        pyth.setRaw(BTC_FEED, btcRet);
        pyth.setRaw(MUSD_FEED, musdRet);
        BtcMusdOracle.Status memory s = oracle.status();
        assertGe(s.skipPrice, 1, "skip read");
        try oracle.price() returns (uint256 px) {
            assertTrue(s.ok);
            assertEq(px, s.price);
            assertLe(px, SKIP_PX * 1e18);
            assertGe(px, SKIP_PX * 1e36 / 1.02e18);
        } catch (bytes memory err) {
            assertFalse(s.ok);
            assertTrue(s.pythBtcFresh, "only the band can revert here");
            assertEq(bytes4(err), IBtcMusdOracle.PythDeviation.selector);
        }
    }
}
