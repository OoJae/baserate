// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Id, Market} from "morpho-blue/interfaces/IMorpho.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IRiskLens} from "../../src/interfaces/IRiskLens.sol";
import {ISlipstreamPool} from "../../src/interfaces/external/ITigrisDex.sol";
import {IMusdTroveManager, ISortedTroves} from "../../src/interfaces/external/IMusdTroves.sol";
import {RiskLens} from "../../src/lens/RiskLens.sol";
import {TickMath} from "../../src/lens/TickMath.sol";
import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {
    MockIrm,
    MockMorphoMarkets,
    MockQuoter,
    MockRouter,
    MockSlipstreamPool,
    MockToken,
    MockTroves,
    MockVault
} from "../utils/LensMocks.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {PythMock} from "../utils/PythMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";

/// @dev External wrapper so reverts inside the library can be asserted.
contract TickMathHarness {
    function sqrtAt(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }
}

/// @notice RiskLens against local mocks of every source: a real BtcMusdOracle (SkipMock + PythMock), a real
/// BorrowAccountFactory, and mocks for Morpho, the IRM, QuoterV2, the Tigris Router, the MUSD price pool, troves and
/// vault-shaped wsMUSD/backstop.
contract RiskLensTest is Test {
    uint256 internal constant NOW = 1_792_943_000;
    uint256 internal constant SKIP_PX = 80_000e18;
    uint256 internal constant RATE = 1e9; // per second, about 3.15% APR
    int24 internal constant SPOT_TICK = 276_426; // MUSD = 0.989854965375286618 mUSDC
    int24 internal constant TWAP_TICK = 276_526; // MUSD = 0.980006233875921045 mUSDC
    uint256 internal constant SPOT_PRICE = 989_854_965_375_286_618;
    uint256 internal constant TWAP_PRICE = 980_006_233_875_921_045;

    MockMUSD internal musd;
    PythMock internal pyth;
    BtcMusdOracle internal oracle;
    MockMorphoMarkets internal morpho;
    MockIrm internal irm;
    BorrowAccountFactory internal factory;
    MockVault internal ws;
    MockVault internal backstop;
    MockToken internal stable;
    MockSlipstreamPool internal pricePool;
    MockQuoter internal quoter;
    MockRouter internal router;
    MockTroves internal troves;
    RiskLens internal lens;

    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal poolFactory = makeAddr("poolFactory");
    address internal trA = makeAddr("troveA");
    address internal trB = makeAddr("troveB");
    address internal trC = makeAddr("troveC");

    function setUp() public {
        vm.warp(NOW);
        vm.etch(MezoAddresses.SKIP_BTC_USD, address(new SkipMock()).code);
        SkipMock(MezoAddresses.SKIP_BTC_USD).setAnswer(int256(SKIP_PX));
        pyth = new PythMock();
        pyth.setPrice(MezoAddresses.PYTH_BTC_USD, 80_100e8, -8, NOW - 100);
        pyth.setPrice(MezoAddresses.PYTH_MUSD_USD, 0.99e8, -8, NOW - 100);
        oracle = new BtcMusdOracle(address(pyth), MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);

        musd = new MockMUSD();
        morpho = new MockMorphoMarkets();
        irm = new MockIrm(RATE);
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: address(morpho),
                musd: address(musd),
                oracle: address(oracle),
                irm: address(irm),
                lltv: 0.77e18,
                bos: address(0),
                collSurplusPool: address(0),
                governor: governor,
                sentinel: sentinel,
                feeRecipient: makeAddr("feeRouter"),
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits(0.01e18, 6200),
                canary: IBorrowAccountFactory.Limits(0.002e18, 7675)
            })
        );
        morpho.setMarket(
            factory.MARKET_ID(),
            Market({
                totalSupplyAssets: 10_000e18,
                totalSupplyShares: 10_000e24,
                totalBorrowAssets: 4000e18,
                totalBorrowShares: 4000e24,
                lastUpdate: uint128(NOW - 1 hours),
                fee: 0
            })
        );

        ws = new MockVault(address(musd));
        backstop = new MockVault(address(musd));
        musd.mint(address(backstop), 100e18);
        musd.mint(address(this), 50e18);
        musd.approve(address(ws), 50e18);
        ws.deposit(50e18, address(backstop));
        vm.deal(address(backstop), 0.5e18);

        stable = new MockToken("mUSDC", 6);
        pricePool = new MockSlipstreamPool(address(stable), address(musd));
        pricePool.set(TickMath.getSqrtRatioAtTick(SPOT_TICK), TWAP_TICK);

        quoter = new MockQuoter();
        quoter.setReserves(10e18, 800_000e18);
        router = new MockRouter();
        router.setReserves(5e18, 400_000e18);

        troves = new MockTroves();
        // Descending NICR: A (20k debt) > B (30k) > C (40k); C is redeemed first.
        troves.push(trA, 1e18, 20_000e18, 100e18);
        troves.push(trB, 1e18, 30_000e18, 200e18);
        troves.push(trC, 1e18, 40_000e18, 300e18);

        lens = new RiskLens(_config());
    }

    // ---------------------------------------------------------------- helpers

    function _config() internal view returns (IRiskLens.LensConfig memory) {
        return IRiskLens.LensConfig({
            factory: address(factory),
            wsMusd: address(ws),
            troveManager: address(troves),
            sortedTroves: address(troves),
            router: address(router),
            poolFactory: poolFactory,
            quoter: address(quoter),
            clTickSpacing: 200,
            musdPricePool: address(pricePool)
        });
    }

    function _query(uint256 nSizes) internal view returns (IRiskLens.Query memory q) {
        q.backstop = address(backstop);
        q.btcSizes = new uint256[](nSizes);
        for (uint256 i; i < nSizes; ++i) {
            q.btcSizes[i] = 0.01e18 * 10 ** (i % 3) * (1 + i / 3);
        }
        q.troveCount = 10;
        q.twapWindow = 1800;
    }

    /// @dev Calls the lens with a plain CALL, as `eth_call` does (a Solidity call to a view would STATICCALL).
    function _snap(RiskLens l, IRiskLens.Query memory q) internal returns (IRiskLens.Snapshot memory s) {
        (bool ok, bytes memory ret) = address(l).call(abi.encodeCall(RiskLens.snapshot, (q)));
        assertTrue(ok, "snapshot must not revert");
        s = abi.decode(ret, (IRiskLens.Snapshot));
    }

    function _snap() internal returns (IRiskLens.Snapshot memory) {
        return _snap(lens, _query(3));
    }

    // ---------------------------------------------------------------- happy path

    function test_snapshot_readsEverySource() public {
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, 0, "no failures");
        assertEq(s.skipped, 0, "nothing skipped");
        assertEq(s.precompileCalls, 4, "1 Skip + 3 CL quotes");
        assertEq(s.blockNumber, block.number);
        assertEq(s.timestamp, NOW);

        // Oracle
        assertTrue(s.oracle.ok);
        assertEq(s.oracle.skipPrice, SKIP_PX);
        assertEq(s.oracle.price, oracle.price());

        // Market (accrued one hour of interest at RATE)
        IRiskLens.MarketState memory m = s.market;
        assertTrue(m.created);
        assertEq(m.id, Id.unwrap(factory.MARKET_ID()));
        assertEq(m.loanToken, address(musd));
        assertEq(m.collateralToken, factory.COLLATERAL());
        assertEq(m.lltv, 0.77e18);
        assertGt(m.totalBorrowAssets, 4000e18, "interest accrued");
        assertApproxEqRel(m.totalBorrowAssets, 4000e18 + 4000e18 * RATE * 3600 / 1e18, 1e12);
        assertEq(m.totalSupplyAssets - m.totalBorrowAssets, 6000e18, "accrual adds to both sides");
        assertEq(m.liquidity, 6000e18);
        assertApproxEqRel(m.utilization, 0.4e18, 0.001e18);
        assertEq(m.borrowRate, RATE);
        assertEq(m.borrowApr, RATE * 365 days);
        assertApproxEqRel(m.supplyApr, m.borrowApr * 4 / 10, 0.001e18);
        assertEq(m.liquidationIncentive, uint256(1e36) / (1e18 - 0.3e18 * 0.23e18 / 1e18), "7.41% at 0.77");

        // Factory
        assertEq(s.factory.globalBorrowCap, 5000e18);
        assertEq(s.factory.borrowHeadroom, 5000e18 - m.totalBorrowAssets);
        assertEq(s.factory.standardPositionCap, 0.01e18);
        assertEq(s.factory.standardCeilingBps, 6200);
        assertEq(s.factory.canaryPositionCap, 0.002e18);
        assertEq(s.factory.canaryCeilingBps, 7675);
        assertEq(s.factory.maxCeilingBps, 7675);
        assertFalse(s.factory.borrowPaused);
        assertFalse(s.factory.creditPaused);
        assertEq(s.factory.feeRecipient, makeAddr("feeRouter"));
        assertEq(s.factory.originationFeeBps, 10);
        assertEq(s.factory.governor, governor);
        assertEq(s.factory.sentinel, sentinel);

        // Backstop
        assertEq(s.backstop.backstop, address(backstop));
        assertEq(s.backstop.musd, 100e18);
        assertEq(s.backstop.wsMusdShares, 50e18);
        assertEq(s.backstop.wsMusdAssets, 50e18);
        assertEq(s.backstop.freeMusd, 150e18);
        assertEq(s.backstop.nativeBtc, 0.5e18);
        assertTrue(s.backstop.vaultRead);
        assertEq(s.backstop.vaultTotalAssets, 100e18);

        // MUSD price
        assertEq(s.musd.pythPrice, 0.99e18);
        assertTrue(s.musd.pythFresh);
        assertEq(s.musd.pythAge, 100);
        assertEq(s.musd.twapWindow, 1800);
        assertEq(s.musd.twapTick, TWAP_TICK);
        assertApproxEqRel(s.musd.twapPrice, TWAP_PRICE, 1e9);
        assertApproxEqRel(s.musd.spotPrice, SPOT_PRICE, 1e9);

        // Depth: per-unit proceeds fall as size grows, impact rises
        assertEq(s.depth.length, 3);
        uint256 lastPerUnit = type(uint256).max;
        uint256 lastImpact;
        for (uint256 i; i < 3; ++i) {
            IRiskLens.DepthQuote memory d = s.depth[i];
            assertEq(d.clOut, d.btcIn * 800_000e18 / (10e18 + d.btcIn), "CL quote");
            assertEq(d.vammOut, d.btcIn * 400_000e18 / (5e18 + d.btcIn), "vAMM quote");
            assertEq(d.bestOut, d.clOut > d.vammOut ? d.clOut : d.vammOut);
            assertEq(d.referenceOut, d.btcIn * s.oracle.price / 1e36);
            uint256 perUnit = d.bestOut * 1e18 / d.btcIn;
            assertLt(perUnit, lastPerUnit, "depth decreasing in size");
            assertGe(d.impactBps, lastImpact, "impact non-decreasing");
            lastPerUnit = perUnit;
            lastImpact = d.impactBps;
        }
        assertTrue(s.depth[0].clean, "0.01 BTC clears inside the 7.41% incentive");
        assertFalse(s.depth[2].clean, "1 BTC does not");

        // Troves: lowest NICR first, cumulative debt ahead
        IRiskLens.TroveQueue memory t = s.troves;
        assertEq(t.size, 3);
        assertEq(t.price, SKIP_PX);
        assertEq(t.tcr, 3e18 * SKIP_PX / 90_600e18);
        assertFalse(t.recoveryMode);
        assertEq(t.entries.length, 3);
        assertEq(t.entries[0].borrower, trC);
        assertEq(t.entries[1].borrower, trB);
        assertEq(t.entries[2].borrower, trA);
        assertEq(t.entries[0].debtAhead, 0);
        assertEq(t.entries[1].debtAhead, 40_300e18);
        assertEq(t.entries[2].debtAhead, 40_300e18 + 30_200e18);
        assertLt(t.entries[0].nicr, t.entries[1].nicr);
        assertEq(t.entries[0].icr, 1e18 * SKIP_PX / 40_300e18);
        assertEq(t.entries[0].coll, 1e18);
        assertEq(t.entries[0].principal, 40_000e18);
        assertEq(t.entries[0].interest, 300e18);
    }

    function test_snapshot_staticcallFlagsOnlyClDepth() public view {
        uint256 callsBefore = quoter.calls();
        // A Solidity call to a view function is a STATICCALL, like another contract's view would make.
        IRiskLens.Snapshot memory s = lens.snapshot(_query(3));
        assertEq(s.failed, lens.SRC_CL_DEPTH(), "only CL depth unavailable");
        assertEq(s.precompileCalls, 1, "no CL quotes attempted");
        assertEq(quoter.calls(), callsBefore, "quoter never called");
        for (uint256 i; i < 3; ++i) {
            assertEq(s.depth[i].clOut, 0);
            assertGt(s.depth[i].vammOut, 0);
            assertEq(s.depth[i].bestOut, s.depth[i].vammOut);
        }
        assertTrue(s.oracle.ok);
        assertTrue(s.market.created);
        assertEq(s.troves.entries.length, 3);
    }

    function test_clQuote_standalone() public {
        (bool ok, uint256 out, bool exhausted) = lens.clQuote(1e18); // STATICCALL
        assertFalse(ok);
        assertEq(out, 0);
        (bool success, bytes memory ret) = address(lens).call(abi.encodeCall(RiskLens.clQuote, (1e18)));
        assertTrue(success);
        (ok, out, exhausted) = abi.decode(ret, (bool, uint256, bool));
        assertTrue(ok);
        assertFalse(exhausted);
        assertEq(out, uint256(1e18) * 800_000e18 / 11e18);
    }

    function test_snapshot_flagsExhaustedClLiquidity() public {
        // Like mainnet CL200 today: past ~0.25 BTC the in-range MUSD runs out and QuoterV2 reports a partial fill.
        quoter.setExhaustAbove(0.5e18);
        IRiskLens.Snapshot memory s = _snap();
        assertFalse(s.depth[0].clExhausted);
        assertFalse(s.depth[1].clExhausted);
        assertTrue(s.depth[2].clExhausted, "1 BTC drains the pool");
        assertEq(s.depth[2].clOut, uint256(0.5e18) * 800_000e18 / 10.5e18, "all the MUSD in range");
        assertEq(s.failed, 0, "a partial fill is data, not a failure");
    }

    function test_snapshot_maxSizesStayWithinPrecompileBudget() public {
        assertLe(1 + lens.MAX_DEPTH_SIZES() + lens.BACKSTOP_PRECOMPILE_RESERVE(), lens.PRECOMPILE_BUDGET());
        assertLe(lens.PRECOMPILE_BUDGET(), 20, "Mezo limit");
        IRiskLens.Snapshot memory s = _snap(lens, _query(8));
        assertEq(s.precompileCalls, 9);
        assertEq(s.failed, 0);
    }

    function test_snapshot_zeroSizeRowIsEmpty() public {
        IRiskLens.Query memory q = _query(2);
        q.btcSizes[1] = 0;
        IRiskLens.Snapshot memory s = _snap(lens, q);
        assertEq(s.depth[1].bestOut, 0);
        assertEq(s.failed, 0);
        assertEq(s.precompileCalls, 2);
    }

    // ---------------------------------------------------------------- isolation: one failing source at a time

    function test_isolation_oracle() public {
        vm.mockCallRevert(address(oracle), abi.encodeCall(IBtcMusdOracle.status, ()), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        // Without Skip there is no price for ICRs either.
        assertEq(s.failed, lens.SRC_ORACLE() | lens.SRC_PYTH_MUSD() | lens.SRC_TROVES());
        assertTrue(s.market.created);
        assertGt(s.depth[0].bestOut, 0);
        assertEq(s.depth[0].referenceOut, 0);
        assertEq(s.troves.entries.length, 3, "queue still listed");
        assertEq(s.troves.entries[0].icr, 0);
    }

    function test_isolation_skipDownStillReportsStatus() public {
        SkipMock(MezoAddresses.SKIP_BTC_USD).setMode(SkipMock.Mode.REVERT);
        IRiskLens.Snapshot memory s = _snap();
        assertFalse(s.oracle.ok);
        assertEq(s.oracle.skipAge, type(uint256).max);
        assertEq(s.failed, lens.SRC_TROVES(), "status() itself never reverts");
        assertEq(s.oracle.pythBtcPrice, 80_100e18, "Pyth still visible");
    }

    function test_isolation_market() public {
        vm.mockCallRevert(address(morpho), abi.encodeWithSelector(MockMorphoMarkets.market.selector), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_MARKET());
        assertEq(s.factory.globalBorrowCap, 5000e18);
        assertEq(s.factory.borrowHeadroom, 0, "unknown without the market");
        assertFalse(s.depth[0].clean, "incentive unknown");
    }

    function test_isolation_irm() public {
        vm.mockCallRevert(address(irm), abi.encodeWithSelector(MockIrm.borrowRateView.selector), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_MARKET());
    }

    function test_isolation_factory() public {
        vm.mockCallRevert(address(factory), abi.encodeCall(IBorrowAccountFactory.globalBorrowCap, ()), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_FACTORY());
        assertTrue(s.market.created);
    }

    function test_isolation_backstopBalanceRead() public {
        vm.mockCallRevert(address(musd), abi.encodeCall(IERC20.balanceOf, (address(backstop))), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_BACKSTOP());
        assertEq(s.backstop.backstop, address(backstop));
    }

    function test_backstop_eoaAndNonVault() public {
        address eoa = makeAddr("backstopEoa");
        musd.mint(eoa, 7e18);
        IRiskLens.Query memory q = _query(1);
        q.backstop = eoa;
        IRiskLens.Snapshot memory s = _snap(lens, q);
        assertEq(s.failed, 0);
        assertEq(s.backstop.freeMusd, 7e18);
        assertFalse(s.backstop.vaultRead);

        vm.mockCallRevert(address(backstop), abi.encodeCall(IERC4626.totalAssets, ()), bytes("x"));
        s = _snap();
        assertEq(s.failed, 0, "a non-vault backstop is not a failure");
        assertFalse(s.backstop.vaultRead);
        assertEq(s.backstop.freeMusd, 150e18);
    }

    function test_isolation_pricePool() public {
        vm.mockCallRevert(address(pricePool), abi.encodeWithSelector(ISlipstreamPool.observe.selector), bytes("OLD"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_MUSD_POOL());
        assertEq(s.musd.twapPrice, 0);
        assertEq(s.musd.pythPrice, 0.99e18, "Pyth leg unaffected");
    }

    function test_isolation_quoter() public {
        quoter.setReverting(true);
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_CL_DEPTH());
        assertEq(s.depth[0].clOut, 0);
        assertGt(s.depth[0].vammOut, 0);
    }

    function test_isolation_router() public {
        vm.mockCallRevert(address(router), abi.encodeWithSelector(MockRouter.getAmountsOut.selector), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_VAMM_DEPTH());
        assertGt(s.depth[0].clOut, 0);
        assertEq(s.depth[0].bestOut, s.depth[0].clOut);
    }

    function test_isolation_troves() public {
        vm.mockCallRevert(address(troves), abi.encodeCall(ISortedTroves.getSize, ()), bytes("x"));
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_TROVES());
        assertEq(s.troves.entries.length, 0);
    }

    function test_isolation_everythingDownStillReturns() public {
        vm.mockCallRevert(address(oracle), abi.encodeCall(IBtcMusdOracle.status, ()), bytes("x"));
        vm.mockCallRevert(address(morpho), abi.encodeWithSelector(MockMorphoMarkets.market.selector), bytes("x"));
        vm.mockCallRevert(address(factory), abi.encodeCall(IBorrowAccountFactory.globalBorrowCap, ()), bytes("x"));
        vm.mockCallRevert(address(musd), abi.encodeCall(IERC20.balanceOf, (address(backstop))), bytes("x"));
        vm.mockCallRevert(address(pricePool), abi.encodeWithSelector(ISlipstreamPool.slot0.selector), bytes("x"));
        vm.mockCallRevert(address(router), abi.encodeWithSelector(MockRouter.getAmountsOut.selector), bytes("x"));
        vm.mockCallRevert(address(troves), abi.encodeCall(ISortedTroves.getSize, ()), bytes("x"));
        quoter.setReverting(true);
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, 0x1ff, "every source flagged");
        assertEq(s.depth.length, 3);
    }

    // ---------------------------------------------------------------- configuration

    function test_skippedSourcesWhenUnconfigured() public {
        IRiskLens.LensConfig memory c;
        c.factory = address(factory);
        RiskLens bare = new RiskLens(c);
        IRiskLens.Query memory q = _query(2);
        q.backstop = address(0);
        IRiskLens.Snapshot memory s = _snap(bare, q);
        assertEq(s.failed, 0);
        assertEq(
            s.skipped,
            bare.SRC_BACKSTOP() | bare.SRC_MUSD_POOL() | bare.SRC_CL_DEPTH() | bare.SRC_VAMM_DEPTH() | bare.SRC_TROVES()
        );
        assertEq(s.precompileCalls, 1);
        assertTrue(s.oracle.ok);
        assertTrue(s.market.created);
        assertEq(s.depth.length, 2);
        assertGt(s.depth[0].referenceOut, 0);
    }

    function test_queryValidation() public {
        IRiskLens.Query memory q = _query(9);
        vm.expectRevert(abi.encodeWithSelector(IRiskLens.TooManySizes.selector, 9, 8));
        lens.snapshot(q);
        q = _query(1);
        q.troveCount = 26;
        vm.expectRevert(abi.encodeWithSelector(IRiskLens.TooManyTroves.selector, 26, 25));
        lens.snapshot(q);
        q = _query(1);
        q.twapWindow = 59;
        vm.expectRevert(abi.encodeWithSelector(IRiskLens.InvalidTwapWindow.selector, 59));
        lens.snapshot(q);
        q.twapWindow = 0;
        assertEq(lens.snapshot(q).musd.twapWindow, lens.DEFAULT_TWAP_WINDOW());
    }

    function test_constructorValidation() public {
        IRiskLens.LensConfig memory c = _config();
        c.factory = address(0);
        vm.expectRevert(IRiskLens.ZeroFactory.selector);
        new RiskLens(c);

        c = _config();
        c.sortedTroves = address(0);
        vm.expectRevert(IRiskLens.InvalidConfig.selector);
        new RiskLens(c);

        c = _config();
        c.poolFactory = address(0);
        vm.expectRevert(IRiskLens.InvalidConfig.selector);
        new RiskLens(c);

        c = _config();
        c.clTickSpacing = 0;
        vm.expectRevert(IRiskLens.InvalidConfig.selector);
        new RiskLens(c);

        c = _config();
        c.router = makeAddr("noCode");
        vm.expectRevert(IRiskLens.InvalidConfig.selector);
        new RiskLens(c);

        c = _config();
        c.musdPricePool = address(new MockSlipstreamPool(address(stable), makeAddr("notMusd")));
        vm.expectRevert(abi.encodeWithSelector(IRiskLens.PricePoolWithoutMusd.selector, c.musdPricePool));
        new RiskLens(c);
    }

    function test_immutablesFromFactory() public view {
        assertEq(lens.FACTORY(), address(factory));
        assertEq(lens.MORPHO(), address(morpho));
        assertEq(lens.MUSD(), address(musd));
        assertEq(lens.ORACLE(), address(oracle));
        assertEq(lens.IRM(), address(irm));
        assertEq(lens.COLLATERAL(), factory.COLLATERAL());
        assertEq(lens.LLTV(), 0.77e18);
        assertEq(lens.MARKET_ID(), Id.unwrap(factory.MARKET_ID()));
        assertFalse(lens.MUSD_IS_TOKEN0());
    }

    function test_marketNotCreated() public {
        morpho.setMarket(factory.MARKET_ID(), Market(0, 0, 0, 0, 0, 0));
        IRiskLens.Snapshot memory s = _snap();
        assertFalse(s.market.created);
        assertEq(s.failed, 0);
        assertGt(s.market.liquidationIncentive, 1e18);
        assertEq(s.factory.borrowHeadroom, 0);
    }

    // ---------------------------------------------------------------- price math

    function test_musdPrice_musdAsToken0() public {
        MockSlipstreamPool flipped = new MockSlipstreamPool(address(musd), address(stable));
        flipped.set(TickMath.getSqrtRatioAtTick(-SPOT_TICK), -SPOT_TICK);
        IRiskLens.LensConfig memory c = _config();
        c.musdPricePool = address(flipped);
        RiskLens l = new RiskLens(c);
        assertTrue(l.MUSD_IS_TOKEN0());
        (int24 tick, uint256 twap, uint256 spot) = l.musdPoolPrice(600);
        assertEq(tick, -SPOT_TICK);
        assertApproxEqRel(twap, SPOT_PRICE, 1e9);
        assertApproxEqRel(spot, SPOT_PRICE, 1e9);
    }

    function test_musdPrice_twapTickRoundsTowardsNegativeInfinity() public {
        // -7 over 2 s is -3.5: Uniswap's OracleLibrary floors it to -4, not -3.
        pricePool.setCumulatives(0, -7);
        (int24 tick,,) = lens.musdPoolPrice(2);
        assertEq(tick, -4);
        pricePool.setCumulatives(0, 7);
        (tick,,) = lens.musdPoolPrice(2);
        assertEq(tick, 3);
        pricePool.setCumulatives(-100, -40);
        (tick,,) = lens.musdPoolPrice(20);
        assertEq(tick, 3);
    }

    function test_tickMath_knownValues() public {
        TickMathHarness h = new TickMathHarness();
        assertEq(h.sqrtAt(0), 2 ** 96);
        assertEq(h.sqrtAt(-887_272), 4_295_128_739);
        assertEq(h.sqrtAt(887_272), 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342);
        vm.expectRevert(abi.encodeWithSelector(TickMath.TickOutOfRange.selector, int24(887_273)));
        h.sqrtAt(887_273);
    }

    // ---------------------------------------------------------------- troves

    function test_troveQueue_clampsAndHandlesEmpty() public view {
        IRiskLens.TroveQueue memory t = lens.troveQueue(25, SKIP_PX);
        assertEq(t.entries.length, 3);
        t = lens.troveQueue(1, SKIP_PX);
        assertEq(t.entries.length, 1);
        assertEq(t.entries[0].borrower, trC);
        t = lens.troveQueue(0, SKIP_PX);
        assertEq(t.entries.length, 0);
        assertEq(t.size, 3);
    }

    function test_troveQueue_recoveryModeFlag() public view {
        // TCR = 3 BTC * price / 90.6k: below 150% once BTC < 45,300.
        IRiskLens.TroveQueue memory t = lens.troveQueue(3, 45_000e18);
        assertTrue(t.recoveryMode);
        t = lens.troveQueue(3, 46_000e18);
        assertFalse(t.recoveryMode);
    }

    function test_troveManagerInterfaceMatchesMock() public pure {
        // Guards the interface against drift: the lens reads exactly these selectors.
        assertEq(IMusdTroveManager.getCurrentICR.selector, MockTroves.getCurrentICR.selector);
        assertEq(IMusdTroveManager.getEntireDebtAndColl.selector, MockTroves.getEntireDebtAndColl.selector);
    }
}
