// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Id, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../../src/interfaces/ICollateralBTC.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";

/// @notice Local (non-fork) M1 stack for the area-A audit regressions: real Morpho Blue + AdaptiveCurveIrm, MockMUSD, a
/// settable Morpho oracle, and the real BorrowAccountFactory (which deploys the real bcBTC and BorrowAccount).
/// Morpho and the IRM (solc 0.8.19, compiled via test/utils/MorphoImports.sol) are deployed from build artifacts; with
/// an isolated FOUNDRY_OUT the project's fs_permissions block reading it, so `_deploy` falls back to the default ./out
/// build (run `forge build` once if ./out/Morpho.sol is missing).
/// Run: FOUNDRY_OUT=out/fix-a FOUNDRY_CACHE_PATH=cache/fix-a forge test --match-path test/audit/CoreAudit.t.sol -vv
/// Parameters mirror testnet: LLTV 0.77, STANDARD 0.01 BTC / 6200 bps, CANARY 0.002 BTC / 7675 bps, 5,000 MUSD cap.
abstract contract CoreAuditBase is Test {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant LLTV = 0.77e18;
    uint256 internal constant PRICE = 80_000e36; // 80,000 MUSD per BTC at Morpho's 1e36 scale (18/18 decimals)
    uint256 internal constant SEED = 10_000e18;

    MockMUSD internal musd;
    IMorpho internal morpho;
    address internal irm;
    MockMorphoOracle internal oracle;
    BorrowAccountFactory internal factory;
    ICollateralBTC internal receipt;
    MarketParams internal params;
    Id internal marketId;

    address internal morphoOwner = makeAddr("morphoOwner");
    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal feeTo = makeAddr("feeRecipient");
    address internal canaryOp = makeAddr("canaryOperator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal lender = makeAddr("lender");
    address internal liquidator = makeAddr("liquidator");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_792_942_983);
        vm.roll(16_363_000);

        musd = new MockMUSD();
        morpho = IMorpho(_deploy("Morpho.sol", "Morpho", abi.encode(morphoOwner)));
        irm = _deploy("AdaptiveCurveIrm.sol", "AdaptiveCurveIrm", abi.encode(address(morpho)));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        vm.stopPrank();

        oracle = new MockMorphoOracle(PRICE);
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: address(morpho),
                musd: address(musd),
                oracle: address(oracle),
                irm: irm,
                lltv: LLTV,
                bos: address(0),
                collSurplusPool: address(0),
                governor: governor,
                sentinel: sentinel,
                feeRecipient: feeTo,
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits(0.01e18, 6200),
                canary: IBorrowAccountFactory.Limits(0.002e18, 7675)
            })
        );
        receipt = ICollateralBTC(factory.COLLATERAL());
        params = factory.marketParams();
        marketId = params.id();
        morpho.createMarket(params);

        musd.mint(lender, SEED);
        vm.startPrank(lender);
        musd.approve(address(morpho), SEED);
        morpho.supply(params, SEED, 0, lender, "");
        vm.stopPrank();

        // D-7: canary grants are timelocked like every other raise.
        _submit(abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (canaryOp, true)));
        skip(48 hours);
        factory.setCanaryOperator(canaryOp, true);

        vm.label(address(morpho), "Morpho");
        vm.label(address(factory), "factory");
        vm.label(address(receipt), "bcBTC");
        vm.label(address(musd), "MUSD");
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Deploys a 0.8.19 artifact. The project's `fs_permissions` only allow reading `./out`, so when the suite
    /// runs with an isolated `FOUNDRY_OUT` the artifact is read from the default `./out` build instead.
    function _deploy(string memory file, string memory name, bytes memory args) internal returns (address addr) {
        bytes memory code;
        try vm.getCode(string.concat(file, ":", name)) returns (bytes memory c) {
            code = c;
        } catch {
            code = vm.getCode(string.concat("out/", file, "/", name, ".json"));
        }
        bytes memory init = bytes.concat(code, args);
        assembly ("memory-safe") {
            addr := create(0, add(init, 0x20), mload(init))
        }
        require(addr != address(0), "deploy failed");
    }

    function _open(address who, uint256 coll, uint256 musdOut) internal returns (IBorrowAccount acct) {
        vm.deal(who, who.balance + coll);
        vm.prank(who);
        acct = IBorrowAccount(factory.openAndBorrow{value: coll}(musdOut, BPS));
    }

    function _openCanary(address who, uint256 coll, uint256 musdOut) internal returns (IBorrowAccount acct) {
        vm.deal(who, who.balance + coll);
        vm.prank(who);
        acct = IBorrowAccount(factory.openCanary{value: coll}(musdOut, BPS));
    }

    function _value(uint256 coll) internal view returns (uint256) {
        return coll * oracle.rawPrice() / 1e36;
    }

    function _debt(address acct) internal view returns (uint256) {
        return morpho.expectedBorrowAssets(params, acct);
    }

    function _coll(address acct) internal view returns (uint256) {
        return morpho.position(marketId, acct).collateral;
    }

    /// @dev Post-action LTV in bps, rounded down (same valuation as Morpho / BorrowAccount).
    function _ltvBps(address acct) internal view returns (uint256) {
        return _debt(acct) * BPS / _value(_coll(acct));
    }

    function _healthy(address acct) internal view returns (bool) {
        return _value(_coll(acct)) * LLTV / 1e18 >= _debt(acct);
    }

    /// @dev Smallest collateral with `debt * 1e4 <= floor(c * price / 1e36) * ceilingBps`.
    function _minColl(uint256 debt_, uint256 ceilingBps) internal view returns (uint256 c) {
        uint256 price = oracle.rawPrice();
        c = debt_ * BPS * 1e36 / (price * ceilingBps);
        while (debt_ * BPS > (c * price / 1e36) * ceilingBps) ++c;
        while (c != 0 && debt_ * BPS <= ((c - 1) * price / 1e36) * ceilingBps) --c;
    }

    function _assertClean(address acct) internal view {
        assertEq(musd.balanceOf(acct), 0, "clone holds MUSD");
        assertEq(IERC20(address(receipt)).balanceOf(acct), 0, "clone holds bcBTC");
    }

    function _submit(bytes memory data) internal {
        vm.prank(governor);
        factory.submit(data);
    }

    function _exec(address caller, bytes memory data) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = address(factory).call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @notice Area A (core credit stack) audit regressions, plus the BorrowAccount/factory findings of area D (D-1, D-4,
/// D-7). Each `test_fix_*` was the PoC of the finding it is named after and now asserts the fixed behaviour.
contract CoreAuditTest is CoreAuditBase {
    using MorphoBalancesLib for IMorpho;

    // ---------------------------------------------------------------- harness sanity

    /// @dev Positive control: the harness reproduces the intended open / exit behaviour.
    function test_harness_openAndExit() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 200e18);
        assertEq(musd.balanceOf(alice), 200e18);
        assertEq(musd.balanceOf(feeTo), 0.2e18);
        assertEq(_debt(address(acct)), 200.2e18);
        musd.mint(alice, 0.2e18);
        vm.startPrank(alice);
        musd.approve(address(acct), type(uint256).max);
        oracle.setReverting(true);
        acct.repayAndWithdraw(alice);
        vm.stopPrank();
        assertEq(alice.balance, 0.005e18);
        assertEq(IERC20(address(receipt)).totalSupply(), 0);
    }

    // ---------------------------------------------------------------- A-1 / D-1: top-ups are never capped

    /// @notice A-1: after a sentinel position-cap cut, a position above the new cap can still be topped up and so
    /// defended against liquidation; only new debt is refused while its collateral is above the cap.
    function test_fix_A1_topUpAboveCutCapDefendsPosition() public {
        // Alice opens the STANDARD maximum: 0.01 BTC (800 MUSD of value) at ~60% LTV.
        IBorrowAccount acct = _open(alice, 0.01e18, 480e18);
        assertApproxEqAbs(_ltvBps(address(acct)), 6006, 1);

        // Liquidation depth falls; the sentinel halves the STANDARD position cap (instant).
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.005e18, 6200);

        // BTC drops 21%: Alice tops up with 0.003 BTC (and even 1 wei more), far above the new cap.
        oracle.setPrice(63_000e36);
        vm.deal(alice, 0.003e18 + 1);
        vm.startPrank(alice);
        acct.addCollateral{value: 0.003e18}();
        acct.addCollateral{value: 1}();
        vm.stopPrank();
        assertEq(_coll(address(acct)), 0.013e18 + 1);

        // The further 1.6% drop that used to liquidate her leaves the position healthy, at ~59.6% LTV.
        oracle.setPrice(62_000e36);
        assertTrue(_healthy(address(acct)), "defended");
        assertLt(_ltvBps(address(acct)), 6200);
        musd.mint(liquidator, 1000e18);
        vm.startPrank(liquidator);
        musd.approve(address(morpho), type(uint256).max);
        vm.expectRevert(bytes("position is healthy"));
        morpho.liquidate(params, address(acct), 0.001e18, 0, "");
        vm.stopPrank();

        // The cap still binds where it matters: no new debt while collateral is above it.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, 0.013e18 + 1, 0.005e18));
        acct.borrow(1e18, BPS, alice);
        _assertClean(address(acct));
    }

    /// @notice A-1 (control): a top-up below the cap, the documented rescue path, keeps working.
    function test_fix_A1_control_topUpWorksBelowCap() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 240e18);
        oracle.setPrice(63_000e36);
        vm.deal(alice, 0.003e18);
        vm.prank(alice);
        acct.addCollateral{value: 0.003e18}();
        oracle.setPrice(62_000e36);
        assertTrue(_healthy(address(acct)));
    }

    /// @notice D-1a: a borrower who opened at the position cap can top up when BTC falls and is not liquidated. Once
    /// back under the cap (by withdrawing within the ceiling) she can borrow again.
    function test_fix_D1a_borrowerAtPositionCapCanTopUp() public {
        IBorrowAccount acct = _open(alice, 0.01e18, 400e18); // LTV ~50%

        oracle.setPrice(54_000e36); // LTV ~74.1%
        vm.deal(alice, 0.005e18);
        vm.prank(alice);
        acct.addCollateral{value: 0.005e18}();
        assertEq(_coll(address(acct)), 0.015e18);

        oracle.setPrice(51_000e36); // ~78.5% without the top-up, ~52.3% with it
        assertTrue(_healthy(address(acct)), "not liquidatable");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, 0.015e18, 0.01e18));
        acct.borrow(1e18, BPS, alice);

        // BTC recovers; withdrawing back to the cap re-enables borrowing.
        oracle.setPrice(PRICE);
        vm.startPrank(alice);
        acct.withdrawCollateral(0.005e18, alice);
        acct.borrow(1e18, BPS, alice);
        vm.stopPrank();
        assertEq(_coll(address(acct)), 0.01e18);
        _assertClean(address(acct));
    }

    /// @notice D-1b: a cap cut below an existing position does not block its top-ups.
    function test_fix_D1b_sentinelCapCutDoesNotBlockTopUps() public {
        IBorrowAccount acct = _open(bob, 0.004e18, 100e18);
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.001e18, 6200);
        vm.deal(bob, 1);
        vm.prank(bob);
        acct.addCollateral{value: 1}();
        assertEq(_coll(address(acct)), 0.004e18 + 1);
    }

    /// @notice D-1c: a ceiling cut only bounds withdrawals that would end above the new ceiling. With debt, every
    /// withdrawal raises the LTV, so a cut to 0 still stops partial withdrawals (by design: it is the sentinel's
    /// lever against new risk); repay, top-ups and the oracle-free full exit stay open whatever the ceiling.
    function test_fix_D1c_ceilingCutBoundsOnlyWithdrawalsAboveIt() public {
        IBorrowAccount acct = _open(bob, 0.004e18, 100e18); // LTV ~31%

        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.01e18, 5000);
        vm.prank(bob);
        acct.withdrawCollateral(0.001e18, bob); // ~41.7%: within the cut ceiling
        assertLe(_ltvBps(address(acct)), 5000);
        vm.prank(bob);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        acct.withdrawCollateral(0.001e18, bob); // ~62.6%: above it

        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.01e18, 0);
        vm.prank(bob);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        acct.withdrawCollateral(1e9, bob);

        // Risk-reducing actions and the full exit are never blocked.
        vm.deal(bob, 0.001e18);
        musd.mint(bob, 1e18);
        vm.startPrank(bob);
        acct.addCollateral{value: 0.001e18}();
        musd.approve(address(acct), type(uint256).max);
        acct.repay(50e18);
        oracle.setReverting(true);
        acct.repayAndWithdraw(bob);
        vm.stopPrank();
        assertEq(_coll(address(acct)), 0);
        assertEq(bob.balance, 0.004e18, "0.003 left after the withdrawal + the 0.001 top-up");
    }

    /// @notice A-1: idle BTC (a CollSurplusPool claim, the `comeBack` path) at the cap is supplied in full instead of
    /// reverting `ZeroAmount`; with a borrow, only the room under the cap is supplied and the rest stays rescuable.
    function test_fix_A1_supplyIdleIgnoresCapUnlessBorrowing() public {
        IBorrowAccount acct = _open(alice, 0.01e18, 0); // at the cap
        vm.deal(address(acct), 0.003e18);
        vm.prank(alice);
        assertEq(acct.supplyIdle(0, 0, alice), 0.003e18);
        assertEq(_coll(address(acct)), 0.013e18);
        assertEq(address(acct).balance, 0);

        // Above the cap a borrow is refused with the cap error, not ZeroAmount, and nothing is supplied.
        vm.deal(address(acct), 0.001e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, 0.013e18, 0.01e18));
        acct.supplyIdle(10e18, BPS, alice);

        // Below the cap with a borrow: supply up to the cap, borrow, leave the excess idle and rescuable.
        IBorrowAccount b = _open(bob, 0.008e18, 0);
        vm.deal(address(b), 0.005e18);
        vm.prank(bob);
        assertEq(b.supplyIdle(10e18, BPS, bob), 0.002e18);
        assertEq(_coll(address(b)), 0.01e18);
        assertEq(musd.balanceOf(bob), 10e18);
        assertEq(address(b).balance, 0.003e18);
        vm.prank(bob);
        b.rescueNative(bob);
        assertEq(bob.balance, 0.003e18);
        _assertClean(address(b));
    }

    /// @notice A-1: a collateral-only open is not capped either; borrowing on it is.
    function test_fix_A1_collateralOnlyOpenAboveCap() public {
        IBorrowAccount acct = _open(alice, 0.02e18, 0);
        assertEq(_coll(address(acct)), 0.02e18);
        vm.deal(bob, 0.02e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, 0.02e18, 0.01e18));
        factory.openAndBorrow{value: 0.02e18}(1e18, BPS);
    }

    // ---------------------------------------------------------------- A-2 / D-4: cuts invalidate queued raises

    /// @notice A-2: a sentinel ceiling cut invalidates the STANDARD `setLimits` raise queued before it, so nobody can
    /// undo the cut with it; a new raise needs a fresh, public 48 h.
    function test_fix_A2_sentinelCeilingCutInvalidatesPendingRaise() public {
        bytes memory raiseCap = abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.STANDARD, 0.02e18, 6200));
        _submit(raiseCap);

        skip(24 hours);
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.01e18, 5000);
        assertEq(factory.executableAt(raiseCap), 0, "invalidated by the cut");

        skip(24 hours);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setLimits(Profile.STANDARD, 0.02e18, 6200);
        (uint128 cap, uint16 ceiling) = factory.limits(Profile.STANDARD);
        assertEq(cap, 0.01e18);
        assertEq(ceiling, 5000, "cut stands");

        // The borrow the sentinel meant to block stays blocked.
        vm.deal(alice, 0.01e18);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: 0.01e18}(480e18, BPS);

        // Governance can still raise, with a new 48 h notice measured from after the cut.
        _submit(raiseCap);
        skip(48 hours - 1);
        vm.prank(attacker);
        vm.expectPartialRevert(IBorrowAccountFactory.TimelockNotExpired.selector);
        factory.setLimits(Profile.STANDARD, 0.02e18, 6200);
        skip(1);
        _exec(attacker, raiseCap);
        (, ceiling) = factory.limits(Profile.STANDARD);
        assertEq(ceiling, 6200);
    }

    /// @notice A-2 (global cap): a sentinel cut to 0 invalidates the cap raise queued before it.
    function test_fix_A2_globalCapCutInvalidatesPendingRaise() public {
        bytes memory raise = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (10_000e18));
        _submit(raise);
        skip(47 hours);
        vm.prank(sentinel);
        factory.setGlobalBorrowCap(0);
        skip(1 hours);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(10_000e18);
        assertEq(factory.globalBorrowCap(), 0, "emergency stop holds");

        vm.deal(alice, 0.005e18);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.GlobalCapExceeded.selector);
        factory.openAndBorrow{value: 0.005e18}(200e18, BPS);
    }

    /// @notice D-4: queued calldata executed as a decrease through the instant path is consumed with it, so it cannot
    /// later re-raise the parameter after an emergency cut.
    function test_fix_D4_instantPathConsumesStaleEntry() public {
        bytes memory raiseA = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (8000e18));
        bytes memory raiseB = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (10_000e18));
        _submit(raiseA);
        _submit(raiseB);
        skip(48 hours);

        _exec(attacker, raiseB); // anyone executes B
        vm.prank(governor);
        factory.setGlobalBorrowCap(8000e18); // A's calldata, now a decrease: instant
        assertEq(factory.globalBorrowCap(), 8000e18);
        assertEq(factory.executableAt(raiseA), 0, "consumed");

        vm.prank(sentinel);
        factory.setGlobalBorrowCap(0);
        skip(30 days);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(8000e18);
        assertEq(factory.globalBorrowCap(), 0, "emergency cut holds");
    }

    /// @notice D-4: a pending limits raise does not survive a sentinel cut of the same profile.
    function test_fix_D4_pendingRaiseDiesWithSentinelCut() public {
        _submit(abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.STANDARD, 0.02e18, 7100)));
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0, 0);
        skip(48 hours);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setLimits(Profile.STANDARD, 0.02e18, 7100);
        (uint128 cap, uint16 ceiling) = factory.limits(Profile.STANDARD);
        assertEq(cap, 0);
        assertEq(ceiling, 0);
    }

    /// @notice A-2: queued raises also lapse `EXECUTION_WINDOW` after they become executable.
    function test_fix_A2_queuedRaiseExpires() public {
        bytes memory raise = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (6000e18));
        _submit(raise);
        skip(48 hours + factory.EXECUTION_WINDOW() + 1);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(6000e18);
    }

    // ---------------------------------------------------------------- A-3: revoked canaries

    /// @notice A-3: once its owner's operator role is revoked, a CANARY position can unwind but cannot withdraw past
    /// the STANDARD ceiling.
    function test_fix_A3_revokedCanaryWithdrawHeldToStandardCeiling() public {
        IBorrowAccount acct = _openCanary(canaryOp, 0.002e18, 64e18); // ~40%
        assertEq(factory.riskParams(address(acct)).ceilingBps, 7675);

        vm.prank(sentinel); // removal is instant for the sentinel too
        factory.setCanaryOperator(canaryOp, false);
        assertEq(factory.riskParams(address(acct)).ceilingBps, 6200, "STANDARD ceiling");

        vm.prank(canaryOp);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.NotCanaryOperator.selector, canaryOp));
        acct.borrow(1e18, BPS, canaryOp);

        // The withdrawal that used to reach the CANARY ceiling is refused against the STANDARD one.
        uint256 debt_ = _debt(address(acct));
        uint256 minColl = _minColl(debt_, 7675);
        uint256 toCanaryCeiling = _coll(address(acct)) - minColl;
        uint256 v = _value(minColl);
        vm.prank(canaryOp);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.LtvTooHigh.selector, (debt_ * BPS + v - 1) / v, 6200));
        acct.withdrawCollateral(toCanaryCeiling, canaryOp);

        // Withdrawing to the STANDARD ceiling works.
        uint256 toStandardCeiling = _coll(address(acct)) - _minColl(debt_, 6200);
        vm.prank(canaryOp);
        acct.withdrawCollateral(toStandardCeiling, canaryOp);
        assertLe(_ltvBps(address(acct)), 6200);
        assertGt(_ltvBps(address(acct)), 6100);

        // The full exit stays open.
        musd.mint(canaryOp, 1e18);
        vm.startPrank(canaryOp);
        musd.approve(address(acct), type(uint256).max);
        acct.repayAndWithdraw(canaryOp);
        vm.stopPrank();
        assertEq(_coll(address(acct)), 0);
    }

    /// @notice A-3: a revoked canary already above the STANDARD ceiling cannot withdraw at all, only repay or exit; a
    /// re-grant (timelocked) restores the CANARY ceiling.
    function test_fix_A3_revokedCanaryAboveStandardCeilingCanOnlyUnwind() public {
        IBorrowAccount acct = _openCanary(canaryOp, 0.002e18, 120e18); // ~75%
        vm.prank(governor);
        factory.setCanaryOperator(canaryOp, false);

        vm.prank(canaryOp);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        acct.withdrawCollateral(1e9, canaryOp);

        musd.mint(canaryOp, 1e18);
        vm.startPrank(canaryOp);
        musd.approve(address(acct), type(uint256).max);
        acct.repay(60e18);
        vm.stopPrank();

        _submit(abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (canaryOp, true)));
        skip(48 hours);
        factory.setCanaryOperator(canaryOp, true);
        assertEq(factory.riskParams(address(acct)).ceilingBps, 7675);
        uint256 toCanaryCeiling = _coll(address(acct)) - _minColl(_debt(address(acct)), 7675);
        vm.prank(canaryOp);
        acct.withdrawCollateral(toCanaryCeiling, canaryOp);
        assertGt(_ltvBps(address(acct)), 7600);
    }

    // ---------------------------------------------------------------- A-4: no MUSD stranded in clones

    /// @notice A-4: the clone is refused as a receiver on every borrow path, and MUSD transferred to it directly can
    /// be swept out by the owner, so it is never stranded.
    function test_fix_A4_selfReceiverRejectedAndDirectTransfersSweepable() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 0);
        bytes memory err = abi.encodeWithSelector(IBorrowAccount.InvalidReceiver.selector, address(acct));

        vm.prank(alice);
        vm.expectRevert(err);
        acct.borrow(100e18, BPS, address(acct));

        vm.deal(address(acct), 0.001e18);
        vm.prank(alice);
        vm.expectRevert(err);
        acct.supplyIdle(10e18, BPS, address(acct));

        vm.prank(alice);
        vm.expectRevert(err);
        acct.withdrawCollateral(0.001e18, address(acct));

        // Module draws: the receiver is the module's choice, and the clone is refused there too.
        address module = makeAddr("module");
        _submit(abi.encodeCall(IBorrowAccountFactory.setModuleApproval, (module, true)));
        skip(48 hours);
        factory.setModuleApproval(module, true);
        vm.prank(alice);
        acct.setModule(module, true);
        vm.prank(module);
        vm.expectRevert(err);
        acct.borrowByModule(10e18, BPS, address(acct));
        vm.prank(module);
        acct.borrowByModule(10e18, BPS, module);
        assertEq(musd.balanceOf(module), 10e18);
        _assertClean(address(acct));

        // A direct transfer lands in the clone; the owner sweeps it.
        musd.mint(attacker, 100e18);
        vm.prank(attacker);
        musd.transfer(address(acct), 100e18);
        vm.prank(attacker);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.sweep(address(musd), attacker);
        vm.prank(alice);
        assertEq(acct.sweep(address(musd), alice), 100e18);
        assertEq(musd.balanceOf(alice), 100e18);
        _assertClean(address(acct));
    }

    // ---------------------------------------------------------------- A-5: pause semantics (documented)

    /// @notice A-5: pausing stops new borrowing; collateral-only deposits and every exit stay open. A collateral-only
    /// position carries no debt and so no liquidation risk; it still cannot borrow until the pause is lifted.
    function test_fix_A5_pauseStopsBorrowingNotCollateralDeposits() public {
        vm.prank(sentinel);
        factory.setPaused(true, false);

        vm.deal(bob, 0.005e18);
        vm.prank(bob);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        factory.openAndBorrow{value: 0.005e18}(10e18, BPS);

        IBorrowAccount acct = IBorrowAccount(factory.createAccount(bob));
        vm.prank(bob);
        acct.addCollateral{value: 0.005e18}();
        assertEq(_coll(address(acct)), 0.005e18);
        vm.prank(bob);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        acct.borrow(1e18, BPS, bob);
        vm.prank(bob);
        acct.withdrawCollateral(0.005e18, bob);
        assertEq(bob.balance, 0.005e18);
    }

    // ---------------------------------------------------------------- D-7: canary grants are timelocked

    /// @notice D-7: granting the canary role (borrowing at LLTV - 25 bps) is a timelocked raise like a STANDARD
    /// ceiling raise to the same value.
    function test_fix_D7_canaryGrantIsTimelocked() public {
        address stranger = makeAddr("stranger");
        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setCanaryOperator(stranger, true);

        vm.deal(stranger, 0.002e18);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.NotCanaryOperator.selector, stranger));
        factory.openCanary{value: 0.002e18}(122e18, 7675);

        bytes memory grant = abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (stranger, true));
        _submit(grant);
        skip(48 hours - 1);
        vm.prank(attacker);
        vm.expectPartialRevert(IBorrowAccountFactory.TimelockNotExpired.selector);
        factory.setCanaryOperator(stranger, true);
        skip(1);
        _exec(attacker, grant);
        vm.prank(stranger);
        address acct = factory.openCanary{value: 0.002e18}(122e18, 7675);
        assertGt(_ltvBps(acct), 7600, "only after a public 48 h");
    }

    // ---------------------------------------------------------------- probes (expected-sound behaviour)

    /// @dev Third parties can repay on behalf of, and supply loan assets on behalf of, a clone; neither breaks the
    /// owner's oracle-free exit or leaves tokens in the clone.
    function test_probe_thirdPartyMorphoActionsDoNotBreakExit() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 200e18);
        Position memory p = morpho.position(marketId, address(acct));
        musd.mint(attacker, 1000e18);
        vm.startPrank(attacker);
        musd.approve(address(morpho), type(uint256).max);
        morpho.repay(params, 1, 0, address(acct), ""); // 1-wei "donation" repay
        morpho.supply(params, 5e18, 0, address(acct), ""); // supply shares credited to the clone
        vm.stopPrank();
        skip(30 days);
        oracle.setReverting(true);
        uint256 debt_ = _debt(address(acct));
        musd.mint(alice, debt_);
        vm.startPrank(alice);
        musd.approve(address(acct), debt_);
        acct.repayAndWithdraw(alice);
        vm.stopPrank();
        assertGt(p.borrowShares, 0);
        assertEq(_coll(address(acct)), 0);
        assertEq(musd.balanceOf(address(acct)), 0);
        assertEq(IERC20(address(receipt)).balanceOf(address(acct)), 0);
    }

    /// @dev A Morpho flash loan of bcBTC cannot be repaid by a non-account, so it always reverts.
    function test_probe_bcBtcFlashLoanReverts() public {
        _open(alice, 0.005e18, 0);
        FlashBorrower fb = new FlashBorrower(address(receipt));
        vm.expectRevert();
        morpho.flashLoan(address(receipt), 0.005e18, abi.encode(address(fb)));
        vm.expectRevert();
        fb.go(morpho, 0.005e18);
    }
}

/// @dev Flash-loans bcBTC from Morpho and unwraps it inside the callback.
contract FlashBorrower {
    address internal immutable token;

    constructor(address token_) {
        token = token_;
    }

    receive() external payable {}

    function go(IMorpho morpho, uint256 amount) external {
        IERC20(token).approve(address(morpho), type(uint256).max);
        morpho.flashLoan(token, amount, "");
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata) external {
        ICollateralBTC(token).unwrap(assets, address(this));
    }
}
