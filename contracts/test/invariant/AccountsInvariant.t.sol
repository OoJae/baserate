// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Id, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../../src/interfaces/ICollateralBTC.sol";
import {BorrowAccountForkBase} from "../fork/BorrowAccountForkBase.t.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";

/// @notice Drives random owner actions, price moves, time, liquidations, oracle outages and sentinel cap cuts
/// against the M1 accounts, recording post-action violations as ghost flags.
contract AccountsHandler is CommonBase, StdCheats, StdUtils {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant BPS = 10_000;

    BorrowAccountFactory internal immutable factory;
    IMorpho internal immutable morpho;
    IERC20 internal immutable musd;
    ICollateralBTC internal immutable receipt;
    MockMorphoOracle internal immutable oracle;
    address internal immutable sentinel;
    uint256 internal immutable initialPrice;
    MarketParams internal params;
    Id internal id;

    address[] internal actors;
    address internal immutable canaryOp;
    address internal liquidator = makeAddr("inv.liquidator");

    address[] public accounts;
    mapping(address => bool) internal tracked;

    // Ghosts: set when a successful action leaves the system outside its bounds.
    bool public ltvViolated;
    bool public globalCapViolated;
    bool public positionCapViolated;
    bool public exitFailed;
    bool public topUpFailed;
    uint256 public successfulBorrows;
    uint256 public successfulExits;
    uint256 public liquidations;

    constructor(
        BorrowAccountFactory factory_,
        MockMorphoOracle oracle_,
        address sentinel_,
        address canaryOp_,
        address[] memory actors_
    ) {
        factory = factory_;
        morpho = IMorpho(factory_.MORPHO());
        musd = IERC20(factory_.MUSD());
        receipt = ICollateralBTC(factory_.COLLATERAL());
        oracle = oracle_;
        sentinel = sentinel_;
        canaryOp = canaryOp_;
        initialPrice = oracle_.rawPrice();
        params = factory_.marketParams();
        id = params.id();
        actors = actors_;
        actors.push(canaryOp_);
    }

    function accountsLength() external view returns (uint256) {
        return accounts.length;
    }

    // ---------------------------------------------------------------- actions

    function open(uint256 actorSeed, uint256 collSeed, uint256 ltvSeed) external {
        address actor = _actor(actorSeed);
        Profile profile = actor == canaryOp ? Profile.CANARY : Profile.STANDARD;
        (uint128 cap, uint16 ceiling) = factory.limits(profile);
        uint256 coll = bound(collSeed, 1e12, cap);
        // Occasionally aim above the ceiling to exercise the rejection path.
        uint256 ltv = bound(ltvSeed, 0, uint256(ceiling) + 300);
        uint256 musdOut = _value(coll) * ltv / BPS * BPS / (BPS + 10);

        vm.deal(actor, actor.balance + coll);
        vm.prank(actor);
        if (profile == Profile.CANARY) {
            try factory.openCanary{value: coll}(musdOut, BPS) returns (address a) {
                _afterRiskAction(a, musdOut != 0, musdOut != 0);
            } catch {}
        } else {
            try factory.openAndBorrow{value: coll}(musdOut, BPS) returns (address a) {
                _afterRiskAction(a, musdOut != 0, musdOut != 0);
            } catch {}
        }
    }

    function borrow(uint256 actorSeed, uint256 ltvSeed) external {
        (address actor, address acct) = _existing(actorSeed);
        if (acct == address(0)) return;
        uint256 coll = morpho.position(id, acct).collateral;
        uint256 target = _value(coll) * bound(ltvSeed, 0, 9000) / BPS;
        uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
        if (target <= debt_ + 1) return;
        uint256 musdOut = (target - debt_) * BPS / (BPS + 10);
        if (musdOut == 0) return;
        vm.prank(actor);
        try IBorrowAccount(acct).borrow(musdOut, BPS, actor) {
            _afterRiskAction(acct, true, true);
        } catch {}
    }

    function addCollateral(uint256 actorSeed, uint256 amountSeed) external {
        (address actor, address acct) = _existing(actorSeed);
        if (acct == address(0)) return;
        uint256 amount = bound(amountSeed, 1, 0.005e18);
        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        // Top-ups are never capped, paused or priced (A-1/D-1): they must always succeed.
        try IBorrowAccount(acct).addCollateral{value: amount}() {}
        catch {
            topUpFailed = true;
        }
    }

    /// @dev The sentinel cuts a profile's position cap (instant), leaving existing positions above it.
    function cutPositionCap(uint256 actorSeed, uint256 capSeed) external {
        Profile profile = _actor(actorSeed) == canaryOp ? Profile.CANARY : Profile.STANDARD;
        (uint128 cap, uint16 ceiling) = factory.limits(profile);
        if (cap == 0) return;
        vm.prank(sentinel);
        factory.setLimits(profile, uint128(bound(capSeed, cap / 2, cap)), ceiling);
    }

    function repay(uint256 actorSeed, uint256 amountSeed) external {
        (address actor, address acct) = _existing(actorSeed);
        if (acct == address(0)) return;
        uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
        if (debt_ == 0) return;
        uint256 amount = bound(amountSeed, 1, debt_ * 2);
        deal(address(musd), actor, amount);
        vm.startPrank(actor);
        musd.approve(acct, amount);
        try IBorrowAccount(acct).repay(amount) {} catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 actorSeed, uint256 amountSeed) external {
        (address actor, address acct) = _existing(actorSeed);
        if (acct == address(0)) return;
        uint256 coll = morpho.position(id, acct).collateral;
        if (coll == 0) return;
        uint256 amount = bound(amountSeed, 1, coll);
        vm.prank(actor);
        try IBorrowAccount(acct).withdrawCollateral(amount, actor) {
            _afterRiskAction(acct, false, true);
        } catch {}
    }

    /// @dev The full exit must always succeed for a funded owner, whatever the oracle is doing.
    function exit(uint256 actorSeed) external {
        (address actor, address acct) = _existing(actorSeed);
        if (acct == address(0)) return;
        Position memory p = morpho.position(id, acct);
        if (p.collateral == 0 && p.borrowShares == 0) return;
        uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
        deal(address(musd), actor, debt_);
        vm.startPrank(actor);
        musd.approve(acct, debt_);
        try IBorrowAccount(acct).repayAndWithdraw(actor) {
            ++successfulExits;
        } catch {
            exitFailed = true;
        }
        vm.stopPrank();
    }

    function movePrice(uint256 bpsSeed) external {
        uint256 next = oracle.rawPrice() * bound(bpsSeed, 9000, 11_000) / BPS;
        if (next < initialPrice / 2) next = initialPrice / 2;
        if (next > initialPrice * 3 / 2) next = initialPrice * 3 / 2;
        oracle.setPrice(next);
    }

    /// @dev Pushes one indebted account just past the LLTV so liquidations actually happen.
    function crashPrice(uint256 accountSeed, uint256 overBpsSeed) external {
        if (accounts.length == 0) return;
        address acct = accounts[accountSeed % accounts.length];
        Position memory p = morpho.position(id, acct);
        if (p.borrowShares == 0 || p.collateral == 0) return;
        uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
        uint256 targetLtv = params.lltv + bound(overBpsSeed, 1, 500) * 1e14; // LLTV + 0.01..5 pts (WAD)
        uint256 next = debt_ * 1e18 * 1e36 / (p.collateral * targetLtv);
        if (next != 0) oracle.setPrice(next);
    }

    /// @dev Takes the oracle down about a quarter of the time.
    function toggleOracle(uint256 seed) external {
        oracle.setReverting(seed % 4 == 0);
    }

    function warp(uint256 secondsSeed) external {
        skip(bound(secondsSeed, 1, 3 days));
    }

    function cutGlobalCap(uint256 capSeed) external {
        uint256 current = factory.globalBorrowCap();
        if (current == 0) return;
        vm.prank(sentinel);
        factory.setGlobalBorrowCap(bound(capSeed, current / 2, current));
    }

    function liquidate(uint256 accountSeed, uint256 fracSeed) external {
        if (accounts.length == 0 || oracle.reverting()) return;
        address acct = accounts[accountSeed % accounts.length];
        Position memory p = morpho.position(id, acct);
        if (p.borrowShares == 0) return;
        uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
        if (debt_ * 1e18 <= _value(p.collateral) * params.lltv) return; // healthy
        uint256 shares = uint256(p.borrowShares) * bound(fracSeed, 1, 100) / 100;
        if (shares == 0) return;

        deal(address(musd), liquidator, debt_ * 2);
        vm.startPrank(liquidator);
        musd.approve(address(morpho), type(uint256).max);
        try morpho.liquidate(params, acct, 0, shares, "") returns (uint256 seized, uint256) {
            if (seized != 0) receipt.unwrap(seized, liquidator);
            ++liquidations;
        } catch {}
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- internal

    /// @dev `raisesLtv`: the action borrowed or withdrew. Only those are bound by the ceiling; a pure top-up may leave
    /// a position above it (after a price drop) because it can only lower LTV, and top-ups are never blocked (A-1).
    function _afterRiskAction(address acct, bool borrowed, bool raisesLtv) internal {
        _track(acct);
        Position memory p = morpho.position(id, acct);
        if (raisesLtv && p.borrowShares != 0) {
            uint256 debt_ = morpho.expectedBorrowAssets(params, acct);
            (, uint16 ceiling) = factory.limits(factory.profileOf(acct));
            if (debt_ * BPS > _value(p.collateral) * ceiling) ltvViolated = true;
        }
        if (borrowed) {
            ++successfulBorrows;
            if (morpho.market(id).totalBorrowAssets > factory.globalBorrowCap()) globalCapViolated = true;
            (uint128 cap,) = factory.limits(factory.profileOf(acct));
            if (p.collateral > cap) positionCapViolated = true;
        }
    }

    function _track(address acct) internal {
        if (!tracked[acct]) {
            tracked[acct] = true;
            accounts.push(acct);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _existing(uint256 seed) internal view returns (address actor, address acct) {
        actor = _actor(seed);
        (address a, bool deployed) = factory.accountOf(actor, actor == canaryOp ? Profile.CANARY : Profile.STANDARD);
        if (deployed) acct = a;
    }

    function _value(uint256 coll) internal view returns (uint256) {
        return coll * oracle.rawPrice() / 1e36;
    }
}

/// @notice System invariants for bcBTC, the clones and M1 on a testnet fork (real Morpho, IRM and MUSD).
abstract contract AccountsInvariantTests is BorrowAccountForkBase {
    AccountsHandler internal handler;

    function _setUpHandler() internal {
        _submitAndExecute(abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (canaryOp, true)));
        address[] memory users = new address[](3);
        users[0] = alice;
        users[1] = bob;
        users[2] = makeAddr("carol");
        handler = new AccountsHandler(factory, oracle, sentinel, canaryOp, users);
        targetContract(address(handler));
        // The handler pranks its own actors; a fixed sender avoids an RPC account lookup per random sender.
        targetSender(makeAddr("inv.sender"));
    }

    /// @dev Non-vacuity: a scripted pass through the handler reaches the borrow, liquidation and exit paths.
    function test_handlerReachesEveryPath() public {
        handler.open(0, type(uint256).max, 6000); // alice, full cap, ~60% LTV
        handler.open(3, type(uint256).max, 7600); // canary operator near its ceiling
        handler.borrow(1, 0); // bob has no account: no-op
        handler.crashPrice(0, 100);
        handler.liquidate(0, 50);
        handler.toggleOracle(0); // oracle down
        handler.exit(0);
        handler.exit(3);
        assertGt(handler.successfulBorrows(), 0, "borrows");
        assertGt(handler.liquidations(), 0, "liquidations");
        assertEq(handler.successfulExits(), 2, "exits with the oracle down");
        assertFalse(handler.exitFailed());
        invariant_clonesHoldNothing();
        invariant_collateralOnlyFromAccounts();
        assertEq(IERC20(address(receipt)).totalSupply(), 0);
    }

    /// @dev Invariant 8: clones end every call with 0 MUSD, 0 bcBTC (and no stray native BTC outside come-back).
    function invariant_clonesHoldNothing() public view {
        for (uint256 i; i < handler.accountsLength(); ++i) {
            address acct = handler.accounts(i);
            assertEq(musd.balanceOf(acct), 0, "MUSD in clone");
            assertEq(IERC20(address(receipt)).balanceOf(acct), 0, "bcBTC in clone");
            assertEq(acct.balance, 0, "native BTC in clone");
        }
    }

    /// @dev Invariant 5: native BTC held by the receipt covers its supply.
    function invariant_receiptBacked() public view {
        assertGe(address(receipt).balance, IERC20(address(receipt)).totalSupply());
    }

    /// @dev Invariants 6 and 7: bcBTC in Morpho equals the clones' M1 collateral, and every holder is an account.
    function invariant_collateralOnlyFromAccounts() public view {
        uint256 sum;
        for (uint256 i; i < handler.accountsLength(); ++i) {
            address acct = handler.accounts(i);
            assertTrue(factory.isAccount(acct), "unregistered collateral holder");
            sum += morpho.position(marketId, acct).collateral;
        }
        uint256 inMorpho = IERC20(address(receipt)).balanceOf(net.morpho);
        assertEq(inMorpho, sum, "Morpho bcBTC != sum of clone collateral");
        assertEq(IERC20(address(receipt)).totalSupply(), inMorpho, "bcBTC outside Morpho");
    }

    /// @dev Invariant 11: no borrow succeeds on a position whose collateral is above the profile cap. Collateral
    /// itself may exceed the cap (top-ups are never capped, and the sentinel may cut the cap under a position).
    function invariant_positionCaps() public view {
        assertFalse(handler.positionCapViolated(), "borrow above the position cap");
    }

    /// @dev Invariant 14: collateral top-ups always succeed, even above a cut position cap or with the oracle down.
    function invariant_topUpsNeverBlocked() public view {
        assertFalse(handler.topUpFailed(), "addCollateral failed");
    }

    /// @dev Invariant 9: post-action LTV <= ceiling.
    function invariant_ltvWithinCeilingAfterActions() public view {
        assertFalse(handler.ltvViolated(), "LTV above ceiling after an action");
    }

    /// @dev Invariant 10: after any borrow, M1 totalBorrowAssets <= global cap.
    function invariant_borrowsWithinGlobalCap() public view {
        assertFalse(handler.globalCapViolated(), "global cap exceeded after a borrow");
    }

    /// @dev Invariant 13: the oracle-free exit always succeeds for a funded owner.
    function invariant_exitAlwaysWorks() public view {
        assertFalse(handler.exitFailed(), "repayAndWithdraw failed");
    }
}

contract AccountsInvariantTestnetTest is AccountsInvariantTests {
    function setUp() public {
        _setUpNet(Net.TESTNET);
        _setUpHandler();
    }
}

contract AccountsInvariantMainnetTest is AccountsInvariantTests {
    function setUp() public {
        _setUpNet(Net.MAINNET);
        _setUpHandler();
    }
}
