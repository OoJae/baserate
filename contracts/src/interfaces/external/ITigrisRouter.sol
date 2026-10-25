// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Tigris basic-pool (Velodrome V2) Router: mainnet 0x16A7...C706, testnet 0x9a1f...D7E9.
/// @dev Verified source (solc 0.8.24). Routes are `Route{from, to, stable, factory}` (the docs' `address[]` path
/// sample is wrong). `swapExactTokensForTokens` pulls `amountIn` of `routes[0].from` from the caller straight into the
/// pool with `transferFrom`, so for BTC the caller approves the router on the BTC precompile first.
interface ITigrisRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
