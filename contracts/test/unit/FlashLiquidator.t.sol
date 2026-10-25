// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {FlashLiquidator} from "../../src/liquidation/FlashLiquidator.sol";

/// @notice FlashLiquidator unit tests that need no Morpho: construction, incentive math, venue gating and the
/// callback guards. The economic paths run on the mainnet and testnet forks.
contract FlashLiquidatorTest is Test {
    using MarketParamsLib for MarketParams;

    address internal morpho = makeAddr("morpho");
    address internal backstop = makeAddr("backstop");
    MarketParams internal params;
    ILiquidationVenues.VenueConfig internal noVenues;
    FlashLiquidator internal liq;

    function setUp() public {
        params = MarketParams({
            loanToken: makeAddr("musd"),
            collateralToken: makeAddr("bcBTC"),
            oracle: makeAddr("oracle"),
            irm: makeAddr("irm"),
            lltv: 0.86e18
        });
        liq = new FlashLiquidator(morpho, params, backstop, 419, noVenues);
    }

    function test_constructor_wiring() public view {
        assertEq(liq.MORPHO(), morpho);
        assertEq(liq.BACKSTOP(), backstop);
        assertEq(liq.MAX_IMPACT_BPS(), 419);
        assertEq(Id.unwrap(liq.MARKET_ID()), Id.unwrap(params.id()));
        MarketParams memory mp = liq.marketParams();
        assertEq(mp.loanToken, params.loanToken);
        assertEq(mp.collateralToken, params.collateralToken);
        assertEq(mp.oracle, params.oracle);
        assertEq(mp.irm, params.irm);
        assertEq(mp.lltv, params.lltv);
        assertEq(liq.BTC(), 0x7b7C000000000000000000000000000000000000);
        assertEq(liq.CL_TICK_SPACING(), 200);
    }

    function test_incentiveFactor_matchesMorpho() public {
        // min(1.15, 1 / (1 - 0.3 x (1 - lltv))), Morpho rounding.
        assertEq(liq.LIQUIDATION_INCENTIVE_FACTOR(), uint256(1e36) / 0.958e18, "LLTV 0.86: 4.38%");
        params.lltv = 0.77e18;
        FlashLiquidator l77 = new FlashLiquidator(morpho, params, backstop, 689, noVenues);
        assertEq(l77.LIQUIDATION_INCENTIVE_FACTOR(), uint256(1e36) / 0.931e18, "LLTV 0.77: 7.41%");
        params.lltv = 0.1e18;
        FlashLiquidator l10 = new FlashLiquidator(morpho, params, backstop, 1000, noVenues);
        assertEq(l10.LIQUIDATION_INCENTIVE_FACTOR(), 1.15e18, "capped at 1.15");
    }

    function test_constructor_rejects() public {
        vm.expectRevert(IFlashLiquidator.ZeroAddress.selector);
        new FlashLiquidator(address(0), params, backstop, 419, noVenues);
        MarketParams memory bad = params;
        bad.oracle = address(0);
        vm.expectRevert(IFlashLiquidator.ZeroAddress.selector);
        new FlashLiquidator(morpho, bad, backstop, 419, noVenues);
        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.InvalidMaxImpact.selector, 0));
        new FlashLiquidator(morpho, params, backstop, 0, noVenues);
        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.InvalidMaxImpact.selector, 2001));
        new FlashLiquidator(morpho, params, backstop, 2001, noVenues);
    }

    function test_liquidate_unconfiguredVenuesRevert() public {
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.CL200));
        liq.liquidate(address(1), 1, Venue.CL200, 0);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.VAMM));
        liq.liquidate(address(1), 1, Venue.VAMM, 0);

        FlashLiquidator noBackstop = new FlashLiquidator(morpho, params, address(0), 419, noVenues);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationVenues.VenueUnavailable.selector, Venue.BACKSTOP));
        noBackstop.liquidate(address(1), 1, Venue.BACKSTOP, 0);
    }

    function test_callback_onlyMorphoAndOnlyInFlight() public {
        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.NotMorpho.selector, address(this)));
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));

        vm.prank(morpho);
        vm.expectRevert(IFlashLiquidator.NotInFlight.selector);
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));
    }

    function test_receivesNativeBtc() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(liq).call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(address(liq).balance, 0.1 ether);
    }
}
