// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {BackstopBase} from "./BackstopBase.t.sol";

/// @notice Backstop unit tests on a local stack: pricing, NAV marking, premium vesting, the 7-day exit queue at the
/// lower NAV, the Dutch auction, the JIT-deposit attack, oracle outages and the sentinel's pause.
contract BackstopTest is BackstopBase {
    uint256 internal constant DISCOUNT_086 = 21_920_668_058_455_114; // (1/0.958 - 1) / 2, rounded down like Morpho

    // ---------------------------------------------------------------- construction

    function test_constructor_wiringAndDiscount() public view {
        assertEq(backstop.asset(), address(musd));
        assertEq(backstop.WSMUSD(), address(ws));
        assertEq(backstop.ORACLE(), address(oracle));
        assertEq(backstop.LIQUIDATOR(), liquidator);
        assertEq(backstop.SENTINEL(), sentinel);
        assertEq(backstop.DISCOUNT(), DISCOUNT_086);
        assertEq(backstop.MAX_KEEPER_SALE(), 0.05e18);
        assertEq(backstop.name(), "Baserate Backstop MUSD");
        assertEq(backstop.symbol(), "bMUSD");
        assertEq(backstop.decimals(), 18);
        assertEq(backstop.totalAssets(), SEED);
    }

    function test_constructor_discountAt077() public {
        Backstop b = new Backstop(_params(0.77e18));
        // LIF = 1/0.931 = 1.07411...; half the incentive is 3.7057%.
        assertEq(b.DISCOUNT(), (uint256(1e36) / 0.931e18 - 1e18) / 2);
        assertApproxEqAbs(b.DISCOUNT(), 0.037057e18, 1e12);
    }

    function test_constructor_rejectsBadParams() public {
        IBackstop.BackstopParams memory p = _params(LLTV);
        p.liquidator = address(0);
        vm.expectRevert(IBackstop.ZeroAddress.selector);
        new Backstop(p);

        p = _params(LLTV);
        p.sentinel = address(0);
        vm.expectRevert(IBackstop.ZeroAddress.selector);
        new Backstop(p);

        p = _params(1e18);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.InvalidLltv.selector, 1e18));
        new Backstop(p);

        p = _params(LLTV);
        p.musd = address(smusd);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.AssetMismatch.selector, address(smusd), address(musd)));
        new Backstop(p);
    }

    // ---------------------------------------------------------------- deposits and parking

    function test_deposit_mintsAtNavAndParksInWsMusd() public {
        uint256 shares = _deposit(alice, 10_000e18);
        assertEq(shares, 10_000e18, "1:1 at NAV 1");
        assertEq(backstop.totalAssets(), 10_001e18, "NAV");
        assertEq(musd.balanceOf(address(backstop)), 0, "no idle MUSD");
        assertGt(ws.balanceOf(address(backstop)), 0, "parked in wsMUSD");
        assertApproxEqAbs(backstop.cash(), 10_001e18, 2, "cash");
    }

    function test_instantExitsDisabled() public {
        _deposit(alice, 1000e18);
        assertEq(backstop.maxWithdraw(alice), 0);
        assertEq(backstop.maxRedeem(alice), 0);
        vm.startPrank(alice);
        vm.expectRevert(IBackstop.UseRedeemQueue.selector);
        backstop.withdraw(1, alice, alice);
        vm.expectRevert(IBackstop.UseRedeemQueue.selector);
        backstop.redeem(1, alice, alice);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- buying collateral

    function test_buyCollateral_onlyLiquidator() public {
        _deposit(alice, 10_000e18);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotLiquidator.selector, alice));
        backstop.buyCollateral{value: 0.01 ether}(0);

        vm.prank(liquidator);
        vm.expectRevert(IBackstop.ZeroAmount.selector);
        backstop.buyCollateral(0);
    }

    function test_buyCollateral_paysHalfIncentiveDiscountAndMarksAt95() public {
        _deposit(alice, 10_000e18);
        uint256 navBefore = backstop.totalAssets();
        uint256 btc = 0.01e18;
        uint256 value = btc * PRICE / 1e36; // 800 MUSD
        uint256 expectedPaid = value * (WAD - DISCOUNT_086) / WAD;
        assertEq(backstop.quoteBuy(btc), expectedPaid, "quote");

        uint256 before = musd.balanceOf(liquidator);
        uint256 paid = _buy(btc);
        assertEq(paid, expectedPaid, "pays oracle x (1 - incentive/2)");
        assertEq(musd.balanceOf(liquidator) - before, paid, "MUSD to the seller");
        assertEq(backstop.inventory(), btc, "inventory");
        assertEq(address(backstop).balance, btc, "native BTC held");
        assertEq(backstop.auctionStart(), block.timestamp, "auction starts");

        // The mark-down from cost (97.8%) to 0.95 x oracle is a loss recognised instantly.
        uint256 markDown = paid - value * 95 / 100;
        assertApproxEqAbs(backstop.totalAssets(), navBefore - markDown, 3, "NAV marks inventory at 0.95");
        assertEq(_unvested(), 0, "nothing vesting");
    }

    function test_buyCollateral_minOutAndFreeCash() public {
        _deposit(alice, 1000e18);
        uint256 quote = backstop.quoteBuy(0.01e18);
        vm.deal(liquidator, 1 ether);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.InsufficientOutput.selector, quote, quote + 1));
        backstop.buyCollateral{value: 0.01e18}(quote + 1);

        // 0.02 BTC costs ~1,565 MUSD: more than the 1,001 MUSD of cash.
        assertEq(backstop.quoteBuy(0.02e18), 0, "quote 0 when cash is short");
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.InsufficientCash.selector);
        backstop.buyCollateral{value: 0.02e18}(0);
    }

    // ---------------------------------------------------------------- vesting

    function test_premiumVestsLinearlyOverSevenDays() public {
        _deposit(alice, 10_000e18);
        _buy(0.05e18);
        uint256 navAfterBuy = backstop.totalAssets();
        uint256 pps0 = _pps();

        // Sold at the start of the auction (factor 1.00): gain over the 0.95 mark = 5% of 4,000 MUSD.
        _take(0.05e18);
        uint256 gain = 0.05e18 * PRICE / 1e36 * 5 / 100;
        assertApproxEqAbs(backstop.totalAssets(), navAfterBuy, 3, "no instant gain");
        assertApproxEqAbs(_pps(), pps0, 1, "share price unchanged by the sale");
        assertApproxEqAbs(_unvested(), gain, 3, "gain is vesting");

        skip(3.5 days);
        assertApproxEqAbs(backstop.totalAssets(), navAfterBuy + gain / 2, 1e15, "half vested");
        skip(3.5 days);
        assertApproxEqAbs(backstop.totalAssets(), navAfterBuy + gain, 1e15, "fully vested");
        skip(30 days);
        assertApproxEqAbs(backstop.totalAssets(), navAfterBuy + gain, 1e15, "no further change");
    }

    function test_donationVestsInsteadOfMovingPrice() public {
        _deposit(alice, 10_000e18);
        uint256 pps0 = _pps();
        musd.mint(address(backstop), 1000e18);
        assertEq(_pps(), pps0, "view ignores the donation");
        backstop.sync();
        assertApproxEqAbs(_pps(), pps0, 1, "sync vests it");
        assertApproxEqAbs(_unvested(), 1000e18, 2, "vesting");
        skip(7 days);
        assertGt(_pps(), pps0 + 0.09e18, "vested to holders");
    }

    function test_lossesConsumeUnvestedGainsFirst() public {
        _deposit(alice, 10_000e18);
        musd.mint(address(backstop), 1000e18);
        backstop.sync();
        _buy(0.01e18); // mark-down ~22.5 MUSD, absorbed by the 1,000 unvested
        uint256 nav = backstop.totalAssets();
        assertApproxEqAbs(nav, 10_001e18, 3, "book untouched");
        assertApproxEqAbs(_unvested(), 1000e18 - (backstop.quoteBuy(0.01e18) - 760e18), 1e15, "unvested absorbed it");

        // A price drop larger than the remaining unvested hits the book instantly.
        _setPrice(PRICE / 2); // inventory mark 760 -> 380, still inside the unvested buffer
        backstop.sync();
        assertApproxEqAbs(backstop.totalAssets(), nav, 3, "absorbed");
        _setPrice(PRICE / 100_000); // mark ~0
        backstop.sync();
        // After this drop the inventory is worth almost nothing; unvested absorbs what it can, the rest hits book.
        assertLe(backstop.totalAssets(), backstop.grossAssets(), "NAV never above gross");
    }

    function test_priceDropWithoutUnvestedIsInstantLoss() public {
        _deposit(alice, 10_000e18);
        _buy(0.05e18);
        uint256 nav = backstop.totalAssets();
        _setPrice(PRICE * 90 / 100);
        uint256 expectedLoss = 0.05e18 * PRICE / 1e36 * 95 / 100 / 10;
        assertApproxEqAbs(backstop.totalAssets(), nav - expectedLoss, 3, "view shows the loss now");
        backstop.sync();
        assertApproxEqAbs(_book(), nav - expectedLoss, 3, "book takes the loss");
    }

    // ---------------------------------------------------------------- JIT deposit attack

    /// @dev Deposit right before a liquidation buy, queue the exit right after: the attacker eats part of the
    /// mark-down and forfeits the premium, which vests to the incumbents.
    function test_jitDepositAroundLiquidation_yieldsNothing() public {
        _deposit(alice, 10_000e18);
        uint256 shares = _deposit(attacker, 10_000e18);
        _buy(0.05e18);
        uint256 id = _request(attacker, shares);
        _take(0.05e18); // premium realised: vests
        skip(7 days);
        vm.prank(attacker);
        uint256 out = backstop.claimRedeem(id);
        assertLe(out, 10_000e18, "no profit for the JIT depositor");
        assertGt(musd.balanceOf(attacker), 0);
        // The incumbent captured the whole premium.
        assertGt(backstop.convertToAssets(backstop.balanceOf(alice)), 10_000e18, "incumbent earned the premium");
    }

    /// @dev Deposit right before the inventory sells, exit right after: the realised gain is still vesting, so the
    /// request NAV equals the deposit.
    function test_jitDepositAroundSale_yieldsZero() public {
        _deposit(alice, 10_000e18);
        _buy(0.05e18);
        uint256 shares = _deposit(attacker, 10_000e18);
        _take(0.05e18);
        uint256 id = _request(attacker, shares);
        assertApproxEqAbs(backstop.redeemRequest(id).assets, 10_000e18, 2, "request NAV = deposit");
        skip(7 days);
        vm.prank(attacker);
        uint256 out = backstop.claimRedeem(id);
        assertApproxEqAbs(out, 10_000e18, 2, "~0 yield");
        assertLe(out, 10_000e18, "never more than the deposit");
    }

    // ---------------------------------------------------------------- exit queue

    function test_requestRedeem_escrowsAndReserves() public {
        uint256 shares = _deposit(alice, 1000e18);
        uint256 id = _request(alice, shares);
        IBackstop.RedeemRequest memory r = backstop.redeemRequest(id);
        assertEq(r.owner, alice);
        assertEq(r.receiver, alice);
        assertEq(r.shares, shares);
        assertEq(r.assets, 1000e18);
        assertEq(r.claimableAt, block.timestamp + 7 days);
        assertEq(backstop.balanceOf(alice), 0, "escrowed");
        assertEq(backstop.balanceOf(address(backstop)), shares, "held in escrow");
        assertEq(backstop.reservedAssets(), 1000e18, "reserved");
        assertApproxEqAbs(backstop.availableCash(), SEED, 2, "only the seed is free");
        assertEq(backstop.nextRequestId(), id + 1);
    }

    function test_claimRedeem_delayAndUnknown() public {
        uint256 shares = _deposit(alice, 1000e18);
        uint256 id = _request(alice, shares);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotClaimable.selector, id, uint64(block.timestamp + 7 days)));
        backstop.claimRedeem(id);
        skip(7 days);
        uint256 out = backstop.claimRedeem(id); // anyone may trigger it; the receiver is paid
        assertEq(out, 1000e18);
        assertEq(musd.balanceOf(alice), 1000e18);
        assertEq(backstop.reservedAssets(), 0);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.UnknownRequest.selector, id));
        backstop.claimRedeem(id);
    }

    function test_claimPaysRequestNavWhenNavRose() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _deposit(bob, 10_000e18);
        uint256 id = _request(alice, aliceShares);
        // Gains arrive and vest during the wait.
        musd.mint(address(backstop), 2000e18);
        backstop.sync();
        skip(7 days);
        uint256 ppsBefore = _pps();
        uint256 out = backstop.claimRedeem(id);
        assertEq(out, 10_000e18, "paid at the request NAV");
        // The forfeited upside stays with the pool and re-vests: the claim does not lift the price instantly.
        assertApproxEqAbs(_pps(), ppsBefore, 1, "no instant jump");
        skip(7 days);
        assertGt(_pps(), ppsBefore, "forfeited upside vests to the remaining holders");
    }

    function test_claimPaysClaimNavWhenNavFell() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _buy(0.05e18);
        uint256 id = _request(alice, aliceShares);
        uint256 atRequest = backstop.redeemRequest(id).assets;
        _setPrice(PRICE * 80 / 100); // inventory loses 20%
        skip(7 days);
        uint256 valueNow = backstop.convertToAssets(aliceShares);
        assertLt(valueNow, atRequest, "NAV fell");
        // Inventory must be sold first so cash covers the claim.
        _take(backstop.inventory());
        uint256 out = backstop.claimRedeem(id);
        assertLe(out, valueNow, "never above NAV at claim");
        assertLt(out, atRequest, "the requester shares the loss");
    }

    function test_requestRedeem_allowanceForThirdParty() public {
        uint256 shares = _deposit(alice, 1000e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, shares));
        backstop.requestRedeem(shares, bob, alice);
        vm.prank(alice);
        backstop.approve(bob, shares);
        vm.prank(bob);
        uint256 id = backstop.requestRedeem(shares, bob, alice);
        assertEq(backstop.redeemRequest(id).receiver, bob);
        assertEq(backstop.redeemRequest(id).owner, alice);
    }

    function test_reservedCashIsNeverSpentOnCollateral() public {
        uint256 shares = _deposit(alice, 10_000e18);
        _request(alice, shares);
        assertEq(backstop.quoteBuy(0.01e18), 0, "only the seed is free");
        vm.deal(liquidator, 1 ether);
        vm.prank(liquidator);
        vm.expectPartialRevert(IBackstop.InsufficientCash.selector);
        backstop.buyCollateral{value: 0.01e18}(0);
    }

    // ---------------------------------------------------------------- Dutch auction

    function test_auctionFactorDecaysOverSixHours() public {
        _deposit(alice, 10_000e18);
        assertEq(backstop.auctionFactor(), 1e18, "no inventory");
        _buy(0.01e18);
        assertEq(backstop.auctionFactor(), 1e18, "starts at 1.00");
        skip(3 hours);
        assertEq(backstop.auctionFactor(), 0.975e18, "halfway");
        skip(3 hours);
        assertEq(backstop.auctionFactor(), 0.95e18, "floor");
        skip(1 days);
        assertEq(backstop.auctionFactor(), 0.95e18, "stays at the floor");
    }

    function test_takeAuction_paysPriceTimesFactor() public {
        _deposit(alice, 10_000e18);
        _buy(0.02e18);
        skip(3 hours);
        uint256 cost = backstop.quoteAuction(0.01e18);
        assertEq(cost, 0.01e18 * PRICE / 1e36 * 975 / 1000, "oracle x 0.975");

        musd.mint(taker, cost);
        vm.startPrank(taker);
        musd.approve(address(backstop), cost);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.ExcessiveInput.selector, cost, cost - 1));
        backstop.takeAuction(0.01e18, cost - 1, taker);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.ExceedsInventory.selector, 0.03e18, 0.02e18));
        backstop.takeAuction(0.03e18, type(uint256).max, taker);
        address to = makeAddr("btcReceiver");
        uint256 paid = backstop.takeAuction(0.01e18, cost, to);
        vm.stopPrank();
        assertEq(paid, cost);
        assertEq(to.balance, 0.01e18, "native BTC out");
        assertEq(backstop.inventory(), 0.01e18, "inventory left");
    }

    function test_auctionClockWeightsNewInventory() public {
        _deposit(alice, 10_000e18);
        _buy(0.01e18);
        skip(4 hours);
        // A dust purchase barely moves the clock...
        _buy(1e10);
        assertApproxEqAbs(block.timestamp - backstop.auctionStart(), 4 hours, 1, "dust cannot reset");
        // ...an equal-size purchase halves the elapsed time.
        _buy(0.01e18);
        assertApproxEqAbs(block.timestamp - backstop.auctionStart(), 2 hours, 2, "pro-rata pull-back");
    }

    function test_sellInventory_boundsAndVenues() public {
        _deposit(alice, 10_000e18);
        _buy(0.1e18);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.ExceedsInventory.selector, 0.06e18, 0.05e18));
        backstop.sellInventory(0.06e18, Venue.VAMM, 0);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.VAMM));
        backstop.sellInventory(0.01e18, Venue.VAMM, 0);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.BACKSTOP));
        backstop.sellInventory(0.01e18, Venue.BACKSTOP, 0);
    }

    // ---------------------------------------------------------------- pause and roles

    function test_pause_onlySentinel_depositsOnly() public {
        uint256 shares = _deposit(alice, 10_000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotSentinel.selector, alice));
        backstop.setDepositsPaused(true);

        vm.prank(sentinel);
        backstop.setDepositsPaused(true);
        assertTrue(backstop.depositsPaused());
        assertEq(backstop.maxDeposit(bob), 0);
        assertEq(backstop.maxMint(bob), 0);
        musd.mint(bob, 100e18);
        vm.startPrank(bob);
        musd.approve(address(backstop), 100e18);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 100e18, 0));
        backstop.deposit(100e18, bob);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, bob, 1e18, 0));
        backstop.mint(1e18, bob);
        vm.stopPrank();

        // Everything else keeps working while paused.
        _buy(0.01e18);
        _take(0.005e18);
        uint256 id = _request(alice, shares / 2);
        skip(7 days);
        backstop.claimRedeem(id);
        backstop.sync();

        vm.prank(sentinel);
        backstop.setDepositsPaused(false);
        _deposit(bob, 100e18);
    }

    // ---------------------------------------------------------------- oracle outage

    function test_oracleDown_viewsConservativeMutationsRevert() public {
        uint256 shares = _deposit(alice, 10_000e18);
        uint256 id = _request(alice, shares / 2);
        _buy(0.01e18);
        oracle.setReverting(true);
        assertApproxEqAbs(backstop.totalAssets(), backstop.cash(), 3, "inventory valued at 0");
        assertEq(backstop.quoteBuy(0.01e18), 0);
        assertEq(backstop.quoteAuction(0.01e18), 0);

        vm.expectRevert(IBackstop.OracleUnavailable.selector);
        backstop.sync();
        musd.mint(bob, 1e18);
        vm.startPrank(bob);
        musd.approve(address(backstop), 1e18);
        vm.expectRevert(IBackstop.OracleUnavailable.selector);
        backstop.deposit(1e18, bob);
        vm.stopPrank();
        skip(7 days);
        vm.expectRevert(IBackstop.OracleUnavailable.selector);
        backstop.claimRedeem(id);

        oracle.setReverting(false);
        backstop.claimRedeem(id);
    }

    function test_noInventory_noOracleNeeded() public {
        oracle.setReverting(true);
        uint256 shares = _deposit(alice, 1000e18);
        uint256 id = _request(alice, shares);
        skip(7 days);
        assertEq(backstop.claimRedeem(id), 1000e18);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_buyQuote(uint256 btc, uint256 price) public {
        btc = bound(btc, 1e10, 0.1e18);
        price = bound(price, 1000e36, 500_000e36) / 1e18;
        _setPrice(price);
        _deposit(alice, 100_000e18);
        uint256 quote = backstop.quoteBuy(btc);
        uint256 value = btc * price / 1e36;
        assertApproxEqAbs(quote, value * (WAD - DISCOUNT_086) / WAD, 2, "quote");
        if (quote == 0) return;
        uint256 navBefore = backstop.totalAssets();
        assertEq(_buy(btc), quote, "paid = quote");
        assertLe(backstop.totalAssets(), navBefore, "a purchase never raises NAV instantly");
    }

    function testFuzz_depositNeverMovesSharePrice(uint256 a, uint256 b, uint256 btc) public {
        a = bound(a, 1e15, 1_000_000e18);
        b = bound(b, 1, 1_000_000e18);
        btc = bound(btc, 0, 0.1e18);
        _deposit(alice, a);
        if (btc != 0 && backstop.quoteBuy(btc) != 0) _buy(btc);
        uint256 pps = _pps();
        _deposit(bob, b);
        assertApproxEqAbs(_pps(), pps, 2, "deposit keeps the share price");
    }
}
