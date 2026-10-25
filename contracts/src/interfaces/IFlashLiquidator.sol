// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {IMorphoLiquidateCallback} from "morpho-blue/interfaces/IMorphoCallbacks.sol";

import {ILiquidationVenues, Venue} from "./ILiquidationVenues.sol";

/// @notice Permissionless, zero-capital liquidator for the M1 market (MUSD loan, bcBTC collateral).
/// @dev `liquidate` calls `Morpho.liquidate` with a callback; inside `onMorphoLiquidate` the seized bcBTC is unwrapped
/// to native BTC and sold on one venue, the repaid MUSD is approved to Morpho, and the surplus goes to the caller.
/// Native BTC the liquidation leaves behind is forwarded to the caller when it can take it, else kept for
/// `sweepNative`; native BTC already held (donations) is never forwarded by `liquidate`.
interface IFlashLiquidator is ILiquidationVenues, IMorphoLiquidateCallback {
    /// @notice Per-venue outcome of selling a given amount of seized BTC.
    /// @param proceeds MUSD the venue would pay (0 when unavailable, out of cash or the quote failed).
    /// @param profit `proceeds - repaid` when the sale clears both the impact floor and the repayment, else 0.
    /// @param ok Whether a liquidation through this venue would succeed at the current state.
    struct VenueQuote {
        uint256 proceeds;
        uint256 profit;
        bool ok;
    }

    /// @notice Everything the Liquidate page and the keeper need for one borrower, for a full liquidation.
    /// @param oracleOk Whether the M1 oracle answered (a frozen oracle freezes liquidations in Morpho too).
    /// @param liquidatable Whether Morpho would accept a liquidation now.
    /// @param collateral Borrower's bcBTC collateral.
    /// @param debt Borrower's debt with interest accrued to now, rounded up.
    /// @param price M1 oracle price (MUSD wei per bcBTC wei, scaled by 1e36).
    /// @param ltvWad Debt over collateral value at `price`, in WAD (liquidatable above the LLTV).
    /// @param seizable Collateral a full liquidation seizes: enough to repay all debt, capped at the collateral.
    /// @param repaid MUSD that liquidation repays to Morpho.
    /// @param badDebt Debt Morpho would socialise because the collateral cannot cover it (0 for a healthy book).
    /// @param minProceeds The sale floor: max(seizable value x (1 - MAX_IMPACT_BPS), repaid).
    /// @param quotes Indexed by `Venue`.
    struct LiquidationPreview {
        bool oracleOk;
        bool liquidatable;
        uint256 collateral;
        uint256 debt;
        uint256 price;
        uint256 ltvWad;
        uint256 seizable;
        uint256 repaid;
        uint256 badDebt;
        uint256 minProceeds;
        VenueQuote[3] quotes;
    }

    /// @notice Emitted after a successful liquidation.
    /// @param caller Who called `liquidate` and received the profit.
    /// @param borrower The liquidated M1 position (a BorrowAccount clone).
    /// @param venue Where the seized BTC was sold.
    /// @param seized bcBTC seized (= native BTC sold).
    /// @param repaid MUSD repaid to Morpho.
    /// @param proceeds MUSD received from the venue.
    /// @param profit MUSD sent to the caller.
    event Liquidated(
        address indexed caller,
        address indexed borrower,
        Venue indexed venue,
        uint256 seized,
        uint256 repaid,
        uint256 proceeds,
        uint256 profit
    );

    /// @notice Emitted when the caller could not take the native BTC its liquidation left behind; it stays in the
    /// contract for `sweepNative`.
    event NativeKept(address indexed caller, uint256 amount);
    /// @notice Emitted when `sweepNative` sends the contract's native BTC to `to`.
    event NativeSwept(address indexed caller, address indexed to, uint256 amount);

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice `MAX_IMPACT_BPS` is zero or above the 20% hard cap.
    error InvalidMaxImpact(uint256 maxImpactBps);
    /// @notice `onMorphoLiquidate` was not called by Morpho.
    error NotMorpho(address caller);
    /// @notice `onMorphoLiquidate` was called outside this contract's own `liquidate`.
    error NotInFlight();
    /// @notice The borrower has no debt in M1.
    error NothingToLiquidate(address borrower);
    /// @notice The venue paid less than the seized value at the oracle price minus `MAX_IMPACT_BPS`.
    error ImpactTooHigh(uint256 proceeds, uint256 floor);
    /// @notice The venue paid less than Morpho will pull for the repayment.
    error InsufficientProceeds(uint256 proceeds, uint256 repaid);
    /// @notice The caller's profit is below `minProfit`.
    error ProfitTooLow(uint256 profit, uint256 minProfit);
    /// @notice `sweepNative` could not send the native BTC to `to`.
    error NativeSendFailed(address to, uint256 amount);

    /// @notice Liquidates `borrower` in M1 and sells the seized BTC through `venue`, with no capital from the caller.
    /// @param borrower The M1 position to liquidate.
    /// @param seizedAssets bcBTC to seize; 0 liquidates in full (repays all debt, or seizes all collateral when it
    /// cannot cover the debt, in which case Morpho socialises the rest).
    /// @param venue Where to sell the seized BTC.
    /// @param minProfit Minimum MUSD profit for the caller (sandwich and slippage protection).
    /// @return seized bcBTC seized.
    /// @return repaid MUSD repaid to Morpho.
    /// @return profit MUSD sent to the caller.
    function liquidate(address borrower, uint256 seizedAssets, Venue venue, uint256 minProfit)
        external
        returns (uint256 seized, uint256 repaid, uint256 profit);

    /// @notice Sends all native BTC held here to `to`. Permissionless: the contract holds nothing between
    /// transactions in normal operation, so this only moves donations and refunds a liquidation caller could not take.
    /// @return amount Native BTC sent.
    function sweepNative(address to) external returns (uint256 amount);

    /// @notice Full-liquidation preview for `borrower`, with the proceeds and profit of every venue.
    /// @dev Not a view, because QuoterV2 simulates the CL swap: call it with `eth_call` (viem `simulateContract` or
    /// `readContract`). It never changes state. Uses `Router.getAmountsOut` for the vAMM and `Backstop.quoteBuy`.
    function previewLiquidation(address borrower) external returns (LiquidationPreview memory preview);

    /// @notice Proceeds per venue for selling `btcAmount` of seized BTC now, and the oracle value of that BTC.
    /// @dev Not a view (QuoterV2); call it with `eth_call`. The keeper uses it to size partial liquidations.
    function quoteVenues(uint256 btcAmount) external returns (uint256 oracleValue, uint256[3] memory proceeds);

    /// @notice The Morpho Blue singleton.
    function MORPHO() external view returns (address);

    /// @notice The M1 market id.
    function MARKET_ID() external view returns (Id);

    /// @notice The M1 market parameters this liquidator is bound to.
    function marketParams() external view returns (MarketParams memory);

    /// @notice The Baserate backstop (bMUSD) used by the BACKSTOP venue.
    function BACKSTOP() external view returns (address);

    /// @notice Morpho's liquidation incentive factor for M1, in WAD (1.0438e18 at LLTV 0.86, 1.0741e18 at 0.77).
    function LIQUIDATION_INCENTIVE_FACTOR() external view returns (uint256);

    /// @notice Maximum shortfall of venue proceeds against the seized BTC's oracle value, in bps.
    function MAX_IMPACT_BPS() external view returns (uint256);
}
