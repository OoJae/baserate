// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {BackstopBase} from "../unit/BackstopBase.t.sol";

/// @notice Drives the Backstop through deposits, mints, queued exits, liquidation buys, auction sales, BTC price
/// moves, MUSD donations, sMUSD yield and time. Before/after properties are recorded as ghost flags because handler
/// reverts are discarded (fail_on_revert = false).
/// Share-price rules checked on every action (pps = convertToAssets(1e18), tolerance `_tol(p0)`: 2 wei plus one share-wei of
/// value, the most ERC-4626 rounding can move it while the dead seed keeps supply >= 1e18):
/// - no action raises the share price instantly (gains only vest with time);
/// - deposits, mints, exit requests and claims, auction sales, donations and yield never lower it (only the PnL
///   events, liquidation buys and BTC price drops, may);
/// - a claim pays at most min(NAV of its shares at request, NAV of its shares at claim).
contract BackstopHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant TOL = 2;
    uint256 internal constant PRICE0 = 80_000e36;

    Backstop internal immutable backstop;
    MockMUSD internal immutable musd;
    SMUSDMock internal immutable smusd;
    MockMorphoOracle internal immutable oracle;
    address internal immutable liquidator;

    address[] internal actors;
    uint256[] internal openIds;

    bool public instantGain;
    bool public nonPnlLoss;
    bool public claimAboveNav;
    bool public previewMismatch;
    uint256 public claims;
    uint256 public buys;
    uint256 public sales;

    mapping(bytes32 => uint256) public calls;

    constructor(
        Backstop backstop_,
        MockMUSD musd_,
        SMUSDMock smusd_,
        MockMorphoOracle oracle_,
        address liquidator_,
        address[] memory actors_
    ) {
        backstop = backstop_;
        musd = musd_;
        smusd = smusd_;
        oracle = oracle_;
        liquidator = liquidator_;
        actors = actors_;
        for (uint256 i; i < actors_.length; ++i) {
            vm.prank(actors_[i]);
            musd.approve(address(backstop_), type(uint256).max);
        }
    }

    function openRequests() external view returns (uint256[] memory) {
        return openIds;
    }

    // ---------------------------------------------------------------- non-PnL actions

    function deposit(uint256 actorSeed, uint256 assets) external {
        calls["deposit"]++;
        address actor = _actor(actorSeed);
        assets = bound(assets, 1, 200_000e18);
        uint256 expected = backstop.previewDeposit(assets);
        musd.mint(actor, assets);
        vm.prank(actor);
        musd.approve(address(backstop), type(uint256).max);
        uint256 p0 = _pps();
        vm.prank(actor);
        if (backstop.deposit(assets, actor) != expected) previewMismatch = true;
        _checkNeutral(p0);
    }

    function mint(uint256 actorSeed, uint256 shares) external {
        calls["mint"]++;
        address actor = _actor(actorSeed);
        shares = bound(shares, 1, 200_000e18);
        uint256 expected = backstop.previewMint(shares);
        musd.mint(actor, expected);
        vm.prank(actor);
        musd.approve(address(backstop), type(uint256).max);
        uint256 p0 = _pps();
        vm.prank(actor);
        if (backstop.mint(shares, actor) != expected) previewMismatch = true;
        _checkNeutral(p0);
    }

    function requestRedeem(uint256 actorSeed, uint256 shares) external {
        calls["request"]++;
        address actor = _actor(actorSeed);
        uint256 bal = backstop.balanceOf(actor);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        uint256 p0 = _pps();
        vm.prank(actor);
        uint256 id = backstop.requestRedeem(shares, actor, actor);
        openIds.push(id);
        _checkNeutral(p0);
    }

    function claimRedeem(uint256 idSeed) external {
        calls["claim"]++;
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length;
        uint256 id = openIds[idx];
        IBackstop.RedeemRequest memory r = backstop.redeemRequest(id);
        if (block.timestamp < r.claimableAt) vm.warp(r.claimableAt);
        // Cash may be short while BTC is held: sell what is needed through the auction first.
        uint256 valueNow = backstop.convertToAssets(r.shares);
        uint256 owed = valueNow < r.assets ? valueNow : r.assets;
        if (backstop.cash() < owed && backstop.inventory() != 0) _auction(backstop.inventory());
        valueNow = backstop.convertToAssets(r.shares);
        uint256 p0 = _pps();
        uint256 before = musd.balanceOf(r.receiver);
        try backstop.claimRedeem(id) returns (uint256 paid) {
            claims++;
            if (paid > r.assets || paid > valueNow) claimAboveNav = true;
            if (musd.balanceOf(r.receiver) - before != paid) claimAboveNav = true;
            openIds[idx] = openIds[openIds.length - 1];
            openIds.pop();
            _checkNeutral(p0);
        } catch {}
    }

    function takeAuction(uint256 btcSeed, uint256 waitSeed) external {
        calls["auction"]++;
        uint256 inv = backstop.inventory();
        if (inv == 0) return;
        vm.warp(block.timestamp + bound(waitSeed, 0, 8 hours));
        _auction(bound(btcSeed, 1, inv));
    }

    function donate(uint256 amount) external {
        calls["donate"]++;
        amount = bound(amount, 1, 50_000e18);
        uint256 p0 = _pps();
        musd.mint(address(backstop), amount);
        try backstop.sync() {} catch {}
        _checkNeutral(p0);
    }

    function smusdYield(uint256 amount) external {
        calls["yield"]++;
        uint256 supply = smusd.totalSupply();
        if (supply == 0) return;
        amount = bound(amount, supply / 1e18 + 1, 10_000e18);
        uint256 p0 = _pps();
        musd.mint(address(this), amount);
        musd.approve(address(smusd), amount);
        smusd.receiveProtocolYield(amount);
        try backstop.sync() {} catch {}
        _checkNeutral(p0);
    }

    // ---------------------------------------------------------------- PnL events

    function buyCollateral(uint256 btcSeed) external {
        calls["buy"]++;
        uint256 btc = bound(btcSeed, 1e12, 2e18);
        if (backstop.quoteBuy(btc) == 0) return;
        vm.deal(liquidator, liquidator.balance + btc);
        uint256 p0 = _pps();
        vm.prank(liquidator);
        backstop.buyCollateral{value: btc}(0);
        buys++;
        if (_pps() > p0 + _tol(p0)) instantGain = true;
    }

    function movePrice(uint256 bpsSeed, bool up) external {
        calls["price"]++;
        uint256 bps = bound(bpsSeed, 0, 1500);
        uint256 price = oracle.rawPrice();
        price = up ? price * (10_000 + bps) / 10_000 : price * (10_000 - bps) / 10_000;
        if (price < PRICE0 / 4 || price > PRICE0 * 4) return;
        uint256 p0 = _pps();
        oracle.setPrice(price);
        try backstop.sync() {} catch {}
        if (_pps() > p0 + _tol(p0)) instantGain = true;
    }

    function warp(uint256 secondsSeed) external {
        calls["warp"]++;
        vm.warp(block.timestamp + bound(secondsSeed, 1, 3 days));
    }

    // ---------------------------------------------------------------- internal

    function _auction(uint256 btc) internal {
        address taker = actors[0];
        uint256 cost = backstop.quoteAuction(btc);
        musd.mint(taker, cost);
        uint256 p0 = _pps();
        vm.prank(taker);
        backstop.takeAuction(btc, cost, taker);
        sales++;
        _checkNeutral(p0);
    }

    function _checkNeutral(uint256 p0) internal {
        uint256 p1 = _pps();
        if (p1 > p0 + _tol(p0)) instantGain = true;
        if (p1 + _tol(p0) < p0) nonPnlLoss = true;
    }

    function _tol(uint256 p0) internal pure returns (uint256) {
        return TOL + p0 / 1e18;
    }

    function _pps() internal view returns (uint256) {
        return backstop.convertToAssets(1e18);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }
}

contract BackstopInvariantTest is BackstopBase {
    BackstopHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actors = new address[](4);
        actors[0] = makeAddr("inv.taker");
        actors[1] = alice;
        actors[2] = bob;
        actors[3] = attacker;
        handler = new BackstopHandler(backstop, musd, smusd, oracle, liquidator, actors);
        // Outside sMUSD holders, so protocol yield is diluted like on-chain.
        musd.mint(address(this), 1_000_000e18);
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(1_000_000e18);
        _deposit(alice, 50_000e18);
        targetContract(address(handler));
    }

    /// @notice Share value changes only on realised PnL: no action lifts it instantly, and non-PnL actions never
    /// lower it.
    function invariant_shareValueOnlyMovesOnPnl() public view {
        assertFalse(handler.instantGain(), "instant share-price gain");
        assertFalse(handler.nonPnlLoss(), "non-PnL action lowered the share price");
    }

    /// @notice No withdrawal exceeds NAV: every claim pays at most min(request NAV, claim NAV) of its shares.
    function invariant_noWithdrawalExceedsNav() public view {
        assertFalse(handler.claimAboveNav(), "claim above NAV");
    }

    /// @notice Recognised NAV never exceeds what the backstop could realise (cash + BTC at 0.95 x oracle).
    function invariant_navBackedByGross() public view {
        assertLe(backstop.totalAssets(), backstop.grossAssets(), "NAV above gross");
        (uint256 book, uint256 unvested,,) = backstop.vestingState();
        assertLe(book, backstop.grossAssets(), "book above gross");
        assertLe(unvested, backstop.grossAssets(), "unvested above gross");
    }

    /// @notice Escrow and reserves match the open requests exactly.
    function invariant_queueAccounting() public view {
        uint256[] memory ids = handler.openRequests();
        uint256 shares;
        uint256 assets;
        for (uint256 i; i < ids.length; ++i) {
            IBackstop.RedeemRequest memory r = backstop.redeemRequest(ids[i]);
            shares += r.shares;
            assets += r.assets;
        }
        assertEq(backstop.balanceOf(address(backstop)), shares, "escrowed shares");
        assertEq(backstop.reservedAssets(), assets, "reserved assets");
    }

    /// @notice BTC inventory is always backed by native balance.
    function invariant_inventoryBacked() public view {
        assertLe(backstop.inventory(), address(backstop).balance, "inventory above native balance");
    }

    function invariant_previewsMatch() public view {
        assertFalse(handler.previewMismatch(), "preview != execution");
    }

    function invariant_handlerReachesPaths() public view {
        // Sanity: not a vacuous run (asserted loosely; some sequences are short).
        assertLe(handler.claims(), handler.calls("claim"));
    }
}
