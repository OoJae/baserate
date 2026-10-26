// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {console2} from "forge-std/Test.sol";

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {BackstopBase} from "../unit/BackstopBase.t.sol";
import {VaultBase} from "../unit/VaultBase.t.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {R2Base} from "./Round2Cross.t.sol";
import {R3EconCheckpointPinner} from "./Round3EconomicsHelpers.sol";

// =====================================================================================================================
// Round 3, economic and cross-contract composition review of the round-2 fixes (524b0f1..16dbaf0).
// Run: FOUNDRY_OUT=out/r3-economics FOUNDRY_CACHE_PATH=cache/r3-economics forge test --match-path
// test/audit/Round3_economics.t.sol -vvv
// =====================================================================================================================

/// @notice Backstop: the parking pause that keeps the BACKSTOP venue funded while sMUSD's withdraw is broken.
contract R3EconBackstopTest is BackstopBase {
    address internal carol = makeAddr("carol");

    // -----------------------------------------------------------------------------------------------------------------
    // R3E-1: any successful wsMUSD withdraw lifts the parking pause, and wsMUSD serves a withdraw that fits in its own
    // idle MUSD without calling sMUSD. A 0.0009 MUSD donation to wsMUSD (below MIN_HARVEST, so it is neither absorbed
    // nor re-staked) plus a dust-sized claim lifts the pause in the very block it was set, while sMUSD's withdraw still
    // reverts: the next sale re-parks every idle MUSD into the broken wsMUSD and the BACKSTOP venue is dead but quoted.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3E_1_parkingPauseLiftedOnDemand_whileSmusdWithdrawStillBroken() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _deposit(bob, 20_000e18);
        uint256 carolShares = _deposit(carol, 3000e18);
        uint256 attShares = _deposit(attacker, 1e18);
        uint256 idA = _request(alice, aliceShares);
        uint256 idC = _request(carol, carolShares);
        // The attacker queues two dust exits (~0.0002 MUSD each) in advance: one per pause it will lift.
        uint256 idX1 = _request(attacker, attShares / 5000);
        uint256 idX2 = _request(attacker, attShares / 5000);
        _buy(0.1e18); // seized BTC the auction will sell later
        skip(7 days);

        // sMUSD's withdraw breaks (the R2X-1 scenario: an upgrade, an illiquid strategy, a pause); deposits still work.
        smusd.setDisabled(false, true, false);

        // The round-2 fix: the matured exit is paid in kind and parking pauses for PARK_PAUSE.
        backstop.claimRedeem(idA);
        assertGt(ws.balanceOf(alice), 0, "alice paid in wsMUSD shares");
        uint256 pausedUntil = vm.getBlockTimestamp() + backstop.PARK_PAUSE();
        assertEq(backstop.parkingPausedUntil(), pausedUntil, "parking paused for a day");
        assertEq(musd.balanceOf(address(backstop)), 0, "no idle MUSD left");
        uint256 snap = vm.snapshotState();

        // Control: the auction proceeds stay idle for the day and the BACKSTOP venue buys from them.
        uint256 proceeds = _take(0.1e18);
        assertEq(musd.balanceOf(address(backstop)), proceeds, "control: proceeds kept idle");
        uint256 q = backstop.quoteBuy(0.05e18);
        assertGt(q, 0, "control: quoted");
        assertEq(_buy(0.05e18), q, "control: the venue buys from idle MUSD");
        vm.revertToState(snap);

        // Attack, in the same block: 0.0009 MUSD donated to wsMUSD stays idle there (below MIN_HARVEST, so `_sync`
        // neither absorbs nor re-stakes it)...
        musd.mint(attacker, 0.0009e18);
        vm.prank(attacker);
        musd.transfer(address(ws), 0.0009e18);
        // ...so wsMUSD pays the dust claim's withdraw out of that idle MUSD without calling sMUSD: the backstop sees a
        // successful wsMUSD withdraw and lifts the pause.
        backstop.claimRedeem(idX1);
        assertEq(backstop.parkingPausedUntil(), 0, "pause lifted in the block it was set");
        // sMUSD's withdraw is still broken: any real wsMUSD withdrawal reverts.
        vm.prank(alice);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        ws.withdraw(1e18, alice, alice);

        // The next sale re-parks all its proceeds into the broken wsMUSD; the venue is quoted but dead.
        _take(0.1e18);
        assertLt(musd.balanceOf(address(backstop)), 1e15, "proceeds re-parked into the broken wsMUSD");
        assertEq(backstop.quoteBuy(0.05e18), q, "still quoted as available, at the same price");
        _expectBuyUnavailable(0.05e18);

        // Repeatable: the next in-kind exit pauses parking again, the next dust claim lifts it again.
        backstop.claimRedeem(idC);
        assertGt(backstop.parkingPausedUntil(), 0, "carol's in-kind exit pauses parking");
        backstop.claimRedeem(idX2);
        assertEq(backstop.parkingPausedUntil(), 0, "lifted again");

        emit log_named_decimal_uint("attacker cost: MUSD donated to wsMUSD", 0.0009e18, 18);
        emit log_named_decimal_uint("sale proceeds re-parked into the broken wsMUSD", proceeds, 18);
    }

    function _expectBuyUnavailable(uint256 btc) internal {
        vm.deal(liquidator, btc);
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        backstop.buyCollateral{value: btc}(0);
    }
}

/// @notice Allocator: the carried-forward checkpoint of the R2V-3 fix.
contract R3EconAllocatorTest is VaultBase {
    uint256 internal constant YEAR = 365 days;

    // -----------------------------------------------------------------------------------------------------------------
    // R3E-2: a touched-block checkpoint carries the previous external liquidity forward with a fresh timestamp, so one
    // low recorded across a single block boundary (borrow in block N, permissionless checkpoint() first in block N+1,
    // repay) can be kept inside the 24 h LIQUIDITY_WINDOW forever by one `accrueInterest + checkpoint()` transaction per
    // hour. TO_LIQUIDITY is sized on the window's minimum, so vMUSD cannot leave M1 while wsMUSD pays more, and the
    // keeper's own calls (made in untouched blocks) do not help.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3E_2_onceRecordedLowPinnedByHourlyTouchedCheckpoints_blocksToLiquidity() public {
        _deposit(lender, 20_000e18);
        // vMUSD holds 6k in M1 (through the allocator role), outside borrowers 2.9k: the R2V-3 regression's setup.
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

        // 1. One real low across a single block boundary: borrow 5,000 MUSD in the block before a checkpoint is due,
        // call the permissionless checkpoint() first thing in the next block (M1 untouched there), repay.
        address att = makeAddr("pinner");
        skip(1 hours - 4);
        vm.roll(vm.getBlockNumber() + 899);
        _borrow(att, 5000e18);
        _nextBlock();
        assertTrue(allocator.checkpoint(), "the low is recorded");
        _repayAll(att);
        int256 low = _lastCheckpoint().m1ExternalLiquidity;
        assertLt(low, -4000e18, "external liquidity recorded with the borrow outstanding");
        uint256 snap = vm.snapshotState();

        // Control: honest hourly checkpoints. The low ages out of the 24 h window and TO_LIQUIDITY resumes.
        for (uint256 h; h < 25; ++h) {
            _nextHour();
            assertTrue(allocator.checkpoint());
        }
        _nextBlock();
        _mockWsApy(0.5e18);
        (IBaserateAllocator.Action control, uint256 controlAmount,) = allocator.previewRebalance();
        assertEq(uint256(control), uint256(IBaserateAllocator.Action.TO_LIQUIDITY), "control: resumes after 24 h");
        assertEq(controlAmount, allocator.MAX_MOVE());
        vm.revertToState(snap);

        // 2. Attack: one transaction per hour, in the first block where a checkpoint is due. The keeper's hourly
        // checkpoint then finds nothing due, and its previews and rebalances (untouched blocks) see nothing to move.
        R3EconCheckpointPinner pinner =
            new R3EconCheckpointPinner(morpho, IBaserateAllocator(address(allocator)), params);
        uint256 pinGas;
        uint256 days_ = 5;
        for (uint256 h; h < days_ * 24; ++h) {
            _nextHour();
            uint256 g0 = gasleft();
            assertTrue(pinner.pin(), "the pinning checkpoint lands first");
            pinGas = g0 - gasleft();
            assertEq(_lastCheckpoint().m1ExternalLiquidity, low, "the low is carried forward, freshly timestamped");
            _nextBlock();
            assertFalse(allocator.checkpoint(), "the keeper's hourly checkpoint: nothing due");
            if (h % 6 == 5) {
                _mockWsApy(0.5e18);
                (IBaserateAllocator.Action a,,) = allocator.previewRebalance();
                assertEq(uint256(a), uint256(IBaserateAllocator.Action.NONE), "keeper preview: nothing to move");
                (a,) = allocator.rebalance(); // even if called anyway, in an untouched block
                assertEq(uint256(a), uint256(IBaserateAllocator.Action.NONE));
            }
        }
        _mockWsApy(0.5e18);
        (,, IBaserateAllocator.Snapshot memory s) = allocator.previewRebalance();
        assertLt(s.m1TrailingApy, s.wsMusdApy, "wsMUSD still pays more");
        assertGt(s.m1Liquidity, 6000e18, "M1 really holds 6k of liquidity");
        assertLt(s.conservativeLiquidity, s.bufferTarget, "but TO_LIQUIDITY is sized on the pinned low");
        assertGt(_vaultM1(), 6000e18, "vMUSD's 6k never left M1 in 5 days");

        emit log_named_int("pinned m1ExternalLiquidity (MUSD wei)", low);
        emit log_named_decimal_uint("spot M1 liquidity", s.m1Liquidity, 18);
        emit log_named_decimal_uint("conservative liquidity TO_LIQUIDITY is sized on", s.conservativeLiquidity, 18);
        emit log_named_uint("gas per hourly pin (accrueInterest + checkpoint)", pinGas);
        emit log_named_uint("pins sent over the 5 days", days_ * 24);
        vm.clearMockedCalls();
    }

    function _nextBlock() internal {
        skip(4);
        vm.roll(vm.getBlockNumber() + 1);
    }

    /// @dev The first block in which the next hourly checkpoint is due.
    function _nextHour() internal {
        IBaserateAllocator.Checkpoint memory c = _lastCheckpoint();
        uint256 due = uint256(c.timestamp) + allocator.CHECKPOINT_INTERVAL();
        uint256 now_ = vm.getBlockTimestamp();
        vm.warp(due > now_ ? due : now_ + 4);
        vm.roll(vm.getBlockNumber() + 900);
    }

    function _lastCheckpoint() internal view returns (IBaserateAllocator.Checkpoint memory) {
        uint256 count = allocator.checkpointCount();
        uint256 n = count < allocator.CHECKPOINT_CAPACITY() ? count : allocator.CHECKPOINT_CAPACITY();
        return allocator.checkpointAt(n - 1);
    }

    function _repayAll(address who) internal {
        uint256 shares = morpho.position(marketId, who).borrowShares;
        musd.mint(who, 1e18); // the interest of one block
        vm.startPrank(who);
        musd.approve(address(morpho), type(uint256).max);
        morpho.repay(params, 0, shares, who, "");
        vm.stopPrank();
    }

    /// @dev Makes wsMUSD's trailing APY exactly `apy` against the oldest retained checkpoint.
    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = vm.getBlockTimestamp() - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (YEAR * 1e18);
        vm.mockCall(address(ws), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }
}

/// @notice Oracle: the 600 s Pyth band of the R2X-2 fix, on the full stack (real BtcMusdOracle, factory, Morpho, vMUSD).
contract R3EconOracleTest is R2Base {
    using MorphoBalancesLib for *;

    // -----------------------------------------------------------------------------------------------------------------
    // R3E-3: the band now gates only for the first 600 s after a Pyth push. Pyth BTC/USD is pushed about hourly, so for
    // ~50 of every 60 minutes nothing checks Skip. A Skip misprint 11 minutes after a push, which the 3,900 s band
    // rejected (Pyth 660 s old, deviation > 10%), now (a) liquidates honest positions at a false price and (b) lets a
    // borrower draw debt against a false price into bad debt for vMUSD.
    // -----------------------------------------------------------------------------------------------------------------

    function test_R3E_3a_skipMisprintElevenMinutesAfterPythPush_unfairLiquidation() public {
        _supplyM1(m1Lender, 20_000e18);
        address victim = makeAddr("victim");
        address acct = _open(victim, 0.1e18, 7000); // an honest STANDARD position at 70% LTV
        uint256 t0 = vm.getBlockTimestamp();
        _setPyth(BTC_USD, t0); // Pyth's hourly push
        vm.warp(t0 + 11 minutes);
        vm.roll(vm.getBlockNumber() + 165);

        // Skip misprints -20% for a block; Pyth (660 s old) and the DEX pools still say 80,000.
        skipOracle.setAnswer(int256(BTC_USD * 80 / 100));
        IBtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok, "the oracle prices: the band is off");
        assertFalse(s.pythBtcFresh);
        assertEq(s.deviationBps, 2000, "Skip 20% under Pyth");
        _assertOldBandWouldReject(s);

        IFlashLiquidator.LiquidationPreview memory p = liquidator.previewLiquidation(acct);
        assertTrue(p.liquidatable, "a 70% LTV position is liquidatable at the misprint");
        uint256 equityBefore = 0.1e18 * BTC_USD / 1e18 - IBorrowAccount(acct).debt();
        address bot = makeAddr("mevBot");
        vm.prank(bot);
        (uint256 seized,, uint256 profit) = liquidator.liquidate(acct, 0, Venue.CL200, 0);
        skipOracle.setAnswer(int256(BTC_USD)); // Skip corrects next block
        uint256 left = IBorrowAccount(acct).collateral() * BTC_USD / 1e18;
        assertEq(IBorrowAccount(acct).debt(), 0, "debt repaid out of seized collateral");
        assertLt(left * 2, equityBefore, "the victim kept under half its equity");
        emit log_named_decimal_uint("victim equity before (MUSD at the true price)", equityBefore, 18);
        emit log_named_decimal_uint("victim equity after", left, 18);
        emit log_named_decimal_uint("BTC seized", seized, 18);
        emit log_named_decimal_uint("liquidator profit (MUSD)", profit, 18);
    }

    function test_R3E_3b_skipMisprintElevenMinutesAfterPythPush_overBorrowIntoBadDebt() public {
        // vMUSD is M1's lender (15k supplied through the allocator role, as the buffer policy does over time).
        uint256 lenderShares = _depositVault(lender, 30_000e18);
        vm.startPrank(address(allocator));
        vault.deallocate(address(liq), "", 15_000e18);
        vault.allocate(address(mm), abi.encode(params), 15_000e18);
        vm.stopPrank();
        uint256 lenderBefore = vault.previewRedeem(lenderShares);
        uint256 t0 = vm.getBlockTimestamp();
        _setPyth(BTC_USD, t0);
        vm.warp(t0 + 11 minutes);
        vm.roll(vm.getBlockNumber() + 165);

        // Skip misprints +50% for a block.
        skipOracle.setAnswer(int256(BTC_USD * 3 / 2));
        IBtcMusdOracle.Status memory s = oracle.status();
        assertTrue(s.ok, "the oracle prices: the band is off");
        _assertOldBandWouldReject(s);

        // The borrower opens at the STANDARD ceiling of the misprinted price (position cap 0.1 BTC).
        address att = makeAddr("overBorrower");
        uint256 out = _maxOut(0.1e18, CEILING);
        vm.deal(att, 0.1e18);
        vm.prank(att);
        address acct = factory.openAndBorrow{value: 0.1e18}(out, CEILING);
        assertEq(musd.balanceOf(att), out);

        // Skip corrects; the position is under water and liquidates with bad debt that M1's suppliers (vMUSD) absorb.
        _nextBlock();
        skipOracle.setAnswer(int256(BTC_USD));
        uint256 debt = IBorrowAccount(acct).debt();
        uint256 btcValue = 0.1e18 * BTC_USD / 1e18;
        assertGt(debt, btcValue * 1e18 / liquidator.LIQUIDATION_INCENTIVE_FACTOR(), "LTV beyond 1/LIF: bad debt");
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.CL200, 0);
        uint256 lenderAfter = vault.previewRedeem(lenderShares);
        assertGt(out, btcValue, "the borrower kept more MUSD than its BTC was worth");
        assertLt(lenderAfter + 500e18, lenderBefore, "vMUSD lenders absorbed the bad debt");
        emit log_named_decimal_uint("MUSD borrowed against 0.1 BTC", out, 18);
        emit log_named_decimal_uint("true value of the 0.1 BTC", btcValue, 18);
        emit log_named_decimal_uint("borrower profit", out - btcValue, 18);
        emit log_named_decimal_uint("vMUSD lenders' loss", lenderBefore - lenderAfter, 18);
    }

    /// @dev The round-1 rule (band on while Pyth BTC is at most PYTH_MAX_AGE = 3,900 s old) reverts `PythDeviation`.
    function _assertOldBandWouldReject(IBtcMusdOracle.Status memory s) internal view {
        assertGt(s.pythBtcAge, oracle.PYTH_BTC_BAND_MAX_AGE(), "past the new 600 s band");
        assertLe(s.pythBtcAge, oracle.PYTH_MAX_AGE(), "within the old 3,900 s band");
        assertGt(s.deviationBps, oracle.MAX_DEV_BPS(), "a band breach");
    }
}
