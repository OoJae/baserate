// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho} from "morpho-blue/interfaces/IMorpho.sol";

import {Deploy} from "../../script/Deploy.s.sol";
import {MezoAddresses, MezoNetwork} from "../../script/config/MezoAddresses.sol";
import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {BackstopBase} from "../unit/BackstopBase.t.sol";
import {VaultBase} from "../unit/VaultBase.t.sol";
import {WsMUSDBase} from "../unit/WsMUSDBase.t.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {MockBribe, MockPoolsVoter} from "../utils/VoterMocks.sol";
import {CoreAuditBase} from "./CoreAudit.t.sol";
import {DeployLiquidationHarness} from "./LiquidationAuditHelpers.sol";
import {CheckpointPoisoner} from "./Round2VerifyHelpers.sol";

// =====================================================================================================================
// Round 2: verification of the round-1 fixes (af6eace) and the new findings R2V-*.
// Run: FOUNDRY_OUT=out/r2-verify FOUNDRY_CACHE_PATH=cache/r2-verify forge test --match-path test/audit/Round2Verify.t.sol
// =====================================================================================================================

/// @notice Backstop: R2V-1 (deposits are closed between a purchase and its sale), R2V-2 (the dead-share seed is
/// mandatory in DeployLiquidation), R2V-7 (exits are paid in kind when sMUSD's withdraw reverts) and a partial-claim
/// fuzz. Each R2V test replays the PoC of the report and asserts the fixed behaviour.
contract R2VBackstopTest is BackstopBase {
    /// @notice R2V-1 (fixed). Between `buyCollateral` (mark-down recognised at once) and the sale (mark-up vests) the
    /// held BTC sits at 0.95 x oracle; deposits and mints are now closed while at least `DUST_INVENTORY` is held, so
    /// nobody can buy into the mark-up. Once the sale clears the inventory, deposits reopen at gross and pay for the
    /// mark-up still vesting (C-1): the incumbent keeps all of it.
    function test_fix_R2V1_depositBetweenPurchaseAndSale_isRefused() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);

        // Counterfactual: nobody joins.
        uint256 snap = vm.snapshotState();
        _buy(0.05e18);
        _take(0.05e18);
        skip(7 days);
        uint256 aliceAlone = backstop.convertToAssets(aliceShares);
        vm.revertToState(snap);

        // A liquidation sells 0.05 BTC to the backstop at 0.978 x oracle; it is marked at 0.95.
        _buy(0.05e18);
        uint256 inv = backstop.inventory();
        assertEq(backstop.maxDeposit(attacker), 0, "deposits closed while holding");
        assertEq(backstop.maxMint(attacker), 0, "mints closed while holding");
        assertGt(backstop.previewDeposit(1e18), 0, "previews ignore the limit (ERC-4626)");

        // The PoC's deposit (same block as the liquidation) is refused, and so is a mint.
        uint256 stake = 1_000_000e18;
        musd.mint(attacker, stake);
        vm.startPrank(attacker);
        musd.approve(address(backstop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.HoldingInventory.selector, inv));
        backstop.deposit(stake, attacker);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.HoldingInventory.selector, inv));
        backstop.mint(1e18, attacker);
        vm.stopPrank();

        // The sale reopens deposits; the 200 MUSD mark-up is vesting and a deposit now pays for its part in full.
        _take(0.05e18);
        assertApproxEqAbs(_unvested(), 200e18, 1e15, "mark-up vesting");
        assertEq(backstop.maxDeposit(attacker), type(uint256).max, "open again");
        vm.prank(attacker);
        uint256 attackerShares = backstop.deposit(stake, attacker);
        skip(7 days);
        uint256 id = _request(attacker, attackerShares);
        skip(7 days);
        uint256 out = backstop.claimRedeem(id);
        uint256 aliceWith = backstop.convertToAssets(aliceShares);

        emit log_named_decimal_uint("late depositor out - in (rounding)", stake - out, 18);
        emit log_named_decimal_uint("alice value, no late depositor", aliceAlone, 18);
        emit log_named_decimal_uint("alice value, late depositor", aliceWith, 18);
        assertLe(out, stake, "no profit for the late depositor");
        assertGt(aliceAlone, 10_080e18, "the incumbent nets ~+88 MUSD");
        assertApproxEqAbs(aliceWith, aliceAlone, 1e6, "and keeps it with a late depositor around");
    }

    /// @notice R2V-2 (fixed). Deposits are priced at gross, which a direct MUSD transfer raises at once, so the
    /// dead-share seed is what defeats the donation attack. DeployLiquidation now requires the 1 MUSD seed (it reverts
    /// before deploying anything without it) and always deposits it for 0xdEaD; against such a backstop the PoC's
    /// 1-wei deposit plus 10,000 MUSD donation is harmless.
    function test_fix_R2V2_deployScriptSeedIsMandatory_donationHarmless() public {
        DeployLiquidationHarness script = new DeployLiquidationHarness();
        address deployer = makeAddr("deployer");
        musd.mint(deployer, 1e18 - 1);
        vm.expectRevert(bytes("DeployLiquidation: deployer must hold 1 MUSD to seed the backstop"));
        script.requireSeedFunds(address(musd), deployer);
        musd.mint(deployer, 1);
        script.requireSeedFunds(address(musd), deployer);

        // The script's seed on a fresh backstop: 1e18 dead shares.
        Backstop fresh = new Backstop(_params(LLTV));
        musd.mint(address(script), 1e18);
        script.seed(fresh, address(musd));
        assertEq(fresh.balanceOf(DEAD), 1e18, "dead shares");
        assertEq(fresh.totalSupply(), 1e18);

        // The PoC: 1 wei deposit, then a 10,000 MUSD donation.
        musd.mint(attacker, 10_000e18 + 1);
        vm.startPrank(attacker);
        musd.approve(address(fresh), 1);
        assertEq(fresh.deposit(1, attacker), 1, "1 wei buys 1 share-wei");
        musd.transfer(address(fresh), 10_000e18);
        vm.stopPrank();

        // Small and large deposits still mint, and lose nothing beyond rounding once the donation has vested.
        musd.mint(bob, 13_000e18);
        vm.startPrank(bob);
        musd.approve(address(fresh), type(uint256).max);
        uint256 small = fresh.deposit(4000e18, bob);
        uint256 large = fresh.deposit(9000e18, bob);
        vm.stopPrank();
        assertGt(small, 0, "no DoS of small depositors");
        assertGt(large, 1, "no single-share mint");
        skip(7 days);
        fresh.sync();
        uint256 bobValue = fresh.convertToAssets(small + large);
        emit log_named_decimal_uint("victim value after vesting (paid 13,000)", bobValue, 18);
        assertGe(bobValue + 1e9, 13_000e18, "no loss beyond rounding");
    }

    /// @notice R2V-7 (fixed). With sMUSD's withdraw reverting, matured exits no longer freeze: both claim paths pay in
    /// kind (idle MUSD plus wsMUSD shares worth the rest, rounded down), which wsMUSD's `redeemInKind` turns into sMUSD.
    /// A purchase reverts `CashUnavailable` (the liquidator falls back to a DEX venue); the failed withdraw pauses
    /// parking, so new MUSD stays idle, `quoteBuy` counts only that idle MUSD and purchases it covers still clear.
    function test_fix_R2V7_brokenSmusdWithdraw_exitsPaidInKind() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        uint256 bobShares = _deposit(bob, 10_000e18); // free cash for purchases
        uint256 idA = _request(alice, aliceShares);
        uint256 idB = _request(bob, bobShares / 2);
        skip(7 days);
        uint256 idle = musd.balanceOf(address(backstop));
        assertLt(idle, 1e15, "all cash parked in wsMUSD");
        assertGt(backstop.availableCash(), 5000e18, "free cash beyond the 15,000 MUSD reserved for the two exits");

        smusd.setDisabled(false, true, false);

        // The purchase cannot raise MUSD: a clean revert the liquidator can route around.
        uint256 quote = backstop.quoteBuy(0.01e18);
        vm.deal(liquidator, 0.01e18);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.CashUnavailable.selector, quote, idle));
        backstop.buyCollateral{value: 0.01e18}(0);

        // claimRedeem pays in kind, at the same request NAV.
        uint256 owed = backstop.redeemRequest(idA).assets;
        uint256 rest = owed - idle;
        uint256 wsShares = ws.convertToShares(rest);
        vm.expectEmit(address(backstop));
        emit IBackstop.PaidInKind(alice, owed, idle, wsShares);
        assertEq(backstop.claimRedeem(idA), owed, "settled at the request NAV");
        assertEq(ws.balanceOf(alice), wsShares, "wsMUSD shares to the receiver");
        uint256 value = musd.balanceOf(alice) + ws.convertToAssets(wsShares);
        assertLe(value, owed, "rounded in the backstop's favour");
        assertApproxEqAbs(value, owed, 2, "worth the claim");
        assertEq(backstop.reservedAssets(), backstop.redeemRequest(idB).assets, "reservation exact");
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        // The receiver leaves wsMUSD in kind, with no sMUSD withdraw.
        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(wsShares, alice, alice);
        assertApproxEqAbs(smusdOut + musdOut, owed - idle, 2, "sMUSD out");

        // The owner-only oracle-free claim pays in kind too.
        vm.prank(bob);
        uint256 paidB = backstop.claimRedeemWithoutOracle(idB);
        assertGt(paidB, 0);
        assertEq(backstop.redeemRequest(idB).shares, 0, "closed");
        assertLe(ws.convertToAssets(ws.balanceOf(bob)) + musd.balanceOf(bob), paidB);
        assertEq(backstop.reservedAssets(), 0);

        // Parking is paused: a deposit stays idle, and quoteBuy counts only idle MUSD.
        _deposit(alice, 1000e18);
        assertEq(musd.balanceOf(address(backstop)), 1000e18, "idle, not re-parked into the broken wsMUSD");
        assertGt(backstop.availableCash(), 1600e18, "free cash on paper");
        assertEq(backstop.quoteBuy(0.02e18), 0, "~1,565 MUSD: above the idle MUSD, so unavailable");
        uint256 q = backstop.quoteBuy(0.01e18);
        assertGt(q, 0, "~782 MUSD: covered by idle MUSD");
        assertEq(_buy(0.01e18), q, "the purchase clears from idle MUSD");
    }

    /// @notice Verification (C-3): repeated partial claims never pay more than the request NAV, the reservation always
    /// equals the outstanding requests' NAV, escrow follows the remainder, and no claim moves the share price.
    function testFuzz_verify_partialClaimsNeverOverpay(uint256 buyBtc, uint256 chunk, uint256 bobPart) public {
        buyBtc = bound(buyBtc, 0.08e18, 0.16e18);
        chunk = bound(chunk, 0.004e18, 0.03e18);
        uint256 aliceShares = _deposit(alice, 10_000e18);
        uint256 bobShares = _deposit(bob, 3000e18);
        bobPart = bound(bobPart, 1, bobShares);
        _buy(buyBtc);
        uint256 idA = _request(alice, aliceShares);
        uint256 idB = _request(bob, bobPart);
        uint256 owedA = backstop.redeemRequest(idA).assets;
        uint256 owedB = backstop.redeemRequest(idB).assets;
        skip(7 days);

        uint256 paidA;
        uint256 paidB;
        for (uint256 round; round < 80; ++round) {
            uint256 pps0 = _pps();
            if (backstop.redeemRequest(idA).shares != 0 && backstop.cash() != 0) paidA += backstop.claimRedeem(idA);
            if (backstop.redeemRequest(idB).shares != 0 && backstop.cash() != 0) paidB += backstop.claimRedeem(idB);
            assertApproxEqRel(_pps(), pps0, 1e9, "a claim does not move the share price");
            assertEq(
                backstop.reservedAssets(),
                uint256(backstop.redeemRequest(idA).assets) + backstop.redeemRequest(idB).assets,
                "reservation = outstanding request NAV"
            );
            assertEq(
                backstop.balanceOf(address(backstop)),
                uint256(backstop.redeemRequest(idA).shares) + backstop.redeemRequest(idB).shares,
                "escrow = outstanding request shares"
            );
            uint256 inv = backstop.inventory();
            if (inv == 0) {
                if (backstop.redeemRequest(idA).shares == 0 && backstop.redeemRequest(idB).shares == 0) break;
                continue;
            }
            uint256 take = chunk;
            if (take >= inv || inv - take < backstop.DUST_INVENTORY()) take = inv;
            _take(take);
        }
        assertLe(paidA, owedA, "A never paid above its request NAV");
        assertLe(paidB, owedB, "B never paid above its request NAV");
        assertEq(backstop.redeemRequest(idA).shares, 0, "A settled");
        assertEq(backstop.redeemRequest(idB).shares, 0, "B settled");
        assertApproxEqAbs(paidA, owedA, 1e9, "A paid in full over the partial claims");
        assertApproxEqAbs(paidB, owedB, 1e9, "B paid in full over the partial claims");
        assertEq(backstop.reservedAssets(), 0);
    }
}

/// @notice Allocator and adapter: R2V-3 (fixed: a transient borrow at a checkpoint is no longer recorded, so it cannot
/// freeze TO_LIQUIDITY for a day), R2V-4 (known: a zero-capital `accrueInterest` front-run vetoes a block's rate-driven
/// move) and gas-starvation checks on the M1-first exit fallback and the rescue probe.
contract R2VAllocatorTest is VaultBase {
    uint256 internal constant YEAR = 365 days;

    function _steadyState() internal {
        _deposit(lender, 20_000e18);
        _wsYield(1e18);
        _borrow(borrower, 2900e18);
        // Two buffer top-ups, one per block on M1 state left by earlier blocks (R2X-3).
        _nextBlock();
        allocator.rebalance();
        _nextBlock();
        allocator.rebalance();
        _advanceWithCheckpoints(1 days);
    }

    function _nextBlock() internal {
        skip(12);
        vm.roll(block.number + 1);
    }

    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = block.timestamp - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (YEAR * 1e18);
        vm.mockCall(address(ws), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }

    /// @notice R2V-3 (fixed). `_checkpoint(touched)` used to keep a same-block external liquidity whenever it was LOWER
    /// than the last checkpoint's, and `TO_LIQUIDITY` is sized on the minimum over the last 24 h. A borrower with
    /// headroom could borrow, call the permissionless `checkpoint()` and repay in one transaction: the transient low was
    /// recorded and blocked every `TO_LIQUIDITY` move for 24 h (indefinitely if repeated daily). A checkpoint taken in a
    /// block where M1 was already touched now carries the previous external liquidity forward unchanged, in either
    /// direction, so the same transaction records nothing new and the move runs in the next block.
    function test_fix_R2V3_transientBorrowAtCheckpoint_isNotRecorded() public {
        _deposit(lender, 20_000e18);
        // vMUSD holds 6k in M1 (set up through the allocator role), outside borrowers 2.9k.
        vm.startPrank(address(allocator));
        vault.deallocate(address(liq), "", 6000e18);
        vault.allocate(address(mm), abi.encode(params), 6000e18);
        vm.stopPrank();
        _borrow(borrower, 2900e18);
        _advanceWithCheckpoints(1 days);
        _mockWsApy(0.5e18); // wsMUSD pays more: the honest move is TO_LIQUIDITY

        (IBaserateAllocator.Action honest, uint256 honestAmount,) = allocator.previewRebalance();
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.TO_LIQUIDITY), "honest: pull from M1");
        assertEq(honestAmount, allocator.MAX_MOVE());

        // One transaction: borrow ~all spot liquidity, checkpoint, repay.
        skip(1 hours);
        vm.roll(block.number + 300);
        CheckpointPoisoner p = new CheckpointPoisoner(morpho, IBaserateAllocator(address(allocator)), params);
        collateral.mint(address(p), 1e18);
        musd.mint(address(p), 10e18);
        p.postCollateral();
        _nextBlock();
        assertTrue(p.poison(6000e18), "a checkpoint is still recorded (share prices, timestamp)");
        uint256 count = allocator.checkpointCount();
        IBaserateAllocator.Checkpoint memory poisoned = allocator.checkpointAt(count - 1);
        IBaserateAllocator.Checkpoint memory previous = allocator.checkpointAt(count - 2);
        assertEq(poisoned.timestamp, block.timestamp, "taken inside the borrow-checkpoint-repay transaction");
        assertEq(poisoned.m1ExternalLiquidity, previous.m1ExternalLiquidity, "the transient borrow is not recorded");
        assertGt(poisoned.m1ExternalLiquidity, 0, "M1's outside liquidity as last seen untouched");

        // The next block: the honest move runs, sized on the real liquidity.
        _nextBlock();
        _mockWsApy(0.5e18);
        (IBaserateAllocator.Action action, uint256 amount, IBaserateAllocator.Snapshot memory s) =
            allocator.previewRebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY), "not blocked");
        assertEq(amount, allocator.MAX_MOVE());
        assertGt(s.m1Liquidity, 6000e18, "M1 really holds 6k of liquidity");
        assertApproxEqAbs(s.conservativeLiquidity, s.m1Liquidity, 1e15, "and the conservative view agrees");
        (action, amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY));
        assertEq(amount, allocator.MAX_MOVE());
    }

    /// @notice R2V-4 (known limitation, kept by design). The same-block guard reads Morpho's `lastUpdate == now`, which
    /// the permissionless `Morpho.accrueInterest` sets. Anyone ordering one `accrueInterest` before the keeper's
    /// `rebalance` (no capital, no M1 position, ~30k gas) cancels that block's rate-driven move; repeated before every
    /// attempt it vetoes them for as long as the front-runner keeps paying, in whichever direction it dislikes. This is
    /// a liveness cost only, and the alternative is worse: sizing moves on totals another transaction may have just
    /// changed would let that transaction steer vMUSD's funds and start cooldowns (B-1). Buffer top-ups in a touched
    /// block are sized on the larger of spot and the last checkpoint (R2X-3), so a front-run delays a top-up only until a
    /// checkpoint taken in a block nobody touched M1 in (hourly, by anyone) has recorded the low; holding top-ups off for
    /// longer means front-running every such checkpoint as well.
    function test_known_R2V4_accrueInterestFrontRun_vetoesRateDrivenMovesForABlock() public {
        _steadyState();
        uint256 m1Before = _vaultM1();
        for (uint256 i; i < 24; ++i) {
            skip(1 hours);
            vm.roll(block.number + 300);
            (IBaserateAllocator.Action honest,,) = allocator.previewRebalance();
            assertEq(uint256(honest), uint256(IBaserateAllocator.Action.TO_MARKET), "honest move this block");

            vm.prank(stranger); // no MUSD, no position
            morpho.accrueInterest(params);
            (IBaserateAllocator.Action action,) = allocator.rebalance();
            assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "vetoed for this block");
        }
        assertApproxEqAbs(_vaultM1(), m1Before, 0.5e18, "a day of vetoed moves (only interest accrued)");
        assertEq(allocator.lastRebalance(), 0);

        _nextBlock();
        (IBaserateAllocator.Action unblocked,) = allocator.rebalance();
        assertEq(uint256(unblocked), uint256(IBaserateAllocator.Action.TO_MARKET), "runs as soon as nobody front-runs");

        // Borrowers really drain the buffer (an earlier block). Until a checkpoint has recorded the low, a front-run
        // makes the top-up wait as well...
        _nextBlock();
        _borrow(makeAddr("big"), _m1Liquidity() - 100e18);
        _nextBlock();
        vm.prank(stranger);
        morpho.accrueInterest(params);
        (IBaserateAllocator.Action topUp,,) = allocator.previewRebalance();
        assertEq(uint256(topUp), uint256(IBaserateAllocator.Action.NONE), "waits for a checkpoint of the low");

        // ...but once the keeper's hourly checkpoint has recorded it, the front-run no longer stops the top-up.
        skip(1 hours);
        vm.roll(block.number + 300);
        assertTrue(allocator.checkpoint());
        _nextBlock();
        vm.prank(stranger);
        morpho.accrueInterest(params);
        uint256 amount;
        (topUp, amount) = allocator.rebalance();
        assertEq(uint256(topUp), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP), "real low topped up");
        assertEq(amount, allocator.MAX_MOVE());
    }

    /// @notice Verification (B-2 fallback / 1/64-gas argument): no gas limit makes `allocator.withdraw` succeed through
    /// the M1-first fallback while the wsMUSD leg works, because the fallback would need more than 1/64 of what made
    /// the first attempt run out of gas.
    function test_verify_exitFallbackCannotBeForcedByGas() public {
        _steadyState();
        vm.prank(lender);
        vault.approve(address(allocator), type(uint256).max);
        uint256 m1Before = _vaultM1();

        uint256 snap = vm.snapshotState();
        vm.prank(lender);
        uint256 g0 = gasleft();
        allocator.withdraw(500e18, lender);
        uint256 normalGas = g0 - gasleft();
        assertApproxEqAbs(_vaultM1(), m1Before, 1, "normal path: wsMUSD pays");
        vm.revertToState(snap);

        // Fallback cost, measured with a reverting sMUSD withdraw.
        smusd.setDisabled(false, true, false);
        vm.prank(lender);
        g0 = gasleft();
        allocator.withdraw(500e18, lender);
        uint256 fallbackGas = g0 - gasleft();
        assertLt(_vaultM1(), m1Before, "fallback path: M1 pays");
        vm.revertToState(snap);
        console2.log("normal exit gas", normalGas);
        console2.log("failed first attempt + M1-first exit gas", fallbackGas);

        uint256 successes;
        for (uint256 g = 100_000; g < normalGas + 200_000; g += 3000) {
            uint256 s = vm.snapshotState();
            vm.prank(lender);
            try allocator.withdraw{gas: g}(500e18, lender) {
                ++successes;
                assertApproxEqAbs(_vaultM1(), m1Before, 1, "a gas-limited call never takes the M1-first path");
            } catch {}
            vm.revertToState(s);
        }
        assertGt(successes, 0);
    }

    /// @notice Verification (B-2 rescue): while wsMUSD pays, no gas limit makes the probe fail, so a curator or sentinel
    /// can never move the shares out in kind.
    function test_verify_rescueProbeCannotBeStarved() public {
        _steadyState();
        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);
        uint256 unwoundRuns;
        for (uint256 g = 3_000_000; g < 3_400_000; g += 4000) {
            uint256 s = vm.snapshotState();
            vm.prank(curator);
            try liq.rescue{gas: g}() returns (uint256, bool unwound) {
                assertTrue(unwound, "never in kind while wsMUSD pays");
                ++unwoundRuns;
            } catch {}
            assertEq(ws.balanceOf(curator), 0);
            assertFalse(liq.rescued());
            vm.revertToState(s);
        }
        assertGt(unwoundRuns, 0);
    }
}

/// @notice wsMUSD: R2V-5 quantifies the documented harvest-timing trade-off (a known limitation).
contract R2VWsMUSDTest is WsMUSDBase {
    /// @notice R2V-5 (known limitation, kept by design). Nothing is credited instantly, so a lump of sMUSD yield
    /// (FeeRouter's 40% leg, a PCV distribution) sits in `_unvested` for 3 days after its harvest, and a depositor who
    /// joins before it has vested, even right after the keeper harvested it in the same block, shares it pro rata by
    /// staying until it has. Frequent keeper syncs do not bound this; only the 3-day vesting window does. The vesting is
    /// what makes a same-block or flash-funded deposit around a harvest earn nothing (I-1); the price is this dilution,
    /// which needs real capital held in wsMUSD for up to 3 days and only redistributes yield, never principal.
    function test_known_R2V5_lumpYieldSharedWithDepositorsWhoJoinBeforeItVests() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        skip(3 days);
        ws.sync();

        _yieldForVault(100e18);
        uint256 harvested = ws.sync(); // the keeper harvests at once
        assertApproxEqRel(harvested, 100e18, 0.01e18);
        uint256 aliceAtHarvest = ws.convertToAssets(aliceShares);

        uint256 stake = 90_000e18;
        uint256 shares = _deposit(attacker, stake);
        skip(3 days);
        uint256 out = ws.previewRedeem(shares);
        uint256 aliceGain = ws.convertToAssets(aliceShares) - aliceAtHarvest;
        emit log_named_decimal_uint("late depositor's share of a lump harvested before it joined", out - stake, 18);
        emit log_named_decimal_uint("incumbent's share of its own lump", aliceGain, 18);
        assertGt(out - stake, 85e18, "~90% of the lump goes to the depositor who joined after the harvest");
        assertLt(aliceGain, 15e18, "the incumbent keeps ~10%");
    }
}

/// @notice FeeRouter: no gas limit diverts the sMUSD leg (to a carry or, later, the treasury) or a bribe share.
contract R2VFeeRouterTest is Test {
    MockMUSD internal musd;
    SMUSDMock internal smusd;
    MockPoolsVoter internal voter;
    MockBribe internal bribeA;
    MockBribe internal bribeB;
    FeeRouter internal router;
    address internal gaugeA = makeAddr("gaugeA");
    address internal gaugeB = makeAddr("gaugeB");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_792_943_000);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        voter = new MockPoolsVoter();
        address[] memory rewards = new address[](1);
        rewards[0] = address(musd);
        bribeA = new MockBribe(address(voter), rewards);
        bribeB = new MockBribe(address(voter), rewards);
        voter.addGauge(gaugeA, address(bribeA));
        voter.addGauge(gaugeB, address(bribeB));
        address saver = makeAddr("saver");
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

    function test_verify_noGasLimitDivertsALeg() public {
        musd.mint(address(router), 1000e18);
        uint256 successes;
        for (uint256 g = 600_000; g < 1_600_000; g += 2500) {
            uint256 s = vm.snapshotState();
            try router.distribute{gas: g}() {
                ++successes;
                assertEq(router.smusdFailingSince(), 0, "sMUSD never counted as failing");
                assertEq(router.smusdCarry(), 0);
                assertEq(musd.balanceOf(address(bribeA)), 200e18, "bribe A posted");
                assertEq(musd.balanceOf(address(bribeB)), 200e18, "bribe B posted");
                assertEq(musd.balanceOf(treasury), 200e18);
                assertEq(musd.balanceOf(address(router)), 0);
            } catch {}
            vm.revertToState(s);
        }
        assertGt(successes, 0);
    }
}

/// @notice Factory timelock queue: a cut kills every raise of its own parameter (whatever the calldata encoding) and
/// nothing else; top-ups above the cap never enable a borrow.
contract R2VFactoryTest is CoreAuditBase {
    function test_verify_cutsInvalidateOnlyTheirOwnParameter() public {
        address module = makeAddr("module");
        address newOp = makeAddr("newOperator");
        address newFee = makeAddr("newFee");
        bytes memory capRaise = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (9000e18));
        bytes memory stdRaise = abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.STANDARD, 0.02e18, 7000));
        bytes memory stdRaisePadded = bytes.concat(stdRaise, hex"00000000deadbeef");
        bytes memory canRaise = abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.CANARY, 0.004e18, 7675));
        bytes memory approve = abi.encodeCall(IBorrowAccountFactory.setModuleApproval, (module, true));
        bytes memory grant = abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (newOp, true));
        bytes memory fee = abi.encodeCall(IBorrowAccountFactory.setFeeRecipient, (newFee));
        _submit(capRaise);
        _submit(stdRaise);
        _submit(stdRaisePadded);
        _submit(canRaise);
        _submit(approve);
        _submit(grant);
        _submit(fee);

        // A stranger can neither cut nor execute early.
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        _exec(attacker, abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.STANDARD, 0.01e18, 6200)));
        vm.expectRevert();
        _exec(attacker, capRaise);

        // The sentinel cuts the STANDARD ceiling only (a no-op on the position cap).
        skip(1 hours);
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.01e18, 6000);
        skip(48 hours);

        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        _exec(attacker, stdRaise);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        _exec(attacker, stdRaisePadded);
        assertEq(factory.executableAt(stdRaise), 0);

        // Every other parameter's raise still executes, by anyone.
        _exec(attacker, capRaise);
        _exec(attacker, canRaise);
        _exec(attacker, approve);
        _exec(attacker, grant);
        _exec(attacker, fee);
        assertEq(factory.globalBorrowCap(), 9000e18);
        assertTrue(factory.isApprovedModule(module));
        assertTrue(factory.isCanaryOperator(newOp));
        assertEq(factory.feeRecipient(), newFee);

        // A consumed raise cannot be replayed (it is now an equal value: a governor/sentinel-only decrease), and the
        // execution window closes 14 days after maturity.
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        _exec(attacker, capRaise);
        bytes memory late = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (9500e18));
        _submit(late);
        skip(48 hours + 14 days + 1);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        _exec(attacker, late);
    }

    function test_verify_topUpAboveCapNeverEnablesABorrow() public {
        IBorrowAccount acct = _open(alice, 0.01e18, 400e18); // at the 0.01 BTC cap
        vm.deal(alice, 1e18);
        vm.prank(alice);
        acct.addCollateral{value: 0.09e18}(); // 10x the cap
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, 0.1e18, 0.01e18));
        acct.borrow(1e18, BPS, alice);
        // Back at the cap it borrows again, within the same ceiling as before.
        vm.prank(alice);
        acct.withdrawCollateral(0.09e18, alice);
        vm.prank(alice);
        acct.borrow(10e18, BPS, alice);
        assertLe(_debt(address(acct)) * BPS, _value(_coll(address(acct))) * 6200);
    }
}

/// @notice Deploy.s.sol testnet dry run against local replicas etched at the testnet addresses: the core deploy runs end
/// to end without writing the registry, queues the canary grant, and the grant becomes executable by anyone at 48 h.
contract R2VDeployScriptTest is Test {
    function test_verify_testnetCoreDeployDryRun_andCanaryGrantMatures() public {
        vm.chainId(MezoAddresses.TESTNET_CHAIN_ID);
        MezoNetwork memory net = MezoAddresses.testnet();

        vm.etch(net.musd, address(new MockMUSD()).code);
        vm.etch(net.smusd, address(new SMUSDMock(net.musd)).code);
        address morphoOwner = makeAddr("morphoOwner");
        vm.etch(net.morpho, deployCode("Morpho.sol:Morpho", abi.encode(morphoOwner)).code);
        vm.store(net.morpho, bytes32(0), bytes32(uint256(uint160(morphoOwner))));
        vm.etch(net.irm, deployCode("AdaptiveCurveIrm.sol:AdaptiveCurveIrm", abi.encode(net.morpho)).code);
        vm.startPrank(morphoOwner);
        IMorpho(net.morpho).enableIrm(net.irm);
        IMorpho(net.morpho).enableLltv(net.lltv);
        vm.stopPrank();
        MockMUSD(net.musd).mint(DEFAULT_SENDER, 10_000e18);

        string memory before = vm.readFile("deployments/31611.json");
        Deploy script = new Deploy();
        Deploy.Deployed memory d = script.run();
        assertEq(vm.readFile("deployments/31611.json"), before, "dry run: registry untouched");

        assertEq(d.deployer, DEFAULT_SENDER);
        assertEq(d.factory.governor(), d.deployer);
        assertGt(IMorpho(net.morpho).market(d.factory.MARKET_ID()).lastUpdate, 0, "M1 created");
        assertEq(IMorpho(net.morpho).market(d.factory.MARKET_ID()).totalSupplyAssets, 3000e18, "M1 seeded");
        assertEq(d.wsMusd.balanceOf(address(0xdEaD)), 1e18, "wsMUSD seeded");
        assertEq(IERC20(net.musd).balanceOf(address(d.dispenser)), 600e18);

        bytes memory grant = abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (d.deployer, true));
        assertFalse(d.factory.isCanaryOperator(d.deployer), "no instant grant (D-7)");
        assertEq(d.factory.executableAt(grant), block.timestamp + 48 hours, "grant queued");
        vm.expectRevert(
            abi.encodeWithSelector(IBorrowAccountFactory.TimelockNotExpired.selector, block.timestamp + 48 hours)
        );
        d.factory.setCanaryOperator(d.deployer, true);
        skip(48 hours);
        vm.prank(makeAddr("keeper"));
        d.factory.setCanaryOperator(d.deployer, true);
        assertTrue(d.factory.isCanaryOperator(d.deployer), "the keeper executes the matured grant");
    }
}
