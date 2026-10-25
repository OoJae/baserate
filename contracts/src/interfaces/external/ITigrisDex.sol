// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Tigris (Mezo's Velodrome V2-style DEX) basic-pool Router, verified at mainnet
/// 0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706. `getAmountsOut` prices from stored reserves (no token calls), so it
/// makes no precompile calls even for routes through the BTC precompile token.
interface ITigrisRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);
}

/// @notice Slipstream (concentrated-liquidity) pool reads used by RiskLens. Verified `CLPool` source (solc 0.7.6) at
/// mainnet CL200 0x9CBc1537d255768b431488305b1C7EFc2ac95022 and CL10 0xCC372B7E15535aB225fe17c1075831D38ef7aC1a.
/// Slipstream's `slot0` has six fields (no `feeProtocol`).
interface ISlipstreamPool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            bool unlocked
        );

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
}

/// @notice Slipstream QuoterV2, verified at mainnet 0x4E56aF2d49D3D8F9a99155b31dd117ccDD545dC7 (absent on testnet).
/// @dev Not `view`: it runs `pool.swap` and decodes the revert raised in its own swap callback, so it needs a CALL
/// context (an `eth_call` works; a STATICCALL does not). Selling the BTC precompile token (CL200 token0) makes the
/// pool read `BTC.balanceOf(pool)` once before the callback, i.e. one precompile call per quote.
interface ISlipstreamQuoterV2 {
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
