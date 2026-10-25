// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IIrm} from "morpho-blue/interfaces/IIrm.sol";
import {IMorpho, Id, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {LIQUIDATION_CURSOR, MAX_LIQUIDATION_INCENTIVE_FACTOR} from "morpho-blue/libraries/ConstantsLib.sol";
import {MathLib, WAD} from "morpho-blue/libraries/MathLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBorrowAccountFactory, Profile} from "../interfaces/IBorrowAccountFactory.sol";
import {IRiskLens} from "../interfaces/IRiskLens.sol";
import {IMusdTroveManager, ISortedTroves} from "../interfaces/external/IMusdTroves.sol";
import {ISlipstreamPool, ISlipstreamQuoterV2, ITigrisRouter} from "../interfaces/external/ITigrisDex.sol";
import {IBtcMusdOracle} from "../oracle/IBtcMusdOracle.sol";
import {TickMath} from "./TickMath.sol";

/// @title RiskLens
/// @notice Stateless, read-only risk snapshot of Baserate's M1 market for the app's risk page and the keeper: oracle
/// status, M1 totals and rates, factory caps and pauses, a backstop's free MUSD, MUSD/USD from Pyth and a Slipstream
/// TWAP, BTC -> MUSD liquidation depth per size on Slipstream (QuoterV2) and the basic vAMM (Router), and the MUSD
/// trove redemption queue that Baserate borrowers are not exposed to.
/// @dev No storage and no admin. Every source runs in isolation (try/catch around a self-call or a low-level call),
/// so one failing source only sets its `SRC_*` bit in `Snapshot.failed`.
///
/// Precompile budget (Mezo allows 20 precompile executions per transaction, reads included): `status()` makes one
/// Skip call; each CL quote makes one BTC-precompile read (`CLPool.swap` reads `BTC.balanceOf(pool)` before the
/// quoter's callback reverts); everything else (Morpho, IRM, factory, Pyth, Router, CL `observe`, troves) makes none.
/// With at most `MAX_DEPTH_SIZES` (8) sizes a snapshot makes at most 9, leaving `BACKSTOP_PRECOMPILE_RESERVE` (4)
/// for a backstop whose `totalAssets()` marks BTC at Skip, inside `PRECOMPILE_BUDGET` (15).
///
/// CL quotes: Slipstream's QuoterV2 is not `view` (it executes `pool.swap` and decodes its own callback's revert),
/// so this `view` lens performs that one CALL through an internal function cast to `view` (the same technique
/// forge-std's console uses). No state can change: the swap always reverts. Under `eth_call` the quote works;
/// under a STATICCALL the lens detects the static context with `probeCallContext()` first and flags CL depth as
/// failed instead of burning gas.
contract RiskLens is IRiskLens {
    using MathLib for uint256;
    using MorphoBalancesLib for IMorpho;

    /// @notice Source bit: `BtcMusdOracle.status()`.
    uint256 public constant SRC_ORACLE = 1 << 0;
    /// @notice Source bit: M1 market state (Morpho and IRM).
    uint256 public constant SRC_MARKET = 1 << 1;
    /// @notice Source bit: factory caps and flags.
    uint256 public constant SRC_FACTORY = 1 << 2;
    /// @notice Source bit: backstop free MUSD.
    uint256 public constant SRC_BACKSTOP = 1 << 3;
    /// @notice Source bit: MUSD price pool TWAP and spot.
    uint256 public constant SRC_MUSD_POOL = 1 << 4;
    /// @notice Source bit: Slipstream (QuoterV2) depth.
    uint256 public constant SRC_CL_DEPTH = 1 << 5;
    /// @notice Source bit: basic vAMM (Router) depth.
    uint256 public constant SRC_VAMM_DEPTH = 1 << 6;
    /// @notice Source bit: trove redemption queue.
    uint256 public constant SRC_TROVES = 1 << 7;
    /// @notice Source bit: Pyth MUSD/USD (as read by the oracle; failed when the read was invalid).
    uint256 public constant SRC_PYTH_MUSD = 1 << 8;

    /// @notice Mezo's per-transaction precompile limit is 20; the lens stays within 15.
    uint256 public constant PRECOMPILE_BUDGET = 15;
    /// @notice Precompile calls left for a backstop's `totalAssets()`.
    uint256 public constant BACKSTOP_PRECOMPILE_RESERVE = 4;
    /// @notice Maximum BTC sizes per snapshot (one BTC-precompile read each on Slipstream).
    uint256 public constant MAX_DEPTH_SIZES = 8;
    /// @notice Maximum troves walked per snapshot.
    uint256 public constant MAX_TROVES = 25;
    /// @notice TWAP window used when the query passes 0.
    uint32 public constant DEFAULT_TWAP_WINDOW = 1800;
    /// @notice Shortest accepted TWAP window.
    uint32 public constant MIN_TWAP_WINDOW = 60;
    /// @notice Longest accepted TWAP window.
    uint32 public constant MAX_TWAP_WINDOW = 7 days;
    /// @notice Gas forwarded to each QuoterV2 call (a 7-tick CL200 quote costs about 475k).
    uint256 public constant QUOTE_GAS = 3_000_000;
    /// @notice Gas forwarded to the call-context probe.
    uint256 public constant PROBE_GAS = 10_000;
    /// @notice The BTC ERC-20 precompile (shares its balance with native BTC).
    address public constant BTC = 0x7b7C000000000000000000000000000000000000;
    /// @notice MUSD's Recovery Mode threshold (CCR 150%).
    uint256 public constant CCR = 1.5e18;

    address public immutable FACTORY;
    address public immutable MORPHO;
    address public immutable MUSD;
    address public immutable ORACLE;
    address public immutable IRM;
    address public immutable COLLATERAL;
    uint256 public immutable LLTV;
    bytes32 public immutable MARKET_ID;
    address public immutable WS_MUSD;
    address public immutable TROVE_MANAGER;
    address public immutable SORTED_TROVES;
    address public immutable ROUTER;
    address public immutable POOL_FACTORY;
    address public immutable QUOTER;
    int24 public immutable CL_TICK_SPACING;
    address public immutable MUSD_PRICE_POOL;
    /// @notice True when MUSD is token0 of `MUSD_PRICE_POOL`.
    bool public immutable MUSD_IS_TOKEN0;

    /// @dev MUSD amount (wei) quoted against the stable so the quote lands in 18 decimals, and the divisor applied
    /// afterwards (1 unless the stable has more than 18 decimals).
    uint256 internal immutable PRICE_BASE;
    uint256 internal immutable PRICE_DIVISOR;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    /// @dev Transient slot written by `probeCallContext`.
    bytes32 internal constant PROBE_SLOT = keccak256("baserate.risklens.probe");

    /// @param c Wiring; see `LensConfig`.
    constructor(LensConfig memory c) {
        if (c.factory == address(0)) revert ZeroFactory();
        if ((c.troveManager == address(0)) != (c.sortedTroves == address(0))) revert InvalidConfig();
        if ((c.router == address(0)) != (c.poolFactory == address(0))) revert InvalidConfig();
        if (c.quoter != address(0) && c.clTickSpacing <= 0) revert InvalidConfig();
        _requireCode(c.factory);
        _requireCode(c.wsMusd);
        _requireCode(c.troveManager);
        _requireCode(c.sortedTroves);
        _requireCode(c.router);
        _requireCode(c.quoter);
        _requireCode(c.musdPricePool);

        IBorrowAccountFactory f = IBorrowAccountFactory(c.factory);
        address musd = f.MUSD();
        FACTORY = c.factory;
        MORPHO = f.MORPHO();
        MUSD = musd;
        ORACLE = f.ORACLE();
        IRM = f.IRM();
        COLLATERAL = f.COLLATERAL();
        LLTV = f.LLTV();
        MARKET_ID = Id.unwrap(f.MARKET_ID());
        WS_MUSD = c.wsMusd;
        TROVE_MANAGER = c.troveManager;
        SORTED_TROVES = c.sortedTroves;
        ROUTER = c.router;
        POOL_FACTORY = c.poolFactory;
        QUOTER = c.quoter;
        CL_TICK_SPACING = c.clTickSpacing;
        MUSD_PRICE_POOL = c.musdPricePool;

        bool musdIsToken0 = false;
        uint256 base = WAD;
        uint256 divisor = 1;
        if (c.musdPricePool != address(0)) {
            address token0 = ISlipstreamPool(c.musdPricePool).token0();
            address token1 = ISlipstreamPool(c.musdPricePool).token1();
            if (token0 != musd && token1 != musd) revert PricePoolWithoutMusd(c.musdPricePool);
            musdIsToken0 = token0 == musd;
            uint256 stableDecimals = IERC20Metadata(musdIsToken0 ? token1 : token0).decimals();
            if (stableDecimals <= 18) base = WAD * 10 ** (18 - stableDecimals);
            else divisor = 10 ** (stableDecimals - 18);
        }
        MUSD_IS_TOKEN0 = musdIsToken0;
        PRICE_BASE = base;
        PRICE_DIVISOR = divisor;
    }

    // ---------------------------------------------------------------- snapshot

    /// @inheritdoc IRiskLens
    function snapshot(Query calldata q) external view returns (Snapshot memory s) {
        if (q.btcSizes.length > MAX_DEPTH_SIZES) revert TooManySizes(q.btcSizes.length, MAX_DEPTH_SIZES);
        if (q.troveCount > MAX_TROVES) revert TooManyTroves(q.troveCount, MAX_TROVES);
        uint32 window = q.twapWindow == 0 ? DEFAULT_TWAP_WINDOW : q.twapWindow;
        if (window < MIN_TWAP_WINDOW || window > MAX_TWAP_WINDOW) revert InvalidTwapWindow(q.twapWindow);

        s.blockNumber = block.number;
        s.timestamp = block.timestamp;

        _readOracle(s);
        _readMarketAndFactory(s);
        _readBackstop(s, q.backstop);
        _readMusdPrice(s, window);
        _readDepth(s, q.btcSizes);
        _readTroves(s, q.troveCount);
    }

    // ---------------------------------------------------------------- per-source views

    /// @inheritdoc IRiskLens
    function marketState() public view returns (MarketState memory m) {
        MarketParams memory p = _marketParams();
        m.id = MARKET_ID;
        m.loanToken = p.loanToken;
        m.collateralToken = p.collateralToken;
        m.oracle = p.oracle;
        m.irm = p.irm;
        m.lltv = p.lltv;
        m.liquidationIncentive = _liquidationIncentive(p.lltv);

        Market memory raw = IMorpho(MORPHO).market(Id.wrap(MARKET_ID));
        if (raw.lastUpdate == 0) return m;
        m.created = true;
        m.lastUpdate = raw.lastUpdate;
        m.fee = raw.fee;
        (m.totalSupplyAssets, m.totalSupplyShares, m.totalBorrowAssets, m.totalBorrowShares) =
            IMorpho(MORPHO).expectedMarketBalances(p);
        m.borrowRate = IIrm(p.irm).borrowRateView(p, raw);
        m.borrowApr = m.borrowRate * YEAR;
        if (m.totalSupplyAssets != 0) {
            m.utilization = m.totalBorrowAssets.wDivDown(m.totalSupplyAssets);
            m.liquidity = m.totalSupplyAssets > m.totalBorrowAssets ? m.totalSupplyAssets - m.totalBorrowAssets : 0;
        }
        m.supplyApr = m.borrowApr.wMulDown(m.utilization).wMulDown(WAD - m.fee);
    }

    /// @inheritdoc IRiskLens
    function factoryState() public view returns (FactoryState memory f) {
        IBorrowAccountFactory fac = IBorrowAccountFactory(FACTORY);
        f.globalBorrowCap = fac.globalBorrowCap();
        (f.standardPositionCap, f.standardCeilingBps) = fac.limits(Profile.STANDARD);
        (f.canaryPositionCap, f.canaryCeilingBps) = fac.limits(Profile.CANARY);
        f.maxCeilingBps = fac.MAX_CEILING_BPS();
        f.borrowPaused = fac.borrowPaused();
        f.creditPaused = fac.creditPaused();
        f.feeRecipient = fac.feeRecipient();
        f.originationFeeBps = fac.ORIGINATION_FEE_BPS();
        f.governor = fac.governor();
        f.sentinel = fac.sentinel();
    }

    /// @inheritdoc IRiskLens
    function backstopState(address backstop) public view returns (BackstopState memory b) {
        b.backstop = backstop;
        b.musd = IERC20(MUSD).balanceOf(backstop);
        b.nativeBtc = backstop.balance;
        if (WS_MUSD != address(0)) {
            b.wsMusdShares = IERC20(WS_MUSD).balanceOf(backstop);
            if (b.wsMusdShares != 0) b.wsMusdAssets = IERC4626(WS_MUSD).previewRedeem(b.wsMusdShares);
        }
        b.freeMusd = b.musd + b.wsMusdAssets;
        // An EOA would make the decode revert outside the try, so only contracts are asked.
        if (backstop.code.length != 0) {
            try IERC4626(backstop).totalAssets() returns (uint256 assets) {
                b.vaultRead = true;
                b.vaultTotalAssets = assets;
            } catch {}
        }
    }

    /// @inheritdoc IRiskLens
    function musdPoolPrice(uint32 window) public view returns (int24 twapTick, uint256 twapPrice, uint256 spotPrice) {
        ISlipstreamPool pool = ISlipstreamPool(MUSD_PRICE_POOL);
        (uint160 sqrtPriceX96,,,,,) = pool.slot0();
        spotPrice = _musdPrice(sqrtPriceX96);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        (int56[] memory cumulatives,) = pool.observe(secondsAgos);
        int56 delta = cumulatives[1] - cumulatives[0];
        int56 span = int56(uint56(window));
        // forge-lint: disable-next-line(unsafe-typecast) an average of int24 ticks fits int24.
        twapTick = int24(delta / span);
        // Round towards negative infinity, as Uniswap's OracleLibrary.consult does.
        if (delta < 0 && delta % span != 0) twapTick--;
        twapPrice = _musdPrice(TickMath.getSqrtRatioAtTick(twapTick));
    }

    /// @inheritdoc IRiskLens
    function vammQuote(uint256 btcIn) public view returns (uint256 musdOut) {
        ITigrisRouter.Route[] memory routes = new ITigrisRouter.Route[](1);
        routes[0] = ITigrisRouter.Route({from: BTC, to: MUSD, stable: false, factory: POOL_FACTORY});
        uint256[] memory amounts = ITigrisRouter(ROUTER).getAmountsOut(btcIn, routes);
        musdOut = amounts[amounts.length - 1];
    }

    /// @inheritdoc IRiskLens
    function clQuote(uint256 btcIn) external view returns (bool ok, uint256 musdOut, bool exhausted) {
        if (QUOTER == address(0) || btcIn == 0 || !_inCallContext()) return (false, 0, false);
        return _clQuote(btcIn);
    }

    /// @inheritdoc IRiskLens
    function troveQueue(uint256 count, uint256 price) public view returns (TroveQueue memory t) {
        ISortedTroves sorted = ISortedTroves(SORTED_TROVES);
        IMusdTroveManager manager = IMusdTroveManager(TROVE_MANAGER);
        t.size = sorted.getSize();
        t.price = price;
        if (price != 0) {
            t.tcr = manager.getTCR(price);
            t.recoveryMode = t.tcr < CCR;
        }
        uint256 n = Math.min(count, t.size);
        t.entries = new TroveEntry[](n);
        address borrower = n == 0 ? address(0) : sorted.getLast();
        uint256 debtAhead = 0;
        uint256 filled = 0;
        while (filled < n && borrower != address(0)) {
            TroveEntry memory e = t.entries[filled];
            e.borrower = borrower;
            e.nicr = manager.getNominalICR(borrower);
            if (price != 0) e.icr = manager.getCurrentICR(borrower, price);
            (e.coll, e.principal, e.interest,,,) = manager.getEntireDebtAndColl(borrower);
            e.debtAhead = debtAhead;
            debtAhead += e.principal + e.interest;
            ++filled;
            borrower = sorted.getPrev(borrower);
        }
        // The walk ends early only if the list is shorter than `getSize()` reported; trim the unused tail.
        TroveEntry[] memory entries = t.entries;
        assembly ("memory-safe") {
            mstore(entries, filled)
        }
    }

    /// @inheritdoc IRiskLens
    function probeCallContext() external {
        bytes32 slot = PROBE_SLOT;
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }

    // ---------------------------------------------------------------- snapshot sections

    /// @dev One QuoterV2 call (one BTC-precompile read). The caller has already checked the call context.
    /// Slipstream's QuoterV2 swaps until the input is spent or the price reaches the limit; with no explicit limit it
    /// uses MIN_SQRT_RATIO + 1 (or MAX_SQRT_RATIO - 1), so ending there means in-range liquidity ran out.
    function _clQuote(uint256 btcIn) internal view returns (bool, uint256, bool) {
        bytes memory data = abi.encodeCall(
            ISlipstreamQuoterV2.quoteExactInputSingle,
            (ISlipstreamQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: BTC, tokenOut: MUSD, amountIn: btcIn, tickSpacing: CL_TICK_SPACING, sqrtPriceLimitX96: 0
                }))
        );
        (bool success, uint256 retSize, uint256 amountOut, uint256 sqrtPriceAfter) =
            _callAsView()(QUOTER, QUOTE_GAS, data);
        // QuoterV2 returns four words (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate).
        if (!success || retSize != 128 || amountOut == 0) return (false, 0, false);
        bool exhausted = sqrtPriceAfter == TickMath.MIN_SQRT_RATIO + 1 || sqrtPriceAfter == TickMath.MAX_SQRT_RATIO - 1;
        return (true, amountOut, exhausted);
    }

    function _readOracle(Snapshot memory s) internal view {
        try IBtcMusdOracle(ORACLE).status() returns (IBtcMusdOracle.Status memory st) {
            s.oracle = st;
            s.musd.pythPrice = st.musdPrice;
            s.musd.pythAge = st.musdAge;
            s.musd.pythFresh = st.musdFresh;
            if (st.musdPrice == 0) s.failed |= SRC_PYTH_MUSD;
        } catch {
            s.failed |= SRC_ORACLE | SRC_PYTH_MUSD;
        }
        s.precompileCalls += 1;
    }

    function _readMarketAndFactory(Snapshot memory s) internal view {
        try this.marketState() returns (MarketState memory m) {
            s.market = m;
        } catch {
            s.failed |= SRC_MARKET;
        }
        try this.factoryState() returns (FactoryState memory f) {
            s.factory = f;
            if (s.market.created && f.globalBorrowCap > s.market.totalBorrowAssets) {
                s.factory.borrowHeadroom = f.globalBorrowCap - s.market.totalBorrowAssets;
            }
        } catch {
            s.failed |= SRC_FACTORY;
        }
    }

    function _readBackstop(Snapshot memory s, address backstop) internal view {
        if (backstop == address(0)) {
            s.skipped |= SRC_BACKSTOP;
            return;
        }
        try this.backstopState(backstop) returns (BackstopState memory b) {
            s.backstop = b;
        } catch {
            s.failed |= SRC_BACKSTOP;
            s.backstop.backstop = backstop;
        }
    }

    function _readMusdPrice(Snapshot memory s, uint32 window) internal view {
        s.musd.twapWindow = window;
        if (MUSD_PRICE_POOL == address(0)) {
            s.skipped |= SRC_MUSD_POOL;
            return;
        }
        try this.musdPoolPrice(window) returns (int24 tick, uint256 twap, uint256 spot) {
            s.musd.twapTick = tick;
            s.musd.twapPrice = twap;
            s.musd.spotPrice = spot;
        } catch {
            s.failed |= SRC_MUSD_POOL;
        }
    }

    function _readDepth(Snapshot memory s, uint256[] calldata sizes) internal view {
        uint256 n = sizes.length;
        s.depth = new DepthQuote[](n);
        if (QUOTER == address(0) || n == 0) s.skipped |= SRC_CL_DEPTH;
        if (ROUTER == address(0) || n == 0) s.skipped |= SRC_VAMM_DEPTH;
        if (n == 0) return;

        bool quoteCl = QUOTER != address(0) && _inCallContext();
        if (QUOTER != address(0) && !quoteCl) s.failed |= SRC_CL_DEPTH;
        uint256 refPrice = _referencePrice(s.oracle);
        uint256 incentiveBps = s.market.liquidationIncentive == 0
            ? 0
            : (s.market.liquidationIncentive - WAD) * BPS / s.market.liquidationIncentive;

        for (uint256 i; i < n; ++i) {
            DepthQuote memory d = s.depth[i];
            d.btcIn = sizes[i];
            if (d.btcIn == 0) continue;
            d.referenceOut = Math.mulDiv(d.btcIn, refPrice, ORACLE_PRICE_SCALE);
            if (quoteCl) {
                s.precompileCalls += 1;
                bool ok;
                (ok, d.clOut, d.clExhausted) = _clQuote(d.btcIn);
                if (!ok) s.failed |= SRC_CL_DEPTH;
            }
            if (ROUTER != address(0)) {
                try this.vammQuote(d.btcIn) returns (uint256 out) {
                    d.vammOut = out;
                    if (out == 0) s.failed |= SRC_VAMM_DEPTH;
                } catch {
                    s.failed |= SRC_VAMM_DEPTH;
                }
            }
            d.bestOut = Math.max(d.clOut, d.vammOut);
            if (d.referenceOut != 0 && d.bestOut != 0) {
                if (d.bestOut < d.referenceOut) d.impactBps = (d.referenceOut - d.bestOut) * BPS / d.referenceOut;
                d.clean = d.impactBps < incentiveBps;
            }
        }
    }

    function _readTroves(Snapshot memory s, uint256 count) internal view {
        if (TROVE_MANAGER == address(0)) {
            s.skipped |= SRC_TROVES;
            return;
        }
        // MUSD prices troves with Skip's BTC/USD; a missing Skip answer leaves ICR and TCR at 0 (flagged).
        uint256 price = s.oracle.skipPrice;
        if (price == 0) s.failed |= SRC_TROVES;
        try this.troveQueue(count, price) returns (TroveQueue memory t) {
            s.troves = t;
        } catch {
            s.failed |= SRC_TROVES;
        }
    }

    // ---------------------------------------------------------------- helpers

    function _marketParams() internal view returns (MarketParams memory) {
        return MarketParams({loanToken: MUSD, collateralToken: COLLATERAL, oracle: ORACLE, irm: IRM, lltv: LLTV});
    }

    /// @dev Morpho Blue's liquidation incentive factor for `lltv`.
    function _liquidationIncentive(uint256 lltv) internal pure returns (uint256) {
        return Math.min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - lltv)));
    }

    /// @dev MUSD per BTC at Morpho's 1e36 scale: the oracle price when valid, else Skip with MUSD at 1.00, else 0.
    function _referencePrice(IBtcMusdOracle.Status memory st) internal pure returns (uint256) {
        if (st.ok) return st.price;
        return st.skipPrice * 1e18;
    }

    /// @dev MUSD priced in the pool's other token, scaled to 18 decimals, from a Q64.96 sqrt price (token1/token0).
    /// Mirrors Uniswap's OracleLibrary.getQuoteAtTick, including the overflow-safe branch for large prices.
    function _musdPrice(uint160 sqrtPriceX96) internal view returns (uint256 price) {
        uint256 base = PRICE_BASE;
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            price = MUSD_IS_TOKEN0 ? Math.mulDiv(ratioX192, base, 1 << 192) : Math.mulDiv(1 << 192, base, ratioX192);
        } else {
            uint256 ratioX128 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            price = MUSD_IS_TOKEN0 ? Math.mulDiv(ratioX128, base, 1 << 128) : Math.mulDiv(1 << 128, base, ratioX128);
        }
        price /= PRICE_DIVISOR;
    }

    /// @dev True in a CALL context, false under STATICCALL (where `probeCallContext`'s TSTORE fails).
    function _inCallContext() internal view returns (bool ok) {
        (ok,,,) = _callAsView()(address(this), PROBE_GAS, abi.encodeCall(IRiskLens.probeCallContext, ()));
    }

    /// @dev Plain CALL used for QuoterV2 and the context probe. Neither can change state: the quoter's swap always
    /// reverts and the probe only writes transient storage. Copies at most two words of return data into scratch
    /// space (no return bomb).
    /// @return success Whether the call succeeded.
    /// @return retSize The full return-data size.
    /// @return word0 The first return word (0 when fewer than 32 bytes came back).
    /// @return word1 The second return word (0 when fewer than 64 bytes came back).
    function _rawCall(address target, uint256 gasLimit, bytes memory data)
        internal
        returns (bool success, uint256 retSize, uint256 word0, uint256 word1)
    {
        assembly ("memory-safe") {
            mstore(0x00, 0)
            mstore(0x20, 0)
            success := call(gasLimit, target, 0, add(data, 0x20), mload(data), 0x00, 0x40)
            retSize := returndatasize()
            if iszero(lt(retSize, 0x20)) { word0 := mload(0x00) }
            if iszero(lt(retSize, 0x40)) { word1 := mload(0x20) }
        }
    }

    /// @dev `_rawCall` typed as `view`, so the lens can stay a `view` contract (see the contract NatSpec).
    function _callAsView()
        internal
        pure
        returns (function(address, uint256, bytes memory)
                internal
                view returns (bool, uint256, uint256, uint256) viewCall)
    {
        function(address, uint256, bytes memory) internal returns (bool, uint256, uint256, uint256) raw = _rawCall;
        assembly ("memory-safe") {
            viewCall := raw
        }
    }

    function _requireCode(address target) internal view {
        if (target != address(0) && target.code.length == 0) revert InvalidConfig();
    }
}
