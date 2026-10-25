// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {ErrorsLib} from "morpho-blue/libraries/ErrorsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {LiquidationForkBase} from "./LiquidationForkBase.t.sol";

/// @notice Zero-capital liquidation of a canary through every venue on pinned Mezo forks, against the real Morpho,
/// IRM, MUSD, sMUSD, Pyth and Tigris pools (Skip and the BTC precompile mocked). Each scenario opens a canary at the
/// canary ceiling through the factory's canary-operator path, moves Skip down until Morpho deems it unhealthy,
/// liquidates in full and checks: lenders made whole (no bad debt), the caller profits by exactly the previewed
/// amount, the liquidator keeps nothing, and the precompile budget holds.
abstract contract FlashLiquidatorForkScenarios is LiquidationForkBase {
    using MorphoBalancesLib for *;

    uint256 internal constant CANARY = 0.002e18;
    uint256 internal constant DROP_BPS = 200;

    function _liquidatableCanary() internal returns (address account) {
        account = _openCanary(CANARY);
        assertFalse(liq.previewLiquidation(account).liquidatable, "healthy at open");
        skip(1 hours); // interest accrues; Skip stays fresh (mock in LIVE mode)
        _dropSkip(DROP_BPS);
        assertTrue(liq.previewLiquidation(account).liquidatable, "liquidatable after the drop");
    }

    function _expectedCalls(Venue venue) internal pure returns (uint256 skipCalls, uint256 btcCalls) {
        if (venue == Venue.BACKSTOP) return (3, 0);
        if (venue == Venue.CL200) return (2, 4);
        return (2, 5);
    }

    function _fullLiquidation(Venue venue) internal returns (Outcome memory o) {
        address account = _liquidatableCanary();
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(account);
        uint256 v = uint256(venue);
        assertTrue(p.oracleOk, "oracle");
        assertTrue(p.quotes[v].ok, "venue clears");
        assertEq(p.badDebt, 0, "no bad debt expected");
        assertGt(p.ltvWad, net.lltv, "above LLTV");

        uint256 supplyBefore = MorphoBalancesLib.expectedTotalSupplyAssets(morpho, params);
        uint256 lenderBefore = MorphoBalancesLib.expectedSupplyAssets(morpho, params, lender);

        o = _liquidate(account, 0, venue, 1);

        // Lenders are made whole: no bad debt realised, supply only grew with interest.
        Position memory pos = _position(account);
        assertEq(pos.borrowShares, 0, "debt fully repaid");
        assertGt(pos.collateral, 0, "borrower keeps the excess collateral");
        assertGe(morpho.market(marketId).totalSupplyAssets, supplyBefore, "no bad debt");
        assertGe(MorphoBalancesLib.expectedSupplyAssets(morpho, params, lender), lenderBefore, "lender whole");

        // The preview was exact.
        assertEq(o.seized, p.seizable, "seized = preview");
        assertEq(o.repaid, p.repaid, "repaid = preview");
        assertEq(o.profit, p.quotes[v].profit, "profit = preview");
        assertGt(o.profit, 0, "caller profits");

        // Precompile budget (Mezo: 20 per transaction).
        (uint256 expSkip, uint256 expBtc) = _expectedCalls(venue);
        assertEq(o.skipCalls, expSkip, "skip calls");
        assertEq(o.btcCalls, expBtc, "btc precompile calls");
        assertLe(o.skipCalls + o.btcCalls, PRECOMPILE_LIMIT, "precompile limit");
        assertLt(o.gas, 3_000_000, "fits comfortably in a 10M block");
        _assertLiquidatorEmpty();

        console2.log("venue", v);
        console2.log("  seized (BTC wei)", o.seized);
        console2.log("  repaid (MUSD wei)", o.repaid);
        console2.log("  profit (MUSD wei)", o.profit);
        console2.log("  gas", o.gas);
        console2.log("  skip calls", o.skipCalls);
        console2.log("  btc precompile calls", o.btcCalls);
    }

    function _liquidateWhilePaused(Venue venue) internal {
        address account = _liquidatableCanary();
        vm.prank(sentinel);
        factory.setPaused(true, true);
        assertTrue(factory.borrowPaused(), "paused");
        Outcome memory o = _liquidate(account, 0, venue, 1);
        assertGt(o.profit, 0, "profit while paused");
        assertEq(_position(account).borrowShares, 0, "repaid while paused");
    }

    function _partialLiquidation(Venue venue) internal {
        address account = _liquidatableCanary();
        Position memory before = _position(account);
        uint256 seize = before.collateral / 4;
        Outcome memory o = _liquidate(account, seize, venue, 1);
        assertEq(o.seized, seize, "seized as asked");
        Position memory after_ = _position(account);
        assertEq(after_.collateral, before.collateral - seize, "collateral left");
        assertLt(after_.borrowShares, before.borrowShares, "debt reduced");
        assertGt(o.profit, 0, "profit");
        _assertLiquidatorEmpty();
    }

    function _backstopVenueRequiresFreeCash() internal {
        address account = _liquidatableCanary();
        // The depositor queues a full exit: all cash is now reserved for it.
        uint256 shares = backstop.balanceOf(depositor);
        vm.prank(depositor);
        backstop.requestRedeem(shares, depositor, depositor);
        assertEq(backstop.availableCash(), 0, "cash reserved");

        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(account);
        assertFalse(p.quotes[uint256(Venue.BACKSTOP)].ok, "backstop out of free cash");
        vm.prank(keeper);
        vm.expectPartialRevert(IBackstop.InsufficientCash.selector);
        liq.liquidate(account, 0, Venue.BACKSTOP, 0);
    }

    function _guards() internal {
        address account = _liquidatableCanary();

        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.NotMorpho.selector, address(this)));
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));

        vm.prank(net.morpho);
        vm.expectRevert(IFlashLiquidator.NotInFlight.selector);
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));

        // Only the liquidator may sell to the backstop.
        vm.deal(address(this), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotLiquidator.selector, address(this)));
        backstop.buyCollateral{value: 0.001 ether}(0);

        // The caller's profit floor binds.
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(account);
        uint256 profit = p.quotes[uint256(Venue.VAMM)].profit;
        uint256 snap = vm.snapshotState(); // the BTC mock's balance moves are not journaled
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.ProfitTooLow.selector, profit, profit + 1));
        liq.liquidate(account, 0, Venue.VAMM, profit + 1);
        vm.revertToState(snap);
        // The exact preview profit clears.
        assertEq(_liquidate(account, 0, Venue.VAMM, profit).profit, profit, "minProfit = preview clears");

        // An address without debt has nothing to liquidate.
        address nobody = makeAddr("nobody");
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.NothingToLiquidate.selector, nobody));
        liq.liquidate(nobody, 0, Venue.VAMM, 0);
    }

    function _healthyReverts() internal {
        address account = _openCanary(CANARY);
        vm.prank(keeper);
        vm.expectRevert(bytes(ErrorsLib.HEALTHY_POSITION));
        liq.liquidate(account, 0, Venue.BACKSTOP, 0);
    }
}

contract FlashLiquidatorMainnetForkTest is FlashLiquidatorForkScenarios {
    function setUp() public {
        _setUpLiquidation(Net.MAINNET, 0.002e18);
    }

    function test_mainnet_liquidateCanary_backstop() public {
        Outcome memory o = _fullLiquidation(Venue.BACKSTOP);
        assertEq(backstop.inventory(), o.seized, "backstop holds the seized BTC");
        assertEq(address(backstop).balance, o.seized, "native BTC in the backstop");
    }

    function test_mainnet_liquidateCanary_cl200() public {
        _fullLiquidation(Venue.CL200);
    }

    function test_mainnet_liquidateCanary_vamm() public {
        _fullLiquidation(Venue.VAMM);
    }

    function test_mainnet_liquidateWhileBorrowPaused() public {
        _liquidateWhilePaused(Venue.CL200);
    }

    function test_mainnet_partialLiquidation_cl200() public {
        _partialLiquidation(Venue.CL200);
    }

    function test_mainnet_backstopVenueRequiresFreeCash() public {
        _backstopVenueRequiresFreeCash();
    }

    function test_mainnet_guards() public {
        _guards();
    }

    function test_mainnet_healthyPositionReverts() public {
        _healthyReverts();
    }

    function test_mainnet_wiring() public view {
        assertEq(liq.BACKSTOP(), address(backstop));
        assertEq(backstop.LIQUIDATOR(), address(liq));
        assertEq(liq.LIQUIDATION_INCENTIVE_FACTOR(), lif);
        assertEq(liq.MAX_IMPACT_BPS(), 419);
        assertEq(backstop.DISCOUNT(), (lif - 1e18) / 2);
        assertEq(liq.CL_ROUTER(), net.clSwapRouter);
        assertEq(liq.CL_TICK_SPACING(), 200);
        MarketParams memory mp = liq.marketParams();
        assertEq(mp.collateralToken, params.collateralToken);
        assertEq(mp.lltv, 0.86e18);
    }
}

contract FlashLiquidatorTestnetForkTest is FlashLiquidatorForkScenarios {
    function setUp() public {
        _setUpLiquidation(Net.TESTNET, 0.002e18);
    }

    function test_testnet_liquidateCanary_backstop() public {
        _fullLiquidation(Venue.BACKSTOP);
    }

    function test_testnet_liquidateCanary_vamm() public {
        _fullLiquidation(Venue.VAMM);
    }

    function test_testnet_cl200Unavailable() public {
        address account = _liquidatableCanary();
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(account);
        assertFalse(p.quotes[uint256(Venue.CL200)].ok, "no CL on testnet");
        assertEq(p.quotes[uint256(Venue.CL200)].proceeds, 0, "no CL quote");
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.CL200));
        liq.liquidate(account, 0, Venue.CL200, 0);
    }

    function test_testnet_liquidateWhileBorrowPaused() public {
        _liquidateWhilePaused(Venue.VAMM);
    }

    function test_testnet_partialLiquidation_vamm() public {
        _partialLiquidation(Venue.VAMM);
    }

    function test_testnet_guards() public {
        _guards();
    }

    function test_testnet_wiring() public view {
        assertEq(liq.MAX_IMPACT_BPS(), 689);
        assertEq(liq.CL_ROUTER(), address(0));
        assertEq(liq.CL_QUOTER(), address(0));
        assertEq(liq.ROUTER(), net.router);
        assertEq(liq.POOL_FACTORY(), net.poolFactory);
    }
}
