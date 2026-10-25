// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Id, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {FlashLiquidator} from "../../src/liquidation/FlashLiquidator.sol";
import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {BtcPrecompileMock} from "../utils/BtcPrecompileMock.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice Fixture for the liquidation suites: a pinned Mezo fork with the Skip mock and the BTC precompile mock
/// etched, the real BtcMusdOracle (real Pyth), a fresh M1 market through the factory, wsMUSD over the real sMUSD, the
/// Backstop (seeded) and the FlashLiquidator wired to the real Tigris pools.
abstract contract LiquidationForkBase is MezoFork {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    struct Outcome {
        uint256 seized;
        uint256 repaid;
        uint256 profit;
        uint256 gas;
        uint256 skipCalls;
        uint256 btcCalls;
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant LENDER_SEED = 50_000e18;
    uint256 internal constant BACKSTOP_SEED = 5000e18;
    uint256 internal constant MAX_KEEPER_SALE = 0.05e18;
    uint256 internal constant PRECOMPILE_LIMIT = 20;

    BtcPrecompileMock internal btc;
    BtcMusdOracle internal oracle;
    BorrowAccountFactory internal factory;
    WsMUSD internal wsMusd;
    Backstop internal backstop;
    FlashLiquidator internal liq;
    IMorpho internal morpho;
    IERC20 internal musd;
    MarketParams internal params;
    Id internal marketId;
    uint256 internal lif;
    uint256 internal maxImpactBps;
    uint16 internal canaryCeiling;
    bool internal isMainnet;

    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal canaryOp = makeAddr("canaryOperator");
    address internal lender = makeAddr("lender");
    address internal keeper = makeAddr("keeper");
    address internal depositor = makeAddr("depositor");
    address internal feeTo = makeAddr("feeRecipient");

    function _setUpLiquidation(Net which, uint128 canaryCap) internal {
        _fork(which);
        btc = _etchBtc();
        isMainnet = which == Net.MAINNET;
        canaryCeiling = isMainnet ? 8575 : 7675;

        oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: governor,
                sentinel: sentinel,
                feeRecipient: feeTo,
                globalBorrowCap: 100_000e18,
                standard: IBorrowAccountFactory.Limits({positionCap: 0.02e18, ceilingBps: isMainnet ? 7100 : 6200}),
                canary: IBorrowAccountFactory.Limits({positionCap: canaryCap, ceilingBps: canaryCeiling})
            })
        );
        vm.prank(governor);
        factory.setCanaryOperator(canaryOp, true);

        morpho = IMorpho(net.morpho);
        musd = IERC20(net.musd);
        params = factory.marketParams();
        morpho.createMarket(params);
        marketId = params.id();
        deal(net.musd, lender, LENDER_SEED);
        vm.startPrank(lender);
        musd.approve(net.morpho, LENDER_SEED);
        morpho.supply(params, LENDER_SEED, 0, lender, "");
        vm.stopPrank();

        wsMusd = new WsMUSD(net.musd, net.smusd, governor, 250_000e18);
        lif = _lif(net.lltv);
        maxImpactBps = (lif - 1e18) * BPS / lif; // break-even impact: 419 bps at 0.86, 690 bps at 0.77
        ILiquidationVenues.VenueConfig memory venues = ILiquidationVenues.VenueConfig({
            clRouter: net.clSwapRouter, clQuoter: net.clQuoter, router: net.router, poolFactory: net.poolFactory
        });
        // The two contracts reference each other: predict the liquidator's CREATE address.
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        backstop = new Backstop(
            IBackstop.BackstopParams({
                musd: net.musd,
                wsMusd: address(wsMusd),
                oracle: address(oracle),
                lltv: net.lltv,
                liquidator: predicted,
                sentinel: sentinel,
                maxKeeperSale: MAX_KEEPER_SALE,
                venues: venues
            })
        );
        liq = new FlashLiquidator(net.morpho, params, address(backstop), maxImpactBps, venues);
        assertEq(address(liq), predicted, "liquidator address");

        _depositBackstop(depositor, BACKSTOP_SEED);
        vm.label(address(liq), "FlashLiquidator");
        vm.label(address(backstop), "Backstop");
        vm.label(address(wsMusd), "wsMUSD");
        vm.label(address(oracle), "BtcMusdOracle");
        vm.label(address(factory), "factory");
    }

    // ---------------------------------------------------------------- helpers

    function _lif(uint256 lltv) internal pure returns (uint256) {
        uint256 l = 1e18 * 1e18 / (1e18 - 0.3e18 * (1e18 - lltv) / 1e18);
        return l < 1.15e18 ? l : 1.15e18;
    }

    function _depositBackstop(address who, uint256 assets) internal returns (uint256 shares) {
        deal(net.musd, who, musd.balanceOf(who) + assets);
        vm.startPrank(who);
        musd.approve(address(backstop), assets);
        shares = backstop.deposit(assets, who);
        vm.stopPrank();
    }

    function _skipAnswer() internal view returns (int256 answer) {
        (, answer,,,) = skipOracle.latestRoundData();
    }

    /// @dev Moves the Skip BTC/USD answer down by `bps`.
    function _dropSkip(uint256 bps) internal {
        skipOracle.setAnswer(_skipAnswer() * int256(BPS - bps) / int256(BPS));
    }

    function _value(uint256 coll) internal view returns (uint256) {
        return coll * oracle.price() / 1e36;
    }

    /// @dev Largest `musdOut` whose debt (musdOut + 10 bps fee) keeps `coll` at or under `ltvBps`.
    function _maxMusdOut(uint256 coll, uint256 ltvBps) internal view returns (uint256 m) {
        uint256 maxDebt = _value(coll) * ltvBps / BPS;
        m = maxDebt * BPS / (BPS + 10);
        while (m + 1 + (m + 1 + 999) / 1000 <= maxDebt) ++m;
        while (m != 0 && m + (m * 10 + BPS - 1) / BPS > maxDebt) --m;
    }

    /// @dev The canary operator opens a canary at the canary ceiling (the live canary-operator path).
    function _openCanary(uint256 coll) internal returns (address account) {
        uint256 musdOut = _maxMusdOut(coll, canaryCeiling);
        vm.deal(canaryOp, canaryOp.balance + coll);
        vm.prank(canaryOp);
        account = factory.openCanary{value: coll}(musdOut, canaryCeiling);
    }

    function _position(address account) internal view returns (Position memory) {
        return morpho.position(marketId, account);
    }

    /// @dev Calls the liquidator as `keeper` while recording gas and every call into the Skip and BTC precompiles.
    function _liquidate(address borrower, uint256 seizedAssets, Venue venue, uint256 minProfit)
        internal
        returns (Outcome memory o)
    {
        uint256 before = musd.balanceOf(keeper);
        vm.startStateDiffRecording();
        uint256 g = gasleft();
        vm.prank(keeper);
        (o.seized, o.repaid, o.profit) = liq.liquidate(borrower, seizedAssets, venue, minProfit);
        o.gas = g - gasleft();
        (o.skipCalls, o.btcCalls) = _countPrecompiles(vm.stopAndReturnStateDiff());
        assertEq(musd.balanceOf(keeper) - before, o.profit, "profit paid to caller");
    }

    function _countPrecompiles(VmSafe.AccountAccess[] memory accesses)
        internal
        pure
        returns (uint256 skipCalls, uint256 btcCalls)
    {
        for (uint256 i; i < accesses.length; ++i) {
            VmSafe.AccountAccessKind k = accesses[i].kind;
            if (
                k != VmSafe.AccountAccessKind.Call && k != VmSafe.AccountAccessKind.StaticCall
                    && k != VmSafe.AccountAccessKind.DelegateCall && k != VmSafe.AccountAccessKind.CallCode
            ) continue;
            if (accesses[i].account == MezoAddresses.SKIP_BTC_USD) skipCalls++;
            else if (accesses[i].account == MezoAddresses.BTC) btcCalls++;
        }
    }

    /// @dev The liquidator never keeps funds between transactions.
    function _assertLiquidatorEmpty() internal view {
        assertEq(musd.balanceOf(address(liq)), 0, "liquidator MUSD");
        assertEq(address(liq).balance, 0, "liquidator BTC");
        assertEq(IERC20(params.collateralToken).balanceOf(address(liq)), 0, "liquidator bcBTC");
        assertEq(musd.allowance(address(liq), net.morpho), 0, "dangling Morpho allowance");
    }
}
