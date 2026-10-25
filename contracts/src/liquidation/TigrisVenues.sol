// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ILiquidationVenues, Venue} from "../interfaces/ILiquidationVenues.sol";
import {ICLQuoterV2} from "../interfaces/external/ICLQuoterV2.sol";
import {ICLSwapRouter} from "../interfaces/external/ICLSwapRouter.sol";
import {ITigrisRouter} from "../interfaces/external/ITigrisRouter.sol";

/// @title TigrisVenues
/// @notice Sells native BTC for MUSD on Tigris: the BTC/MUSD CL200 pool through CLSwapRouter, or the BTC/MUSD basic
/// volatile pool through the Router. Shared by the FlashLiquidator and the Backstop's keeper sales.
/// @dev Mezo's BTC is native and also an ERC-20 precompile at `BTC` with one shared balance. The DEX venues take the
/// precompile token: this contract approves the router on the precompile, and the router (or pool callback) pulls it
/// with `transferFrom`, which moves native balance. Nothing here wraps BTC.
/// Callers must measure proceeds by MUSD balance delta and enforce their own floor: the routers are called with a
/// zero minimum so that a shortfall surfaces as the caller's custom error, inside the same transaction.
/// BTC precompile calls per sale (each counts towards Mezo's 20-per-transaction limit, see docs/design §0.5):
/// - CL200: `approve` 1, pool `balance0()` before and after the callback 2, router `transferFrom` 1 = 4;
/// - vAMM: `approve` 1, router `transferFrom` 1, pool `balanceOf` before and after taking the fee 2, the fee
///   `transfer` to PoolFees 1 = 5.
/// Quotes: CL200 via QuoterV2 costs 1 BTC read (the pool's `balance0()`); vAMM via `Router.getAmountsOut` costs 0.
abstract contract TigrisVenues is ILiquidationVenues {
    using SafeERC20 for IERC20;

    /// @inheritdoc ILiquidationVenues
    address public constant BTC = 0x7b7C000000000000000000000000000000000000;
    /// @inheritdoc ILiquidationVenues
    int24 public constant CL_TICK_SPACING = 200;

    /// @inheritdoc ILiquidationVenues
    address public immutable CL_ROUTER;
    /// @inheritdoc ILiquidationVenues
    address public immutable CL_QUOTER;
    /// @inheritdoc ILiquidationVenues
    address public immutable ROUTER;
    /// @inheritdoc ILiquidationVenues
    address public immutable POOL_FACTORY;

    /// @dev The MUSD token both venues pay out.
    address private immutable _OUT_TOKEN;

    /// @param musd MUSD, the token every venue pays out.
    /// @param venues Tigris addresses; zero entries disable the matching venue.
    constructor(address musd, VenueConfig memory venues) {
        _OUT_TOKEN = musd;
        CL_ROUTER = venues.clRouter;
        CL_QUOTER = venues.clQuoter;
        ROUTER = venues.router;
        POOL_FACTORY = venues.poolFactory;
    }

    /// @dev Whether `venue` is a configured DEX venue on this network.
    function _dexAvailable(Venue venue) internal view returns (bool) {
        if (venue == Venue.CL200) return CL_ROUTER != address(0);
        if (venue == Venue.VAMM) return ROUTER != address(0) && POOL_FACTORY != address(0);
        return false;
    }

    /// @dev Sells `btcIn` native BTC (as the precompile token) on a DEX venue; MUSD lands on this contract. The
    /// caller measures the proceeds and enforces its floor.
    function _sellOnDex(Venue venue, uint256 btcIn) internal {
        if (!_dexAvailable(venue)) revert VenueUnavailable(venue);
        if (venue == Venue.CL200) {
            IERC20(BTC).forceApprove(CL_ROUTER, btcIn);
            ICLSwapRouter(CL_ROUTER)
                .exactInputSingle(
                    ICLSwapRouter.ExactInputSingleParams({
                        tokenIn: BTC,
                        tokenOut: _OUT_TOKEN,
                        tickSpacing: CL_TICK_SPACING,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: btcIn,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    })
                );
        } else {
            IERC20(BTC).forceApprove(ROUTER, btcIn);
            ITigrisRouter(ROUTER).swapExactTokensForTokens(btcIn, 0, _vammRoute(), address(this), block.timestamp);
        }
    }

    /// @dev MUSD a DEX venue would pay for `btcIn` right now, or 0 when the venue or its quoter is unavailable or the
    /// quote fails. Not a view: QuoterV2 simulates the swap and reverts internally, so call it through `eth_call`.
    function _quoteDex(Venue venue, uint256 btcIn) internal returns (uint256) {
        if (btcIn == 0 || !_dexAvailable(venue)) return 0;
        if (venue == Venue.CL200) {
            if (CL_QUOTER == address(0)) return 0;
            try ICLQuoterV2(CL_QUOTER)
                .quoteExactInputSingle(
                    ICLQuoterV2.QuoteExactInputSingleParams({
                        tokenIn: BTC,
                        tokenOut: _OUT_TOKEN,
                        amountIn: btcIn,
                        tickSpacing: CL_TICK_SPACING,
                        sqrtPriceLimitX96: 0
                    })
                ) returns (
                uint256 amountOut, uint160, uint32, uint256
            ) {
                return amountOut;
            } catch {
                return 0;
            }
        }
        try ITigrisRouter(ROUTER).getAmountsOut(btcIn, _vammRoute()) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    function _vammRoute() internal view returns (ITigrisRouter.Route[] memory routes) {
        routes = new ITigrisRouter.Route[](1);
        routes[0] = ITigrisRouter.Route({from: BTC, to: _OUT_TOKEN, stable: false, factory: POOL_FACTORY});
    }
}
