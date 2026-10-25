// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {
    LIQUIDATION_CURSOR,
    MAX_LIQUIDATION_INCENTIVE_FACTOR,
    ORACLE_PRICE_SCALE
} from "morpho-blue/libraries/ConstantsLib.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MathLib, WAD} from "morpho-blue/libraries/MathLib.sol";
import {SharesMathLib} from "morpho-blue/libraries/SharesMathLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBackstop} from "../interfaces/IBackstop.sol";
import {ICollateralBTC} from "../interfaces/ICollateralBTC.sol";
import {IFlashLiquidator} from "../interfaces/IFlashLiquidator.sol";
import {Venue} from "../interfaces/ILiquidationVenues.sol";
import {TigrisVenues} from "./TigrisVenues.sol";

/// @title FlashLiquidator
/// @notice Permissionless, immutable, zero-capital liquidator for Baserate's M1 market on Mezo's Morpho Blue.
/// Anyone calls `liquidate(borrower, seized, venue, minProfit)`; Morpho hands over the seized bcBTC, this contract
/// unwraps it to native BTC and sells it on the chosen venue, Morpho pulls the repaid MUSD, and the surplus (the
/// liquidation incentive less the venue's discount or price impact) goes to the caller.
/// @dev Flow:
/// 1. `liquidate` (transient guard) sets a transient in-flight flag and calls
///    `Morpho.liquidate(M1, borrower, seized, repaidShares, abi.encode(venue))`. With `seizedAssets == 0` it first
///    accrues interest and reads the oracle to liquidate in full: by all borrow shares when the collateral covers
///    them at the incentive, else by all collateral (Morpho then socialises the shortfall).
/// 2. `onMorphoLiquidate` (Morpho only, in-flight only, single use) unwraps the bcBTC, sells it through the venue,
///    requires proceeds >= seized x oracle price x (1 - MAX_IMPACT_BPS) and >= the repayment, and approves Morpho.
/// 3. Back in `liquidate`: the caller's profit must reach `minProfit`; all MUSD and any native BTC left (router
///    refunds, a CL partial fill) go to the caller, so the contract holds nothing between transactions.
/// The oracle price is the M1 oracle's: Skip BTC/USD (staleness-checked, Pyth-banded) over the MUSD leg clamped to
/// [1.00, 1.02], exactly the price Morpho used to size the seizure.
///
/// Precompile budget per liquidation (Mezo allows 20 per transaction; native value transfers are not precompile
/// calls). Skip: Morpho's `price()` 1, plus 1 more (the full-size pre-read, reused in the callback, or the callback's
/// own read for an explicit size). BTC precompile: 0 for the backstop (it takes native `msg.value`), 4 on CL200,
/// 5 on the vAMM (see TigrisVenues). The backstop venue adds the backstop's own Skip read.
/// | Venue    | Skip | BTC | Total |
/// | BACKSTOP |  3   |  0  |   3   |
/// | CL200    |  2   |  4  |   6   |
/// | VAMM     |  2   |  5  |   7   |
/// `previewLiquidation` costs 3 (oracle, backstop quote, QuoterV2's pool balance read).
contract FlashLiquidator is IFlashLiquidator, TigrisVenues, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using MathLib for uint256;
    using SharesMathLib for uint256;
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant BPS = 10_000;
    /// @notice Hard upper bound on `MAX_IMPACT_BPS`.
    uint256 public constant MAX_IMPACT_CAP_BPS = 2000;

    /// @inheritdoc IFlashLiquidator
    address public immutable MORPHO;
    /// @inheritdoc IFlashLiquidator
    Id public immutable MARKET_ID;
    /// @inheritdoc IFlashLiquidator
    address public immutable BACKSTOP;
    /// @inheritdoc IFlashLiquidator
    uint256 public immutable LIQUIDATION_INCENTIVE_FACTOR;
    /// @inheritdoc IFlashLiquidator
    uint256 public immutable MAX_IMPACT_BPS;

    address internal immutable _MUSD;
    address internal immutable _COLLATERAL;
    address internal immutable _ORACLE;
    address internal immutable _IRM;
    uint256 internal immutable _LLTV;

    /// @dev Set by `liquidate` around the Morpho call; `onMorphoLiquidate` consumes it.
    bool private transient _inFlight;
    /// @dev Oracle price read by a full-size `liquidate`, reused in the callback (same transaction, same price).
    uint256 private transient _cachedPrice;
    /// @dev Venue proceeds of the current liquidation, for the event.
    uint256 private transient _proceeds;

    /// @param morpho Mezo's Morpho Blue singleton.
    /// @param params The M1 market (MUSD loan, bcBTC collateral, BtcMusdOracle, AdaptiveCurveIrm, LLTV).
    /// @param backstop The Backstop (bMUSD); zero disables the BACKSTOP venue.
    /// @param maxImpactBps Maximum shortfall of proceeds against the seized BTC's oracle value. Set it to the
    /// break-even impact `1 - 1/LIF` (419 bps at LLTV 0.86, 689 bps at 0.77) and at least the backstop discount.
    /// @param venues Tigris addresses; zero entries disable the matching venue.
    constructor(
        address morpho,
        MarketParams memory params,
        address backstop,
        uint256 maxImpactBps,
        VenueConfig memory venues
    ) TigrisVenues(params.loanToken, venues) {
        if (
            morpho == address(0) || params.loanToken == address(0) || params.collateralToken == address(0)
                || params.oracle == address(0) || params.irm == address(0)
        ) revert ZeroAddress();
        if (maxImpactBps == 0 || maxImpactBps > MAX_IMPACT_CAP_BPS) revert InvalidMaxImpact(maxImpactBps);

        MORPHO = morpho;
        MARKET_ID = params.id();
        BACKSTOP = backstop;
        MAX_IMPACT_BPS = maxImpactBps;
        _MUSD = params.loanToken;
        _COLLATERAL = params.collateralToken;
        _ORACLE = params.oracle;
        _IRM = params.irm;
        _LLTV = params.lltv;
        uint256 lif = WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - params.lltv));
        LIQUIDATION_INCENTIVE_FACTOR = lif < MAX_LIQUIDATION_INCENTIVE_FACTOR ? lif : MAX_LIQUIDATION_INCENTIVE_FACTOR;
    }

    /// @notice Receives native BTC from bcBTC unwraps and router refunds.
    receive() external payable {}

    // ---------------------------------------------------------------- liquidation

    /// @inheritdoc IFlashLiquidator
    function liquidate(address borrower, uint256 seizedAssets, Venue venue, uint256 minProfit)
        external
        nonReentrant
        returns (uint256 seized, uint256 repaid, uint256 profit)
    {
        if (!_venueAvailable(venue)) revert VenueUnavailable(venue);
        MarketParams memory params = marketParams();

        uint256 repaidShares;
        if (seizedAssets == 0) {
            IMorpho(MORPHO).accrueInterest(params);
            Position memory pos = IMorpho(MORPHO).position(MARKET_ID, borrower);
            if (pos.borrowShares == 0) revert NothingToLiquidate(borrower);
            Market memory m = IMorpho(MORPHO).market(MARKET_ID);
            uint256 price = IOracle(_ORACLE).price();
            _cachedPrice = price;
            // Morpho's own seizure formula for a repayment by shares.
            uint256 seizeAll = uint256(pos.borrowShares)
                .toAssetsDown(m.totalBorrowAssets, m.totalBorrowShares)
                .wMulDown(LIQUIDATION_INCENTIVE_FACTOR)
                .mulDivDown(ORACLE_PRICE_SCALE, price);
            if (seizeAll <= pos.collateral) repaidShares = pos.borrowShares;
            else seizedAssets = pos.collateral;
        }

        _inFlight = true;
        (seized, repaid) = IMorpho(MORPHO).liquidate(params, borrower, seizedAssets, repaidShares, abi.encode(venue));
        // Morpho always calls back when data is non-empty and the callback consumes the flag; clear it regardless.
        _inFlight = false;
        _cachedPrice = 0;
        uint256 proceeds = _proceeds;
        _proceeds = 0;

        profit = IERC20(_MUSD).balanceOf(address(this));
        if (profit < minProfit) revert ProfitTooLow(profit, minProfit);
        if (profit != 0) IERC20(_MUSD).safeTransfer(msg.sender, profit);
        uint256 leftover = address(this).balance;
        if (leftover != 0) {
            (bool ok,) = msg.sender.call{value: leftover}("");
            if (!ok) revert NativeSendFailed(msg.sender, leftover);
        }
        emit Liquidated(msg.sender, borrower, venue, seized, repaid, proceeds, profit);
    }

    /// @notice Morpho liquidation callback: unwraps the seized bcBTC, sells it on the venue and approves the repayment.
    /// @dev Only Morpho, only inside this contract's own `liquidate`, and only once per liquidation.
    function onMorphoLiquidate(uint256 repaidAssets, bytes calldata data) external {
        if (msg.sender != MORPHO) revert NotMorpho(msg.sender);
        if (!_inFlight) revert NotInFlight();
        _inFlight = false;

        Venue venue = abi.decode(data, (Venue));
        // Only Morpho's liquidations can send bcBTC here (the bcBTC gate), so the balance is what was just seized.
        uint256 seized = IERC20(_COLLATERAL).balanceOf(address(this));
        if (seized != 0) ICollateralBTC(_COLLATERAL).unwrap(seized, address(this));

        uint256 price = _cachedPrice;
        if (price == 0) price = IOracle(_ORACLE).price();
        uint256 floor = _impactFloor(seized, price);

        uint256 musdBefore = IERC20(_MUSD).balanceOf(address(this));
        if (venue == Venue.BACKSTOP) IBackstop(BACKSTOP).buyCollateral{value: seized}(floor);
        else _sellOnDex(venue, seized);
        uint256 proceeds = IERC20(_MUSD).balanceOf(address(this)) - musdBefore;

        if (proceeds < floor) revert ImpactTooHigh(proceeds, floor);
        if (proceeds < repaidAssets) revert InsufficientProceeds(proceeds, repaidAssets);
        _proceeds = proceeds;
        IERC20(_MUSD).forceApprove(MORPHO, repaidAssets);
    }

    // ---------------------------------------------------------------- previews

    /// @inheritdoc IFlashLiquidator
    function previewLiquidation(address borrower) external returns (LiquidationPreview memory p) {
        Position memory pos = IMorpho(MORPHO).position(MARKET_ID, borrower);
        (,, uint256 totalBorrowAssets, uint256 totalBorrowShares) =
            IMorpho(MORPHO).expectedMarketBalances(marketParams());
        uint256 shares = pos.borrowShares;
        p.collateral = pos.collateral;
        p.debt = shares.toAssetsUp(totalBorrowAssets, totalBorrowShares);

        try IOracle(_ORACLE).price() returns (uint256 price) {
            p.oracleOk = true;
            p.price = price;
        } catch {
            return p;
        }
        uint256 collValue = p.collateral.mulDivDown(p.price, ORACLE_PRICE_SCALE);
        if (collValue != 0) p.ltvWad = p.debt.wDivUp(collValue);
        else if (p.debt != 0) p.ltvWad = type(uint256).max;
        // Morpho's `_isHealthy`, on interest-accrued totals.
        p.liquidatable = shares != 0 && collValue.wMulDown(_LLTV) < p.debt;
        if (!p.liquidatable) return p;

        uint256 seizeAll = shares.toAssetsDown(totalBorrowAssets, totalBorrowShares)
            .wMulDown(LIQUIDATION_INCENTIVE_FACTOR)
            .mulDivDown(ORACLE_PRICE_SCALE, p.price);
        if (seizeAll <= p.collateral) {
            p.seizable = seizeAll;
            p.repaid = p.debt;
        } else {
            p.seizable = p.collateral;
            uint256 repaidShares = p.collateral
                .mulDivUp(p.price, ORACLE_PRICE_SCALE)
                .wDivUp(LIQUIDATION_INCENTIVE_FACTOR)
                .toSharesUp(totalBorrowAssets, totalBorrowShares);
            p.repaid = repaidShares.toAssetsUp(totalBorrowAssets, totalBorrowShares);
            p.badDebt = p.debt > p.repaid ? p.debt - p.repaid : 0;
        }

        uint256 floor = _impactFloor(p.seizable, p.price);
        p.minProceeds = floor > p.repaid ? floor : p.repaid;
        uint256[3] memory proceeds = _quoteAll(p.seizable);
        for (uint256 i; i < 3; ++i) {
            bool ok = proceeds[i] != 0 && proceeds[i] >= p.minProceeds;
            p.quotes[i] = VenueQuote({proceeds: proceeds[i], profit: ok ? proceeds[i] - p.repaid : 0, ok: ok});
        }
    }

    /// @inheritdoc IFlashLiquidator
    function quoteVenues(uint256 btcAmount) external returns (uint256 oracleValue, uint256[3] memory proceeds) {
        oracleValue = btcAmount.mulDivDown(IOracle(_ORACLE).price(), ORACLE_PRICE_SCALE);
        proceeds = _quoteAll(btcAmount);
    }

    /// @inheritdoc IFlashLiquidator
    function marketParams() public view returns (MarketParams memory) {
        return MarketParams({loanToken: _MUSD, collateralToken: _COLLATERAL, oracle: _ORACLE, irm: _IRM, lltv: _LLTV});
    }

    // ---------------------------------------------------------------- internal

    function _venueAvailable(Venue venue) internal view returns (bool) {
        return venue == Venue.BACKSTOP ? BACKSTOP != address(0) : _dexAvailable(venue);
    }

    /// @dev Oracle value of `btc` less `MAX_IMPACT_BPS`.
    function _impactFloor(uint256 btc, uint256 price) internal view returns (uint256) {
        return btc.mulDivDown(price, ORACLE_PRICE_SCALE).mulDivDown(BPS - MAX_IMPACT_BPS, BPS);
    }

    function _quoteAll(uint256 btc) internal returns (uint256[3] memory proceeds) {
        if (BACKSTOP != address(0) && btc != 0) proceeds[uint256(Venue.BACKSTOP)] = IBackstop(BACKSTOP).quoteBuy(btc);
        proceeds[uint256(Venue.CL200)] = _quoteDex(Venue.CL200, btc);
        proceeds[uint256(Venue.VAMM)] = _quoteDex(Venue.VAMM, btc);
    }
}
