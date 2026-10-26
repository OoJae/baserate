// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {IMorpho} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {VaultBase} from "./VaultBase.t.sol";

/// @notice BaserateAllocator policy: buffer, APY rule (trailing direction, spot sizing, same-block guard, conservative
/// liquidity), bounds, caps, checkpoints and the withdraw helpers (including the M1-first retry).
contract BaserateAllocatorTest is VaultBase {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant YEAR = 365 days;

    // ---------------------------------------------------------------- helpers

    /// @dev Makes wsMUSD's trailing APY exactly `apy` (WAD) by mocking the current `convertToAssets(1e18)` against the
    /// reference checkpoint the allocator will use (history must be shorter than 7 days: the oldest one).
    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = block.timestamp - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (YEAR * 1e18);
        vm.mockCall(address(ws), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }

    function _rebalance() internal returns (IBaserateAllocator.Action action, uint256 amount) {
        (action, amount) = allocator.rebalance();
    }

    /// @dev Supplies `amount` MUSD to M1 directly (an outside lender).
    function _supplyM1(address who, uint256 amount) internal {
        _fundApprove(who, amount, address(morpho));
        vm.prank(who);
        morpho.supply(params, amount, 0, who, "");
    }

    /// @dev M1's supply-share price as the allocator checkpoints it: MUSD wei per 1e24 shares.
    function _m1Price() internal view returns (uint256) {
        (uint256 supply, uint256 shares,,) = morpho.expectedMarketBalances(params);
        return (supply + 1) * 1e24 / (shares + 1e6);
    }

    /// @dev Moves to the next block (a later timestamp), so M1 counts as untouched in it.
    function _nextBlock() internal {
        skip(12);
        vm.roll(block.number + 1);
    }

    /// @dev Lender liquidity in the vault, one day of checkpoints, and `borrowed` MUSD drawn from M1.
    function _scenario(uint256 deposit, uint256 borrowed) internal {
        _deposit(lender, deposit);
        if (borrowed != 0) _borrow(borrower, borrowed);
        _advanceWithCheckpoints(1 days);
    }

    // ---------------------------------------------------------------- construction

    function test_constructor_wiring() public view {
        assertEq(allocator.VAULT(), address(vault));
        assertEq(allocator.LIQUIDITY_ADAPTER(), address(liq));
        assertEq(allocator.MARKET_ADAPTER(), address(mm));
        assertEq(allocator.MORPHO(), address(morpho));
        assertEq(allocator.WSMUSD(), address(ws));
        assertEq(allocator.MUSD(), address(musd));
        assertEq(allocator.MARKET_ID(), Id.unwrap(marketId));
        MarketParams memory p = allocator.marketParams();
        assertEq(Id.unwrap(p.id()), Id.unwrap(marketId));
        assertTrue(vault.isAllocator(address(allocator)));
        assertEq(allocator.checkpointCount(), 1, "deployment checkpoint");
        assertEq(allocator.checkpointAt(0).timestamp, block.timestamp);
        assertEq(allocator.checkpointAt(0).sharePrice, ws.convertToAssets(1e18));
        assertEq(allocator.checkpointAt(0).m1SharePrice, 1e18, "M1 supply-share price at par");
        assertEq(allocator.checkpointAt(0).m1ExternalLiquidity, int128(int256(TEAM_SUPPLY)), "team supply, no borrow");
        assertEq(allocator.readyAt(), 0);
        assertEq(allocator.LIQUIDITY_WINDOW(), 1 days);
    }

    function test_constructor_validation() public {
        vm.expectRevert(IBaserateAllocator.ZeroAddress.selector);
        new BaserateAllocator(address(0), address(liq), address(mm), params);

        WsMusdLiquidityAdapter otherLiq = new WsMusdLiquidityAdapter(
            IVaultV2FactoryLike(vaultFactory).createVaultV2(curator, address(musd), bytes32(uint256(7))), address(ws)
        );
        vm.expectRevert(IBaserateAllocator.AdapterMismatch.selector);
        new BaserateAllocator(address(vault), address(otherLiq), address(mm), params);

        MarketParams memory bad = params;
        bad.loanToken = address(collateral);
        vm.expectRevert(IBaserateAllocator.AssetMismatch.selector);
        new BaserateAllocator(address(vault), address(liq), address(mm), bad);

        bad = params;
        bad.irm = address(0xBEEF);
        vm.expectRevert(IBaserateAllocator.IrmMismatch.selector);
        new BaserateAllocator(address(vault), address(liq), address(mm), bad);

        bad = params;
        bad.lltv = 0.5e18;
        vm.expectRevert(IBaserateAllocator.MarketNotCreated.selector);
        new BaserateAllocator(address(vault), address(liq), address(mm), bad);
    }

    // ---------------------------------------------------------------- checkpoints

    function test_checkpoint_atMostHourly() public {
        assertFalse(allocator.checkpoint(), "same block");
        skip(59 minutes);
        assertFalse(allocator.checkpoint(), "within the hour");
        skip(1 minutes);
        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.CheckpointRecorded(1, uint64(block.timestamp), ws.convertToAssets(1e18));
        assertTrue(allocator.checkpoint());
        assertEq(allocator.checkpointCount(), 2);
    }

    function test_checkpoint_ringBufferKeepsNewest() public {
        uint256 capacity = allocator.CHECKPOINT_CAPACITY();
        _advanceWithCheckpoints((capacity + 10) * 1 hours);
        uint256 count = allocator.checkpointCount();
        assertEq(count, capacity + 11);
        IBaserateAllocator.Checkpoint memory oldest = allocator.checkpointAt(0);
        IBaserateAllocator.Checkpoint memory newest = allocator.checkpointAt(capacity - 1);
        assertEq(newest.timestamp, block.timestamp, "newest is now");
        assertEq(newest.timestamp - oldest.timestamp, (capacity - 1) * 1 hours, "contiguous hourly");
        vm.expectRevert(abi.encodeWithSelector(IBaserateAllocator.IndexOutOfRange.selector, capacity, capacity));
        allocator.checkpointAt(capacity);
    }

    function test_wsMusdApy_usesSevenDayWindow() public {
        _deposit(lender, 10_000e18);
        _wsYield(10e18);
        _advanceWithCheckpoints(8 days);
        (uint256 apy, uint256 window) = allocator.wsMusdApy();
        assertEq(window, 7 days, "checkpoint exactly 7 days back");
        assertGt(apy, 0, "positive");
    }

    function test_wsMusdApy_matchesSharePriceGrowth() public {
        _deposit(lender, 10_000e18);
        _wsYield(30e18); // vests linearly over 3 days
        _advanceWithCheckpoints(2 days);
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 p = ws.convertToAssets(1e18);
        (uint256 apy, uint256 window) = allocator.wsMusdApy();
        assertEq(window, 2 days, "oldest checkpoint while history < 7 days");
        assertEq(apy, (p - c.sharePrice) * 1e18 * YEAR / (uint256(c.sharePrice) * window));
        // ~30/10,101 over 3 days, annualized: ~36%.
        assertApproxEqRel(apy, 0.3613e18, 0.01e18);
    }

    function test_wsMusdApy_zeroWithoutGrowth() public view {
        (uint256 apy, uint256 window) = allocator.wsMusdApy();
        assertEq(apy, 0);
        assertEq(window, 0);
    }

    // ---------------------------------------------------------------- buffer

    function test_rebalance_topsUpBuffer() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 1500e18); // M1 liquidity 1,500 < 2,000 floor
        assertEq(_m1Liquidity(), 1500e18);
        _nextBlock(); // the borrow is from an earlier block

        vm.expectEmit(true, false, false, false, address(allocator));
        emit IBaserateAllocator.Rebalanced(IBaserateAllocator.Action.BUFFER_TOP_UP, 0, 0, 0, 0, 0, 0);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();

        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 500e18);
        assertEq(_m1Liquidity(), 2000e18, "buffer restored");
        assertApproxEqAbs(_vaultM1(), 500e18, 1, "vault supplied the deficit");
        assertEq(allocator.lastRebalance(), 0, "a top-up does not start the cooldown");
        assertEq(allocator.lastTopUpAt(), block.timestamp);
        assertEq(allocator.readyAt(), 0);
    }

    function test_rebalance_bufferTopUp_noHistoryNeeded_andBoundedPerCall() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2900e18); // liquidity 100: needs 1,900
        _nextBlock();
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, allocator.MAX_MOVE(), "bounded per call");

        // At most one top-up per block (R2X-3)...
        (IBaserateAllocator.Action pending,,) = allocator.previewRebalance();
        assertEq(uint256(pending), uint256(IBaserateAllocator.Action.NONE), "preview: none left in this block");
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "second call in the block");
        assertEq(amount, 0);

        // ...but no cooldown: the next block closes the rest of the deficit.
        _nextBlock();
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertApproxEqAbs(amount, 900e18, 1);
        assertApproxEqAbs(_m1Liquidity(), 2000e18, 1, "buffer restored on the second call");
        assertGe(_m1Liquidity(), _bufferTarget() - 1);
        _nextBlock();
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "nothing left");
    }

    function test_rebalance_bufferTopUp_ignoresCooldownOfARateMove() public {
        _scenario(10_000e18, 1000e18);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        uint256 cooldownEnd = block.timestamp + 1 hours;
        assertEq(allocator.readyAt(), cooldownEnd);

        // Borrowers drain M1 below the buffer during the cooldown.
        _nextBlock();
        _borrow(makeAddr("big"), _m1Liquidity() - 500e18);
        assertLt(_m1Liquidity(), _bufferTarget());
        _nextBlock();
        assertEq(allocator.readyAt(), block.timestamp, "a due top-up is ready now");

        uint256 amount;
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 1000e18);
        _nextBlock();
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertGe(_m1Liquidity(), _bufferTarget(), "buffer restored inside the cooldown");
        assertEq(allocator.readyAt(), cooldownEnd, "top-ups leave the rate cooldown alone");

        // Nothing left to top up: rate moves still wait for the cooldown.
        _nextBlock();
        vm.expectRevert(abi.encodeWithSelector(IBaserateAllocator.CooldownActive.selector, cooldownEnd));
        allocator.rebalance();
    }

    function test_rebalance_bufferTargetIs15PercentOfSupply() public {
        // Large M1: 20k supplied by the team, 17.5k borrowed -> target 15% of supply (> 2k floor).
        _fundApprove(team, 17_000e18, address(morpho));
        vm.prank(team);
        morpho.supply(params, 17_000e18, 0, team, "");
        _deposit(lender, 50_000e18);
        _borrow(borrower, 17_500e18); // supply 20k, liquidity 2.5k, target 3k
        _nextBlock(); // the borrow is from an earlier block; 12 s of interest raise supply (and so the target)
        (uint256 supply, uint256 borrowed) = _market();
        uint256 liquidity = supply - borrowed;
        assertEq(liquidity, 2500e18, "interest raises supply and borrow alike");
        // x = (0.15 S - L) / 0.85, rounded up, on M1 accrued to now.
        uint256 expected = (supply * 1500 - liquidity * 10_000 + 8499) / 8500;

        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, expected, "closes the 15% deficit exactly");
        // (0.15 * 20,000 - 2,500) / 0.85 = 588.23..., plus 15/85 of the 12 s of interest.
        assertApproxEqRel(amount, 588_235_294_117_647_058_824, 1e12);
        assertGe(_m1Liquidity(), _bufferTarget(), "target met after the move");
    }

    /// @notice R2X-3: in a block where M1 was touched first, a top-up is sized on the larger of spot and the last
    /// checkpoint, so a transient low (a borrow or withdrawal undone later in the same transaction) cannot trigger
    /// one. A low that a checkpoint has recorded is still topped up, even when someone touches M1 first.
    function test_rebalance_topUp_touchedBlock_sizedOnLastCheckpoint() public {
        _deposit(lender, 10_000e18);
        _nextBlock();

        // A borrow earlier in the block leaves M1 short of the buffer on spot; it may be repaid in the same transaction.
        _borrow(borrower, 1500e18);
        (IBaserateAllocator.Action action, uint256 amount, IBaserateAllocator.Snapshot memory s) =
            allocator.previewRebalance();
        assertTrue(s.marketTouched);
        assertEq(s.m1Liquidity, 1500e18, "spot: below the 2,000 floor");
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "sized on the checkpoint's 3,000");
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(amount, 0);
        assertEq(_vaultM1(), 0, "nothing supplied on a possibly transient low");
        assertEq(allocator.lastTopUpAt(), 0);

        // The borrow stays. Until a checkpoint records it, a block in which M1 is touched first still waits...
        _nextBlock();
        morpho.accrueInterest(params);
        (action,,) = allocator.previewRebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "the last checkpoint still says 3,000");

        // ...an hour later a checkpoint taken in a block nobody touched M1 in records the real low...
        skip(1 hours);
        vm.roll(block.number + 1);
        assertTrue(allocator.checkpoint());
        assertEq(allocator.checkpointAt(1).m1ExternalLiquidity, int128(1500e18), "real low recorded");

        // ...and from then on the top-up runs even in a block where M1 is touched first (a bare accrual here).
        _nextBlock();
        morpho.accrueInterest(params);
        (action, amount, s) = allocator.previewRebalance();
        assertTrue(s.marketTouched);
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 500e18);
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 500e18);
        assertEq(_m1Liquidity(), 2000e18, "buffer restored");
        assertEq(allocator.lastTopUpAt(), block.timestamp);
    }

    function test_borrower_canBorrowFromBuffer() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2900e18);
        _nextBlock();
        _rebalance();
        _nextBlock();
        _rebalance();
        // A new borrower can take the whole standing buffer.
        address other = makeAddr("other");
        _borrow(other, 1999e18);
        assertEq(musdBalance(other), 1999e18);
    }

    function musdBalance(address who) internal view returns (uint256) {
        return musd.balanceOf(who);
    }

    // ---------------------------------------------------------------- APY rule

    function test_rebalance_noApyMoveWithoutHistory() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 1000e18); // M1 pays, buffer fine
        skip(2 hours);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "needs a day of wsMUSD history");
        assertEq(amount, 0);
        assertEq(allocator.lastRebalance(), 0, "no-op does not start the cooldown");
    }

    function test_m1TrailingApy_isSupplySharePriceGrowth() public {
        _scenario(10_000e18, 1000e18);
        _advanceWithCheckpoints(1 days);
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        (uint256 apy, uint256 window) = allocator.m1TrailingApy();
        (, uint256 wsWindow) = allocator.wsMusdApy();
        assertEq(window, 2 days);
        assertEq(window, wsWindow, "same reference checkpoint as wsMUSD");
        assertEq(apy, (_m1Price() - c.m1SharePrice) * 1e18 * YEAR / (uint256(c.m1SharePrice) * window));
        assertGt(apy, 0, "borrowers paid interest");
        // Utilization was steady, so the realized rate tracks the spot model.
        assertApproxEqRel(apy, allocator.m1SupplyApy(), 0.1e18);
    }

    function test_checkpoint_recordsM1SharePriceAndExternalLiquidity() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 1000e18);
        skip(1 hours);
        assertTrue(allocator.checkpoint());
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(1);
        assertEq(c.m1SharePrice, _m1Price());
        assertEq(c.m1ExternalLiquidity, int128(int256(_m1Liquidity() - _vaultM1())), "supply - borrow - vMUSD");
    }

    function test_checkpoint_inTouchedBlock_carriesTheLastValueForward() public {
        skip(1 hours);
        // An outside supply earlier in the block may be transient: the checkpoint keeps the previous value.
        _supplyM1(stranger, 10_000e18);
        assertTrue(allocator.checkpoint());
        assertEq(allocator.checkpointAt(1).m1ExternalLiquidity, int128(int256(TEAM_SUPPLY)));
        // An hour later, in a block nobody touched M1 in, the supply counts.
        skip(1 hours);
        assertTrue(allocator.checkpoint());
        assertEq(allocator.checkpointAt(2).m1ExternalLiquidity, int128(int256(TEAM_SUPPLY + 10_000e18)));

        // A lower value in a touched block may be transient too (borrow, checkpoint, repay; R2V-3): carried forward.
        skip(1 hours);
        _borrow(borrower, 5000e18);
        assertTrue(allocator.checkpoint());
        assertEq(allocator.checkpointAt(3).m1ExternalLiquidity, int128(int256(TEAM_SUPPLY + 10_000e18)));
        // The share prices are still recorded as usual.
        assertEq(allocator.checkpointAt(3).m1SharePrice, _m1Price());
        assertEq(allocator.checkpointAt(3).timestamp, block.timestamp);

        // The borrow stayed: the next untouched checkpoint records it.
        skip(1 hours);
        vm.roll(block.number + 1);
        assertTrue(allocator.checkpoint());
        assertApproxEqAbs(
            allocator.checkpointAt(4).m1ExternalLiquidity, int128(int256(TEAM_SUPPLY + 5000e18)), 1e15, "real low"
        );
    }

    function test_rebalance_noRateMoveWhenM1TouchedEarlierInTheBlock() public {
        _scenario(10_000e18, 1000e18);
        (IBaserateAllocator.Action honest,,) = allocator.previewRebalance();
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.TO_MARKET));

        // Any M1 interaction earlier in the block (here a bare accrual) may have left transient totals.
        morpho.accrueInterest(params);
        (IBaserateAllocator.Action action, uint256 amount, IBaserateAllocator.Snapshot memory s) =
            allocator.previewRebalance();
        assertTrue(s.marketTouched);
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(amount, 0);
        assertEq(_vaultM1(), 0);
        assertEq(allocator.lastRebalance(), 0, "no cooldown started");

        _nextBlock();
        (action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET), "next block");
    }

    function test_rebalance_noToMarket_whenSpotDisagreesWithTrailing() public {
        _scenario(10_000e18, 1000e18);
        (uint256 trailing,) = allocator.m1TrailingApy();
        // The borrower repays in full: M1 now pays nothing, although its trailing rate is still positive.
        musd.mint(borrower, 100e18); // the interest
        vm.startPrank(borrower);
        musd.approve(address(morpho), type(uint256).max);
        morpho.repay(params, 0, morpho.position(marketId, borrower).borrowShares, borrower, "");
        vm.stopPrank();
        _nextBlock();
        _mockWsApy(trailing / 2);
        IBaserateAllocator.Snapshot memory s = allocator.snapshot();
        assertGt(s.m1TrailingApy, s.wsMusdApy, "trailing says M1");
        assertEq(s.m1SupplyApy, 0, "spot says nothing");
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
    }

    function test_rebalance_noToLiquidity_whenSpotDisagreesWithTrailing() public {
        _withM1Position();
        // A fresh large borrow lifts the spot rate far above the trailing one (buffer still met).
        _borrow(makeAddr("big"), 2500e18);
        assertGe(_m1Liquidity(), _bufferTarget());
        _nextBlock();
        (uint256 trailing,) = allocator.m1TrailingApy();
        uint256 spot = allocator.m1SupplyApy();
        assertGt(spot, trailing * 2);
        _mockWsApy((trailing + spot) / 2);
        IBaserateAllocator.Snapshot memory s = allocator.snapshot();
        assertLt(s.m1TrailingApy, s.wsMusdApy, "trailing says wsMUSD");
        assertGt(s.m1SupplyApy, s.wsMusdApy, "spot says M1");
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
    }

    function test_rebalance_toLiquidity_ignoresOutsideSupplyFromTheLastDay() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2000e18); // liquidity 1,000
        _nextBlock();
        _rebalance(); // top-up 1,000: vMUSD holds 1,000 of M1, liquidity at the 2,000 floor
        _advanceWithCheckpoints(1 days);
        // A real outside lender arrives; on spot M1 now has 10,000 to spare.
        _supplyM1(stranger, 10_000e18);
        _nextBlock();
        _mockWsApy(0.5e18);
        IBaserateAllocator.Snapshot memory s = allocator.snapshot();
        assertApproxEqAbs(s.m1Liquidity, 12_000e18, 1e15);
        assertApproxEqAbs(s.conservativeLiquidity, 2000e18, 1e15, "without the outside supply");
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "nothing above the conservative buffer");

        // Once the supply has stayed for a full day of checkpoints, it counts.
        _advanceWithCheckpoints(1 days + 1 hours);
        _mockWsApy(0.5e18);
        s = allocator.snapshot();
        assertApproxEqAbs(s.conservativeLiquidity, s.m1Liquidity, 1e15);
        uint256 amount;
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY));
        assertEq(amount, allocator.MAX_MOVE());
        assertLt(_vaultM1(), 1e18, "vMUSD's M1 position is back in wsMUSD (interest aside)");
    }

    function test_rebalance_movesToMarket_whenM1PaysMore() public {
        _scenario(10_000e18, 1000e18);
        uint256 m1Apy = allocator.m1SupplyApy();
        (uint256 wsApy,) = allocator.wsMusdApy();
        assertGt(m1Apy, wsApy, "M1 pays more");

        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        assertEq(amount, allocator.MAX_MOVE());
        assertApproxEqAbs(_vaultM1(), 1000e18, 1);
    }

    function test_rebalance_staysInWsMusd_whenItPaysMore() public {
        _scenario(10_000e18, 1000e18);
        _mockWsApy(allocator.m1SupplyApy() * 2);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "no M1 position to pull, nothing to add");
        assertEq(amount, 0);
        assertEq(_vaultM1(), 0);
    }

    function test_rebalance_toMarket_bisectsToNotOvershoot() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 1000e18);
        _advanceWithCheckpoints(1 days);
        uint256 m1Apy = allocator.m1SupplyApy();
        uint256 wsApy = m1Apy * 80 / 100; // adding 1,000 MUSD would push M1 below this
        _mockWsApy(wsApy);

        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        assertGt(amount, 0);
        assertLt(amount, allocator.MAX_MOVE(), "partial move");
        assertGt(allocator.m1SupplyApy(), wsApy, "M1 still pays more after the move");
    }

    function test_rebalance_toLiquidity_whenWsPaysMore_keepsBuffer() public {
        _scenario(10_000e18, 1000e18);
        // Build an M1 position: three TO_MARKET moves.
        for (uint256 i; i < 3; ++i) {
            _rebalance();
            skip(1 hours);
        }
        uint256 vaultM1Before = _vaultM1();
        assertApproxEqRel(vaultM1Before, 3000e18, 0.0001e18, "three moves plus interest");

        _mockWsApy(0.5e18);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY));
        assertEq(amount, allocator.MAX_MOVE());
        assertApproxEqAbs(_vaultM1(), vaultM1Before - amount, 2);
        assertGe(_m1Liquidity(), _bufferTarget(), "never below the buffer");

        // Keep pulling until only the buffer is left.
        for (uint256 i; i < 5; ++i) {
            skip(1 hours);
            _mockWsApy(0.5e18);
            _rebalance();
        }
        // Supply 3,000 team + vault, borrow 1,000: liquidity stays at the 2,000 floor.
        assertApproxEqAbs(_m1Liquidity(), 2000e18, 1e18);
        assertGe(_m1Liquidity(), 2000e18);
    }

    function test_rebalance_toLiquidity_neverBelowBuffer_fuzz(uint256 borrowed, uint256 position) public {
        borrowed = bound(borrowed, 0, 2900e18);
        position = bound(position, 1, 3);
        _scenario(20_000e18, borrowed);
        for (uint256 i; i < position; ++i) {
            try allocator.rebalance() {} catch {}
            skip(1 hours);
        }
        _mockWsApy(5e18);
        try allocator.rebalance() returns (IBaserateAllocator.Action action, uint256) {
            if (action == IBaserateAllocator.Action.TO_LIQUIDITY) {
                assertGe(_m1Liquidity(), _bufferTarget(), "buffer kept");
            }
        } catch {}
    }

    // ---------------------------------------------------------------- caps

    function test_rebalance_respectsAbsoluteCap() public {
        _scenario(10_000e18, 1000e18);
        bytes32[4] memory ids = _ids();
        bytes[4] memory data = _idData(cfg, _deployment());
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[2], 300e18); // this/marketParams

        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        assertEq(amount, 300e18);
        assertLe(vault.allocation(ids[2]), vault.absoluteCap(ids[2]));

        // Interest accrues on the position; the next move stays under the cap net of it.
        _borrow(makeAddr("b2"), 1500e18);
        skip(30 days);
        (action, amount) = _rebalance();
        for (uint256 i; i < 3; ++i) {
            assertLe(vault.allocation(ids[i]), vault.absoluteCap(ids[i]), "cap respected");
        }
    }

    function test_rebalance_zeroCap_blocksMarketMoves() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2000e18); // buffer deficit
        _nextBlock();
        bytes[4] memory data = _idData(cfg, _deployment());
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[1], 0); // collateralToken id
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(amount, 0);
    }

    function test_rebalance_respectsRelativeCap() public {
        _scenario(10_000e18, 1000e18);
        bytes32[4] memory ids = _ids();
        bytes[4] memory data = _idData(cfg, _deployment());
        vm.prank(curator);
        vault.decreaseRelativeCap(data[0], 0.05e18); // 5% of ~10.1k
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        assertApproxEqAbs(amount, vault.totalAssets() * 5 / 100, 1e15);
        assertLe(vault.allocation(ids[0]), vault.totalAssets() * 5 / 100 + 1);
    }

    function test_rebalance_respectsLiquidityAdapterCap() public {
        _scenario(10_000e18, 1000e18);
        for (uint256 i; i < 2; ++i) {
            _rebalance();
            skip(1 hours);
        }
        bytes32 wsId = liq.adapterId();
        bytes[4] memory data = _idData(cfg, _deployment());
        uint256 held = liq.heldAssets();
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[3], held + 200e18);
        _mockWsApy(0.5e18);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY));
        assertLe(amount, 200e18);
        assertLe(vault.allocation(wsId), vault.absoluteCap(wsId));
    }

    // ---------------------------------------------------------------- idle sweep and preview

    function test_rebalance_parksVaultIdle() public {
        _deposit(lender, 1000e18);
        vm.prank(curator); // a sentinel deallocation
        vault.deallocate(address(liq), "", 600e18);
        assertEq(musd.balanceOf(address(vault)), 600e18);

        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.IdleAllocated(600e18);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_bufferTopUp_usesVaultIdleFirst() public {
        _deposit(lender, 1000e18);
        vm.prank(curator); // a sentinel deallocation
        vault.deallocate(address(liq), "", 600e18);
        _borrow(borrower, 1500e18);
        _nextBlock();
        uint256 heldBefore = liq.heldAssets();
        (, uint256 amount) = _rebalance();
        assertEq(amount, 500e18);
        assertEq(musd.balanceOf(address(vault)), 0, "rest of the idle parked");
        assertApproxEqAbs(liq.heldAssets(), heldBefore + 100e18, 2, "500 of the 600 idle went to M1");
    }

    /// @notice R2X-4: idle vault MUSD is parked even during the cooldown of a rate-driven move. The pending move is
    /// skipped (`NONE`) instead of the whole call reverting, and `readyAt()` tells the keeper to call now.
    function test_rebalance_parksIdleDuringCooldown() public {
        _scenario(10_000e18, 1000e18);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        uint64 movedAt = allocator.lastRebalance();
        uint256 cooldownEnd = uint256(movedAt) + 1 hours;

        // A sentinel deallocation leaves MUSD idle in the vault during the cooldown.
        _nextBlock();
        vm.prank(curator);
        vault.deallocate(address(liq), "", 600e18);
        assertEq(musd.balanceOf(address(vault)), 600e18);
        assertEq(allocator.readyAt(), block.timestamp, "idle to park: ready now");
        (IBaserateAllocator.Action pending,,) = allocator.previewRebalance();
        assertEq(uint256(pending), uint256(IBaserateAllocator.Action.TO_MARKET), "a rate move is pending");

        uint256 heldBefore = liq.heldAssets();
        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.IdleAllocated(600e18);
        uint256 amount;
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "the rate move waits");
        assertEq(amount, 0);
        assertEq(musd.balanceOf(address(vault)), 0, "the idle MUSD does not");
        assertApproxEqAbs(liq.heldAssets(), heldBefore + 600e18, 2);
        assertEq(allocator.lastRebalance(), movedAt, "the cooldown is unchanged");
        assertEq(allocator.readyAt(), cooldownEnd, "nothing left to park");
    }

    function test_rebalance_cooldownWithoutIdle_reverts() public {
        _scenario(10_000e18, 1000e18);
        _rebalance(); // TO_MARKET starts the cooldown
        uint256 cooldownEnd = uint256(allocator.lastRebalance()) + 1 hours;
        _nextBlock();
        assertEq(musd.balanceOf(address(vault)), 0, "nothing idle");
        assertEq(allocator.readyAt(), cooldownEnd);
        vm.expectRevert(abi.encodeWithSelector(IBaserateAllocator.CooldownActive.selector, cooldownEnd));
        allocator.rebalance();

        // Idle dust under MIN_MOVE is not worth a call: still the cooldown.
        vm.prank(curator);
        vault.deallocate(address(liq), "", 0.5e18);
        assertEq(allocator.readyAt(), cooldownEnd, "dust does not make it ready");
        vm.expectRevert(abi.encodeWithSelector(IBaserateAllocator.CooldownActive.selector, cooldownEnd));
        allocator.rebalance();

        // Once the cooldown ends, the pending rate move runs.
        vm.warp(cooldownEnd);
        vm.roll(block.number + 1);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
    }

    function test_rebalance_parkIdle_respectsLiquidityCap() public {
        _deposit(lender, 1000e18);
        vm.prank(curator); // a sentinel deallocation
        vault.deallocate(address(liq), "", 600e18);
        bytes32 wsId = liq.adapterId();
        bytes[4] memory data = _idData(cfg, _deployment());
        uint256 held = liq.heldAssets();
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[3], held + 200e18); // room for 200 of the 600 idle MUSD

        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.IdleAllocated(200e18);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(musd.balanceOf(address(vault)), 400e18, "the rest stays idle");
        assertLe(vault.allocation(wsId), vault.absoluteCap(wsId), "within the cap");

        // A zero cap parks nothing, and the call still succeeds.
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[3], 0);
        _nextBlock();
        (action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(musd.balanceOf(address(vault)), 400e18, "zero cap: nothing parked");
    }

    function test_previewRebalance_matchesRebalance() public {
        _scenario(10_000e18, 1000e18);
        (IBaserateAllocator.Action pAction, uint256 pAmount, IBaserateAllocator.Snapshot memory s) =
            allocator.previewRebalance();
        (uint256 supply, uint256 borrow) = _market();
        assertEq(s.m1BorrowAssets, borrow, "borrow, interest accrued to now");
        assertEq(s.m1SupplyAssets, supply, "supply, interest accrued to now");
        assertEq(s.bufferTarget, 2000e18);
        assertEq(s.apyWindow, 1 days);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(pAction));
        assertApproxEqRel(amount, pAmount, 0.01e18);
    }

    function test_snapshot_fields() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 1000e18);
        IBaserateAllocator.Snapshot memory s = allocator.snapshot();
        assertEq(s.m1SupplyAssets, 3000e18);
        assertEq(s.m1BorrowAssets, 1000e18);
        assertEq(s.m1Liquidity, 2000e18);
        assertEq(s.vaultMarketAssets, 0);
        assertEq(s.vaultIdle, 0);
        assertApproxEqAbs(s.liquidityAvailable, 10_100e18, 2);
        assertGt(s.m1SupplyApy, 0);
        assertEq(s.m1TrailingApy, 0, "no history yet");
        assertEq(s.conservativeLiquidity, 2000e18, "lowest of now and the deployment checkpoint");
        assertTrue(s.marketTouched, "the borrow touched M1 in this block");
    }

    // ---------------------------------------------------------------- withdraw helpers

    function _withM1Position() internal returns (uint256 shares) {
        shares = vault.balanceOf(lender);
        _scenario(10_000e18, 1000e18);
        shares = vault.balanceOf(lender);
        for (uint256 i; i < 3; ++i) {
            _rebalance();
            skip(1 hours);
        }
        assertApproxEqRel(_vaultM1(), 3000e18, 0.0001e18, "three moves plus interest");
    }

    function test_withdraw_usesWsMusdFirst() public {
        _withM1Position();
        uint256 m1Before = _vaultM1();
        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        allocator.withdraw(5000e18, lender);
        vm.stopPrank();
        assertEq(musd.balanceOf(lender), 5000e18);
        assertApproxEqAbs(_vaultM1(), m1Before, 1, "M1 untouched");
    }

    function test_withdraw_pullsShortfallFromM1() public {
        _withM1Position();
        uint256 m1Before = _vaultM1();
        uint256 liquid = liq.availableLiquidity(); // ~7,100
        uint256 want = liquid + 1000e18;

        vm.prank(lender);
        vm.expectRevert(); // the vault alone cannot reach M1
        vault.withdraw(want, lender, lender);

        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        vm.expectEmit(true, false, false, false, address(allocator));
        emit IBaserateAllocator.MarketLiquidityPulled(lender, 0);
        allocator.withdraw(want, lender);
        vm.stopPrank();

        assertEq(musd.balanceOf(lender), want);
        assertApproxEqAbs(m1Before - _vaultM1(), 1000e18, 2, "only the shortfall came from M1");
        assertLe(liq.availableLiquidity(), 2, "wsMUSD drained first");
    }

    function test_redeem_allShares_throughM1() public {
        uint256 shares = _withM1Position();
        vm.startPrank(lender);
        vault.approve(address(allocator), shares);
        uint256 assets = allocator.redeem(shares, lender);
        vm.stopPrank();
        assertApproxEqRel(assets, 10_000e18, 0.001e18);
        assertEq(vault.balanceOf(lender), 0);
    }

    function test_withdraw_requiresShareApproval() public {
        _withM1Position();
        vm.prank(lender);
        vm.expectRevert();
        allocator.withdraw(1000e18, lender);
    }

    function test_withdraw_retriesMarketFirst_whenWsMusdExitReverts() public {
        _withM1Position();
        smusd.setDisabled(false, true, false); // sMUSD withdraw reverts: the vault's wsMUSD leg cannot pay
        uint256 m1Before = _vaultM1();
        uint256 sharesBefore = vault.balanceOf(lender);
        uint256 fair = vault.previewWithdraw(800e18);

        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        vm.expectEmit(true, false, false, true, address(allocator));
        emit IBaserateAllocator.MarketLiquidityPulled(lender, 800e18);
        uint256 burnt = allocator.withdraw(800e18, lender);
        vm.stopPrank();

        assertEq(musd.balanceOf(lender), 800e18);
        assertApproxEqAbs(m1Before - _vaultM1(), 800e18, 2, "paid from M1");
        assertEq(burnt, fair, "no penalty");
        assertEq(sharesBefore - vault.balanceOf(lender), fair);
    }

    function test_redeem_retriesMarketFirst_whenWsMusdExitReverts() public {
        _withM1Position();
        smusd.setDisabled(false, true, false);
        uint256 shares = vault.previewWithdraw(500e18);
        uint256 expected = vault.previewRedeem(shares);
        vm.startPrank(lender);
        vault.approve(address(allocator), shares);
        uint256 assets = allocator.redeem(shares, lender);
        vm.stopPrank();
        assertEq(assets, expected);
        assertEq(musd.balanceOf(lender), expected);
    }

    function test_withdraw_marketFirst_isBoundedByM1Backing() public {
        _withM1Position();
        smusd.setDisabled(false, true, false);
        // More than vMUSD's M1 position: the rest would need wsMUSD, which cannot pay.
        uint256 want = _vaultM1() + 100e18;
        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        allocator.withdraw(want, lender);
        vm.stopPrank();
    }

    function test_withdraw_marketFirstRetry_unusedWhileWsMusdPays() public {
        _withM1Position();
        uint256 m1Before = _vaultM1();
        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        allocator.withdraw(800e18, lender);
        vm.stopPrank();
        assertApproxEqAbs(_vaultM1(), m1Before, 1, "wsMUSD paid, M1 untouched");
    }

    function test_forceDeallocate_market_chargesPenalty() public {
        _withM1Position();
        uint256 sharesBefore = vault.balanceOf(lender);
        uint256 expectedPenaltyShares = vault.previewWithdraw(5e18); // 0.5% of 1,000
        vm.prank(lender);
        uint256 penaltyShares = vault.forceDeallocate(address(mm), _marketData(), 1000e18, lender);
        assertApproxEqAbs(penaltyShares, expectedPenaltyShares, 1e9);
        assertEq(vault.balanceOf(lender), sharesBefore - penaltyShares);

        // A stranger without shares cannot force-deallocate M1 for free.
        vm.prank(stranger);
        vm.expectRevert();
        vault.forceDeallocate(address(mm), _marketData(), 100e18, stranger);
    }
}

interface IVaultV2FactoryLike {
    function createVaultV2(address owner, address asset, bytes32 salt) external returns (address);
}
