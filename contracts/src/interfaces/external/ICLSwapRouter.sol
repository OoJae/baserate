// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Tigris (Velodrome Slipstream) CLSwapRouter, mainnet 0x37cD...6225, the subset Baserate uses.
/// @dev Verified source (solc 0.7.6): pools are keyed by `tickSpacing`, not fee. `pay()` pulls `tokenIn` from the
/// caller with `transferFrom`, except that for tokenIn == BTC it first pays from the router's own native balance when
/// that covers the amount. Every `exactInputSingle` ends with `refundBTC()`, which sends any native BTC the router
/// holds to the caller with a plain call, so contract callers need a `receive()`.
interface ICLSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
