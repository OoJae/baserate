// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {IMorpho, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {IMorphoFlashLoanCallback} from "morpho-blue/interfaces/IMorphoCallbacks.sol";
import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {ErrorsLib} from "morpho-blue/libraries/ErrorsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../../src/interfaces/ICollateralBTC.sol";
import {IBorrowerOperationsSignatures} from "../../src/interfaces/external/IBorrowerOperationsSignatures.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {BorrowAccountForkBase} from "./BorrowAccountForkBase.t.sol";

interface IEIP712Domain {
    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory);
}

/// @dev Tries to flash-borrow bcBTC from Morpho; the return leg must hit the receipt's transfer gate.
contract ReceiptFlashBorrower is IMorphoFlashLoanCallback {
    IMorpho internal immutable MORPHO;

    constructor(IMorpho morpho) {
        MORPHO = morpho;
    }

    function flash(address token, uint256 amount) external {
        MORPHO.flashLoan(token, amount, abi.encode(token));
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        IERC20(abi.decode(data, (address))).approve(address(MORPHO), assets);
    }
}

/// @notice M1 account behaviour against the real Morpho, AdaptiveCurveIrm, MUSD and MUSD come-back contracts.
abstract contract BorrowAccountForkTests is BorrowAccountForkBase {
    using MorphoBalancesLib for IMorpho;

    // ---------------------------------------------------------------- open / borrow

    function test_openAndBorrow_deploysSuppliesBorrowsAndChargesFee() public {
        (address predicted, bool deployedBefore) = factory.accountOf(alice, Profile.STANDARD);
        assertFalse(deployedBefore);
        uint256 coll = 0.005e18;

        vm.expectEmit(true, true, false, true, address(factory));
        emit IBorrowAccountFactory.AccountCreated(alice, predicted, Profile.STANDARD);
        IBorrowAccount acct = _open(alice, coll, 100e18, 6000);

        assertEq(address(acct), predicted, "predicted address");
        assertTrue(factory.isAccount(address(acct)), "registered");
        assertEq(acct.owner(), alice, "owner");
        assertEq(acct.collateral(), coll, "collateral");
        assertEq(acct.debt(), 100.1e18, "debt incl 10 bps fee");
        assertEq(musd.balanceOf(alice), 100e18, "alice MUSD");
        assertEq(musd.balanceOf(feeTo), 0.1e18, "fee");
        assertEq(IERC20(address(receipt)).totalSupply(), coll, "receipt supply");
        _assertClean(acct);
        _assertReceiptBacked();
    }

    function test_openAndBorrow_judgeFlow() public {
        // 0.001 BTC -> 40 MUSD (debt 40.04) is just under 50% LTV at ~80.6k.
        IBorrowAccount acct = _open(alice, 0.001e18, 40e18, 5000);
        assertEq(acct.debt(), 40.04e18);
        assertLe(_ltvBps(address(acct)), 5000);
    }

    function test_openAndBorrow_judgeFlowWith0009BtcExceeds5000Bps() public {
        // Spec's 05_DemoBorrow (0.0009 BTC, 40 MUSD, maxLtv 5000) is ~55% LTV at the pinned price, so it must revert.
        vm.deal(alice, 0.0009e18);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: 0.0009e18}(40e18, 5000);
    }

    function test_openAndBorrow_collateralOnly() public {
        IBorrowAccount acct = _open(alice, 0.004e18, 0, 0);
        assertEq(acct.collateral(), 0.004e18);
        assertEq(acct.debt(), 0);
        _assertClean(acct);
    }

    function test_openAndBorrow_reusesExistingClone() public {
        IBorrowAccount first = _open(alice, 0.003e18, 50e18, 6000);
        IBorrowAccount second = _open(alice, 0.002e18, 50e18, 6000);
        assertEq(address(first), address(second));
        assertEq(second.collateral(), 0.005e18);
        assertApproxEqAbs(second.debt(), 100.1e18, 1);
        assertEq(musd.balanceOf(alice), 100e18);
    }

    function test_borrow_againstExistingCollateral() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 0, 0);
        vm.prank(alice);
        acct.borrow(80e18, 6000, bob);
        assertEq(musd.balanceOf(bob), 80e18, "receiver");
        assertEq(acct.debt(), 80.08e18);
        _assertClean(acct);
    }

    function test_borrow_noFeeWithoutFeeRecipient() public {
        _submitAndExecute(abi.encodeCall(IBorrowAccountFactory.setFeeRecipient, (address(0))));
        assertEq(factory.feeRecipient(), address(0));
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        assertEq(acct.debt(), 100e18);
        assertEq(musd.balanceOf(feeTo), 0);
    }

    function test_borrow_revertsAboveMaxLtv() public {
        uint256 coll = 0.005e18;
        uint256 musdOut = _maxMusdOut(coll, 2000) + 1;
        vm.deal(alice, coll);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: coll}(musdOut, 2000);
    }

    function test_borrow_atProfileCeilingSucceedsAndOneMoreWeiReverts() public {
        uint256 coll = 0.005e18;
        uint256 atCeiling = _maxMusdOut(coll, lim.standardCeiling);

        vm.deal(alice, coll);
        vm.prank(alice);
        // maxLtvBps above the ceiling is clamped to the ceiling.
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: coll}(atCeiling + 1, 10_000);

        IBorrowAccount acct = _open(alice, coll, atCeiling, 10_000);
        assertLe(acct.debt() * BPS, _value(coll) * lim.standardCeiling);
    }

    function test_open_revertsAbovePositionCap() public {
        uint256 coll = uint256(lim.standardCap) + 1;
        vm.deal(alice, coll);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.PositionCapExceeded.selector, coll, lim.standardCap));
        factory.openAndBorrow{value: coll}(0, 0);
    }

    function test_addCollateral_respectsPositionCap() public {
        IBorrowAccount acct = _open(alice, uint256(lim.standardCap) - 0.001e18, 0, 0);
        vm.deal(alice, 0.002e18);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.PositionCapExceeded.selector);
        acct.addCollateral{value: 0.002e18}();

        vm.prank(alice);
        acct.addCollateral{value: 0.001e18}();
        assertEq(acct.collateral(), lim.standardCap);
        _assertClean(acct);
    }

    function test_borrow_revertsAboveGlobalCap() public {
        vm.prank(sentinel);
        factory.setGlobalBorrowCap(50e18);
        vm.deal(alice, 0.005e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.GlobalCapExceeded.selector, 100.1e18, 50e18));
        factory.openAndBorrow{value: 0.005e18}(100e18, 6000);
    }

    function test_globalCap_includesAccruedInterest() public {
        uint256 cap = 300e18;
        vm.prank(governor);
        factory.setGlobalBorrowCap(cap);
        // Debt lands 0.05 MUSD under the cap; a 0.01 MUSD top-up fits now but not after a year of interest.
        uint256 musdOut = (cap - 0.05e18) * BPS / (BPS + 10);
        IBorrowAccount acct = _open(alice, 0.01e18, musdOut, 10_000);
        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        acct.borrow(0.01e18, 10_000, alice);
        vm.revertToState(snap);

        skip(365 days);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.GlobalCapExceeded.selector);
        acct.borrow(0.01e18, 10_000, alice);
    }

    function test_oracleBudget_twoReadsPerBorrow() public {
        vm.expectCall(address(oracle), abi.encodeCall(IOracle.price, ()), 2);
        _open(alice, 0.005e18, 100e18, 6000);
    }

    function test_oracleBudget_zeroReadsOnExit() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        skip(1 days);
        deal(net.musd, alice, 200e18);
        vm.prank(alice);
        musd.approve(address(acct), type(uint256).max);
        vm.expectCall(address(oracle), abi.encodeCall(IOracle.price, ()), 0);
        vm.prank(alice);
        acct.repayAndWithdraw(alice);
    }

    // ---------------------------------------------------------------- pause

    function test_pause_blocksNewPositionsAndBorrowsOnly() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        vm.prank(sentinel);
        factory.setPaused(true, false);

        vm.deal(bob, 0.005e18);
        vm.prank(bob);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        factory.openAndBorrow{value: 0.005e18}(10e18, 6000);

        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        acct.borrow(1e18, 6000, alice);

        // Top-up, repay, partial withdraw and the full exit stay open.
        vm.deal(alice, 0.001e18);
        vm.prank(alice);
        acct.addCollateral{value: 0.001e18}();
        vm.startPrank(alice);
        musd.approve(address(acct), type(uint256).max);
        acct.repay(10e18);
        acct.withdrawCollateral(0.001e18, alice);
        deal(net.musd, alice, 200e18);
        acct.repayAndWithdraw(alice);
        vm.stopPrank();
        assertEq(acct.collateral(), 0);
        assertEq(acct.debt(), 0);

        // The sentinel cannot unpause; the governor can.
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(false, false);
        vm.prank(governor);
        factory.setPaused(false, false);
        _open(bob, 0.005e18, 10e18, 6000);
    }

    // ---------------------------------------------------------------- repay / exit

    function test_repay_partialThenFullByShares() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        deal(net.musd, alice, 200e18);
        vm.startPrank(alice);
        musd.approve(address(acct), type(uint256).max);
        assertEq(acct.repay(10e18), 10e18);
        assertApproxEqAbs(acct.debt(), 90.1e18, 1);

        skip(7 days);
        uint256 debtNow = acct.debt();
        uint256 balBefore = musd.balanceOf(alice);
        uint256 repaid = acct.repay(1000e18);
        vm.stopPrank();

        assertEq(repaid, debtNow, "repaid exact debt");
        assertEq(balBefore - musd.balanceOf(alice), debtNow, "pulled exact debt");
        assertEq(_position(address(acct)).borrowShares, 0);
        assertEq(acct.debt(), 0);
        _assertClean(acct);
    }

    function test_repay_revertsWithoutDebt() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 0, 0);
        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.NoDebt.selector);
        acct.repay(1e18);
    }

    function test_repayAndWithdraw_afterInterest() public {
        uint256 coll = 0.005e18;
        IBorrowAccount acct = _open(alice, coll, 100e18, 6000);
        skip(30 days);
        uint256 expected = acct.debt();
        assertGt(expected, 100.1e18, "interest accrued");
        assertEq(expected, morpho.expectedBorrowAssets(params, address(acct)), "debt() == MorphoBalancesLib");

        deal(net.musd, alice, expected);
        vm.prank(alice);
        musd.approve(address(acct), expected);
        uint256 nativeBefore = alice.balance;

        vm.expectEmit(true, false, false, true, address(acct));
        emit IBorrowAccount.Exited(alice, expected, coll);
        vm.prank(alice);
        acct.repayAndWithdraw(alice);

        assertEq(musd.balanceOf(alice), 0, "pulled exactly the debt");
        assertEq(alice.balance - nativeBefore, coll, "native BTC back");
        Position memory p = _position(address(acct));
        assertEq(p.borrowShares, 0);
        assertEq(p.collateral, 0);
        assertEq(IERC20(address(receipt)).totalSupply(), 0);
        _assertClean(acct);
    }

    function test_repayAndWithdraw_worksWhileOracleReverts() public {
        uint256 coll = 0.005e18;
        IBorrowAccount acct = _open(alice, coll, 100e18, 6000);
        skip(1 days);
        oracle.setReverting(true);

        // Borrowing is frozen with the oracle down...
        vm.prank(alice);
        vm.expectRevert(MockMorphoOracle.OracleDown.selector);
        acct.borrow(1e18, 6000, alice);

        // ...but the full exit needs no price.
        deal(net.musd, alice, 200e18);
        uint256 nativeBefore = alice.balance;
        vm.startPrank(alice);
        musd.approve(address(acct), type(uint256).max);
        acct.repayAndWithdraw(bob);
        vm.stopPrank();
        assertEq(bob.balance, coll, "btcTo receives BTC");
        assertEq(alice.balance, nativeBefore);
        assertEq(acct.collateral(), 0);
        _assertClean(acct);
    }

    function test_repayAndWithdraw_collateralOnlyWhileOracleReverts() public {
        IBorrowAccount acct = _open(alice, 0.004e18, 0, 0);
        oracle.setReverting(true);
        vm.prank(alice);
        acct.repayAndWithdraw(alice);
        assertEq(alice.balance, 0.004e18);
    }

    function test_repayAndWithdraw_revertsWithoutPosition() public {
        vm.prank(alice);
        IBorrowAccount acct = IBorrowAccount(factory.createAccount(alice));
        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.NoPosition.selector);
        acct.repayAndWithdraw(alice);
    }

    // ---------------------------------------------------------------- withdraw

    function test_withdrawCollateral_withDebtRespectsCeiling() public {
        uint256 coll = 0.005e18;
        IBorrowAccount acct = _open(alice, coll, 100e18, 6000);
        uint256 debt_ = acct.debt();
        // Leave the position between the ceiling and the LLTV, so our check (not Morpho's) is the one that binds.
        uint256 lltvBps = net.lltv / 1e14;
        uint256 targetLtv = (lim.standardCeiling + lltvBps) / 2;
        uint256 remaining = debt_ * BPS * 1e36 / (targetLtv * oracle.rawPrice());

        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        acct.withdrawCollateral(coll - remaining, alice);

        vm.prank(alice);
        acct.withdrawCollateral(0.002e18, alice);
        assertEq(alice.balance, 0.002e18);
        assertEq(acct.collateral(), coll - 0.002e18);
        assertLe(_ltvBps(address(acct)), lim.standardCeiling);
        _assertClean(acct);
    }

    function test_withdrawCollateral_withDebtFrozenWhileOracleReverts() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        oracle.setReverting(true);
        vm.prank(alice);
        vm.expectRevert(MockMorphoOracle.OracleDown.selector);
        acct.withdrawCollateral(0.001e18, alice);
    }

    function test_withdrawCollateral_withoutDebtNeedsNoOracle() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 0, 0);
        oracle.setReverting(true);
        vm.prank(alice);
        acct.withdrawCollateral(0.002e18, bob);
        assertEq(bob.balance, 0.002e18);
        assertEq(acct.collateral(), 0.003e18);
    }

    // ---------------------------------------------------------------- permit exit

    function test_repayAndWithdrawWithPermit() public {
        uint256 coll = 0.005e18;
        IBorrowAccount acct = _open(alice, coll, 100e18, 6000);
        skip(3 days);
        uint256 debt_ = acct.debt();
        deal(net.musd, alice, debt_ + 1e18);
        uint256 maxRepay = debt_ + 1e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(ALICE_PK, address(acct), maxRepay, deadline);

        vm.prank(alice);
        acct.repayAndWithdrawWithPermit(maxRepay, deadline, v, r, s, alice);
        assertEq(musd.balanceOf(alice), 1e18, "only the debt was pulled");
        assertEq(musd.allowance(alice, address(acct)), maxRepay - debt_, "leftover allowance");
        assertEq(alice.balance, coll);
        _assertClean(acct);
    }

    function test_repayAndWithdrawWithPermit_survivesFrontRunPermit() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        uint256 maxRepay = 101e18;
        deal(net.musd, alice, maxRepay);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(ALICE_PK, address(acct), maxRepay, deadline);

        vm.prank(bob);
        IERC20Permit(net.musd).permit(alice, address(acct), maxRepay, deadline, v, r, s);

        vm.prank(alice);
        acct.repayAndWithdrawWithPermit(maxRepay, deadline, v, r, s, alice);
        assertEq(acct.collateral(), 0);
    }

    function test_repayAndWithdrawWithPermit_revertsWhenDebtAboveMaxRepay() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 100e18, 6000);
        uint256 debt_ = acct.debt();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(ALICE_PK, address(acct), debt_ - 1, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.RepayExceedsMax.selector, debt_, debt_ - 1));
        acct.repayAndWithdrawWithPermit(debt_ - 1, deadline, v, r, s, alice);
    }

    // ---------------------------------------------------------------- access control

    function test_nonOwnerCannotChangePosition() public {
        IBorrowAccount acct = _open(alice, 0.005e18, 50e18, 6000);
        vm.deal(bob, 1e18);
        vm.startPrank(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.borrow(1e18, 6000, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.withdrawCollateral(1, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.repayAndWithdraw(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.addCollateral{value: 1}();
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.repay(1);
        // Morpho itself refuses to act on the clone's behalf: clones never authorize anyone.
        vm.expectRevert(bytes(ErrorsLib.UNAUTHORIZED));
        morpho.borrow(params, 1e18, 0, address(acct), bob);
        vm.expectRevert(bytes(ErrorsLib.UNAUTHORIZED));
        morpho.withdrawCollateral(params, 1, address(acct), bob);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- canary

    function test_canary_onlyOperatorsOpenNearLltv() public {
        uint256 coll = lim.canaryCap;
        uint256 musdOut = _maxMusdOut(coll, lim.canaryCeiling);

        vm.deal(bob, coll);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.NotCanaryOperator.selector, bob));
        factory.openCanary{value: coll}(musdOut, 10_000);

        // The same LTV is refused on a STANDARD account.
        vm.prank(bob);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: coll}(musdOut, 10_000);

        vm.prank(governor);
        factory.setCanaryOperator(canaryOp, true);
        vm.deal(canaryOp, coll);
        vm.prank(canaryOp);
        address canary = factory.openCanary{value: coll}(musdOut, 10_000);

        (address predicted, bool deployed) = factory.accountOf(canaryOp, Profile.CANARY);
        assertEq(canary, predicted);
        assertTrue(deployed);
        assertEq(uint8(factory.profileOf(canary)), uint8(Profile.CANARY));
        assertGt(_ltvBps(canary), lim.standardCeiling, "above the STANDARD ceiling");
        assertLe(_ltvBps(canary), lim.canaryCeiling, "within the CANARY ceiling");
        _assertClean(IBorrowAccount(canary));
    }

    function test_canary_positionCapAndOperatorRemoval() public {
        vm.prank(governor);
        factory.setCanaryOperator(canaryOp, true);
        uint256 over = uint256(lim.canaryCap) + 1;
        vm.deal(canaryOp, over);
        vm.prank(canaryOp);
        vm.expectPartialRevert(IBorrowAccount.PositionCapExceeded.selector);
        factory.openCanary{value: over}(0, 0);

        vm.prank(canaryOp);
        IBorrowAccount canary = IBorrowAccount(factory.openCanary{value: lim.canaryCap}(10e18, 10_000));

        vm.prank(governor);
        factory.setCanaryOperator(canaryOp, false);
        vm.prank(canaryOp);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.NotCanaryOperator.selector, canaryOp));
        canary.borrow(1e18, 10_000, canaryOp);

        // Unwinding is never blocked.
        deal(net.musd, canaryOp, 20e18);
        vm.startPrank(canaryOp);
        musd.approve(address(canary), type(uint256).max);
        canary.repayAndWithdraw(canaryOp);
        vm.stopPrank();
        assertEq(canary.collateral(), 0);
    }

    // ---------------------------------------------------------------- governance end to end

    function test_governance_timelockedCapRaiseUnblocksBorrow() public {
        vm.prank(sentinel);
        factory.setGlobalBorrowCap(50e18);
        vm.deal(alice, 0.005e18);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.GlobalCapExceeded.selector);
        factory.openAndBorrow{value: 0.005e18}(100e18, 6000);

        bytes memory raise = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (1000e18));
        vm.prank(governor);
        factory.submit(raise);
        vm.expectPartialRevert(IBorrowAccountFactory.TimelockNotExpired.selector);
        factory.setGlobalBorrowCap(1000e18);

        skip(48 hours);
        vm.prank(bob); // anyone executes a due raise
        factory.setGlobalBorrowCap(1000e18);
        assertEq(factory.globalBorrowCap(), 1000e18);
        _open(alice, 0.005e18, 100e18, 6000);
    }

    // ---------------------------------------------------------------- come-back (CollSurplusPool claim)

    function _seedSurplus(address owner_, uint256 amount) internal {
        address csp = net.collSurplusPool;
        // CollSurplusPool layout: activePool(0) borrowerOperations(1) troveManager(2) collateral(3) balances(4).
        assertEq(address(uint160(uint256(vm.load(csp, bytes32(uint256(1)))))), net.borrowerOperations, "csp layout");
        vm.store(csp, keccak256(abi.encode(owner_, uint256(4))), bytes32(amount));
        uint256 tracked = uint256(vm.load(csp, bytes32(uint256(3))));
        vm.store(csp, bytes32(uint256(3)), bytes32(tracked + amount));
        vm.deal(csp, csp.balance + amount);
    }

    function _bosDomainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            IEIP712Domain(net.borrowerOperationsSignatures).eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }

    /// @dev EIP-712 `ClaimCollateral(borrower, recipient, nonce, deadline)` signed by `pk` for BorrowerOperationsSignatures.
    function _claimSig(uint256 pk, address recipient, uint256 deadline) internal view returns (bytes memory) {
        address borrower = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ClaimCollateral(address borrower,address recipient,uint256 nonce,uint256 deadline)"),
                borrower,
                recipient,
                IBorrowerOperationsSignatures(net.borrowerOperationsSignatures).getNonce(borrower),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _bosDomainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_comeBack_claimsIntoUndeployedCloneAndBorrows() public {
        uint256 surplus = 0.003e18;
        _seedSurplus(alice, surplus);
        assertEq(factory.claimableSurplus(alice), surplus);
        (address predicted, bool deployed) = factory.accountOf(alice, Profile.STANDARD);
        assertFalse(deployed);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _claimSig(ALICE_PK, predicted, deadline);

        vm.expectEmit(true, true, false, true, address(factory));
        emit IBorrowAccountFactory.ComeBack(alice, predicted, surplus);
        vm.prank(alice);
        (address account, uint256 claimed) = factory.comeBack(sig, deadline, 50e18, 6000);

        assertEq(account, predicted);
        assertEq(claimed, surplus);
        assertTrue(factory.isAccount(account));
        assertEq(IBorrowAccount(account).collateral(), surplus);
        assertEq(IBorrowAccount(account).debt(), 50.05e18);
        assertEq(musd.balanceOf(alice), 50e18);
        assertEq(factory.claimableSurplus(alice), 0);
        assertEq(account.balance, 0, "no idle BTC left");
        _assertClean(IBorrowAccount(account));
    }

    function test_comeBack_aboveCapLeavesRescuableExcess() public {
        uint256 surplus = uint256(lim.standardCap) + 0.005e18;
        _seedSurplus(alice, surplus);
        (address predicted,) = factory.accountOf(alice, Profile.STANDARD);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _claimSig(ALICE_PK, predicted, deadline);

        vm.prank(alice);
        (address account, uint256 claimed) = factory.comeBack(sig, deadline, 0, 0);
        assertEq(claimed, surplus);
        assertEq(IBorrowAccount(account).collateral(), lim.standardCap, "supplied up to the cap");
        assertEq(account.balance, 0.005e18, "excess idle");

        vm.prank(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        IBorrowAccount(account).rescueNative(bob);
        vm.prank(alice);
        IBorrowAccount(account).rescueNative(alice);
        assertEq(alice.balance, 0.005e18);
    }

    function test_comeBack_frontRunClaimStillLandsInOwnersClone() public {
        uint256 surplus = 0.002e18;
        _seedSurplus(alice, surplus);
        (address predicted,) = factory.accountOf(alice, Profile.STANDARD);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _claimSig(ALICE_PK, predicted, deadline);

        // Anyone can relay the signature, but the BTC can only go to alice's (not yet deployed) clone.
        vm.prank(bob);
        IBorrowerOperationsSignatures(net.borrowerOperationsSignatures)
            .claimCollateralWithSignature(alice, predicted, sig, deadline);
        assertEq(predicted.balance, surplus);
        assertEq(predicted.code.length, 0);

        vm.prank(alice);
        vm.expectRevert(); // nonce consumed
        factory.comeBack(sig, deadline, 0, 0);

        vm.prank(bob);
        factory.createAccount(alice);
        vm.prank(alice);
        uint256 supplied = IBorrowAccount(predicted).supplyIdle(10e18, 6000, alice);
        assertEq(supplied, surplus);
        assertEq(IBorrowAccount(predicted).collateral(), surplus);
        assertEq(musd.balanceOf(alice), 10e18);
    }

    function test_comeBack_onlyForCallersOwnSignature() public {
        _seedSurplus(alice, 0.002e18);
        // Bob replays alice's signature through the factory: the claim is bound to msg.sender (bob) and bob's
        // clone, so the signature does not verify.
        (address alicesClone,) = factory.accountOf(alice, Profile.STANDARD);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _claimSig(ALICE_PK, alicesClone, deadline);
        vm.prank(bob);
        vm.expectRevert();
        factory.comeBack(sig, deadline, 0, 0);
        assertEq(factory.claimableSurplus(alice), 0.002e18);
    }

    // ---------------------------------------------------------------- liquidation and the receipt gate

    function test_liquidation_byThirdPartyReceivesAndUnwrapsReceipt() public {
        uint256 coll = 0.005e18;
        uint256 openLtv = lim.standardCeiling - 100;
        IBorrowAccount acct = _open(alice, coll, _maxMusdOut(coll, openLtv), openLtv);
        uint256 lltvBps = net.lltv / 1e14;
        oracle.setPrice(oracle.rawPrice() * openLtv / (lltvBps + 200));
        // The sentinel's pause never blocks liquidation, unwrapping or the exit.
        vm.prank(sentinel);
        factory.setPaused(true, true);

        deal(net.musd, liquidator, 1000e18);
        uint256 shares = _position(address(acct)).borrowShares / 2;
        vm.startPrank(liquidator);
        musd.approve(net.morpho, type(uint256).max);
        (uint256 seized, uint256 repaid) = morpho.liquidate(params, address(acct), 0, shares, "");
        vm.stopPrank();
        assertGt(seized, 0);
        assertGt(repaid, 0);
        assertEq(IERC20(address(receipt)).balanceOf(liquidator), seized, "liquidator holds receipt");

        // The receipt cannot leave the liquidator except by unwrapping.
        vm.startPrank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, liquidator, bob));
        IERC20(address(receipt)).transfer(bob, 1);
        IERC20(address(receipt)).approve(net.morpho, seized);
        // Morpho wraps the token revert; the underlying reason is the gate (checked directly below).
        vm.expectRevert(bytes(ErrorsLib.TRANSFER_FROM_REVERTED));
        morpho.supplyCollateral(params, seized, liquidator, "");
        vm.stopPrank();
        vm.prank(net.morpho);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, liquidator, net.morpho));
        IERC20(address(receipt)).transferFrom(liquidator, net.morpho, seized);
        vm.prank(liquidator);
        receipt.unwrap(seized, liquidator);

        assertEq(liquidator.balance, seized, "native BTC");
        assertEq(acct.collateral(), coll - seized);
        _assertReceiptBacked();

        // The borrower can still exit the remainder without the oracle.
        oracle.setReverting(true);
        deal(net.musd, alice, 1000e18);
        vm.startPrank(alice);
        musd.approve(address(acct), type(uint256).max);
        acct.repayAndWithdraw(alice);
        vm.stopPrank();
        assertEq(alice.balance, coll - seized);
        assertEq(IERC20(address(receipt)).totalSupply(), 0);
    }

    function test_flashLoanOfReceiptReverts() public {
        _open(alice, 0.005e18, 0, 0);
        ReceiptFlashBorrower fb = new ReceiptFlashBorrower(morpho);
        // The outbound leg (from Morpho) passes the gate; the return leg (fb -> Morpho, fb not an account) does not.
        vm.expectRevert(bytes(ErrorsLib.TRANSFER_FROM_REVERTED));
        fb.flash(address(receipt), 0.001e18);
    }

    function test_receipt_wrapRequiresRegisteredAccount() public {
        vm.deal(bob, 1e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.NotAccount.selector, bob));
        receipt.wrap{value: 1e18}();
    }
}

contract BorrowAccountTestnetForkTest is BorrowAccountForkTests {
    function setUp() public {
        _setUpNet(Net.TESTNET);
    }
}

contract BorrowAccountMainnetForkTest is BorrowAccountForkTests {
    function setUp() public {
        _setUpNet(Net.MAINNET);
    }
}
