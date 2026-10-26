// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IMorpho, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {CollateralBTC} from "../../src/collateral/CollateralBTC.sol";
import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {FlashLiquidator} from "../../src/liquidation/FlashLiquidator.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BackstopBase} from "../unit/BackstopBase.t.sol";
import {BtcPrecompileMock} from "../utils/BtcPrecompileMock.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {
    AuditAccountRegistry,
    DeployLiquidationHarness,
    MockCLRouter,
    NoReceiveKeeper
} from "./LiquidationAuditHelpers.sol";

/// @notice Area C audit regressions, Backstop side (local stack of BackstopBase: LLTV 0.86, 80,000 MUSD/BTC, 1 MUSD
/// dead seed, the test contract plays the FlashLiquidator through `liquidator`). Each test replays a PoC of the
/// report and asserts the fixed behaviour.
contract LiquidationAuditBackstopTest is BackstopBase {
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;

    // ---------------------------------------------------------------- C-1

    /// @notice C-1 (fixed): deposits are priced at book + unvested (gross), so a depositor who arrives after a
    /// liquidation's premium has been realised pays full value for the part of it still vesting. The PoC's 1M MUSD
    /// late deposit now earns nothing, and the incumbent who funded the purchase keeps the whole premium.
    function test_fix_C1_lateDepositorPaysForRealisedPremium() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);

        // Liquidation: the backstop buys 0.05 BTC at 0.978 x oracle and marks it at 0.95 (instant loss for alice).
        uint256 paid = _buy(0.05e18);
        // The auction clears at factor 1.00: the gain over the mark vests over 7 days.
        uint256 sold = _take(0.05e18);
        uint256 premiumVesting = _unvested();
        assertEq(backstop.inventory(), 0, "backstop is all cash: no BTC risk left");
        assertGt(sold - paid, 85e18, "the liquidation was profitable for the backstop (~87.7 MUSD)");
        assertApproxEqAbs(premiumVesting, 200e18, 1e15, "200 MUSD over the mark is vesting");

        // Counterfactual: nobody else deposits. Alice keeps the whole net premium.
        uint256 snap = vm.snapshotState();
        skip(7 days);
        uint256 aliceAlone = backstop.convertToAssets(aliceShares);
        assertGt(aliceAlone, 10_080e18, "without the attacker alice nets ~+87 MUSD");
        vm.revertToState(snap);

        // The late deposit is priced at gross: it buys the vesting premium at full value.
        uint256 stake = 1_000_000e18;
        uint256 attackerShares = _depositAtGross(attacker, stake);

        // Same attack as the PoC: hold through the vesting, then a normal queued exit.
        skip(7 days);
        uint256 id = _request(attacker, attackerShares);
        skip(7 days);
        uint256 out = backstop.claimRedeem(id);
        uint256 aliceAfter = backstop.convertToAssets(aliceShares);
        emit log_named_decimal_uint("attacker out - in (wei-level rounding)", stake - out, 18);
        emit log_named_decimal_uint("alice value without attacker", aliceAlone, 18);
        emit log_named_decimal_uint("alice value with attacker", aliceAfter, 18);

        assertLe(out, stake, "no profit for the late depositor");
        assertApproxEqAbs(out, stake, 1e6, "and no loss beyond rounding");
        assertApproxEqAbs(aliceAfter, aliceAlone, 1e6, "the incumbent keeps the whole premium");
        assertGt(aliceAfter, 10_080e18, "the incumbent who funded the liquidation profits from it");
    }

    /// @dev Deposits `stake` while gains are vesting and checks it was priced at book + unvested.
    function _depositAtGross(address who, uint256 stake) internal returns (uint256 shares) {
        uint256 quoted = backstop.previewDeposit(stake);
        assertLt(quoted, backstop.convertToShares(stake), "priced above the recognised NAV");
        (uint256 book0, uint256 unvested0,, uint64 end0) = backstop.vestingState();
        uint256 pps0 = _pps();
        shares = _deposit(who, stake);
        assertEq(shares, quoted, "preview = execution");
        assertApproxEqAbs(_pps(), pps0, 1, "the recognised share price does not move");
        assertLt(backstop.convertToAssets(shares), stake, "worth less than paid until the premium vests");
        // The deposit joined the book and the vesting gains in their current proportion, keeping the vesting end.
        (uint256 book1, uint256 unvested1,, uint64 end1) = backstop.vestingState();
        assertApproxEqRel(unvested1 * 1e18 / book1, unvested0 * 1e18 / book0, 1e9, "same unvested/book ratio");
        assertEq(end1, end0, "vesting end kept");
    }

    /// @notice C-1 (fixed, second face): a depositor who enters while gains are vesting has paid for their pro-rata
    /// part of those gains, so the next mark-down (absorbed by the unvested gains first) is shared pro rata instead of
    /// being charged to the incumbents' gains only.
    function test_fix_C1_lateDepositorSharesNextLossProRata() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _buy(0.05e18);
        _take(0.05e18); // ~200 MUSD vesting
        uint256 attackerShares = _deposit(attacker, 10_000e18);
        assertApproxEqAbs(
            attackerShares * (backstop.grossAssets() + 1) / (backstop.totalSupply() + 1),
            10_000e18,
            1e6,
            "the deposit bought shares at gross"
        );

        // A new liquidation marks down ~112 MUSD.
        uint256 grossBefore = backstop.grossAssets();
        uint256 supply = backstop.totalSupply();
        _buy(0.05e18);
        backstop.sync();
        uint256 loss = grossBefore - backstop.grossAssets();
        assertGt(loss, 100e18, "mark-down");

        // Once everything has vested, each holder has lost their pro-rata part of the mark-down.
        skip(7 days);
        uint256 attackerLoss = 10_000e18 - backstop.convertToAssets(attackerShares);
        assertApproxEqAbs(attackerLoss, loss * attackerShares / supply, 1e6, "late depositor bears its pro-rata part");
        assertGt(attackerLoss, loss * 45 / 100, "about half of the loss, not none of it");
        uint256 aliceLoss = (grossBefore * aliceShares / supply) - backstop.convertToAssets(aliceShares);
        assertApproxEqAbs(aliceLoss, loss * aliceShares / supply, 1e6, "the incumbent bears only her part");
    }

    // ---------------------------------------------------------------- C-3

    /// @notice C-3 (fixed, cash): a matured exit no longer waits for cash to cover it in full. The claim pays all the
    /// cash there is, burns the matching fraction of the escrowed shares and keeps the rest queued at the same request
    /// NAV per share; once the auction refills cash, the rest is paid.
    function test_fix_C3_maturedExitPaidPartiallyFromAvailableCash() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _buy(0.12e18); // spends ~9,389 of the 10,001 MUSD of cash
        uint256 id = _request(alice, aliceShares);
        IBackstop.RedeemRequest memory r0 = backstop.redeemRequest(id);
        skip(7 days);

        uint256 cash0 = backstop.cash();
        assertLt(cash0, r0.assets / 10, "cash covers <10% of the matured claim");
        uint256 paid1 = backstop.claimRedeem(id); // anyone may trigger it
        assertApproxEqAbs(paid1, cash0, 2, "all the cash is paid now");
        assertEq(musd.balanceOf(alice), paid1, "to the receiver");

        IBackstop.RedeemRequest memory r1 = backstop.redeemRequest(id);
        assertGt(r1.shares, 0, "the rest stays queued");
        assertApproxEqRel(r1.shares, r0.shares - r0.shares * paid1 / r0.assets, 1e12, "matching fraction burned");
        assertLe(
            uint256(r1.assets) * r0.shares,
            uint256(r0.assets) * r1.shares,
            "never a higher NAV per share than at request"
        );
        assertEq(r1.claimableAt, r0.claimableAt, "still claimable");
        assertEq(backstop.reservedAssets(), r1.assets, "reservation follows the remainder");
        assertEq(backstop.balanceOf(address(backstop)), r1.shares, "escrow follows the remainder");

        // The auction refills cash; the remainder is paid and the request closes.
        _take(0.12e18);
        uint256 paid2 = backstop.claimRedeem(id);
        assertEq(backstop.redeemRequest(id).shares, 0, "closed");
        assertEq(backstop.reservedAssets(), 0, "nothing reserved");
        assertEq(backstop.balanceOf(address(backstop)), 0, "nothing escrowed");
        assertLe(paid1 + paid2, r0.assets, "never above the request NAV");
        assertApproxEqAbs(paid1 + paid2, r0.assets, 1e6, "paid in full over the two claims");
    }

    /// @notice C-3 (fixed, dust): sales can no longer strand dust (they take all the inventory or leave at least
    /// `DUST_INVENTORY`), and inventory below `DUST_INVENTORY` (which can still arrive through a tiny liquidation) counts
    /// as 0 in NAV, so it keeps the oracle off every exit, deposit and request.
    function test_fix_C3_dustInventoryNeedsNoOracle() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        _buy(0.12e18);
        uint256 id = _request(alice, aliceShares);
        IBackstop.RedeemRequest memory r = backstop.redeemRequest(id);
        skip(7 days);

        // The PoC's "everything but 1 wei" sale now reverts.
        uint256 cost = backstop.quoteAuction(0.12e18);
        musd.mint(taker, cost);
        vm.startPrank(taker);
        musd.approve(address(backstop), cost);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.DustRemainder.selector, 1));
        backstop.takeAuction(0.12e18 - 1, type(uint256).max, taker);
        vm.stopPrank();
        _take(0.12e18);

        // Dust still arrives through a tiny liquidation: written off, and NAV no longer depends on the oracle.
        _buy(backstop.DUST_INVENTORY() - 1);
        assertEq(backstop.inventory(), backstop.DUST_INVENTORY() - 1, "dust held");
        oracle.setReverting(true);
        uint256 valueNow = backstop.convertToAssets(r.shares);
        uint256 owed = r.assets < valueNow ? r.assets : valueNow;
        assertApproxEqAbs(owed, r.assets, 1e18, "the dust was written off (< 1 MUSD)");
        assertEq(backstop.claimRedeem(id), owed, "the matured exit is paid during the outage");
        uint256 bobShares = _deposit(bob, 100e18);
        assertGt(bobShares, 0, "deposits work");
        _request(bob, bobShares);
        backstop.sync();
        // The dust itself is sold once the oracle is back; it must go in one piece.
        oracle.setReverting(false);
        _take(backstop.inventory());
        assertEq(backstop.inventory(), 0);
    }

    /// @notice C-3 (fixed, outage): while the oracle is down and real inventory is held, the owner can still exit by
    /// valuing the inventory at 0 for their own claim. It only lowers their payout; the remaining holders keep at least
    /// their value and the forfeited part vests to them.
    function test_fix_C3_ownerExitsDuringOracleOutageAtZeroInventory() public {
        uint256 aliceShares = _deposit(alice, 10_000e18);
        uint256 bobShares = _deposit(bob, 10_000e18);
        _buy(0.12e18);
        uint256 id = _request(alice, aliceShares);
        uint256 owedAtRequest = backstop.redeemRequest(id).assets;
        uint256 bobValue = backstop.convertToAssets(bobShares);
        skip(7 days);

        oracle.setReverting(true);
        vm.expectRevert(IBackstop.OracleUnavailable.selector);
        backstop.claimRedeem(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotRequestOwner.selector, bob));
        backstop.claimRedeemWithoutOracle(id);

        uint256 cash = backstop.cash();
        uint256 book = _book();
        uint256 expected = aliceShares * ((cash < book ? cash : book) + 1) / (backstop.totalSupply() + 1);
        vm.prank(alice);
        uint256 paid = backstop.claimRedeemWithoutOracle(id);
        assertEq(paid, expected, "min(book, cash) per share");
        assertLt(paid, owedAtRequest, "the owner takes the haircut of valuing BTC at 0");
        assertEq(backstop.redeemRequest(id).shares, 0, "paid in full from cash");
        assertEq(backstop.reservedAssets(), 0);

        oracle.setReverting(false);
        backstop.sync();
        assertGe(backstop.convertToAssets(bobShares) + 2, bobValue, "the remaining holder lost nothing");
        skip(7 days);
        assertGt(backstop.convertToAssets(bobShares), bobValue + 4000e18, "and gets alice's forfeit as it vests");
    }

    // ---------------------------------------------------------------- informational

    /// @notice Request fields are checked casts: a request above uint128 reverts instead of truncating.
    function test_fix_requestRedeemUsesCheckedCasts() public {
        uint256 huge = uint256(type(uint128).max) + 1;
        uint256 shares = _deposit(alice, huge);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 128, shares));
        backstop.requestRedeem(shares, alice, alice);
    }

    /// @notice A CL partial fill (or the router paying from its own BTC) leaves no BTC-precompile allowance behind, and
    /// only that case pays the extra `approve(0)`.
    function test_fix_sellInventoryClearsResidualClAllowance() public {
        BtcPrecompileMock btc = _etchBtc();
        MockCLRouter router = new MockCLRouter(musd, oracle);
        IBackstop.BackstopParams memory p = _params(LLTV);
        p.venues.clRouter = address(router);
        backstop = new Backstop(p);
        _deposit(alice, 10_000e18);
        _buy(0.05e18);

        // Full fill: approve + transferFrom, nothing left approved.
        uint256 calls0 = btc.callCount();
        vm.prank(taker);
        backstop.sellInventory(0.02e18, Venue.CL200, 0);
        assertEq(btc.callCount() - calls0, 2, "approve + transferFrom");
        assertEq(btc.allowance(address(backstop), address(router)), 0, "no allowance left");
        assertEq(backstop.inventory(), 0.03e18);

        // Partial fill: the unused approval is cleared and only what left is taken off the inventory.
        router.setFillBps(5000);
        calls0 = btc.callCount();
        vm.prank(taker);
        backstop.sellInventory(0.02e18, Venue.CL200, 0);
        assertEq(btc.callCount() - calls0, 3, "approve + transferFrom + approve(0)");
        assertEq(btc.allowance(address(backstop), address(router)), 0, "residual allowance cleared");
        assertEq(backstop.inventory(), 0.02e18, "only the filled half left the inventory");
        assertEq(address(backstop).balance, 0.02e18, "inventory still backed");
    }

    // ---------------------------------------------------------------- script

    /// @notice DeployLiquidation: `Backstop.SENTINEL` is immutable, so mainnet requires an explicit `SENTINEL`. The rule
    /// is checked with the env passed in, never through `vm.setEnv`, which would leak into every other test of the
    /// process (Deploy.s.sol's dry run reads `SENTINEL` too).
    function test_fix_deployScriptRequiresSentinelOnMainnet() public {
        DeployLiquidationHarness script = new DeployLiquidationHarness();
        address deployer = makeAddr("deployer");
        address safe = makeAddr("safe");

        assertEq(script.pickSentinel(31_611, deployer, false, address(0)), deployer, "testnet default");
        assertEq(script.pickSentinel(31_611, deployer, true, safe), safe, "testnet override");
        vm.expectRevert(bytes("DeployLiquidation: set SENTINEL on mainnet"));
        script.pickSentinel(31_612, deployer, false, address(0));
        assertEq(script.pickSentinel(31_612, deployer, true, safe), safe, "explicit sentinel on mainnet");
        vm.expectRevert(bytes("DeployLiquidation: SENTINEL is zero"));
        script.pickSentinel(31_612, deployer, true, address(0));

        // The env-reading wrapper, against whatever the process environment holds (read-only).
        vm.chainId(31_611);
        if (!vm.envExists("SENTINEL")) assertEq(script.sentinelFor(deployer), deployer, "testnet default (env)");
        vm.chainId(31_612);
        if (!vm.envExists("SENTINEL")) {
            vm.expectRevert(bytes("DeployLiquidation: set SENTINEL on mainnet"));
            script.sentinelFor(deployer);
        }
    }

    function _etchBtc() internal returns (BtcPrecompileMock) {
        vm.etch(BTC, address(new BtcPrecompileMock()).code);
        return BtcPrecompileMock(BTC);
    }
}

/// @notice Area C audit regressions, FlashLiquidator side: a local stack with the real Morpho Blue and AdaptiveCurveIrm,
/// the real bcBTC (deployed by a minimal registry standing in for the factory's `isAccount`), wsMUSD over the sMUSD
/// mock, the Backstop and the FlashLiquidator (BACKSTOP venue), plus a second liquidator on a CL router stand-in over
/// the BTC precompile mock for the native-BTC paths. Morpho and the IRM are deployed from the shared `out/` artifacts
/// (the only artifact dir fs_permissions allows), so run `forge build` once into `out/` if they are missing.
contract LiquidationAuditFlashTest is Test {
    using MarketParamsLib for MarketParams;

    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    uint256 internal constant LLTV = 0.77e18;
    uint256 internal constant PRICE = 80_000e36;
    uint256 internal constant MAX_IMPACT_BPS = 689;

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    WsMUSD internal ws;
    MockMorphoOracle internal oracle;
    IMorpho internal morpho;
    address internal irm;
    AuditAccountRegistry internal registry;
    CollateralBTC internal bcbtc;
    MarketParams internal params;
    Backstop internal backstop;
    FlashLiquidator internal liq;

    address internal morphoOwner = makeAddr("morphoOwner");
    address internal capAdmin = makeAddr("capAdmin");
    address internal sentinel = makeAddr("sentinel");
    address internal lender = makeAddr("lender");
    address internal depositor = makeAddr("depositor");
    address internal borrower = makeAddr("borrower");
    address internal keeper = makeAddr("keeper");
    address internal griefer = makeAddr("griefer");

    function setUp() public {
        vm.warp(1_792_942_983);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        ws = new WsMUSD(address(musd), address(smusd), capAdmin, 10_000_000e18);

        morpho = IMorpho(deployCode("out/Morpho.sol/Morpho.json", abi.encode(morphoOwner)));
        irm = deployCode("out/AdaptiveCurveIrm.sol/AdaptiveCurveIrm.json", abi.encode(address(morpho)));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        vm.stopPrank();

        registry = new AuditAccountRegistry(address(morpho));
        bcbtc = registry.collateral();
        oracle = new MockMorphoOracle(PRICE);
        params = MarketParams({
            loanToken: address(musd), collateralToken: address(bcbtc), oracle: address(oracle), irm: irm, lltv: LLTV
        });
        morpho.createMarket(params);

        musd.mint(lender, 1_000_000e18);
        vm.startPrank(lender);
        musd.approve(address(morpho), type(uint256).max);
        morpho.supply(params, 1_000_000e18, 0, lender, "");
        vm.stopPrank();

        ILiquidationVenues.VenueConfig memory none;
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        backstop = new Backstop(
            IBackstop.BackstopParams({
                musd: address(musd),
                wsMusd: address(ws),
                oracle: address(oracle),
                lltv: LLTV,
                liquidator: predicted,
                sentinel: sentinel,
                maxKeeperSale: 0.05e18,
                venues: none
            })
        );
        liq = new FlashLiquidator(address(morpho), params, address(backstop), MAX_IMPACT_BPS, none);
        assertEq(address(liq), predicted, "liquidator address");

        musd.mint(depositor, 500_000e18);
        vm.startPrank(depositor);
        musd.approve(address(backstop), type(uint256).max);
        backstop.deposit(500_000e18, depositor);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Opens an M1 position for `who` through the real bcBTC gate (registered account -> Morpho).
    function _open(address who, uint256 coll, uint256 debt) internal {
        registry.setAccount(who, true);
        vm.deal(who, who.balance + coll);
        vm.startPrank(who);
        bcbtc.wrap{value: coll}();
        bcbtc.approve(address(morpho), coll);
        morpho.supplyCollateral(params, coll, who, "");
        morpho.borrow(params, debt, 0, who, who);
        vm.stopPrank();
    }

    /// @dev A liquidatable 0.01 BTC position (LTV ~0.79 > 0.77 after a 5% drop).
    function _liquidatable() internal {
        _open(borrower, 0.01e18, 600e18);
        oracle.setPrice(PRICE * 95 / 100);
    }

    /// @dev A second FlashLiquidator selling on the CL router stand-in (BTC precompile mock etched).
    function _clLiquidator() internal returns (FlashLiquidator clLiq, MockCLRouter router, BtcPrecompileMock btc) {
        vm.etch(BTC, address(new BtcPrecompileMock()).code);
        btc = BtcPrecompileMock(BTC);
        router = new MockCLRouter(musd, oracle);
        ILiquidationVenues.VenueConfig memory venues;
        venues.clRouter = address(router);
        clLiq = new FlashLiquidator(address(morpho), params, address(0), MAX_IMPACT_BPS, venues);
    }

    function _assertLiquidatorEmpty() internal view {
        assertEq(musd.balanceOf(address(liq)), 0, "liquidator MUSD");
        assertEq(address(liq).balance, 0, "liquidator BTC");
        assertEq(bcbtc.balanceOf(address(liq)), 0, "liquidator bcBTC");
        assertEq(musd.allowance(address(liq), address(morpho)), 0, "Morpho allowance");
    }

    // ---------------------------------------------------------------- sanity (harness)

    /// @notice Harness check: a full zero-capital liquidation through the backstop pays the caller, repays all debt
    /// and leaves nothing in the liquidator; the callback cannot be invoked outside the liquidator's own call.
    function test_sound_fullBackstopLiquidationAndCallbackGuards() public {
        _open(borrower, 0.01e18, 600e18); // LTV 0.75
        oracle.setPrice(PRICE * 95 / 100); // LTV ~0.79 > 0.77
        skip(1 hours);
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(borrower);
        assertTrue(p.liquidatable && p.quotes[uint256(Venue.BACKSTOP)].ok, "preview");

        vm.prank(keeper);
        (uint256 seized, uint256 repaid, uint256 profit) = liq.liquidate(borrower, 0, Venue.BACKSTOP, 1);
        assertEq(seized, p.seizable, "seized = preview");
        assertEq(repaid, p.repaid, "repaid = preview");
        assertEq(profit, p.quotes[uint256(Venue.BACKSTOP)].profit, "profit = preview");
        assertEq(musd.balanceOf(keeper), profit, "caller paid");
        Position memory pos = morpho.position(params.id(), borrower);
        assertEq(pos.borrowShares, 0, "debt repaid");
        assertEq(backstop.inventory(), seized, "backstop holds the BTC");
        _assertLiquidatorEmpty();

        vm.expectRevert(abi.encodeWithSelector(IFlashLiquidator.NotMorpho.selector, address(this)));
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));
        vm.prank(address(morpho));
        vm.expectRevert(IFlashLiquidator.NotInFlight.selector);
        liq.onMorphoLiquidate(1, abi.encode(Venue.BACKSTOP));
        vm.expectRevert(abi.encodeWithSelector(IBackstop.NotLiquidator.selector, address(this)));
        backstop.buyCollateral{value: 1}(0);
    }

    /// @notice Harness check (fuzz): any liquidatable position, healthy book or bad debt, liquidates in full through
    /// the backstop when it has the cash, and the liquidator keeps nothing.
    function testFuzz_sound_fullLiquidationNeverStuck(uint256 coll, uint256 ltvBps, uint256 dropBps) public {
        coll = bound(coll, 1e14, 0.5e18);
        ltvBps = bound(ltvBps, 5000, 7690);
        dropBps = bound(dropBps, 1, 6000);
        uint256 debt = coll * PRICE / 1e36 * ltvBps / 10_000;
        vm.assume(debt >= 1e18);
        _open(borrower, coll, debt);
        oracle.setPrice(PRICE * (10_000 - dropBps) / 10_000);
        skip(1 days);
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(borrower);
        vm.assume(p.liquidatable);
        vm.prank(keeper);
        liq.liquidate(borrower, 0, Venue.BACKSTOP, 0);
        assertEq(morpho.position(params.id(), borrower).borrowShares, 0, "debt cleared (repaid or socialised)");
        _assertLiquidatorEmpty();
    }

    // ---------------------------------------------------------------- C-2

    /// @notice C-2 (fixed): `liquidate` forwards only the native BTC its own liquidation left behind, so 1 wei donated
    /// to the liquidator no longer reaches (and can no longer revert) a caller without a payable receive. The donation
    /// stays until anyone sweeps it.
    function test_fix_C2_nativeDonationNoLongerBricksContractLiquidators() public {
        _liquidatable();
        NoReceiveKeeper bot = new NoReceiveKeeper();

        vm.deal(griefer, 1);
        vm.prank(griefer);
        (bool ok,) = address(liq).call{value: 1}("");
        assertTrue(ok, "anyone can donate native BTC");

        assertGt(bot.liquidate(liq, borrower, Venue.BACKSTOP), 0, "the bot liquidates despite the donation");
        assertEq(morpho.position(params.id(), borrower).borrowShares, 0, "position liquidated");
        assertEq(address(liq).balance, 1, "the donation was not forwarded");

        vm.expectRevert(IFlashLiquidator.ZeroAddress.selector);
        liq.sweepNative(address(0));
        vm.expectEmit(address(liq));
        emit IFlashLiquidator.NativeSwept(griefer, keeper, 1);
        vm.prank(griefer);
        assertEq(liq.sweepNative(keeper), 1, "swept");
        assertEq(keeper.balance, 1);
        assertEq(address(liq).balance, 0);
    }

    /// @notice C-2 (fixed), the router path: the live CLSwapRouter refunds all its native BTC to the caller after every
    /// swap, so a donation to the router reaches the liquidator inside the liquidation. It is forwarded to a caller that
    /// can take it, and kept (event, no revert) for one that cannot.
    function test_fix_C2_routerRefundForwardedOrKept() public {
        (FlashLiquidator clLiq,,) = _clLiquidator();
        MockCLRouter router = MockCLRouter(payable(clLiq.CL_ROUTER()));
        _liquidatable();
        NoReceiveKeeper bot = new NoReceiveKeeper();

        // Grief the router with 1 wei: it is refunded into the next CL liquidation.
        vm.deal(address(router), 1);
        vm.expectEmit(address(clLiq));
        emit IFlashLiquidator.NativeKept(address(bot), 1);
        assertGt(bot.liquidate(clLiq, borrower, Venue.CL200), 0, "the bot liquidates");
        assertEq(address(clLiq).balance, 1, "the refund it could not take stays");

        // An EOA keeper gets the refund of its own liquidation, never the BTC kept from before.
        address other = makeAddr("borrower2");
        _open(other, 0.01e18, 560e18);
        oracle.setPrice(PRICE * 90 / 100);
        vm.deal(address(router), 7);
        vm.prank(keeper);
        clLiq.liquidate(other, 0, Venue.CL200, 0);
        assertEq(keeper.balance, 7, "the refund produced by this liquidation");
        assertEq(address(clLiq).balance, 1, "the earlier BTC is not forwarded");
    }

    /// @notice A CL partial fill leaves native BTC and part of the precompile approval behind: the BTC goes to the
    /// caller and the approval is cleared, so the liquidator again holds nothing.
    function test_fix_C2_partialFillForwardedAndAllowanceCleared() public {
        (FlashLiquidator clLiq, MockCLRouter router, BtcPrecompileMock btc) = _clLiquidator();
        _liquidatable();
        router.setFillBps(6000);

        vm.prank(keeper);
        (uint256 seized,,) = clLiq.liquidate(borrower, 0, Venue.CL200, 0);
        uint256 left = seized - seized * 6000 / 10_000;
        assertEq(keeper.balance, left, "unsold BTC to the caller");
        assertEq(address(clLiq).balance, 0, "nothing kept");
        assertEq(btc.allowance(address(clLiq), address(router)), 0, "residual allowance cleared");
        assertEq(btc.callCount(), 3, "approve + transferFrom + approve(0): within the precompile budget");
    }
}
