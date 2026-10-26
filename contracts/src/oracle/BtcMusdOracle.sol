// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAggregatorV3} from "../interfaces/external/IAggregatorV3.sol";
import {IPythLite} from "../interfaces/external/IPythLite.sol";
import {IBtcMusdOracle} from "./IBtcMusdOracle.sol";

/// @title BtcMusdOracle
/// @notice Immutable Morpho Blue oracle for the M1 market: Baserate Collateral BTC (18 decimals) priced in MUSD
/// (18 decimals) at Morpho's 1e36 scale, i.e. `price() = btcUsd18 * 1e36 / musdUsd18`.
/// @dev Inputs:
/// - Primary: Mezo's Skip BTC/USD precompile. Requires answer > 0 and age <= 60 s (`updatedAt` in the future counts as
///   age 0). `answeredInRound` is always 0 on Skip and is ignored.
/// - Band: Pyth BTC/USD is only a +-10% sanity band (both directions), enforced while it is valid and at most 600 s
///   old (`PYTH_BTC_BAND_MAX_AGE`). A breach reverts `PythDeviation`. Pyth is pushed about hourly, so the band is on
///   for the first 10 minutes after a push; a stalled or lagging Pyth stops gating within 10 minutes, so in a fast
///   crash liquidations are frozen for at most that long (round-2 audit R2X-2; it was 3,900 s, about 65 min).
/// - MUSD leg: Pyth MUSD/USD clamped to [1.00, 1.02] while valid and at most 3,900 s old, else 1.00. BTC is therefore
///   never valued above its USD price in MUSD terms.
/// Pyth is read with a gas-capped, return-size-checked `staticcall` and never causes a revert by itself: a failed,
/// malformed (not exactly 128 bytes), non-positive or out-of-range-exponent read is treated as stale.
///
/// Disclosures:
/// - Discount: while MUSD trades below 1.00 (0.989 at deployment) the clamp undervalues collateral by about 1.1%
///   against the true BTC/MUSD price, so borrowers are liquidated slightly earlier. This is deliberately conservative.
/// - Liveness: `price()` reverts when Skip is down or stale, or when Skip and a fresh Pyth diverge by more than 10%.
///   Morpho then freezes borrows, withdrawals with debt and liquidations. A divergence freeze lasts at most 10 min
///   (until Pyth updates or ages past 600 s); a Skip outage is unbounded. Repay and full withdrawal never call the
///   oracle, so the exit stays open.
/// - Precompile budget: one Skip call per `price()`, `btcUsd()` or `status()`.
contract BtcMusdOracle is IOracle, IBtcMusdOracle {
    /// @notice Skip BTC/USD precompile, at the same address on Mezo testnet and mainnet (18 decimals).
    address public constant SKIP = 0x7b7c000000000000000000000000000000000015;
    /// @notice Maximum Skip age in seconds, the same bound Mezo's MUSD PriceFeed uses.
    uint256 public constant SKIP_MAX_AGE = 60;
    /// @notice Maximum Pyth MUSD/USD age in seconds for the MUSD leg (hourly pushes plus 5 minutes of slack).
    uint256 public constant PYTH_MAX_AGE = 3900;
    /// @notice Maximum Pyth BTC/USD age in seconds for the +-10% band. Kept short so a lagging Pyth cannot freeze
    /// liquidations through a fast crash for longer than this.
    uint256 public constant PYTH_BTC_BAND_MAX_AGE = 600;
    /// @notice Maximum Skip-vs-Pyth BTC deviation, in bps of the Pyth price.
    uint256 public constant MAX_DEV_BPS = 1000;
    /// @notice Lower clamp (and stale default) of the MUSD/USD leg.
    uint256 public constant MUSD_MIN = 1e18;
    /// @notice Upper clamp of the MUSD/USD leg.
    uint256 public constant MUSD_MAX = 1.02e18;
    /// @notice Largest Skip answer that fits Morpho's 1e36 scale (`answer * 1e36` must not overflow).
    uint256 public constant MAX_SKIP_ANSWER = type(uint256).max / 1e36;
    /// @notice Gas forwarded to each Pyth read; a real read costs about 10k, so a misbehaving Pyth cannot eat the tx.
    uint256 public constant PYTH_GAS_LIMIT = 250_000;

    /// @inheritdoc IBtcMusdOracle
    address public immutable PYTH;
    /// @inheritdoc IBtcMusdOracle
    bytes32 public immutable BTC_FEED;
    /// @inheritdoc IBtcMusdOracle
    bytes32 public immutable MUSD_FEED;

    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant SKIP_RETURN_SIZE = 160;
    uint256 internal constant PYTH_RETURN_SIZE = 128;
    int256 internal constant PYTH_MIN_EXPO = -18;

    /// @param pyth Pyth contract (mainnet 0x5D28...7167, testnet 0x933a...1315).
    /// @param btcFeed Pyth BTC/USD feed id.
    /// @param musdFeed Pyth MUSD/USD feed id.
    constructor(address pyth, bytes32 btcFeed, bytes32 musdFeed) {
        if (pyth == address(0)) revert ZeroAddress();
        if (btcFeed == bytes32(0) || musdFeed == bytes32(0)) revert ZeroFeed();
        PYTH = pyth;
        BTC_FEED = btcFeed;
        MUSD_FEED = musdFeed;
    }

    /// @notice Price of 1e18 collateral wei in MUSD wei, scaled by 1e36 (Morpho `IOracle`).
    /// @dev Reverts `SkipUnavailable`, `SkipInvalidAnswer`, `SkipStale` or `PythDeviation`. One Skip precompile call.
    /// @return The BTC/MUSD price at Morpho's 1e36 scale.
    function price() external view returns (uint256) {
        (uint256 btc,) = _btcUsd();
        (bool pythValid, uint256 pythPx, uint256 pythAge) = _readPyth(BTC_FEED);
        if (pythValid && pythAge <= PYTH_BTC_BAND_MAX_AGE && _breachesBand(btc, pythPx)) {
            revert PythDeviation(btc, pythPx);
        }
        (uint256 musd,) = _musdUsd();
        // btc <= MAX_SKIP_ANSWER, so the product cannot overflow; musd >= 1e18.
        return btc * PRICE_SCALE / musd;
    }

    /// @inheritdoc IBtcMusdOracle
    function btcUsd() external view returns (uint256 px18, uint256 updatedAt) {
        return _btcUsd();
    }

    /// @inheritdoc IBtcMusdOracle
    function pythBtc() external view returns (uint256 px18, bool fresh) {
        (bool valid, uint256 px, uint256 age) = _readPyth(BTC_FEED);
        return (px, valid && age <= PYTH_BTC_BAND_MAX_AGE);
    }

    /// @inheritdoc IBtcMusdOracle
    function musdUsd() external view returns (uint256 px18, bool fresh) {
        return _musdUsd();
    }

    /// @inheritdoc IBtcMusdOracle
    function status() external view returns (Status memory s) {
        (bool skipRead, int256 answer, uint256 updatedAt) = _readSkip();
        s.skipAge = skipRead ? _age(updatedAt) : type(uint256).max;
        // forge-lint: disable-next-line(unsafe-typecast) answer > 0 is checked first.
        if (answer > 0) s.skipPrice = uint256(answer);
        bool skipInRange = s.skipPrice != 0 && s.skipPrice <= MAX_SKIP_ANSWER;

        bool btcValid;
        (btcValid, s.pythBtcPrice, s.pythBtcAge) = _readPyth(BTC_FEED);
        s.pythBtcFresh = btcValid && s.pythBtcAge <= PYTH_BTC_BAND_MAX_AGE;

        bool musdValid;
        (musdValid, s.musdPrice, s.musdAge) = _readPyth(MUSD_FEED);
        s.musdFresh = musdValid && s.musdAge <= PYTH_MAX_AGE;

        // diff <= MAX_SKIP_ANSWER and pythBtcPrice > 0 when valid, so mulDiv cannot overflow or divide by zero.
        if (skipInRange && btcValid) {
            s.deviationBps = Math.mulDiv(_absDiff(s.skipPrice, s.pythBtcPrice), BPS, s.pythBtcPrice, Math.Rounding.Ceil);
        }

        s.ok =
            skipInRange && s.skipAge <= SKIP_MAX_AGE && !(s.pythBtcFresh && _breachesBand(s.skipPrice, s.pythBtcPrice));
        if (s.ok) s.price = s.skipPrice * PRICE_SCALE / _musdLeg(s.musdFresh, s.musdPrice);
    }

    /// @dev Validated Skip read: reverts on an unreadable, non-positive, oversized or stale answer.
    function _btcUsd() internal view returns (uint256 px18, uint256 updatedAt) {
        bool read;
        int256 answer;
        (read, answer, updatedAt) = _readSkip();
        if (!read) revert SkipUnavailable();
        if (answer <= 0) revert SkipInvalidAnswer(answer);
        // forge-lint: disable-next-line(unsafe-typecast) answer > 0 was checked above.
        px18 = uint256(answer);
        if (px18 > MAX_SKIP_ANSWER) revert SkipInvalidAnswer(answer);
        uint256 age = _age(updatedAt);
        // forge-lint: disable-next-line(block-timestamp)
        if (age > SKIP_MAX_AGE) revert SkipStale(age);
    }

    /// @dev The MUSD/USD leg: clamped Pyth MUSD while fresh, else 1.00.
    function _musdUsd() internal view returns (uint256 px18, bool fresh) {
        (bool valid, uint256 px, uint256 age) = _readPyth(MUSD_FEED);
        fresh = valid && age <= PYTH_MAX_AGE;
        px18 = _musdLeg(fresh, px);
    }

    /// @dev Never reverts. Copies at most 160 bytes of return data. `read` is false (with zero outputs) when the
    /// precompile reverted or returned fewer than 160 bytes; `roundId`, `startedAt` and `answeredInRound` are ignored.
    function _readSkip() internal view returns (bool read, int256 answer, uint256 updatedAt) {
        address skip = SKIP;
        bytes4 selector = IAggregatorV3.latestRoundData.selector;
        uint256 minSize = SKIP_RETURN_SIZE;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            // Separate statements: Yul evaluates arguments right to left, so returndatasize() must follow the call.
            read := staticcall(gas(), skip, ptr, 0x04, ptr, 0xa0)
            read := and(read, iszero(lt(returndatasize(), minSize)))
            if read {
                answer := mload(add(ptr, 0x20))
                updatedAt := mload(add(ptr, 0x60))
            }
        }
    }

    /// @dev Never reverts. Low-level, gas-capped `getPriceUnsafe(feed)` that copies at most 128 bytes of return data.
    /// A read is valid only with exactly 128 bytes of return data, 0 < price <= int64 max and -18 <= expo <= 0.
    /// Invalid reads return (false, 0, type(uint256).max).
    function _readPyth(bytes32 feed) internal view returns (bool valid, uint256 px18, uint256 age) {
        address pyth = PYTH;
        bytes4 selector = IPythLite.getPriceUnsafe.selector;
        uint256 gasLimit = PYTH_GAS_LIMIT;
        uint256 size = PYTH_RETURN_SIZE;
        bool success = false;
        int256 rawPrice = 0;
        int256 expo = 0;
        uint256 publishTime = 0;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr, 0x04), feed)
            success := staticcall(gasLimit, pyth, ptr, 0x24, ptr, 0x80)
            success := and(success, eq(returndatasize(), size))
            if success {
                rawPrice := mload(ptr)
                expo := mload(add(ptr, 0x40))
                publishTime := mload(add(ptr, 0x60))
            }
        }
        valid = success && rawPrice > 0 && rawPrice <= type(int64).max && expo >= PYTH_MIN_EXPO && expo <= 0;
        if (!valid) return (valid, 0, type(uint256).max);
        // 0 < rawPrice < 2^63 and 0 <= 18 + expo <= 18, so both casts are lossless and px18 < 2^63 * 1e18.
        // forge-lint: disable-next-line(unsafe-typecast)
        px18 = uint256(rawPrice) * 10 ** uint256(18 + expo);
        age = _age(publishTime);
    }

    /// @dev Clamped MUSD leg, or `MUSD_MIN` when not fresh.
    function _musdLeg(bool fresh, uint256 px) internal pure returns (uint256) {
        if (!fresh) return MUSD_MIN;
        return Math.min(Math.max(px, MUSD_MIN), MUSD_MAX);
    }

    /// @dev True when |skip - pyth| * 1e4 > MAX_DEV_BPS * pyth. Callers guarantee skip <= MAX_SKIP_ANSWER and
    /// pyth < 2^63 * 1e18, so neither side overflows.
    function _breachesBand(uint256 skip, uint256 pyth) internal pure returns (bool) {
        return _absDiff(skip, pyth) * BPS > MAX_DEV_BPS * pyth;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    /// @dev Seconds since `timestamp`; a future timestamp counts as age 0. Validator skew of a few seconds is
    /// irrelevant against 60 s, 600 s and 3,900 s bounds.
    function _age(uint256 timestamp) internal view returns (uint256) {
        // forge-lint: disable-next-line(block-timestamp)
        return timestamp >= block.timestamp ? 0 : block.timestamp - timestamp;
    }
}
