// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {IBtcMusdOracle} from "../oracle/IBtcMusdOracle.sol";

/// @notice Stateless read model of Baserate's M1 market and its external risk inputs, for the app and the keeper.
/// @dev Every source is read in isolation: a failing source sets its bit in `Snapshot.failed` and leaves its fields
/// zero, but never reverts the snapshot. Bits in `Snapshot.skipped` mark sources that are not configured on this
/// network or not requested by the query.
interface IRiskLens {
    /// @notice Lens wiring. Every address except `factory` is optional (0 disables that source).
    /// @param factory The BorrowAccountFactory of M1 (Morpho, MUSD, oracle, IRM, LLTV and market id are read from it).
    /// @param wsMusd wsMUSD, to value a backstop's wsMUSD holdings.
    /// @param troveManager MUSD TroveManager (pairs with `sortedTroves`).
    /// @param sortedTroves MUSD SortedTroves.
    /// @param router Tigris basic Router for the BTC/MUSD volatile pool (pairs with `poolFactory`).
    /// @param poolFactory Tigris basic PoolFactory.
    /// @param quoter Slipstream QuoterV2 (mainnet only).
    /// @param clTickSpacing Tick spacing of the BTC/MUSD Slipstream pool the quoter prices (200 on mainnet).
    /// @param musdPricePool Slipstream pool pairing MUSD with a USD stablecoin (mainnet CL10 mUSDC/MUSD).
    struct LensConfig {
        address factory;
        address wsMusd;
        address troveManager;
        address sortedTroves;
        address router;
        address poolFactory;
        address quoter;
        int24 clTickSpacing;
        address musdPricePool;
    }

    /// @notice What to read.
    /// @param backstop Address whose free MUSD is reported (0 to skip).
    /// @param btcSizes BTC amounts (18 decimals) to quote BTC -> MUSD on each venue; at most `MAX_DEPTH_SIZES`.
    /// @param troveCount Troves to walk from the tail of the redemption queue; at most `MAX_TROVES`.
    /// @param twapWindow TWAP window in seconds for the MUSD price pool (0 uses `DEFAULT_TWAP_WINDOW`).
    struct Query {
        address backstop;
        uint256[] btcSizes;
        uint256 troveCount;
        uint32 twapWindow;
    }

    /// @notice M1 state, with interest accrued to `block.timestamp` (Morpho's `expectedMarketBalances`).
    /// @param created False when the market does not exist on Morpho (every other field is then 0 except params).
    /// @param utilization totalBorrowAssets / totalSupplyAssets (WAD).
    /// @param borrowRate IRM `borrowRateView` per second (WAD).
    /// @param borrowApr `borrowRate * 365 days` (WAD, simple).
    /// @param supplyApr `borrowApr * utilization * (1 - fee)` (WAD, simple).
    /// @param liquidity totalSupplyAssets - totalBorrowAssets: MUSD withdrawable or borrowable now.
    /// @param liquidationIncentive Morpho's factor `min(1.15, 1 / (1 - 0.3 * (1 - lltv)))` (WAD).
    struct MarketState {
        bool created;
        bytes32 id;
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
        uint256 totalSupplyAssets;
        uint256 totalSupplyShares;
        uint256 totalBorrowAssets;
        uint256 totalBorrowShares;
        uint256 lastUpdate;
        uint256 fee;
        uint256 utilization;
        uint256 borrowRate;
        uint256 borrowApr;
        uint256 supplyApr;
        uint256 liquidity;
        uint256 liquidationIncentive;
    }

    /// @notice Factory caps, ceilings and pause flags.
    /// @param borrowHeadroom `globalBorrowCap - totalBorrowAssets` (0 when at or over the cap or the market read
    /// failed); filled by `snapshot` only.
    struct FactoryState {
        uint256 globalBorrowCap;
        uint256 borrowHeadroom;
        uint128 standardPositionCap;
        uint16 standardCeilingBps;
        uint128 canaryPositionCap;
        uint16 canaryCeilingBps;
        uint256 maxCeilingBps;
        bool borrowPaused;
        bool creditPaused;
        address feeRecipient;
        uint256 originationFeeBps;
        address governor;
        address sentinel;
    }

    /// @notice Liquidity a backstop can deploy.
    /// @param freeMusd `musd + wsMusdAssets`: MUSD it could pay for collateral now.
    /// @param vaultRead True when `totalAssets()` (ERC-4626) answered.
    struct BackstopState {
        address backstop;
        uint256 musd;
        uint256 wsMusdShares;
        uint256 wsMusdAssets;
        uint256 freeMusd;
        uint256 nativeBtc;
        bool vaultRead;
        uint256 vaultTotalAssets;
    }

    /// @notice MUSD/USD from Pyth (as read by the oracle's `status()`) and from the MUSD price pool.
    /// @param twapPrice MUSD in USD-stable units (18 decimals) at the TWAP tick; `spotPrice` at `slot0`.
    struct MusdPrice {
        uint256 pythPrice;
        uint256 pythAge;
        bool pythFresh;
        uint32 twapWindow;
        int24 twapTick;
        uint256 twapPrice;
        uint256 spotPrice;
    }

    /// @notice A BTC -> MUSD sale of `btcIn`, as a liquidator would execute it.
    /// @param referenceOut `btcIn` valued at the oracle price (`status.price`, or Skip with MUSD at 1.00).
    /// @param clOut Slipstream CL quote (0 when not configured or failed).
    /// @param clExhausted True when the CL swap ran out of in-range liquidity (price pushed to the tick-math limit):
    /// `clOut` is then all the MUSD the pool can give, for a partial fill of `btcIn`.
    /// @param vammOut Basic-pool quote (0 when not configured or failed).
    /// @param impactBps (referenceOut - bestOut) / referenceOut in bps (0 when bestOut >= referenceOut).
    /// @param clean True when the best venue loses less than M1's liquidation incentive, i.e. a liquidation of this
    /// size clears profitably without a backstop.
    struct DepthQuote {
        uint256 btcIn;
        uint256 referenceOut;
        uint256 clOut;
        bool clExhausted;
        uint256 vammOut;
        uint256 bestOut;
        uint256 impactBps;
        bool clean;
    }

    /// @notice One trove, walked from the tail of SortedTroves (lowest NICR first = redeemed first).
    /// @param debtAhead Total debt (principal + interest) of the troves listed before this one.
    struct TroveEntry {
        address borrower;
        uint256 nicr;
        uint256 icr;
        uint256 coll;
        uint256 principal;
        uint256 interest;
        uint256 debtAhead;
    }

    /// @notice The MUSD redemption queue (Baserate positions are never redeemed; this is the comparison).
    /// @param price BTC/USD (18 decimals) used for ICR and TCR: the Skip answer from `status()`.
    struct TroveQueue {
        uint256 size;
        uint256 price;
        uint256 tcr;
        bool recoveryMode;
        TroveEntry[] entries;
    }

    /// @notice Everything in one call.
    /// @param failed Bitmask of `SRC_*` sources that were attempted and (at least partly) failed.
    /// @param skipped Bitmask of `SRC_*` sources not configured or not requested.
    /// @param precompileCalls Precompile executions made by this snapshot itself (Skip via `status()` plus one BTC
    /// precompile read per CL quote), excluding anything a backstop's `totalAssets()` might do.
    struct Snapshot {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 failed;
        uint256 skipped;
        uint256 precompileCalls;
        IBtcMusdOracle.Status oracle;
        MarketState market;
        FactoryState factory;
        BackstopState backstop;
        MusdPrice musd;
        DepthQuote[] depth;
        TroveQueue troves;
    }

    /// @notice `factory` is zero.
    error ZeroFactory();
    /// @notice A pair of addresses that must be set together is half set, or a configured contract has no code.
    error InvalidConfig();
    /// @notice The MUSD price pool does not contain MUSD.
    error PricePoolWithoutMusd(address pool);
    /// @notice More BTC sizes than `MAX_DEPTH_SIZES` (keeps the snapshot within Mezo's precompile limit).
    error TooManySizes(uint256 count, uint256 max);
    /// @notice More troves than `MAX_TROVES`.
    error TooManyTroves(uint256 count, uint256 max);
    /// @notice `twapWindow` is outside [`MIN_TWAP_WINDOW`, `MAX_TWAP_WINDOW`].
    error InvalidTwapWindow(uint32 window);

    /// @notice One-call snapshot. See `Query` and `Snapshot`.
    /// @dev Declared `view` and stateless, but CL quotes need a CALL context: call it with `eth_call` (viem
    /// `readContract` does). When reached through a STATICCALL (another contract's view), CL quotes are detected as
    /// unavailable and flagged in `failed`; everything else is unaffected.
    function snapshot(Query calldata q) external view returns (Snapshot memory s);

    /// @notice M1 market state with interest accrued to now.
    function marketState() external view returns (MarketState memory m);

    /// @notice Factory caps, ceilings, pause flags and roles.
    function factoryState() external view returns (FactoryState memory f);

    /// @notice Free MUSD of `backstop`.
    function backstopState(address backstop) external view returns (BackstopState memory b);

    /// @notice MUSD price from the MUSD price pool: TWAP over `window` seconds and spot.
    function musdPoolPrice(uint32 window) external view returns (int24 twapTick, uint256 twapPrice, uint256 spotPrice);

    /// @notice BTC -> MUSD quote on the basic volatile pool through the Router (0 when the pool does not exist).
    function vammQuote(uint256 btcIn) external view returns (uint256 musdOut);

    /// @notice BTC -> MUSD quote on the Slipstream pool through QuoterV2. Needs a CALL context (see `snapshot`).
    /// @return ok False when not configured, in a STATICCALL context, or when the quote failed.
    /// @return musdOut MUSD out.
    /// @return exhausted True when in-range liquidity ran out (a partial fill; see `DepthQuote.clExhausted`).
    function clQuote(uint256 btcIn) external view returns (bool ok, uint256 musdOut, bool exhausted);

    /// @notice The first `count` troves of the redemption queue, priced at `price` (BTC/USD, 18 decimals).
    function troveQueue(uint256 count, uint256 price) external view returns (TroveQueue memory t);

    /// @notice Writes one transient slot; succeeds only in a CALL context. Used to detect STATICCALL before quoting.
    function probeCallContext() external;
}
