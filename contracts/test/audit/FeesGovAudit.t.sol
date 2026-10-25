// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Position} from "morpho-blue/interfaces/IMorpho.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";
import {ILiquidationVenues} from "../../src/interfaces/ILiquidationVenues.sol";
import {IRiskLens} from "../../src/interfaces/IRiskLens.sol";
import {IMUSDSavingsRate} from "../../src/interfaces/external/IMUSDSavingsRate.sol";
import {RiskLens} from "../../src/lens/RiskLens.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";

import {MockTroves} from "../utils/LensMocks.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {PythMock} from "../utils/PythMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {MockBribe, MockPoolsVoter} from "../utils/VoterMocks.sol";
import {LocalM1Stack} from "./FeesGovAuditHelpers.sol";

// =====================================================================================================================
// D-1, D-4 and D-7 (fixed in BorrowAccount / BorrowAccountFactory): their regression tests live with the matching A-1,
// A-2 and D-7 tests in CoreAudit.t.sol (test_fix_D1a…, test_fix_D1b…, test_fix_D1c…, test_fix_D4…, test_fix_D7…).
// =====================================================================================================================

// =====================================================================================================================
// D-2 (Medium, fixed): any sMUSD change that made the yield leg revert froze every fee in the immutable router
// D-3 (Low, fixed): no on-chain epoch guard: anyone could post the whole bribe share in the last second of an epoch
// =====================================================================================================================

contract FeesGovAudit_FeeRouter is Test {
    uint256 internal constant NOW = 1_792_943_000; // Sunday 2026-10-25
    uint256 internal constant EPOCH_START = 1_792_627_200; // Thursday 2026-10-22 00:00 UTC

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    MockPoolsVoter internal voter;
    MockBribe internal bribeA;
    MockBribe internal bribeB;
    FeeRouter internal router;

    address internal gaugeA = makeAddr("gaugeCL200");
    address internal gaugeB = makeAddr("gaugeVAMM");
    address internal treasury = makeAddr("treasury");
    address internal saver = makeAddr("saver");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(NOW);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        voter = new MockPoolsVoter();
        address[] memory rewards = new address[](1);
        rewards[0] = address(musd);
        bribeA = new MockBribe(address(voter), rewards);
        bribeB = new MockBribe(address(voter), rewards);
        voter.addGauge(gaugeA, address(bribeA));
        voter.addGauge(gaugeB, address(bribeB));
        voter.setWhitelisted(address(musd), true);

        musd.mint(saver, 1_000_000e18);
        vm.startPrank(saver);
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(1_000_000e18);
        vm.stopPrank();

        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](2);
        t[0] = IFeeRouter.BribeTarget({gauge: gaugeA, bribe: address(bribeA)});
        t[1] = IFeeRouter.BribeTarget({gauge: gaugeB, bribe: address(bribeB)});
        router = new FeeRouter(address(musd), address(smusd), address(voter), treasury, t);
    }

    /// @dev D-2 fixed: sMUSD is an upgradeable proxy (SECURITY.md "Upgradeable dependencies"). If an upgrade restricts
    /// `receiveProtocolYield` (e.g. to the PCV), `distribute()` still succeeds: the treasury and bribe legs are paid,
    /// the sMUSD leg is carried with its approval revoked, and once the failure has spanned two epoch flips the sMUSD
    /// leg (carry included) goes to the treasury. Nothing stays stuck in the immutable router.
    function test_fix_D2_smusdRestrictionNoLongerFreezesFees() public {
        vm.mockCallRevert(
            address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.receiveProtocolYield.selector), bytes("only PCV")
        );
        musd.mint(address(router), 1000e18);

        vm.prank(stranger);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(musd.balanceOf(treasury), 200e18, "treasury paid");
        assertEq(musd.balanceOf(address(bribeA)) + musd.balanceOf(address(bribeB)), 400e18, "bribes posted");
        assertEq(plan.smusdCarried, 400e18, "sMUSD leg carried");
        assertEq(musd.balanceOf(address(router)), 400e18);
        assertEq(musd.allowance(address(router), address(smusd)), 0, "approval revoked");
        assertEq(router.smusdFailingSince(), NOW);

        // Killing both gauges sends their shares to the sMUSD leg, which still fails; months later, with more fees
        // streamed in, the grace period is long over and the whole sMUSD leg goes to the treasury.
        voter.setAlive(gaugeA, false);
        voter.setAlive(gaugeB, false);
        skip(180 days);
        musd.mint(address(router), 5000e18);
        plan = router.distribute();
        assertEq(plan.smusdToTreasury, 2000e18 + 2000e18 + 400e18, "40% + redirected 40% + carry");

        assertEq(musd.balanceOf(address(router)), 0, "no fee is stuck in the router");
        assertEq(musd.balanceOf(treasury), 200e18 + 1000e18 + 4400e18);
        assertEq(
            musd.balanceOf(treasury) + musd.balanceOf(address(bribeA)) + musd.balanceOf(address(bribeB)),
            6000e18,
            "every fee paid out"
        );
    }

    /// @dev D-2 fixed (variant): the router reads `pendingYield()` / `totalSupply()` with low-level calls; an upgrade
    /// that drops or renames them (or returns malformed data) no longer freezes the router, and the donation is still
    /// attempted (and here succeeds).
    function test_fix_D2_smusdGetterRemovalNoLongerFreezesRouter() public {
        vm.mockCallRevert(address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.pendingYield.selector), "");
        vm.mockCall(address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.totalSupply.selector), hex"00");
        musd.mint(address(router), 1000e18);
        IFeeRouter.Plan memory preview = router.previewDistribute();
        assertTrue(preview.smusdAccepts);
        IFeeRouter.Plan memory plan = router.distribute();
        assertTrue(plan.smusdAccepts, "donated");
        assertEq(musd.balanceOf(treasury), 200e18);
        assertEq(musd.balanceOf(address(router)), 0);
    }

    /// @dev D-3 fixed: a call in the last hour of epoch N (when Mezo's Voter only lets whitelisted veNFTs vote) posts
    /// no bribe; the bribe shares are carried and land in epoch N+1, where every voter can react. The other legs are
    /// paid immediately.
    function test_fix_D3_lastSecondDistributeCarriesBribesToNextEpoch() public {
        uint256 epochEnd = EPOCH_START + 7 days;
        musd.mint(address(router), 1000e18);
        vm.warp(epochEnd - 1);
        assertFalse(router.bribeWindowOpen(block.timestamp));

        vm.prank(stranger);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.bribesCarried, 400e18);
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), EPOCH_START), 0, "nothing credited to the closing epoch");
        assertEq(bribeB.tokenRewardsPerEpoch(address(musd), EPOCH_START), 0);
        assertEq(musd.balanceOf(treasury), 200e18, "treasury paid");

        // Repeated last-hour calls cannot push the carry into the other legs.
        vm.prank(stranger);
        router.distribute();
        assertEq(router.bribeCarry(0) + router.bribeCarry(1), 400e18);

        vm.warp(epochEnd + 1 hours);
        router.distribute();
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), epochEnd), 200e18, "credited to the next epoch");
        assertEq(bribeB.tokenRewardsPerEpoch(address(musd), epochEnd), 200e18);
        assertEq(musd.balanceOf(address(router)), 0);
    }

    /// @dev D-3 fixed (zero votes): a bribe contract with no votes would make the bribe unclaimable (BribeVotingReward
    /// `earned` divides by the end-of-epoch supply; no sweep). Its share is carried until someone votes.
    function test_fix_D3_voteLessBribeIsCarriedNotPosted() public {
        bribeA.setTotalSupply(0);
        musd.mint(address(router), 1000e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.bribeAmounts[0], 0);
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), EPOCH_START), 0, "no unclaimable bribe");
        assertEq(bribeB.tokenRewardsPerEpoch(address(musd), EPOCH_START), 200e18);
        assertEq(router.bribeCarry(0), 200e18);
    }
}

// =====================================================================================================================
// D-5 (Low, fixed): RiskLens reported a backstop's queued-exit MUSD as free
// D-6 (Informational, fixed): RiskLens.snapshot reverted on an oversized Skip answer that the oracle tolerates
// D-8 (Informational, fixed): the trove queue counted sub-MCR troves that MUSD redemptions skip
// =====================================================================================================================

contract FeesGovAudit_RiskLens is Test {
    uint256 internal constant PRICE = 80_000e36;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    WsMUSD internal ws;
    MockMorphoOracle internal m1Oracle;
    Backstop internal backstop;

    address internal liquidator = makeAddr("liquidator");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_792_942_983);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        ws = new WsMUSD(address(musd), address(smusd), makeAddr("capAdmin"), 250_000e18);
        m1Oracle = new MockMorphoOracle(PRICE);
    }

    function _factory(address oracle_) internal returns (BorrowAccountFactory) {
        return new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: makeAddr("morpho"),
                musd: address(musd),
                oracle: oracle_,
                irm: makeAddr("irm"),
                lltv: 0.77e18,
                bos: address(0),
                collSurplusPool: address(0),
                governor: makeAddr("governor"),
                sentinel: makeAddr("sentinel"),
                feeRecipient: makeAddr("feeRouter"),
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits(0.01e18, 6200),
                canary: IBorrowAccountFactory.Limits(0.002e18, 7675)
            })
        );
    }

    function _lens(address factory_) internal returns (RiskLens) {
        return new RiskLens(
            IRiskLens.LensConfig({
                factory: factory_,
                wsMusd: address(ws),
                troveManager: address(0),
                sortedTroves: address(0),
                router: address(0),
                poolFactory: address(0),
                quoter: address(0),
                clTickSpacing: 0,
                musdPricePool: address(0)
            })
        );
    }

    /// @dev D-5 fixed: after a 1,000 MUSD exit is queued, the backstop can deploy ~1 MUSD (`availableCash`), and the
    /// lens now reports exactly that (the raw balance stays visible in `musd`). BTC donated to the backstop is not
    /// reported as BTC held: `nativeBtc` is the backstop's `inventory()`.
    function test_fix_D5_lensReportsAvailableCashNotReservedExits() public {
        backstop = new Backstop(
            IBackstop.BackstopParams({
                musd: address(musd),
                wsMusd: address(ws),
                oracle: address(m1Oracle),
                lltv: 0.77e18,
                liquidator: liquidator,
                sentinel: makeAddr("sentinel"),
                maxKeeperSale: 0.05e18,
                venues: ILiquidationVenues.VenueConfig(address(0), address(0), address(0), address(0))
            })
        );
        musd.mint(address(this), 1e18);
        musd.approve(address(backstop), 1e18);
        backstop.deposit(1e18, DEAD);
        musd.mint(alice, 1000e18);
        vm.startPrank(alice);
        musd.approve(address(backstop), 1000e18);
        uint256 shares = backstop.deposit(1000e18, alice);
        backstop.requestRedeem(shares, alice, alice);
        vm.stopPrank();

        vm.deal(address(backstop), 0.3e18); // a donation, not inventory

        RiskLens lens = _lens(address(_factory(address(m1Oracle))));
        IRiskLens.BackstopState memory b = lens.backstopState(address(backstop));
        uint256 available = backstop.availableCash();

        assertApproxEqAbs(available, 1e18, 1e15, "backstop can only deploy ~1 MUSD");
        assertEq(b.freeMusd, available, "lens reports what the backstop can deploy");
        assertApproxEqAbs(b.musd + b.wsMusdAssets, 1001e18, 1e15, "raw holdings still visible");
        assertEq(b.nativeBtc, backstop.inventory(), "BTC held = inventory");
        assertEq(b.nativeBtc, 0, "the donation is not counted");

        // A 0.005 BTC sale (~385 MUSD at the backstop's price) is far above the lens's free MUSD, and indeed reverts.
        vm.deal(liquidator, 0.005e18);
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.InsufficientCash.selector);
        backstop.buyCollateral{value: 0.005e18}(0);
    }

    /// @dev D-6 fixed: `BtcMusdOracle.status()` never reverts and reports an oversized Skip answer as `skipPrice` with
    /// `ok = false`; RiskLens now treats a Skip answer above `MAX_SKIP_ANSWER` as unavailable (reference price 0)
    /// instead of computing `skipPrice * 1e18`, so the snapshot no longer panics.
    function test_fix_D6_snapshotToleratesOversizedSkipAnswer() public {
        vm.etch(MezoAddresses.SKIP_BTC_USD, address(new SkipMock()).code);
        SkipMock(MezoAddresses.SKIP_BTC_USD).setAnswer(type(int256).max);
        PythMock pyth = new PythMock();
        pyth.setPrice(MezoAddresses.PYTH_BTC_USD, 80_100e8, -8, block.timestamp - 100);
        pyth.setPrice(MezoAddresses.PYTH_MUSD_USD, 0.99e8, -8, block.timestamp - 100);
        BtcMusdOracle oracle = new BtcMusdOracle(address(pyth), MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);

        IBtcMusdOracle.Status memory st = oracle.status(); // does not revert
        assertFalse(st.ok);
        assertEq(st.skipPrice, uint256(type(int256).max));

        RiskLens lens = _lens(address(_factory(address(oracle))));
        IRiskLens.Query memory q;
        q.btcSizes = new uint256[](1);
        q.btcSizes[0] = 0.01e18;
        (bool ok, bytes memory ret) = address(lens).call(abi.encodeCall(RiskLens.snapshot, (q)));
        assertTrue(ok, "snapshot no longer reverts");
        IRiskLens.Snapshot memory s = abi.decode(ret, (IRiskLens.Snapshot));
        assertFalse(s.oracle.ok);
        assertEq(s.depth.length, 1);
        assertEq(s.depth[0].referenceOut, 0, "reference price unavailable");
        assertFalse(s.depth[0].clean);
        assertEq(lens.MAX_SKIP_PRICE(), oracle.MAX_SKIP_ANSWER());
    }

    /// @dev D-8 fixed: MUSD's `redeemCollateral` starts at `getLast()` but skips every trove with ICR < MCR (110%)
    /// (verified TroveManager source). `troveQueue` still lists such a trove in walk order, marked by `icr < MCR`, but
    /// no longer adds its debt to `debtAhead`: the first redeemable trove shows 0 debt ahead.
    function test_fix_D8_troveQueueExcludesSubMcrTroves() public {
        MockTroves troves = new MockTroves();
        troves.push(makeAddr("A"), 1e18, 20_000e18, 0); // ICR 400%
        troves.push(makeAddr("B"), 1e18, 30_000e18, 0); // ICR 267%
        troves.push(makeAddr("C"), 0.5e18, 40_000e18, 0); // ICR 100%: below MCR, skipped by redemptions
        RiskLens lens = new RiskLens(
            IRiskLens.LensConfig({
                factory: address(_factory(address(m1Oracle))),
                wsMusd: address(ws),
                troveManager: address(troves),
                sortedTroves: address(troves),
                router: address(0),
                poolFactory: address(0),
                quoter: address(0),
                clTickSpacing: 0,
                musdPricePool: address(0)
            })
        );
        IRiskLens.TroveQueue memory t = lens.troveQueue(3, 80_000e18);
        assertEq(t.entries[0].borrower, makeAddr("C"));
        assertLt(t.entries[0].icr, lens.MCR(), "marked: below MCR, skipped by redemptions");
        assertEq(t.entries[1].borrower, makeAddr("B"));
        assertEq(t.entries[1].debtAhead, 0, "a redemption hits B first");
        assertEq(t.entries[2].borrower, makeAddr("A"));
        assertEq(t.entries[2].debtAhead, 30_000e18, "only B's debt shields A");
    }
}
