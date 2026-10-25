// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";
import {IBribeVotingReward} from "../../src/interfaces/external/IBribeVotingReward.sol";
import {IMUSDSavingsRate} from "../../src/interfaces/external/IMUSDSavingsRate.sol";
import {IPoolsVoter} from "../../src/interfaces/external/IPoolsVoter.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice FeeRouter against Mezo's live PoolsVoter, BribeVotingReward contracts, MUSD and sMUSD at the pinned blocks.
/// @dev Mainnet routes to the CL200 and vAMM BTC/MUSD gauges; testnet to the MUSD/BTC vAMM gauge. No precompiles are
/// touched (the voter's MEZO reward token is only moved by `killGauge` when `claimable > 0`, which is 0 at both
/// pinned blocks). `voterTokenId` is a veNFT with a large vote in `bribe0` at the pinned block (mainnet #6033 holds
/// 99.85% of the CL200 bribe's votes; testnet #299 about 30%).
abstract contract FeeRouterForkBase is MezoFork {
    FeeRouter internal router;
    IERC20 internal musd;
    IMUSDSavingsRate internal smusd;
    IPoolsVoter internal voter;
    IFeeRouter.BribeTarget[] internal pairs;
    uint256 internal voterTokenId;

    address internal treasury = makeAddr("treasury");
    address internal keeper = makeAddr("keeper");

    function _setUpNetwork(Net which) internal {
        _fork(which);
        musd = IERC20(net.musd);
        smusd = IMUSDSavingsRate(net.smusd);
        voter = IPoolsVoter(net.poolsVoter);
        pairs.push(IFeeRouter.BribeTarget({gauge: net.gauge0, bribe: net.bribe0}));
        if (net.gauge1 != address(0)) pairs.push(IFeeRouter.BribeTarget({gauge: net.gauge1, bribe: net.bribe1}));
        voterTokenId = which == Net.MAINNET ? 6033 : 299;
        router = new FeeRouter(net.musd, net.smusd, net.poolsVoter, treasury, pairs);
        vm.label(address(router), "FeeRouter");
        vm.label(net.poolsVoter, "PoolsVoter");
        vm.label(net.bribe0, "bribe0");
        if (net.bribe1 != address(0)) vm.label(net.bribe1, "bribe1");
    }

    function _fund(uint256 amount) internal {
        deal(address(musd), address(router), musd.balanceOf(address(router)) + amount);
    }

    function _epoch() internal view returns (uint256) {
        return block.timestamp - (block.timestamp % 7 days);
    }

    function _epochBribe(address bribe) internal view returns (uint256) {
        return IBribeVotingReward(bribe).tokenRewardsPerEpoch(address(musd), _epoch());
    }

    /// @dev sMUSD's `AmountTooSmall` floor for a donation right now.
    function _smusdFloor() internal view returns (uint256) {
        return smusd.totalSupply() / 1e18 + 1;
    }

    // ---------------------------------------------------------------- tests

    function test_fork_liveWiring() public view {
        assertEq(router.GAUGE_COUNT(), pairs.length);
        assertTrue(voter.isWhitelistedToken(address(musd)), "MUSD whitelisted on the voter");
        for (uint256 i; i < pairs.length; ++i) {
            assertTrue(voter.isGauge(pairs[i].gauge), "gauge");
            assertTrue(voter.isAlive(pairs[i].gauge), "alive");
            assertEq(voter.gaugeToBribe(pairs[i].gauge), pairs[i].bribe, "voter maps gauge to bribe");
            assertEq(IBribeVotingReward(pairs[i].bribe).voter(), address(voter), "bribe's voter");
            assertTrue(IBribeVotingReward(pairs[i].bribe).isReward(address(musd)), "MUSD already a reward token");
        }
        assertEq(voter.epochStart(block.timestamp), _epoch(), "voter epoch rule");
        assertEq(router.epochStartOf(block.timestamp), _epoch());
    }

    function test_fork_distributeSplitsAndBribesLand() public {
        uint256 total = 1000e18;
        _fund(total);
        uint256 supply = smusd.totalSupply();
        uint256 indexBefore = smusd.yieldIndex();
        uint256 pending = smusd.pendingYield();
        uint256[] memory bribeBefore = new uint256[](pairs.length);
        uint256[] memory epochBefore = new uint256[](pairs.length);
        for (uint256 i; i < pairs.length; ++i) {
            bribeBefore[i] = musd.balanceOf(pairs[i].bribe);
            epochBefore[i] = _epochBribe(pairs[i].bribe);
        }

        vm.prank(keeper);
        IFeeRouter.Plan memory plan = router.distribute();

        assertEq(musd.balanceOf(address(router)), 0, "drained");
        assertEq(musd.balanceOf(treasury), 200e18, "treasury 20%");
        assertEq(plan.toSmusd, 400e18);
        assertTrue(plan.smusdAccepts);
        assertEq(smusd.yieldIndex() - indexBefore, (400e18 + pending) * 1e18 / supply, "sMUSD yield index rises");

        uint256 bribed;
        for (uint256 i; i < pairs.length; ++i) {
            uint256 share = plan.bribeAmounts[i];
            assertGt(share, 0);
            assertEq(musd.balanceOf(pairs[i].bribe) - bribeBefore[i], share, "MUSD landed in the bribe");
            assertEq(_epochBribe(pairs[i].bribe) - epochBefore[i], share, "credited to the current epoch");
            bribed += share;
        }
        assertEq(bribed, 400e18, "bribes 40%");
    }

    function test_fork_bribePaysEpochVotersAfterThursdayFlip() public {
        IBribeVotingReward bribe = IBribeVotingReward(pairs[0].bribe);
        uint256 votes = bribe.balanceOf(voterTokenId);
        uint256 supply = bribe.totalSupply();
        assertGt(votes, 0, "test veNFT votes in bribe0");
        uint256 flip = _epoch() + 7 days;

        // Baseline: what the veNFT would earn after the flip without our bribe.
        uint256 snap = vm.snapshotState();
        vm.warp(flip + 1);
        uint256 baseline = bribe.earned(address(musd), voterTokenId);
        vm.revertToState(snap);

        uint256 earnedNow = bribe.earned(address(musd), voterTokenId);
        _fund(1000e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(bribe.earned(address(musd), voterTokenId), earnedNow, "nothing claimable before the flip");

        vm.warp(flip - 1);
        assertEq(bribe.earned(address(musd), voterTokenId), earnedNow, "still nothing one second before");
        vm.warp(flip + 1);
        uint256 gained = bribe.earned(address(musd), voterTokenId) - baseline;
        assertApproxEqAbs(gained, plan.bribeAmounts[0] * votes / supply, 2, "pro-rata share after the flip");
    }

    function test_fork_deadGaugeShareGoesToSmusd() public {
        address dead = pairs[pairs.length - 1].gauge;
        address deadBribe = pairs[pairs.length - 1].bribe;
        vm.prank(voter.emergencyCouncil());
        voter.killGauge(dead);
        assertFalse(voter.isAlive(dead));

        _fund(1000e18);
        uint256 supply = smusd.totalSupply();
        uint256 indexBefore = smusd.yieldIndex();
        uint256 pending = smusd.pendingYield();
        uint256 deadBefore = musd.balanceOf(deadBribe);
        IFeeRouter.Plan memory plan = router.distribute();

        uint256 deadShare = 400e18 / pairs.length;
        assertFalse(plan.gaugeAlive[pairs.length - 1]);
        assertEq(plan.bribeAmounts[pairs.length - 1], 0);
        assertEq(musd.balanceOf(deadBribe), deadBefore, "killed gauge's bribe untouched");
        assertEq(plan.toSmusd, 400e18 + deadShare);
        assertEq(smusd.yieldIndex() - indexBefore, (plan.toSmusd + pending) * 1e18 / supply);
        assertEq(musd.balanceOf(treasury), 200e18);
    }

    function test_fork_smusdDustIsDeferred() public {
        uint256 floor = _smusdFloor();
        // 40% of 2 * floor = 0.8 * floor: below sMUSD's AmountTooSmall threshold.
        uint256 total = 2 * floor;
        _fund(total);
        uint256 indexBefore = smusd.yieldIndex();
        IFeeRouter.Plan memory plan = router.distribute();
        assertFalse(plan.smusdAccepts);
        assertEq(smusd.yieldIndex(), indexBefore, "no donation");
        assertEq(musd.balanceOf(address(router)), plan.toSmusd, "dust retained");
        assertEq(musd.balanceOf(treasury), total * 2000 / 10_000);
        for (uint256 i; i < pairs.length; ++i) {
            assertGt(plan.bribeAmounts[i], 0, "bribes still posted");
        }

        // Proof that the floor is real: sMUSD itself rejects the retained amount.
        address donor = makeAddr("donor");
        deal(address(musd), donor, plan.toSmusd);
        vm.startPrank(donor);
        musd.approve(address(smusd), plan.toSmusd);
        vm.expectRevert(IMUSDSavingsRate.AmountTooSmall.selector);
        smusd.receiveProtocolYield(plan.toSmusd);
        vm.stopPrank();
    }

    function test_fork_previewMatchesDistribute() public {
        _fund(777e18 + 3);
        IFeeRouter.Plan memory preview = router.previewDistribute();
        IFeeRouter.Plan memory done = router.distribute();
        assertEq(abi.encode(preview), abi.encode(done));
    }

    /// @dev The real donation (through sMUSD's proxy) uses a small fraction of the router's fixed stipend.
    function test_fork_smusdDonationFitsStipend() public {
        address donor = makeAddr("donor");
        deal(address(musd), donor, 1000e18);
        vm.startPrank(donor);
        musd.approve(address(smusd), 1000e18);
        uint256 before = gasleft();
        smusd.receiveProtocolYield(1000e18);
        uint256 used = before - gasleft();
        vm.stopPrank();
        assertLt(used, router.SMUSD_GAS() / 4, "stipend margin");
    }

    /// @dev Audit D-2 on the live contracts: an sMUSD upgrade that restricts `receiveProtocolYield` no longer freezes
    /// the treasury and bribe legs; the sMUSD leg is carried and approval is revoked.
    function test_fork_smusdRestrictionDoesNotFreezeFees() public {
        vm.mockCallRevert(
            address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.receiveProtocolYield.selector), bytes("only PCV")
        );
        _fund(1000e18);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(musd.balanceOf(treasury), 200e18, "treasury paid");
        uint256 bribed;
        for (uint256 i; i < pairs.length; ++i) {
            bribed += plan.bribeAmounts[i];
        }
        assertEq(bribed, 400e18, "bribes posted");
        assertEq(plan.smusdCarried, 400e18);
        assertEq(musd.balanceOf(address(router)), 400e18);
        assertEq(musd.allowance(address(router), address(smusd)), 0);
    }

    /// @dev Audit D-3 on the live contracts: in the last hour of the epoch nothing is credited to the closing epoch;
    /// the carry lands in the next one.
    function test_fork_lastHourBribesAreCarried() public {
        uint256 epochEnd = _epoch() + 7 days;
        vm.warp(epochEnd - 1);
        _fund(1000e18);
        uint256 before0 = _epochBribe(pairs[0].bribe);
        IFeeRouter.Plan memory plan = router.distribute();
        assertEq(plan.bribesCarried, 400e18);
        assertEq(_epochBribe(pairs[0].bribe), before0, "closing epoch untouched");
        assertEq(musd.balanceOf(treasury), 200e18);

        vm.warp(epochEnd + 2 hours);
        plan = router.distribute();
        assertEq(plan.bribeAmounts[0], 400e18 / pairs.length, "carry posted next epoch");
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_fork_constructorRejectsWrongBribe() public {
        IFeeRouter.BribeTarget[] memory bad = new IFeeRouter.BribeTarget[](1);
        bad[0] = IFeeRouter.BribeTarget({gauge: net.gauge0, bribe: makeAddr("fakeBribe")});
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.BribeMismatch.selector, net.gauge0, bad[0].bribe, net.bribe0));
        new FeeRouter(net.musd, net.smusd, net.poolsVoter, treasury, bad);
    }
}

contract FeeRouterForkTestnetTest is FeeRouterForkBase {
    function setUp() public {
        _setUpNetwork(Net.TESTNET);
    }
}

contract FeeRouterForkMainnetTest is FeeRouterForkBase {
    function setUp() public {
        _setUpNetwork(Net.MAINNET);
    }
}
