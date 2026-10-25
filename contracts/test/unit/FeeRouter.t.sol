// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";
import {IPoolsVoter} from "../../src/interfaces/external/IPoolsVoter.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {MockBribe, MockPoolsVoter} from "../utils/VoterMocks.sol";

/// @notice FeeRouter against local replicas of MUSD, sMUSD (index, `AmountTooSmall`), Mezo's PoolsVoter and
/// BribeVotingReward (`notifyRewardAmount` semantics from the verified source).
contract FeeRouterTest is Test {
    uint256 internal constant NOW = 1_792_943_000; // Sunday 2026-10-25; epoch started Thursday 2026-10-22 00:00 UTC
    uint256 internal constant EPOCH_START = 1_792_627_200;
    uint256 internal constant SMUSD_SUPPLY = 1_000_000e18;

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
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(NOW);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        voter = new MockPoolsVoter();
        address[] memory rewards = new address[](2);
        rewards[0] = makeAddr("btc");
        rewards[1] = address(musd);
        bribeA = new MockBribe(address(voter), rewards);
        bribeB = new MockBribe(address(voter), rewards);
        voter.addGauge(gaugeA, address(bribeA));
        voter.addGauge(gaugeB, address(bribeB));
        voter.setWhitelisted(address(musd), true);

        musd.mint(saver, SMUSD_SUPPLY);
        vm.startPrank(saver);
        musd.approve(address(smusd), SMUSD_SUPPLY);
        smusd.deposit(SMUSD_SUPPLY);
        vm.stopPrank();

        router = _deploy(_pairs(2));
    }

    // ---------------------------------------------------------------- helpers

    function _pairs(uint256 n) internal view returns (IFeeRouter.BribeTarget[] memory t) {
        t = new IFeeRouter.BribeTarget[](n);
        if (n > 0) t[0] = IFeeRouter.BribeTarget({gauge: gaugeA, bribe: address(bribeA)});
        if (n > 1) t[1] = IFeeRouter.BribeTarget({gauge: gaugeB, bribe: address(bribeB)});
    }

    function _deploy(IFeeRouter.BribeTarget[] memory t) internal returns (FeeRouter) {
        return new FeeRouter(address(musd), address(smusd), address(voter), treasury, t);
    }

    function _fund(uint256 amount) internal {
        musd.mint(address(router), amount);
    }

    function _epochBribe(MockBribe b) internal view returns (uint256) {
        return b.tokenRewardsPerEpoch(address(musd), EPOCH_START);
    }

    // ---------------------------------------------------------------- deployment

    function test_constructor_wiring() public view {
        assertEq(router.MUSD(), address(musd));
        assertEq(router.SMUSD(), address(smusd));
        assertEq(router.VOTER(), address(voter));
        assertEq(router.TREASURY(), treasury);
        assertEq(router.GAUGE_COUNT(), 2);
        assertEq(router.SMUSD_BPS() + router.BRIBES_BPS() + router.TREASURY_BPS(), router.BPS(), "splits sum");
        IFeeRouter.BribeTarget[] memory t = router.targets();
        assertEq(t.length, 2);
        assertEq(t[0].gauge, gaugeA);
        assertEq(t[0].bribe, address(bribeA));
        assertEq(t[1].gauge, gaugeB);
        assertEq(t[1].bribe, address(bribeB));
    }

    function test_constructor_singleTarget() public {
        FeeRouter one = _deploy(_pairs(1));
        assertEq(one.GAUGE_COUNT(), 1);
        assertEq(one.targets().length, 1);
    }

    function test_constructor_rejectsZeroAddresses() public {
        IFeeRouter.BribeTarget[] memory t = _pairs(2);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0), address(smusd), address(voter), treasury, t);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(musd), address(0), address(voter), treasury, t);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(musd), address(smusd), address(0), treasury, t);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(musd), address(smusd), address(voter), address(0), t);
        t[1].bribe = address(0);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        _deploy(t);
    }

    function test_constructor_rejectsTargetCount() public {
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.InvalidTargetCount.selector, 0));
        _deploy(_pairs(0));
        IFeeRouter.BribeTarget[] memory three = new IFeeRouter.BribeTarget[](3);
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.InvalidTargetCount.selector, 3));
        _deploy(three);
    }

    function test_constructor_rejectsMiswiring() public {
        IFeeRouter.BribeTarget[] memory t = _pairs(2);
        t[1].bribe = address(bribeA); // gaugeB's real bribe is bribeB
        vm.expectRevert(
            abi.encodeWithSelector(IFeeRouter.BribeMismatch.selector, gaugeB, address(bribeA), address(bribeB))
        );
        _deploy(t);

        t = _pairs(2);
        t[0].gauge = makeAddr("notAGauge");
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.NotAGauge.selector, t[0].gauge));
        _deploy(t);

        t = _pairs(2);
        t[1] = t[0];
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.DuplicateGauge.selector, gaugeA));
        _deploy(t);
    }

    function test_constructor_rejectsUnbribeableMusd() public {
        MockBribe fresh = new MockBribe(address(voter), new address[](0));
        address gaugeC = makeAddr("gaugeC");
        voter.addGauge(gaugeC, address(fresh));
        voter.setWhitelisted(address(musd), false);
        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](1);
        t[0] = IFeeRouter.BribeTarget({gauge: gaugeC, bribe: address(fresh)});
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.MusdNotBribeable.selector, address(fresh)));
        _deploy(t);

        // Whitelisted on the voter is enough even when the bribe has not seen MUSD yet.
        voter.setWhitelisted(address(musd), true);
        _deploy(t);
    }

    function test_constructor_rejectsForeignSmusd() public {
        SMUSDMock other = new SMUSDMock(address(new MockMUSD()));
        vm.expectRevert(
            abi.encodeWithSelector(IFeeRouter.SmusdAssetMismatch.selector, address(musd), address(other.musdToken()))
        );
        new FeeRouter(address(musd), address(other), address(voter), treasury, _pairs(2));
    }

    // ---------------------------------------------------------------- distribution

    function test_distribute_splits40_40_20() public {
        _fund(1000e18);
        uint256 indexBefore = smusd.yieldIndex();

        vm.expectEmit(true, true, true, true, address(router));
        emit IFeeRouter.BribePosted(gaugeA, address(bribeA), EPOCH_START, 200e18);
        vm.expectEmit(true, true, true, true, address(router));
        emit IFeeRouter.BribePosted(gaugeB, address(bribeB), EPOCH_START, 200e18);
        vm.expectEmit(true, false, false, true, address(router));
        emit IFeeRouter.TreasuryPaid(treasury, 200e18);
        vm.expectEmit(false, false, false, true, address(router));
        emit IFeeRouter.SmusdYieldPosted(400e18);
        vm.expectEmit(true, true, false, true, address(router));
        emit IFeeRouter.Distributed(keeper, EPOCH_START, 1000e18, 400e18, 400e18, 200e18, 0);
        vm.prank(keeper);
        IFeeRouter.Plan memory plan = router.distribute();

        assertEq(plan.total, 1000e18);
        assertEq(plan.toSmusd, 400e18);
        assertTrue(plan.smusdAccepts);
        assertEq(plan.toTreasury, 200e18);
        assertEq(plan.bribeAmounts[0], 200e18);
        assertEq(plan.bribeAmounts[1], 200e18);
        assertTrue(plan.gaugeAlive[0] && plan.gaugeAlive[1]);
        assertEq(plan.epochStart, EPOCH_START);

        assertEq(musd.balanceOf(address(router)), 0, "router drained");
        assertEq(musd.balanceOf(treasury), 200e18, "treasury 20%");
        assertEq(_epochBribe(bribeA), 200e18, "bribe A credited to this epoch");
        assertEq(_epochBribe(bribeB), 200e18, "bribe B credited to this epoch");
        assertEq(musd.balanceOf(address(smusd)), SMUSD_SUPPLY + 400e18, "sMUSD holds the yield");
        assertEq(smusd.yieldIndex() - indexBefore, 400e18 * 1e18 / SMUSD_SUPPLY, "yield index rises");
        assertEq(smusd.claimableYield(saver) + 400e18 * smusd.balanceOf(saver) / SMUSD_SUPPLY, 400e18);
        assertEq(musd.allowance(address(router), address(bribeA)), 0, "approval consumed");
        assertEq(musd.allowance(address(router), address(smusd)), 0, "approval consumed");
    }

    function test_distribute_roundingRemainderGoesToSmusd() public {
        uint256 total = 1e18 + 7;
        _fund(total);
        IFeeRouter.Plan memory plan = router.distribute();
        uint256 treasuryShare = total * 2000 / 10_000;
        uint256 bribes = total * 4000 / 10_000;
        assertEq(plan.toTreasury, treasuryShare);
        assertEq(plan.bribeAmounts[0], bribes / 2);
        assertEq(plan.bribeAmounts[1], bribes - bribes / 2, "last gauge takes the remainder");
        assertEq(plan.toSmusd, total - treasuryShare - bribes);
        assertEq(plan.toSmusd + plan.bribeAmounts[0] + plan.bribeAmounts[1] + plan.toTreasury, total, "conserved");
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_distribute_singleTargetGetsAllBribes() public {
        router = _deploy(_pairs(1));
        _fund(100e18);
        router.distribute();
        assertEq(_epochBribe(bribeA), 40e18);
        assertEq(musd.balanceOf(treasury), 20e18);
    }

    function test_distribute_deadGaugeShareGoesToSmusd() public {
        voter.killGauge(gaugeB);
        _fund(1000e18);
        uint256 indexBefore = smusd.yieldIndex();

        vm.expectEmit(true, false, false, true, address(router));
        emit IFeeRouter.BribeRedirected(gaugeB, 200e18, IFeeRouter.RedirectReason.GaugeDead);
        IFeeRouter.Plan memory plan = router.distribute();

        assertFalse(plan.gaugeAlive[1]);
        assertEq(plan.bribeAmounts[1], 0);
        assertEq(plan.toSmusd, 600e18);
        assertEq(_epochBribe(bribeA), 200e18);
        assertEq(_epochBribe(bribeB), 0, "killed gauge never bribed");
        assertEq(smusd.yieldIndex() - indexBefore, 600e18 * 1e18 / SMUSD_SUPPLY);
        assertEq(musd.balanceOf(treasury), 200e18);
    }

    function test_distribute_allGaugesDead() public {
        voter.killGauge(gaugeA);
        voter.killGauge(gaugeB);
        _fund(100e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.toSmusd, 80e18);
        assertEq(musd.balanceOf(address(bribeA)) + musd.balanceOf(address(bribeB)), 0);
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_distribute_unreadableVoterTreatsGaugeAsDead() public {
        vm.mockCallRevert(address(voter), abi.encodeCall(IPoolsVoter.isAlive, (gaugeA)), bytes("upgraded"));
        _fund(100e18);
        vm.expectEmit(true, false, false, true, address(router));
        emit IFeeRouter.BribeRedirected(gaugeA, 20e18, IFeeRouter.RedirectReason.VoterUnreadable);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.toSmusd, 60e18);
        assertEq(_epochBribe(bribeB), 20e18);
    }

    function test_distribute_rejectedNotifyRedirectsAndClearsApproval() public {
        bribeA.setMode(MockBribe.Mode.REVERT);
        _fund(100e18);
        vm.expectEmit(true, false, false, true, address(router));
        emit IFeeRouter.BribeRedirected(gaugeA, 20e18, IFeeRouter.RedirectReason.NotifyFailed);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.bribeAmounts[0], 0);
        assertEq(plan.toSmusd, 60e18);
        assertEq(musd.allowance(address(router), address(bribeA)), 0, "approval cleared");
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_distribute_unwhitelistedNewTokenIsRedirected() public {
        // A bribe that has never seen MUSD and a voter that has de-listed it: notify reverts NotWhitelisted.
        voter.setWhitelisted(address(musd), true);
        MockBribe fresh = new MockBribe(address(voter), new address[](0));
        address gaugeC = makeAddr("gaugeC");
        voter.addGauge(gaugeC, address(fresh));
        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](1);
        t[0] = IFeeRouter.BribeTarget({gauge: gaugeC, bribe: address(fresh)});
        router = _deploy(t);
        voter.setWhitelisted(address(musd), false);

        _fund(10e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.toSmusd, 8e18);
        assertEq(musd.balanceOf(address(fresh)), 0);
    }

    function test_distribute_reentrantBribeIsRedirected() public {
        bribeA.setMode(MockBribe.Mode.REENTER);
        bribeA.setReenterTarget(address(router));
        _fund(100e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.bribeAmounts[0], 0, "re-entry rejected by the guard");
        assertEq(plan.toSmusd, 60e18);
    }

    function test_distribute_gasBurningBribeIsRedirectedWithFullStipend() public {
        bribeA.setMode(MockBribe.Mode.BURN_GAS);
        _fund(100e18);
        IFeeRouter.Plan memory plan = router.distribute{gas: 3_000_000}();
        assertEq(plan.bribeAmounts[0], 0);
        assertEq(plan.bribeAmounts[1], 20e18);
        assertEq(plan.toSmusd, 60e18);
    }

    function test_distribute_starvedCallRevertsInsteadOfRedirecting() public {
        _fund(100e18);
        // Enough for the voter read, not for a full notify stipend: the split must not change silently.
        vm.expectRevert(IFeeRouter.InsufficientGas.selector);
        router.distribute{gas: 400_000}();
        assertEq(musd.balanceOf(address(router)), 100e18);
    }

    function test_distribute_smusdDustIsDeferred() public {
        // sMUSD's floor is supply / 1e18 + 1 wei = 1_000_001 wei here.
        _fund(2_000_000); // 40% = 800_000 < floor
        vm.expectEmit(false, false, false, true, address(router));
        emit IFeeRouter.SmusdYieldDeferred(800_000);
        vm.expectEmit(true, true, false, true, address(router));
        emit IFeeRouter.Distributed(address(this), EPOCH_START, 2_000_000, 0, 800_000, 400_000, 800_000);
        IFeeRouter.Plan memory plan = router.distribute();
        assertFalse(plan.smusdAccepts);
        assertEq(musd.balanceOf(address(router)), 800_000, "dust retained");
        assertEq(_epochBribe(bribeA), 400_000, "bribes still posted");
        assertEq(musd.balanceOf(treasury), 400_000);

        // The retained dust rides along with the next fees.
        _fund(10e18);
        plan = router.distribute();
        assertTrue(plan.smusdAccepts);
        assertEq(plan.total, 10e18 + 800_000);
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_distribute_tinyBalanceSkipsZeroBribes() public {
        _fund(2); // treasury 0, bribes 0 + 0, sMUSD 2 wei: 2 * 1e18 / 1e24 == 0, deferred
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.toTreasury, 0);
        assertEq(plan.bribeAmounts[0] + plan.bribeAmounts[1], 0);
        assertFalse(plan.smusdAccepts);
        assertEq(musd.balanceOf(address(router)), 2);
    }

    function test_distribute_zeroSupplySmusdBuffers() public {
        SMUSDMock empty = new SMUSDMock(address(musd));
        router = new FeeRouter(address(musd), address(empty), address(voter), treasury, _pairs(2));
        _fund(10);
        IFeeRouter.Plan memory plan = router.distribute();
        assertTrue(plan.smusdAccepts, "zero supply buffers into pendingYield");
        assertEq(empty.pendingYield(), plan.toSmusd);
    }

    function test_distribute_revertsWhenEmpty() public {
        vm.expectRevert(IFeeRouter.NothingToDistribute.selector);
        router.distribute();
    }

    function test_distribute_smusdFailureRevertsWholeSplit() public {
        vm.mockCallRevert(
            address(smusd), abi.encodeWithSelector(SMUSDMock.receiveProtocolYield.selector), bytes("down")
        );
        _fund(100e18);
        vm.expectRevert(bytes("down"));
        router.distribute();
        assertEq(musd.balanceOf(address(router)), 100e18, "nothing moved");
    }

    function test_previewMatchesDistribute() public {
        voter.killGauge(gaugeA);
        _fund(123_456e18 + 3);
        IFeeRouter.Plan memory preview = router.previewDistribute();
        IFeeRouter.Plan memory done = router.distribute();
        assertEq(abi.encode(preview), abi.encode(done));
    }

    function test_epochStartOf_isThursdayMidnightUtc() public view {
        assertEq(router.epochStartOf(NOW), EPOCH_START);
        assertEq(router.epochStartOf(EPOCH_START), EPOCH_START);
        assertEq(router.epochStartOf(EPOCH_START - 1), EPOCH_START - 7 days);
        assertEq(voter.epochStart(NOW), EPOCH_START, "same rule as the voter");
        // 1970-01-01 was a Thursday, so epochs flip every Thursday 00:00 UTC.
        assertEq(((EPOCH_START / 1 days) + 4) % 7, 4, "Thursday");
    }

    function test_bribeLandsInNextEpochAfterFlip() public {
        _fund(100e18);
        router.distribute();
        skip(7 days);
        _fund(100e18);
        router.distribute();
        assertEq(_epochBribe(bribeA), 20e18);
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), EPOCH_START + 7 days), 20e18);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_distribute_conservesAndSplits(uint256 total, bool aliveA, bool aliveB) public {
        total = bound(total, 1, 1e30);
        if (!aliveA) voter.killGauge(gaugeA);
        if (!aliveB) voter.killGauge(gaugeB);
        _fund(total);
        uint256 smusdBefore = musd.balanceOf(address(smusd));
        IFeeRouter.Plan memory plan = router.distribute();

        uint256 bribed = musd.balanceOf(address(bribeA)) + musd.balanceOf(address(bribeB));
        uint256 toSmusd = musd.balanceOf(address(smusd)) - smusdBefore;
        uint256 left = musd.balanceOf(address(router));
        assertEq(bribed + toSmusd + musd.balanceOf(treasury) + left, total, "conservation");
        assertEq(musd.balanceOf(treasury), total * 2000 / 10_000, "treasury exactly 20%");
        if (!aliveA) assertEq(musd.balanceOf(address(bribeA)), 0);
        if (!aliveB) assertEq(musd.balanceOf(address(bribeB)), 0);
        assertEq(bribed, plan.bribeAmounts[0] + plan.bribeAmounts[1]);
        if (plan.smusdAccepts) assertEq(left, 0);
        else assertEq(left, plan.toSmusd);
        assertGe(plan.toSmusd, total - total * 2000 / 10_000 - total * 4000 / 10_000, "at least 40%");
    }
}
