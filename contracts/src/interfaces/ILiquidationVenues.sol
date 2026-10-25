// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Where seized BTC is sold.
/// @dev BACKSTOP: `Backstop.buyCollateral{value}` at the M1 oracle price less half the liquidation incentive.
/// CL200: Tigris BTC/MUSD concentrated-liquidity pool, tick spacing 200, through CLSwapRouter (mainnet only).
/// VAMM: Tigris BTC/MUSD basic volatile pool through the Router with `Route{BTC, MUSD, false, factory}`.
enum Venue {
    BACKSTOP,
    CL200,
    VAMM
}

/// @notice Shared surface of the contracts that sell BTC on Tigris (FlashLiquidator, Backstop).
interface ILiquidationVenues {
    /// @notice Tigris addresses for one network. A zero CL router disables the CL200 venue (testnet has no CL200
    /// pool); a zero quoter disables CL quotes only (testnet has no QuoterV2).
    struct VenueConfig {
        address clRouter;
        address clQuoter;
        address router;
        address poolFactory;
    }

    /// @notice The venue is not configured on this network (or not a DEX where a DEX is required).
    error VenueUnavailable(Venue venue);

    /// @notice Mezo's BTC ERC-20 precompile, which shares one balance with native BTC.
    function BTC() external view returns (address);

    /// @notice Tigris CLSwapRouter (zero where CL200 is unavailable).
    function CL_ROUTER() external view returns (address);

    /// @notice Tigris QuoterV2 for CL quotes (zero where absent).
    function CL_QUOTER() external view returns (address);

    /// @notice Tigris basic-pool Router.
    function ROUTER() external view returns (address);

    /// @notice Tigris basic PoolFactory used in the vAMM route.
    function POOL_FACTORY() external view returns (address);

    /// @notice Tick spacing of the BTC/MUSD CL pool used by the CL200 venue.
    function CL_TICK_SPACING() external view returns (int24);
}
