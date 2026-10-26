// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IWsMusdLiquidityAdapter} from "../../src/interfaces/IWsMusdLiquidityAdapter.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {VaultBase} from "../unit/VaultBase.t.sol";
import {WsMUSDBase} from "../unit/WsMUSDBase.t.sol";
import {FlashSupplyAttacker, TransientRepayBorrower} from "./VaultAuditHelpers.sol";

/// @notice Area B audit regressions on the vMUSD stack (VaultBase: real Morpho Blue + AdaptiveCurveIrm, a real VaultV2
/// configured by the deploy script's own `VaultSetup`, wsMUSD over SMUSDMock). Each test replays the original PoC and
/// asserts the fixed behaviour.
/// Run: FOUNDRY_OUT=out/fix-b FOUNDRY_CACHE_PATH=cache/fix-b forge test --match-path test/audit/VaultAudit.t.sol
contract VaultAuditAllocatorTest is VaultBase {
    uint256 internal constant YEAR = 365 days;

    FlashSupplyAttacker internal flash;

    function setUp() public override {
        super.setUp();
        flash = new FlashSupplyAttacker(
            morpho, IBaserateAllocator(address(allocator)), IERC20(address(musd)), allocator.marketParams()
        );
        // Stands in for any flash-loan / own-balance MUSD; it is supplied and withdrawn inside one call.
        musd.mint(address(flash), 40_000e18);
    }

    /// @dev Honest steady state: 20k lent through vMUSD, 2.9k borrowed from M1, two buffer top-ups (vMUSD supplies
    /// 1.9k to M1, M1 liquidity exactly at the 2k floor), a small real wsMUSD yield and one day of checkpoints.
    function _steadyState() internal {
        _deposit(lender, 20_000e18);
        _wsYield(1e18);
        _borrow(borrower, 2900e18);
        // Top-ups need no cooldown, but run at most once per block, on M1 state left by earlier blocks (R2X-3).
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

    /// @dev Makes wsMUSD's trailing APY exactly `apy` (history shorter than 7 days: the oldest checkpoint).
    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = block.timestamp - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (YEAR * 1e18);
        vm.mockCall(address(ws), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }

    // =============================================================================================================
    // B-1 (fixed): a transient M1 supply or repay can no longer flip the allocator's policy or drain the buffer
    // =============================================================================================================

    function test_fix_B1_transientSupply_cannotMoveFundsOrBreakTheBuffer() public {
        _steadyState();

        // Honest policy: buffer met, M1 pays more than wsMUSD on both views, so the allocator would ADD to M1.
        (IBaserateAllocator.Action honest,, IBaserateAllocator.Snapshot memory s) = allocator.previewRebalance();
        assertGe(s.m1Liquidity, s.bufferTarget, "buffer met before");
        assertGt(s.m1TrailingApy, s.wsMusdApy, "M1 pays more (trailing)");
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.TO_MARKET), "honest action: supply M1");
        uint256 vaultM1Before = _vaultM1();
        uint256 capital = musd.balanceOf(address(flash));

        // Attacker: supply 40k to M1, rebalance, withdraw - one transaction. The allocator sees M1 touched earlier
        // in the block and makes no rate-driven move.
        (IBaserateAllocator.Action action, uint256 amount) = flash.attack(40_000e18);
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "policy not inverted");
        assertEq(amount, 0);
        assertGe(musd.balanceOf(address(flash)) + 1, capital);
        // Untouched: at most the attacker's 1 wei of Morpho share rounding accrues to M1's suppliers.
        assertApproxEqAbs(_vaultM1(), vaultM1Before, 1, "vMUSD's M1 supply untouched");
        assertGe(_m1Liquidity(), _bufferTarget(), "buffer intact");
        assertEq(allocator.lastRebalance(), 0, "no cooldown started");

        // The honest move runs in the next block; the attacker cannot hold it off with a cooldown.
        _nextBlock();
        (action, amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        assertGt(_vaultM1(), vaultM1Before);

        // Round 2 at cooldown expiry (the attacker calls first): still nothing.
        skip(1 hours);
        (action, amount) = flash.attack(39_000e18);
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertGe(_m1Liquidity(), _bufferTarget());

        // Borrowers keep the buffer: the 500 MUSD borrow the PoC starved now goes through.
        address newBorrower = makeAddr("newBorrower");
        collateral.mint(newBorrower, 1e18);
        vm.startPrank(newBorrower);
        collateral.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(params, 1e18, newBorrower, "");
        morpho.borrow(params, 500e18, 0, newBorrower, newBorrower);
        vm.stopPrank();
        assertEq(musd.balanceOf(newBorrower), 500e18);
    }

    function test_fix_B1_transientRepay_cannotMoveFunds() public {
        // A borrower holding 1k of M1 debt repays, rebalances and re-borrows inside one transaction.
        TransientRepayBorrower b =
            new TransientRepayBorrower(morpho, IBaserateAllocator(address(allocator)), allocator.marketParams());
        collateral.mint(address(b), 1e18);
        b.open(1000e18);
        _deposit(lender, 20_000e18);
        _wsYield(1e18);
        _borrow(borrower, 1900e18);
        // Two top-ups, one per block on M1 state left by earlier blocks: liquidity back at the 2k floor.
        _nextBlock();
        allocator.rebalance();
        _nextBlock();
        allocator.rebalance();
        _advanceWithCheckpoints(1 days);
        _mockWsApy(0.5e18); // wsMUSD pays more: the honest direction is TO_LIQUIDITY, sized on the true liquidity
        (IBaserateAllocator.Action honest, uint256 honestAmount,) = allocator.previewRebalance();
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.NONE), "liquidity at the floor: nothing to pull");
        assertEq(honestAmount, 0);

        musd.mint(address(b), 10e18); // interest
        uint256 vaultM1Before = _vaultM1();
        (IBaserateAllocator.Action action, uint256 amount) = b.attack();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE), "no move on transient M1 totals");
        assertEq(amount, 0);
        assertEq(_vaultM1(), vaultM1Before);
        assertGt(b.borrowShares(), 0, "re-borrowed");
        assertGe(_m1Liquidity(), _bufferTarget(), "buffer intact");
    }

    function test_fix_B1_capitalHeldAcrossBlocks_cannotDrainTheBuffer() public {
        _steadyState(); // vMUSD 1.9k in M1, M1 liquidity at the 2k floor
        _mockWsApy(0.5e18); // wsMUSD pays more on the trailing view: TO_LIQUIDITY is the honest direction
        (IBaserateAllocator.Action honest,,) = allocator.previewRebalance();
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.NONE), "nothing above the buffer");
        uint256 vaultM1Before = _vaultM1();

        // Not atomic: 40k supplied in one block, rebalance and withdrawal in the next.
        address whale = makeAddr("m1Whale");
        musd.mint(whale, 40_000e18);
        vm.startPrank(whale);
        musd.approve(address(morpho), type(uint256).max);
        (, uint256 shares) = morpho.supply(params, 40_000e18, 0, whale, "");
        vm.stopPrank();
        _nextBlock();
        _mockWsApy(0.5e18);

        IBaserateAllocator.Snapshot memory s = allocator.snapshot();
        assertFalse(s.marketTouched);
        assertGt(s.m1Liquidity, 40_000e18, "spot sees the whale");
        assertApproxEqAbs(s.conservativeLiquidity, 2000e18, 1e15, "the conservative view does not");
        (IBaserateAllocator.Action action, uint256 amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(amount, 0);

        vm.prank(whale);
        morpho.withdraw(params, 0, shares, whale, whale);
        // vMUSD's M1 supply never moved; M1 is only short of the floor by the whale's own interest (dust).
        assertApproxEqAbs(_vaultM1(), vaultM1Before, 1e15, "interest only");
        assertApproxEqAbs(_m1Liquidity(), _bufferTarget(), 1e15, "buffer intact after the whale leaves");
    }

    function test_fix_B1_bufferTopUp_isNeverBlockedByTheCooldown() public {
        _steadyState();
        (IBaserateAllocator.Action action,) = allocator.rebalance(); // a rate-driven move starts the cooldown
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET));
        uint256 cooldownEnd = block.timestamp + 1 hours;

        // Borrowers drain the buffer right after.
        _nextBlock();
        _borrow(makeAddr("big"), _m1Liquidity() - 100e18);
        assertLt(_m1Liquidity(), _bufferTarget());
        _nextBlock(); // top-ups run on M1 state left by earlier blocks, one per block (R2X-3)
        assertEq(allocator.readyAt(), block.timestamp, "a top-up is ready now");
        (action,) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        _nextBlock();
        (action,) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertGe(_m1Liquidity(), _bufferTarget(), "restored inside the cooldown");
        assertEq(allocator.readyAt(), cooldownEnd, "rate moves still wait");
    }

    // =============================================================================================================
    // B-2 (fixed): with sMUSD's withdraw broken, vMUSD's M1-backed share still exits penalty-free, and the wsMUSD
    // position can be rescued in kind behind the vault's roles and a timelock
    // =============================================================================================================

    function test_fix_B2_brokenSMUSDWithdraw_m1ShareExits_andRescueMovesSharesInKind() public {
        _steadyState(); // vMUSD: ~1.9k in M1, ~18.2k in wsMUSD
        // A direct wsMUSD holder for comparison.
        _fundApprove(stranger, 1000e18, address(ws));
        vm.prank(stranger);
        ws.deposit(1000e18, stranger);

        // sMUSD upgrade/strategy fault: withdraw reverts (deposit and claim keep working).
        smusd.setDisabled(false, true, false);

        // Direct wsMUSD holders still leave through the escape hatch.
        uint256 strangerShares = ws.balanceOf(stranger);
        vm.prank(stranger);
        (uint256 smusdOut,) = ws.redeemInKind(strangerShares, stranger, stranger);
        assertApproxEqAbs(smusdOut, 1000e18, 1, "direct holder escaped in kind");

        // The vault's own exit still goes through the liquidity adapter and fails (Vault V2 behaviour).
        vm.prank(lender);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        vault.withdraw(500e18, lender, lender);

        // The allocator's exit retries M1-first: the M1-backed share leaves without the force-deallocate penalty.
        uint256 sharesBefore = vault.balanceOf(lender);
        uint256 fairShares = vault.previewWithdraw(500e18);
        uint256 m1Before = _vaultM1();
        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        assertEq(allocator.withdraw(500e18, lender), fairShares, "no penalty");
        vm.stopPrank();
        assertEq(sharesBefore - vault.balanceOf(lender), fairShares);
        assertEq(musd.balanceOf(lender), 500e18);
        assertApproxEqAbs(m1Before - _vaultM1(), 500e18, 2, "paid from M1");
        // ...up to the rest of vMUSD's M1 position.
        uint256 rest = _vaultM1();
        vm.prank(lender);
        allocator.withdraw(rest, lender);
        assertLe(_vaultM1(), 1, "M1-backed share fully exited");

        // Sentinel response: stop new deposits flowing into the frozen wsMUSD (and rate moves into it).
        bytes[4] memory data = _idData(cfg, _deployment());
        vm.prank(curator);
        vault.decreaseAbsoluteCap(data[3], 0);
        _fundApprove(lender2, 1000e18, address(vault));
        vm.prank(lender2);
        vm.expectRevert();
        vault.deposit(1000e18, lender2);

        // Rescue: curator submits, 72 h timelock (a sentinel could revoke), then the wsMUSD shares go in kind to the
        // vault owner because wsMUSD cannot pay them out.
        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);
        uint256 adapterShares = ws.balanceOf(address(liq));
        vm.prank(curator);
        (uint256 rescued, bool unwound) = liq.rescue();
        assertEq(rescued, adapterShares);
        assertFalse(unwound);
        assertEq(ws.balanceOf(curator), adapterShares, "owner holds the position for manual unwinding");
        assertEq(liq.heldAssets(), 0);
        vm.prank(curator);
        (uint256 inKind,) = ws.redeemInKind(adapterShares, curator, curator);
        assertGt(inKind, 18_000e18, "unwound to sMUSD without any sMUSD withdraw");
    }

    function test_fix_B2_rescue_cannotTakeWhatWsMusdStillPays() public {
        _steadyState();
        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);
        uint256 total = vault.totalAssets();
        vm.prank(curator);
        (, bool unwound) = liq.rescue();
        assertTrue(unwound, "wsMUSD pays: the position becomes idle MUSD in the adapter");
        assertEq(ws.balanceOf(curator), 0);
        assertApproxEqAbs(vault.totalAssets(), total, 3);
        vm.expectRevert(IWsMusdLiquidityAdapter.NoPendingRescue.selector);
        vm.prank(curator);
        liq.rescue();
    }
}

/// @notice Area B audit regressions on wsMUSD alone (WsMUSDBase: MockMUSD + SMUSDMock with a 1M outside sMUSD holder).
contract VaultAuditWsMUSDTest is WsMUSDBase {
    // =============================================================================================================
    // B-3 (fixed): a reverting claimYield neither lowers the share price nor breaks previews
    // =============================================================================================================

    function test_fix_B3_claimRevert_priceHolds_andPreviewsMatchExecution() public {
        _deposit(alice, 10_000e18);
        _yieldForVault(30e18);
        skip(1 days);
        smusd.setDisabled(false, false, true); // claimYield reverts (caught by wsMUSD)

        uint256 priceBefore = ws.convertToAssets(1e18);
        uint256 previewed = ws.previewRedeem(1000e18);
        uint256 maxW = ws.maxWithdraw(alice);

        // ERC-4626: redeem pays exactly previewRedeem in the same transaction.
        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        assertEq(ws.redeem(1000e18, alice, alice), previewed, "previewRedeem honoured");
        vm.revertToState(snap);

        // maxWithdraw is withdrawable.
        vm.prank(alice);
        ws.withdraw(maxW, alice, alice);
        vm.revertToState(snap);

        // "Share price never falls": a sync with the failing claim realizes exactly the preview.
        ws.sync();
        assertEq(ws.convertToAssets(1e18), priceBefore, "share price unchanged");

        // No oscillation while the claim stays broken.
        skip(1 days);
        assertEq(ws.convertToAssets(1e18), priceBefore);
        ws.sync();
        assertEq(ws.convertToAssets(1e18), priceBefore);

        // Claims recover: the yield is harvested and only vests upward.
        smusd.setDisabled(false, false, false);
        assertGt(ws.sync(), 29e18);
        assertEq(ws.convertToAssets(1e18), priceBefore);
        skip(3 days);
        assertGt(ws.convertToAssets(1e18), priceBefore);
    }

    // =============================================================================================================
    // I-1 (fixed): a same-block sMUSD protocol-yield donation does not move totalAssets
    // =============================================================================================================

    function test_fix_I1_sameBlockProtocolYieldDonation_doesNotMoveTotalAssets() public {
        _deposit(alice, 10_000e18);
        skip(3 days); // nobody touched wsMUSD for a full vesting window

        uint256 taBefore = ws.totalAssets();
        uint256 priceBefore = ws.convertToAssets(1e18);
        _yieldForVault(50e18); // permissionless sMUSD.receiveProtocolYield (or a PCV distribution)
        assertEq(ws.totalAssets(), taBefore, "the donation does not count in its block");
        assertEq(ws.convertToAssets(1e18), priceBefore);

        // It reaches holders by vesting from the next harvest.
        ws.sync();
        assertEq(ws.totalAssets(), taBefore);
        skip(3 days);
        assertApproxEqAbs(ws.totalAssets() - taBefore, 50e18, 1e16);
    }
}
