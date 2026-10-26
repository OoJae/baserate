// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {console2} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {IWsMusdLiquidityAdapter} from "../../src/interfaces/IWsMusdLiquidityAdapter.sol";
import {BackstopBase} from "../unit/BackstopBase.t.sol";
import {VaultBase} from "../unit/VaultBase.t.sol";
import {PCVMock, SMUSDMock} from "../utils/SMUSDMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";
import {R2Base} from "./Round2Cross.t.sol";
import {R3GasBurnSMUSDProxy, R3RegTopUpSlotGriefer} from "./Round3RegressionsHelpers.sol";

// =====================================================================================================================
// Round 3: regressions introduced by the round-2 fixes (git diff 524b0f1 16dbaf0 -- contracts/src contracts/script).
// Run: FOUNDRY_OUT=out/r3-regressions FOUNDRY_CACHE_PATH=cache/r3-regressions forge test --match-path
// test/audit/Round3_regressions.t.sol -vvv
// Findings: R3-1 (the parking pause lapses while sMUSD's withdraw stays broken: the venue's idle MUSD is re-parked and
// the preview still reports the BACKSTOP venue), R3-2 (the one-top-up-per-block slot can be taken with a 1 MUSD
// top-up), R3-3 (an in-kind exit spends the venue's idle MUSD first). The `test_R3_verify_*` tests back what was
// checked and found sound.
// =====================================================================================================================

/// @notice Backstop: the in-kind exit path, the parking pause, deposits closed while holding BTC.
contract R3RegBackstopTest is BackstopBase {
    address internal carol = makeAddr("carol");

    // -----------------------------------------------------------------------------------------------------------------
    // R3-1: the parking pause lapses after PARK_PAUSE while sMUSD's withdraw is still broken; the next deposit or sale
    // re-parks every idle MUSD into the broken wsMUSD, so the BACKSTOP venue is dead again while `quoteBuy` reports it.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_1_parkingResumesIntoBrokenWsMusd_backstopVenueDeadButQuoted() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _deposit(bob, 10_000e18);
        uint256 id = _request(alice, aliceShares);
        skip(7 days);
        assertLt(musd.balanceOf(address(backstop)), 1e15, "all cash parked in wsMUSD");

        // sMUSD's withdraw breaks (an upgrade, an illiquid strategy) for longer than PARK_PAUSE. Deposits still work.
        smusd.setDisabled(false, true, false);

        // 1. Until an exit happens to be paid in kind, nothing pauses parking: the venue is dead but quoted.
        uint256 q = backstop.quoteBuy(0.01e18);
        assertGt(q, 0, "quoted as available");
        _expectBuyUnavailable(0.01e18);

        // 2. A matured exit is paid in kind: parking pauses for PARK_PAUSE, so a deposit and the sale proceeds stay
        // idle and fund the venue (the round-2 fix working as designed).
        backstop.claimRedeem(id);
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        _deposit(carol, 2000e18);
        assertEq(_buy(0.01e18), q, "the venue buys from idle MUSD");
        _take(0.01e18);
        uint256 idle = musd.balanceOf(address(backstop));
        assertGt(idle, 2000e18, "sale proceeds kept idle");

        // 3. The pause lapses; sMUSD's withdraw is still broken. The next deposit (anyone, any size; here 1 MUSD) or
        // auction/keeper sale parks every idle MUSD back into wsMUSD, which cannot pay it out.
        skip(backstop.PARK_PAUSE());
        assertTrue(block.timestamp >= backstop.parkingPausedUntil(), "pause over");
        _deposit(attacker, 1e18);
        assertLt(musd.balanceOf(address(backstop)), 1e15, "all idle MUSD re-parked into the broken wsMUSD");

        // 4. The BACKSTOP venue is dead again, while quoteBuy (what FlashLiquidator.previewLiquidation reports for the
        // BACKSTOP venue) still says it can buy.
        uint256 q2 = backstop.quoteBuy(0.01e18);
        assertGt(q2, 0, "still quoted as available");
        _expectBuyUnavailable(0.01e18);
        emit log_named_decimal_uint("idle MUSD re-parked into the broken wsMUSD", idle + 1e18, 18);
        emit log_named_decimal_uint("quoteBuy(0.01 BTC) after the re-park (purchase reverts)", q2, 18);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): no gas limit makes a claim fall back to the in-kind payment while wsMUSD can pay, also with
    // sMUSD's own try/catch'd PCV call and wsMUSD's try/catch'd claimYield/re-stake in the path.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_verify_claimInKindCannotBeForcedByGas() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        uint256 id = _request(alice, aliceShares);
        // Live-like sMUSD: a PCV with queued MUSD that sMUSD's deposit/withdraw distribute through a try/catch, and
        // pending sMUSD yield so wsMUSD's withdraw also runs its try/catch'd claimYield.
        PCVMock pcv = new PCVMock(address(musd), address(smusd));
        smusd.setPcv(address(pcv));
        musd.mint(address(this), 100e18);
        musd.approve(address(smusd), 100e18);
        smusd.receiveProtocolYield(100e18);
        skip(7 days);
        musd.mint(address(pcv), 50e18);
        pcv.queue(50e18);

        uint256 snap = vm.snapshotState();
        uint256 g0 = gasleft();
        backstop.claimRedeem(id);
        uint256 normalGas = g0 - gasleft();
        assertEq(ws.balanceOf(alice), 0, "normal path: MUSD");
        vm.revertToState(snap);

        uint256 successes;
        for (uint256 g = 40_000; g < normalGas + 100_000; g += 1000) {
            vm.revertToState(snap);
            try backstop.claimRedeem{gas: g}(id) {
                ++successes;
                assertEq(ws.balanceOf(alice), 0, "a gas-limited claim is never paid in kind");
                assertEq(backstop.parkingPausedUntil(), 0, "and never pauses parking");
            } catch {}
        }
        console2.log("claimRedeem gas (wsMUSD withdraw + PCV)", normalGas);
        assertGt(successes, 0);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): the in-kind fallback stays reachable within Mezo's 10M block gas limit even if sMUSD's
    // withdraw fails by burning all its gas (INVALID / unbounded loop) instead of reverting cheaply. Worst case: BTC held
    // (the claim reads the oracle) and idle MUSD to transfer in the catch.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_verify_inKindFallbackReachableAgainstGasBurningSmusd() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _deposit(bob, 10_000e18);
        _buy(0.05e18);
        uint256 id = _request(alice, aliceShares);
        skip(7 days);
        musd.mint(address(backstop), 100e18); // idle MUSD the catch pays first
        SMUSDMock impl = new SMUSDMock(address(musd));
        vm.etch(address(smusd), address(new R3GasBurnSMUSDProxy(address(impl))).code);

        uint256 snap = vm.snapshotState();
        uint256 lo = 50_000;
        uint256 hi = 9_500_000;
        assertTrue(_claimWithGas(snap, id, hi), "claims with 9.5M gas");
        while (hi - lo > 5000) {
            uint256 mid = (lo + hi) / 2;
            if (_claimWithGas(snap, id, mid)) hi = mid;
            else lo = mid;
        }
        vm.revertToState(snap);
        backstop.claimRedeem{gas: hi}(id);
        assertGt(ws.balanceOf(alice), 0, "paid in kind");
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        console2.log("min gas: in-kind claim against a gas-burning sMUSD withdraw (cold)", hi);
        assertLt(hi + 100_000, 10_000_000, "fits a 10M-gas block with intrinsic and calldata");
    }

    function _claimWithGas(uint256 snap, uint256 id, uint256 gas_) internal returns (bool ok) {
        vm.revertToState(snap);
        vm.cool(address(backstop));
        vm.cool(address(ws));
        vm.cool(address(smusd));
        vm.cool(address(musd));
        vm.cool(address(oracle));
        try backstop.claimRedeem{gas: gas_}(id) {
            ok = true;
        } catch {}
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): partial claims paid in kind never pay more than the request NAV, keep the reservation and
    // the escrow exact, and do not lift the share price.
    // -----------------------------------------------------------------------------------------------------------------

    function testFuzz_R3_verify_partialInKindClaims(uint256 buyBtc, uint256 chunk, uint256 bobPart) public {
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
        smusd.setDisabled(false, true, false);

        uint256 paidA;
        uint256 paidB;
        for (uint256 round; round < 80; ++round) {
            uint256 pps0 = _pps();
            if (backstop.redeemRequest(idA).shares != 0 && backstop.cash() != 0) paidA += backstop.claimRedeem(idA);
            if (backstop.redeemRequest(idB).shares != 0 && backstop.cash() != 0) paidB += backstop.claimRedeem(idB);
            assertLe(_pps(), pps0 + 1, "a claim never lifts the share price");
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
        // What the receivers actually hold is worth at most what the claims reported.
        uint256 heldA = musd.balanceOf(alice) + ws.convertToAssets(ws.balanceOf(alice));
        uint256 heldB = musd.balanceOf(bob) + ws.convertToAssets(ws.balanceOf(bob));
        assertLe(heldA, paidA, "A: value received <= reported");
        assertLe(heldB, paidB, "B: value received <= reported");
        assertApproxEqAbs(heldA, owedA, 1e9, "A paid in full");
        assertApproxEqAbs(heldB, owedB, 1e9, "B paid in full");
        assertEq(backstop.reservedAssets(), 0);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): ERC-4626 limits and previews around the DUST_INVENTORY threshold, with the oracle down.
    // -----------------------------------------------------------------------------------------------------------------

    function testFuzz_R3_verify_erc4626AroundDust(uint256 assets, uint256 dust) public {
        _deposit(alice, 5000e18);
        // Gains vesting and dust inventory below the threshold: deposits are open and need no oracle.
        dust = bound(dust, 1, backstop.DUST_INVENTORY() - 1);
        _buy(dust);
        musd.mint(address(backstop), 77e18);
        backstop.sync();
        oracle.setReverting(true);
        assertEq(backstop.maxDeposit(bob), type(uint256).max, "open below DUST_INVENTORY");
        assertEq(backstop.maxMint(bob), type(uint256).max);
        assets = bound(assets, 1e12, 1_000_000e18);
        uint256 preview = backstop.previewDeposit(assets);
        if (preview != 0) {
            assertEq(_deposit(bob, assets), preview, "previewDeposit == deposit");
            uint256 cost = backstop.previewMint(1e18);
            musd.mint(bob, cost);
            vm.startPrank(bob);
            musd.approve(address(backstop), cost);
            assertEq(backstop.mint(1e18, bob), cost, "previewMint == mint");
            vm.stopPrank();
        }

        // At DUST_INVENTORY: closed, and both entry points revert, while the views keep answering.
        oracle.setReverting(false);
        _buy(backstop.DUST_INVENTORY());
        assertEq(backstop.maxDeposit(bob), 0, "closed at DUST_INVENTORY");
        assertEq(backstop.maxMint(bob), 0);
        musd.mint(bob, 1e18);
        vm.startPrank(bob);
        musd.approve(address(backstop), 1e18);
        vm.expectPartialRevert(IBackstop.HoldingInventory.selector);
        backstop.deposit(1e18, bob);
        vm.expectPartialRevert(IBackstop.HoldingInventory.selector);
        backstop.mint(1, bob);
        vm.stopPrank();
        oracle.setReverting(true);
        assertEq(backstop.maxDeposit(bob), 0, "views never revert");
        backstop.previewDeposit(1e18);
        backstop.totalAssets();
    }

    function _expectBuyUnavailable(uint256 btc) internal {
        vm.deal(liquidator, btc);
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        backstop.buyCollateral{value: btc}(0);
    }
}

/// @notice R3-1 on the full stack (real FlashLiquidator, Morpho, BtcMusdOracle, Tigris stand-ins): what a third-party
/// liquidator or integrator reading `previewLiquidation` sees, and what the liquidation then does.
contract R3RegFullStackTest is R2Base {
    address internal taker = makeAddr("taker");

    // -----------------------------------------------------------------------------------------------------------------
    // R3-1 (full stack): after PARK_PAUSE, while sMUSD's withdraw is still broken, a 1 MUSD deposit by anyone re-parks
    // the venue's idle MUSD into wsMUSD; previewLiquidation keeps reporting the BACKSTOP venue as clearing and the
    // liquidation through it reverts.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_1_fullStack_venueDefundedAfterPause_previewOk_liquidationReverts() public {
        _supplyM1(m1Lender, 60_000e18);
        address lp = makeAddr("bpAlice");
        uint256 lpShares = _depositBackstop(lp, 10_000e18);
        address a1 = _open(makeAddr("b1"), 0.05e18, 7000);
        address a2 = _open(makeAddr("b2"), 0.05e18, 7000);
        address a3 = _open(makeAddr("b3"), 0.05e18, 7000);
        vm.prank(lp);
        uint256 id = backstop.requestRedeem(lpShares, lp, lp);
        skip(7 days);
        _crash(2000);
        vm.prank(keeper);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);

        // sMUSD's withdraw breaks for longer than PARK_PAUSE; its deposit still works.
        smusd.setDisabled(false, true, false);

        // The round-2 fix at work: the matured exit is paid in kind, parking pauses, the sale proceeds and a new
        // deposit stay idle, and the BACKSTOP venue clears a2 from them.
        backstop.claimRedeem(id);
        assertGt(ws.balanceOf(lp), 0, "exit paid in kind");
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        _takeAll();
        _depositBackstop(makeAddr("newLp"), 5000e18);
        assertTrue(liquidator.previewLiquidation(a2).quotes[uint256(Venue.BACKSTOP)].ok, "venue funded");
        vm.prank(keeper);
        liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
        _takeAll();
        uint256 idle = musd.balanceOf(address(backstop));
        assertGt(idle, 5000e18, "venue funding: idle MUSD");

        // The pause lapses; sMUSD's withdraw is still broken. Anyone's 1 MUSD deposit re-parks all of it.
        skip(backstop.PARK_PAUSE());
        _depositBackstop(stranger, 1e18);
        assertLt(musd.balanceOf(address(backstop)), 1e15, "venue funding re-parked into the broken wsMUSD");

        // previewLiquidation (quoteBuy) reports the BACKSTOP venue as clearing a3; the liquidation reverts.
        IFlashLiquidator.LiquidationPreview memory p = liquidator.previewLiquidation(a3);
        assertTrue(p.liquidatable, "a3 liquidatable");
        assertTrue(p.quotes[uint256(Venue.BACKSTOP)].ok, "BACKSTOP previewed as clearing a3");
        vm.prank(keeper);
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        liquidator.liquidate(a3, 0, Venue.BACKSTOP, 0);
        // A DEX venue still clears it (impact: the backstop venue only, not the market).
        vm.prank(keeper);
        liquidator.liquidate(a3, 0, Venue.CL200, 0);
        emit log_named_decimal_uint("venue funding re-parked by a 1 MUSD deposit", idle, 18);
        emit log_named_decimal_uint(
            "BACKSTOP proceeds previewed for a3 (liquidation reverts)", p.quotes[uint256(Venue.BACKSTOP)].proceeds, 18
        );
    }

    // -----------------------------------------------------------------------------------------------------------------
    // R3-3 (during the pause): an exit paid in kind spends all the idle MUSD (the venue's funding) first, although the
    // backstop's wsMUSD alone could pay the whole claim; anyone can trigger it on any matured request, and the BACKSTOP
    // venue is unavailable from that block on.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_3_fullStack_inKindClaimSpendsTheVenuesIdleFirst() public {
        _supplyM1(m1Lender, 60_000e18);
        address lp1 = makeAddr("bpAlice");
        address lp2 = makeAddr("bpBob");
        uint256 s1 = _depositBackstop(lp1, 3000e18);
        uint256 s2 = _depositBackstop(lp2, 8000e18);
        address a1 = _open(makeAddr("b1"), 0.05e18, 7000);
        address a2 = _open(makeAddr("b2"), 0.05e18, 7000);
        vm.prank(lp1);
        uint256 id1 = backstop.requestRedeem(s1, lp1, lp1);
        vm.prank(lp2);
        uint256 id2 = backstop.requestRedeem(s2, lp2, lp2);
        skip(7 days);
        _crash(2000);
        vm.prank(keeper);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
        smusd.setDisabled(false, true, false);

        backstop.claimRedeem(id1); // in kind: parking pauses
        _takeAll();
        _depositBackstop(makeAddr("newLp"), 5000e18);
        assertTrue(liquidator.previewLiquidation(a2).quotes[uint256(Venue.BACKSTOP)].ok, "venue funded");
        uint256 idle = musd.balanceOf(address(backstop));
        uint256 owed2 = backstop.redeemRequest(id2).assets;
        uint256 wsValue = ws.previewRedeem(ws.balanceOf(address(backstop)));
        assertGt(wsValue, owed2, "the backstop's wsMUSD alone could pay lp2's whole claim");

        vm.prank(stranger);
        backstop.claimRedeem(id2);
        assertEq(musd.balanceOf(lp2), idle, "lp2 receives all the idle MUSD first");
        assertEq(musd.balanceOf(address(backstop)), 0, "venue funding gone");
        assertGt(backstop.availableCash(), 2000e18, "free cash on paper");
        assertFalse(liquidator.previewLiquidation(a2).quotes[uint256(Venue.BACKSTOP)].ok, "venue unavailable");
        vm.prank(keeper);
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
        emit log_named_decimal_uint("idle MUSD (venue funding) handed to the claim", idle, 18);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): the new paths add no precompile calls. An in-kind claim while BTC is held reads Skip once
    // (as a cash claim does) and the oracle-free claim tries it once (deposits read nothing: Round2BudgetTest).
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_verify_inKindPathsPrecompileBudget() public {
        _supplyM1(m1Lender, 60_000e18);
        address lp = makeAddr("bpAlice");
        address lp2 = makeAddr("bpBob");
        uint256 lpShares = _depositBackstop(lp, 10_000e18);
        uint256 lp2Shares = _depositBackstop(lp2, 4000e18);
        address a1 = _open(makeAddr("b1"), 0.05e18, 7000);
        vm.prank(lp);
        uint256 id = backstop.requestRedeem(lpShares, lp, lp);
        vm.prank(lp2);
        uint256 id2 = backstop.requestRedeem(lp2Shares, lp2, lp2);
        skip(7 days);
        _crash(2000);
        vm.prank(keeper);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
        assertGe(backstop.inventory(), backstop.DUST_INVENTORY(), "holding BTC: claims read the oracle");
        smusd.setDisabled(false, true, false);

        _begin();
        backstop.claimRedeem(id);
        Cost memory c = _end("Backstop.claimRedeem paid in kind (holding BTC)");
        assertEq(c.skip, 1, "one Skip read");
        assertEq(c.btc, 0, "no BTC precompile call");
        assertGt(ws.balanceOf(lp), 0, "paid in kind");

        skipOracle.setMode(SkipMock.Mode.REVERT);
        _begin();
        vm.prank(lp2);
        backstop.claimRedeemWithoutOracle(id2);
        c = _end("Backstop.claimRedeemWithoutOracle paid in kind (Skip down)");
        assertEq(c.skip, 1, "one (failed) Skip read");
        assertEq(c.btc, 0);
        assertGt(ws.balanceOf(lp2), 0, "paid in kind");
    }

    function _takeAll() internal {
        uint256 inv = backstop.inventory();
        if (inv == 0) return;
        _fundApprove(taker, backstop.quoteAuction(inv), address(backstop));
        vm.prank(taker);
        backstop.takeAuction(inv, type(uint256).max, taker);
    }
}

/// @notice Allocator: the one-buffer-top-up-per-block rule (R2X-3 fix) and the liquidity adapter's forceDeallocate
/// rejection (R2X-4 fix).
contract R3RegAllocatorTest is VaultBase {
    function _nextBlock() internal {
        skip(12);
        vm.roll(block.number + 1);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // R3-2: anyone can take a block's only top-up slot with a 1 MUSD top-up (supply just enough to leave a 1 MUSD
    // deficit, rebalance, withdraw, in one transaction), so the keeper's top-up does nothing in that block, even after
    // an untouched checkpoint has recorded the low (the case R2V-4 documents as no longer blockable).
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_2_topUpSlotTakenByOneMusdTopUp_throttlesBufferRestoration() public {
        _deposit(lender, 20_000e18); // vMUSD: all in wsMUSD
        // Borrowers really drain M1 (an earlier block): 3,000 team supply, 2,900 borrowed.
        _borrow(borrower, 2900e18);
        // The keeper's hourly checkpoint, in a block nobody touched M1 in, records the low.
        skip(1 hours);
        vm.roll(block.number + 300);
        assertTrue(allocator.checkpoint(), "low recorded");
        _nextBlock();
        assertLt(_m1Liquidity(), 101e18, "M1 drained");

        R3RegTopUpSlotGriefer griefer =
            new R3RegTopUpSlotGriefer(morpho, IBaserateAllocator(address(allocator)), IERC20(address(musd)), params);
        uint256 capital = 2000e18; // working capital, returned within each transaction
        musd.mint(address(griefer), capital);

        // Control: the keeper restores the 2,000 MUSD floor in two blocks (1,000 MUSD per top-up).
        uint256 snap = vm.snapshotState();
        (IBaserateAllocator.Action a, uint256 amount) = allocator.rebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 1000e18);
        _nextBlock();
        allocator.rebalance();
        assertGe(_m1Liquidity() + 1e15, 2000e18, "control: floor restored after 2 blocks");
        vm.revertToState(snap);

        // Attack: in each block the griefer's 1 MUSD top-up runs first; the keeper's top-up then does nothing.
        uint256 m1Before = _vaultM1();
        uint256 blocks = 30;
        uint256 griefGas;
        for (uint256 i; i < blocks; ++i) {
            uint256 g0 = gasleft();
            (a, amount) = griefer.grief();
            griefGas = g0 - gasleft();
            assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP), "griefer takes the slot");
            assertEq(amount, 1e18, "with a 1 MUSD top-up");
            (a, amount) = allocator.rebalance();
            assertEq(uint256(a), uint256(IBaserateAllocator.Action.NONE), "keeper's top-up skipped this block");
            assertEq(amount, 0);
            (IBaserateAllocator.Action planned,,) = allocator.previewRebalance();
            assertEq(uint256(planned), uint256(IBaserateAllocator.Action.NONE));
            _nextBlock();
        }
        uint256 restored = _vaultM1() - m1Before;
        emit log_named_uint("blocks griefed", blocks);
        emit log_named_decimal_uint("MUSD restored to M1 under griefing", restored, 18);
        emit log_named_decimal_uint("M1 liquidity after griefing (floor 2,000)", _m1Liquidity(), 18);
        emit log_named_uint("griefer gas per block", griefGas);
        assertApproxEqAbs(restored, blocks * 1e18, 1e15, "1 MUSD per block instead of 1,000");
        assertLt(_m1Liquidity(), 200e18, "buffer still drained");
        assertGe(musd.balanceOf(address(griefer)) + blocks * 2, capital, "griefer keeps its capital (gas only)");

        // As soon as the griefer stops, the keeper's top-up runs again in full.
        (a, amount) = allocator.rebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 1000e18);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): with sMUSD's withdraw broken, the liquidity adapter's new forceDeallocate rejection leaves
    // every M1-backed exit open: forceDeallocate on the market adapter (its penalty withdraw is paid from the idle it
    // just created, so it never reaches the liquidity adapter) and the allocator's M1-first retry.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_verify_m1ExitsUnaffectedByForceDeallocateRejection() public {
        _deposit(lender, 20_000e18);
        _borrow(borrower, 2900e18);
        _nextBlock();
        allocator.rebalance();
        _nextBlock();
        allocator.rebalance();
        assertGe(_vaultM1(), 1900e18, "vMUSD lends ~1,900 in M1");
        smusd.setDisabled(false, true, false);

        // The vault's own exit reaches the broken wsMUSD leg; forceDeallocate on that leg is rejected.
        vm.prank(lender);
        vm.expectRevert();
        vault.withdraw(1000e18, lender, lender);
        vm.prank(lender);
        vm.expectRevert(IWsMusdLiquidityAdapter.ForceDeallocateDisabled.selector);
        vault.forceDeallocate(address(liq), "", 1000e18, lender);

        // forceDeallocate on the M1 adapter still works, and the idle it creates pays a withdrawal.
        uint256 before = musd.balanceOf(lender);
        vm.startPrank(lender);
        vault.forceDeallocate(address(mm), abi.encode(params), 1000e18, lender);
        vault.withdraw(990e18, lender, lender);
        vm.stopPrank();
        assertEq(musd.balanceOf(lender) - before, 990e18, "M1 leg out via forceDeallocate");

        // The allocator's M1-first retry pays without penalty.
        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        allocator.withdraw(500e18, lender);
        vm.stopPrank();
        assertEq(musd.balanceOf(lender) - before, 1490e18, "M1 leg out via the allocator's retry");
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Verification (sound): the allocator's M1-first retry also stays reachable within a 10M-gas block when sMUSD's
    // withdraw fails by burning all its gas (each nested frame hands back its 1/64).
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3_verify_m1FirstRetryReachableAgainstGasBurningSmusd() public {
        _deposit(lender, 20_000e18);
        _borrow(borrower, 2900e18);
        _nextBlock();
        allocator.rebalance();
        _nextBlock();
        allocator.rebalance();
        vm.prank(lender);
        vault.approve(address(allocator), type(uint256).max);
        SMUSDMock impl = new SMUSDMock(address(musd));
        vm.etch(address(smusd), address(new R3GasBurnSMUSDProxy(address(impl))).code);

        uint256 snap = vm.snapshotState();
        uint256 lo = 50_000;
        uint256 hi = 9_500_000;
        assertTrue(_withdrawWithGas(snap, hi), "exits with 9.5M gas");
        while (hi - lo > 5000) {
            uint256 mid = (lo + hi) / 2;
            if (_withdrawWithGas(snap, mid)) hi = mid;
            else lo = mid;
        }
        console2.log("min gas: allocator.withdraw M1-first retry against a gas-burning sMUSD withdraw (cold)", hi);
        assertLt(hi + 100_000, 10_000_000, "fits a 10M-gas block");
    }

    function _withdrawWithGas(uint256 snap, uint256 gas_) internal returns (bool ok) {
        vm.revertToState(snap);
        address[9] memory a = [
            address(vault),
            address(liq),
            address(mm),
            address(allocator),
            address(morpho),
            address(ws),
            address(smusd),
            address(musd),
            irm
        ];
        for (uint256 i; i < a.length; ++i) {
            vm.cool(a[i]);
        }
        uint256 before = musd.balanceOf(lender);
        vm.prank(lender);
        try allocator.withdraw{gas: gas_}(500e18, lender) {
            ok = musd.balanceOf(lender) - before == 500e18;
        } catch {}
    }
}
