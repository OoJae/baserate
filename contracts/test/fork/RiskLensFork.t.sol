// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IRiskLens} from "../../src/interfaces/IRiskLens.sol";
import {RiskLens} from "../../src/lens/RiskLens.sol";
import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {BtcPrecompileMock} from "../utils/BtcPrecompileMock.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice RiskLens against live Mezo state at the pinned blocks: a fresh M1 (real BtcMusdOracle over the Skip mock
/// and real Pyth, real Morpho and AdaptiveCurveIrm, one open position), real MUSD troves, the real Tigris Router and,
/// on mainnet, the real Slipstream QuoterV2 and CL10 pool.
/// @dev CL quotes read `BTC.balanceOf(pool)` through the BTC precompile, whose stub reverts under a local fork, so the
/// suite etches `BtcPrecompileMock` (mirrors native balances, exactly as the live precompile does). Without it the
/// CL sub-result is flagged unavailable, which `test_fork_withoutBtcMockClIsFlaggedNotFatal` pins down. The same
/// reads were checked live, with the real precompiles, by `cast call` (see script/DeployPeriphery.s.sol NatSpec).
abstract contract RiskLensForkBase is MezoFork {
    uint256 internal constant SEED = 10_000e18;

    BtcMusdOracle internal oracle;
    BorrowAccountFactory internal factory;
    WsMUSD internal ws;
    RiskLens internal lens;
    address internal backstop = makeAddr("backstop");
    address internal borrower = makeAddr("borrower");
    bool internal isMainnet;

    function _setUpNetwork(Net which, bool mockBtc) internal {
        _fork(which);
        isMainnet = which == Net.MAINNET;
        if (mockBtc) vm.etch(MezoAddresses.BTC, address(new BtcPrecompileMock()).code);

        oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: makeAddr("governor"),
                sentinel: makeAddr("sentinel"),
                feeRecipient: makeAddr("feeRouter"),
                globalBorrowCap: 2000e18,
                standard: IBorrowAccountFactory.Limits(0.02e18, uint16(net.lltv / 1e14 - 1500)),
                canary: IBorrowAccountFactory.Limits(0.002e18, uint16(net.lltv / 1e14 - 25))
            })
        );
        MarketParams memory params = factory.marketParams();
        IMorpho(net.morpho).createMarket(params);
        address lender = makeAddr("lender");
        deal(net.musd, lender, SEED);
        vm.startPrank(lender);
        IERC20(net.musd).approve(net.morpho, SEED);
        IMorpho(net.morpho).supply(params, SEED, 0, lender, "");
        vm.stopPrank();

        // One real position so utilization and the IRM rate are non-trivial.
        vm.deal(borrower, 0.01e18);
        vm.prank(borrower);
        factory.openAndBorrow{value: 0.01e18}(300e18, 6000);

        // A backstop holding idle MUSD and wsMUSD.
        ws = new WsMUSD(net.musd, net.smusd, makeAddr("capAdmin"), 250_000e18);
        deal(net.musd, backstop, 1500e18);
        vm.startPrank(backstop);
        IERC20(net.musd).approve(address(ws), 500e18);
        ws.deposit(500e18, backstop);
        vm.stopPrank();

        lens = new RiskLens(
            IRiskLens.LensConfig({
                factory: address(factory),
                wsMusd: address(ws),
                troveManager: net.troveManager,
                sortedTroves: net.sortedTroves,
                router: net.router,
                poolFactory: net.poolFactory,
                quoter: net.clQuoter,
                clTickSpacing: net.clBtcMusdTickSpacing,
                musdPricePool: net.clMusdUsdPool
            })
        );
        vm.label(address(lens), "RiskLens");
    }

    function _query() internal view returns (IRiskLens.Query memory q) {
        q.backstop = backstop;
        q.btcSizes = new uint256[](5);
        q.btcSizes[0] = 0.001e18;
        q.btcSizes[1] = 0.01e18;
        q.btcSizes[2] = 0.05e18;
        q.btcSizes[3] = 0.1e18;
        q.btcSizes[4] = 1e18;
        q.troveCount = 25;
        q.twapWindow = 1800;
    }

    /// @dev Plain CALL, as `eth_call` makes it.
    function _snap() internal returns (IRiskLens.Snapshot memory s) {
        (bool ok, bytes memory ret) = address(lens).call(abi.encodeCall(RiskLens.snapshot, (_query())));
        assertTrue(ok, "snapshot reverted");
        s = abi.decode(ret, (IRiskLens.Snapshot));
    }

    function _expectedSkipped() internal view returns (uint256) {
        return isMainnet ? 0 : lens.SRC_MUSD_POOL() | lens.SRC_CL_DEPTH();
    }
}

abstract contract RiskLensForkTests is RiskLensForkBase {
    function test_fork_snapshotIsSane() public {
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, 0, "no source failed");
        assertEq(s.skipped, _expectedSkipped(), "testnet has no QuoterV2 and no CL10");
        assertLe(s.precompileCalls, lens.PRECOMPILE_BUDGET());
        assertEq(s.precompileCalls, isMainnet ? 6 : 1, "1 Skip + 1 BTC read per CL quote");

        // Oracle: Skip mock seeded with the real fork-block answer, real Pyth.
        assertTrue(s.oracle.ok, "oracle ok");
        (, int256 answer,,,) = skipOracle.latestRoundData();
        assertEq(s.oracle.skipPrice, uint256(answer));
        assertLt(s.oracle.deviationBps, 1000);

        // M1
        assertTrue(s.market.created);
        assertEq(s.market.lltv, net.lltv);
        assertEq(s.market.totalSupplyAssets, SEED);
        assertGe(s.market.totalBorrowAssets, 300e18);
        assertApproxEqRel(s.market.utilization, uint256(300.3e18) * 1e18 / SEED, 0.001e18);
        assertGt(s.market.borrowRate, 0);
        assertGt(s.market.borrowApr, 0.001e18, "APR > 0.1%");
        assertLt(s.market.borrowApr, 1e18, "APR < 100%");
        assertLt(s.market.supplyApr, s.market.borrowApr);
        assertEq(s.market.liquidity, s.market.totalSupplyAssets - s.market.totalBorrowAssets);
        assertGt(s.market.liquidationIncentive, 1.04e18);
        assertLt(s.market.liquidationIncentive, 1.08e18);

        // Factory
        assertEq(s.factory.globalBorrowCap, 2000e18);
        assertEq(s.factory.borrowHeadroom, 2000e18 - s.market.totalBorrowAssets);
        assertEq(s.factory.originationFeeBps, 10);
        assertFalse(s.factory.borrowPaused);

        // Backstop: 1000 idle MUSD + 500 MUSD in wsMUSD
        assertEq(s.backstop.musd, 1000e18);
        assertEq(s.backstop.wsMusdAssets, 500e18);
        assertEq(s.backstop.freeMusd, 1500e18);
        assertFalse(s.backstop.vaultRead, "an EOA is not a vault");

        // MUSD price: Pyth on both networks, CL10 TWAP on mainnet.
        assertGt(s.musd.pythPrice, 0.95e18);
        assertLt(s.musd.pythPrice, 1.05e18);
        if (isMainnet) {
            assertGt(s.musd.twapPrice, 0.95e18);
            assertLt(s.musd.twapPrice, 1.05e18);
            assertApproxEqRel(s.musd.spotPrice, s.musd.twapPrice, 0.02e18, "spot near TWAP");
            assertApproxEqRel(s.musd.twapPrice, s.musd.pythPrice, 0.02e18, "CL10 near Pyth");
        }

        _assertDepth(s);
        _assertTroves(s);
    }

    function _assertDepth(IRiskLens.Snapshot memory s) internal view {
        assertEq(s.depth.length, 5);
        uint256 lastPerUnit = type(uint256).max;
        uint256 lastImpact;
        for (uint256 i; i < s.depth.length; ++i) {
            IRiskLens.DepthQuote memory d = s.depth[i];
            assertGt(d.vammOut, 0, "vAMM quote");
            if (isMainnet) assertGt(d.clOut, 0, "CL200 quote");
            else assertEq(d.clOut, 0);
            assertGt(d.referenceOut, 0);
            uint256 perUnit = d.bestOut * 1e18 / d.btcIn;
            assertLe(perUnit, lastPerUnit, "depth decreasing in size");
            assertGe(d.impactBps, lastImpact, "impact non-decreasing in size");
            lastPerUnit = perUnit;
            lastImpact = d.impactBps;
        }
        // The smallest clip trades within 5% of the oracle on both networks.
        assertLt(s.depth[0].impactBps, 500, "small clip near oracle");
        assertTrue(s.depth[0].clean, "0.001 BTC clears inside the incentive");
        if (isMainnet) {
            // About $10k of MUSD on CL200: a 1 BTC liquidation drains its range and is not clean.
            assertFalse(s.depth[0].clExhausted);
            assertTrue(s.depth[4].clExhausted, "1 BTC exhausts CL200's in-range MUSD");
            assertFalse(s.depth[4].clean, "1 BTC is not clean on mainnet");
            assertGt(s.depth[4].impactBps, s.depth[0].impactBps + 500);
        } else {
            // The testnet MUSD/BTC vAMM holds about 1,300 BTC.
            assertTrue(s.depth[4].clean, "1 BTC is clean on the deep testnet pool");
        }
    }

    function _assertTroves(IRiskLens.Snapshot memory s) internal view {
        IRiskLens.TroveQueue memory t = s.troves;
        assertEq(t.price, s.oracle.skipPrice);
        assertGt(t.tcr, 1.1e18, "system above MCR");
        if (isMainnet) {
            assertEq(t.size, 1, "one mainnet trove");
            assertEq(t.entries.length, 1);
        } else {
            assertGe(t.size, 300, "300+ testnet troves");
            assertEq(t.entries.length, 25);
        }
        uint256 lastNicr;
        uint256 lastAhead;
        for (uint256 i; i < t.entries.length; ++i) {
            IRiskLens.TroveEntry memory e = t.entries[i];
            assertTrue(e.borrower != address(0));
            assertGe(e.nicr, lastNicr, "redemption order: lowest NICR first");
            assertGt(e.icr, 0);
            assertGt(e.coll, 0);
            assertGt(e.principal, 0);
            assertGe(e.debtAhead, lastAhead);
            lastNicr = e.nicr;
            lastAhead = e.debtAhead;
            // NICR = coll * 1e20 / principal (Liquity), computed by MUSD itself.
            assertApproxEqRel(e.nicr, e.coll * 1e20 / e.principal, 0.01e18);
        }
        assertEq(t.entries[0].debtAhead, 0);
    }

    function test_fork_staticcallFlagsClOnly() public view {
        IRiskLens.Snapshot memory s = lens.snapshot(_query());
        uint256 expectedFailed = isMainnet ? lens.SRC_CL_DEPTH() : 0;
        assertEq(s.failed, expectedFailed);
        assertTrue(s.oracle.ok);
        assertGt(s.depth[0].vammOut, 0);
        assertEq(s.depth[0].clOut, 0);
    }
}

contract RiskLensForkTestnetTest is RiskLensForkTests {
    function setUp() public {
        _setUpNetwork(Net.TESTNET, true);
    }
}

contract RiskLensForkMainnetTest is RiskLensForkTests {
    function setUp() public {
        _setUpNetwork(Net.MAINNET, true);
    }

    function test_fork_clMatchesDirectQuoterCall() public {
        (bool ok, bytes memory ret) = address(lens).call(abi.encodeCall(RiskLens.clQuote, (0.01e18)));
        assertTrue(ok);
        (bool quoted, uint256 out, bool exhausted) = abi.decode(ret, (bool, uint256, bool));
        assertTrue(quoted);
        assertFalse(exhausted, "0.01 BTC fits CL200's range");
        (bool ok2, bytes memory ret2) = net.clQuoter
            .call(
                abi.encodeWithSignature(
                    "quoteExactInputSingle((address,address,uint256,int24,uint160))",
                    MezoAddresses.BTC,
                    net.musd,
                    uint256(0.01e18),
                    int24(200),
                    uint160(0)
                )
            );
        assertTrue(ok2);
        assertEq(out, abi.decode(ret2, (uint256)), "lens == QuoterV2");
    }
}

/// @notice Mainnet without the BTC precompile mock: the CL quote hits the precompile stub (which reverts under a
/// fork) and must only flag CL depth, never revert the lens.
contract RiskLensForkMainnetNoBtcMockTest is RiskLensForkBase {
    function setUp() public {
        _setUpNetwork(Net.MAINNET, false);
    }

    function test_fork_withoutBtcMockClIsFlaggedNotFatal() public {
        IRiskLens.Snapshot memory s = _snap();
        assertEq(s.failed, lens.SRC_CL_DEPTH(), "only CL depth unavailable in the fork");
        for (uint256 i; i < s.depth.length; ++i) {
            assertEq(s.depth[i].clOut, 0);
            assertGt(s.depth[i].vammOut, 0);
        }
        assertTrue(s.oracle.ok);
        assertGt(s.musd.twapPrice, 0);
        assertEq(s.troves.entries.length, 1);
    }
}
