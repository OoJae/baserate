// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {VaultBase} from "./VaultBase.t.sol";

/// @notice BaserateAllocator policy: buffer, APY rule, bounds, caps, checkpoints and the withdraw helpers.
contract BaserateAllocatorTest is VaultBase {
    using MarketParamsLib for MarketParams;

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
        assertEq(allocator.readyAt(), 0);
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

        vm.expectEmit(true, false, false, false, address(allocator));
        emit IBaserateAllocator.Rebalanced(IBaserateAllocator.Action.BUFFER_TOP_UP, 0, 0, 0, 0, 0, 0);
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();

        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 500e18);
        assertEq(_m1Liquidity(), 2000e18, "buffer restored");
        assertApproxEqAbs(_vaultM1(), 500e18, 1, "vault supplied the deficit");
        assertEq(allocator.lastRebalance(), block.timestamp);
    }

    function test_rebalance_bufferTopUp_noHistoryNeeded_andBoundedPerCall() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2900e18); // liquidity 100: needs 1,900
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, allocator.MAX_MOVE(), "bounded per call");

        vm.expectRevert(abi.encodeWithSelector(IBaserateAllocator.CooldownActive.selector, block.timestamp + 1 hours));
        allocator.rebalance();

        skip(1 hours);
        (action, amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertApproxEqAbs(_m1Liquidity(), 2000e18, 1, "buffer restored on the second call");
        assertGe(_m1Liquidity(), _bufferTarget() - 1);
    }

    function test_rebalance_bufferTargetIs15PercentOfSupply() public {
        // Large M1: 20k supplied by the team, 18k borrowed -> target 15% of supply (> 2k floor).
        _fundApprove(team, 17_000e18, address(morpho));
        vm.prank(team);
        morpho.supply(params, 17_000e18, 0, team, "");
        _deposit(lender, 50_000e18);
        _borrow(borrower, 17_500e18); // supply 20k, liquidity 2.5k, target 3k
        (IBaserateAllocator.Action action, uint256 amount) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        // (0.15 * 20,000 - 2,500) / 0.85 = 588.23...
        assertEq(amount, 588_235_294_117_647_058_824);
        assertGe(_m1Liquidity(), _bufferTarget(), "target met after the move");
    }

    function test_borrower_canBorrowFromBuffer() public {
        _deposit(lender, 10_000e18);
        _borrow(borrower, 2900e18);
        _rebalance();
        skip(1 hours);
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
        vm.prank(stranger);
        vault.forceDeallocate(address(liq), "", 600e18, stranger);
        assertEq(musd.balanceOf(address(vault)), 600e18);

        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.IdleAllocated(600e18);
        (IBaserateAllocator.Action action,) = _rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_bufferTopUp_usesVaultIdleFirst() public {
        _deposit(lender, 1000e18);
        vm.prank(stranger);
        vault.forceDeallocate(address(liq), "", 600e18, stranger);
        _borrow(borrower, 1500e18);
        uint256 heldBefore = liq.heldAssets();
        (, uint256 amount) = _rebalance();
        assertEq(amount, 500e18);
        assertEq(musd.balanceOf(address(vault)), 0, "rest of the idle parked");
        assertApproxEqAbs(liq.heldAssets(), heldBefore + 100e18, 2, "500 of the 600 idle went to M1");
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
