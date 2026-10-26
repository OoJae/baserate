// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {LiquidationForkBase} from "./LiquidationForkBase.t.sol";

/// @notice The Backstop on the mainnet fork: it absorbs a canary liquidation, then sells the BTC back through the
/// Tigris venues (bounded keeper sales) and the Dutch auction with real MUSD; plus the JIT-deposit attack around a
/// real liquidation.
contract BackstopMainnetForkTest is LiquidationForkBase {
    function setUp() public {
        _setUpLiquidation(Net.MAINNET, 0.05e18);
    }

    /// @dev Liquidates a canary of `coll` BTC into the backstop; returns the BTC it now holds.
    function _fillInventory(uint256 coll) internal returns (uint256 seized) {
        address account = _openCanary(coll);
        skip(1 hours);
        _dropSkip(200);
        seized = _liquidate(account, 0, Venue.BACKSTOP, 1).seized;
        assertEq(backstop.inventory(), seized, "inventory");
    }

    function _keeperSale(Venue venue, uint256 expectedBtcCalls) internal {
        uint256 seized = _fillInventory(0.02e18);
        uint256 pps = backstop.convertToAssets(1e18);
        (, uint256 unvestedBefore,,) = backstop.vestingState();
        uint256 floor = backstop.quoteAuction(seized);
        uint256 mark = seized * oracle.price() / 1e36 * 95 / 100;

        vm.startStateDiffRecording();
        vm.prank(keeper);
        uint256 out = backstop.sellInventory(seized, venue, 0);
        (uint256 skipCalls, uint256 btcCalls) = _countPrecompiles(vm.stopAndReturnStateDiff());

        assertGe(out, floor, "never below the auction price");
        assertEq(backstop.inventory(), 0, "sold out");
        assertEq(address(backstop).balance, 0, "no BTC left");
        assertApproxEqAbs(backstop.convertToAssets(1e18), pps, 1, "the sale's gain does not move the price instantly");
        (, uint256 unvestedAfter,,) = backstop.vestingState();
        assertApproxEqAbs(unvestedAfter - unvestedBefore, out - mark, 3, "gain over the 0.95 mark vests");
        assertEq(skipCalls, 1, "one Skip read");
        assertEq(btcCalls, expectedBtcCalls, "BTC precompile calls");
        skip(7 days);
        assertGt(backstop.convertToAssets(1e18), pps, "premium vested to depositors");
        console2.log("keeper sale venue", uint256(venue));
        console2.log("  btc sold", seized);
        console2.log("  musd out", out);
        console2.log("  auction floor", floor);
    }

    function test_mainnet_keeperSale_cl200() public {
        _keeperSale(Venue.CL200, 4);
    }

    function test_mainnet_keeperSale_vamm() public {
        _keeperSale(Venue.VAMM, 5);
    }

    function test_mainnet_keeperSale_floorTracksAuction() public {
        uint256 seized = _fillInventory(0.02e18);
        // BTC/USD jumps 6%: the DEX (not arbitraged in the fork) now pays ~3.5% under the oracle.
        skipOracle.setAnswer(_skipAnswer() * 106 / 100);
        // The BTC mock's balance moves are not journaled: restore state after the expected revert.
        uint256 snap = vm.snapshotState();
        vm.prank(keeper);
        vm.expectPartialRevert(IBackstop.InsufficientOutput.selector);
        backstop.sellInventory(seized, Venue.CL200, 0);
        vm.revertToState(snap);

        // Six hours later the auction floor is 0.95 x oracle and the same sale clears.
        skip(6 hours);
        assertEq(backstop.auctionFactor(), 0.95e18, "floor");
        uint256 floor = backstop.quoteAuction(seized);
        vm.prank(keeper);
        uint256 out = backstop.sellInventory(seized, Venue.CL200, 0);
        assertGe(out, floor, "at or above the floor");
        assertLt(out, seized * oracle.price() / 1e36, "below the oracle: only the decayed auction price allowed it");

        vm.expectRevert(
            abi.encodeWithSelector(IBackstop.ExceedsInventory.selector, MAX_KEEPER_SALE + 1, MAX_KEEPER_SALE)
        );
        backstop.sellInventory(MAX_KEEPER_SALE + 1, Venue.CL200, 0);
    }

    function test_mainnet_auctionWithRealMusd() public {
        uint256 seized = _fillInventory(0.02e18);
        skip(3 hours);
        address arb = makeAddr("arbitrageur");
        uint256 cost = backstop.quoteAuction(seized);
        assertApproxEqAbs(cost, seized * oracle.price() / 1e36 * 975 / 1000, 2, "oracle x 0.975");
        assertGe(cost, seized * oracle.price() / 1e36 * 975 / 1000, "rounded up");
        deal(net.musd, arb, cost);
        vm.startPrank(arb);
        musd.approve(address(backstop), cost);
        backstop.takeAuction(seized, cost, arb);
        vm.stopPrank();
        assertEq(arb.balance, seized, "native BTC to the taker");
        assertEq(musd.balanceOf(arb), 0, "paid");
        assertEq(backstop.inventory(), 0, "inventory sold");
    }

    function test_mainnet_jitDepositAroundLiquidation() public {
        address account = _openCanary(0.02e18);
        skip(1 hours);
        _dropSkip(200);
        address attacker = makeAddr("attacker");
        uint256 shares = _depositBackstop(attacker, 5000e18);
        _liquidate(account, 0, Venue.BACKSTOP, 1);
        vm.prank(attacker);
        uint256 id = backstop.requestRedeem(shares, attacker, attacker);
        vm.prank(keeper);
        backstop.sellInventory(backstop.inventory(), Venue.CL200, 0);
        skip(7 days);
        uint256 out = backstop.claimRedeem(id);
        assertLe(out, 5000e18, "the JIT depositor earns nothing");
        assertGt(backstop.convertToAssets(backstop.balanceOf(depositor)), BACKSTOP_SEED, "the incumbent earns it");
        console2.log("JIT attacker in", uint256(5000e18));
        console2.log("JIT attacker out", out);
    }

    function test_mainnet_backstopPrecompileBudget() public {
        // Deposits never read Skip: with no BTC held NAV needs no price, and while BTC is held they are refused before
        // any read. Requests and claims read it once while BTC is held.
        deal(net.musd, keeper, 200e18);
        vm.startPrank(keeper);
        musd.approve(address(backstop), 200e18);
        vm.startStateDiffRecording();
        uint256 shares = backstop.deposit(100e18, keeper);
        (uint256 skipCalls, uint256 btcCalls) = _countPrecompiles(vm.stopAndReturnStateDiff());
        assertEq(skipCalls, 0, "deposit");
        assertEq(btcCalls, 0);
        vm.stopPrank();

        uint256 seized = _fillInventory(0.02e18);
        vm.startPrank(keeper);
        vm.startStateDiffRecording();
        vm.expectRevert(abi.encodeWithSelector(IBackstop.HoldingInventory.selector, seized));
        backstop.deposit(100e18, keeper);
        (skipCalls, btcCalls) = _countPrecompiles(vm.stopAndReturnStateDiff());
        assertEq(skipCalls, 0, "deposit refused while holding BTC");
        assertEq(btcCalls, 0);
        vm.startStateDiffRecording();
        backstop.requestRedeem(shares, keeper, keeper);
        (skipCalls,) = _countPrecompiles(vm.stopAndReturnStateDiff());
        assertEq(skipCalls, 1, "request");
        vm.stopPrank();
    }
}
