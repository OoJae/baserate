// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Tigris (Velodrome Slipstream) QuoterV2, mainnet 0x4E56...dC7; absent on testnet.
/// @dev Not a view: it runs the pool swap and decodes the amounts from the revert, so it only works in a regular
/// call (an `eth_call` is fine). Under STATICCALL the pool's lock write fails and the quote reverts. One BTC precompile
/// read per quote (the pool's `balance0()` before the callback).
interface ICLQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        int24 tickSpacing;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
