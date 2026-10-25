// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IMorpho} from "morpho-blue/interfaces/IMorpho.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {BorrowAccountForkBase} from "../fork/BorrowAccountForkBase.t.sol";

/// @notice Fuzzed borrow-path boundaries on the real Morpho + IRM + MUSD fork: the LTV limit to the wei, the
/// origination-fee rounding, and exact full repayment by shares after arbitrary time.
/// @dev On the fresh market the first borrow's debt equals `musdOut + fee` exactly (1e6 virtual shares per asset),
/// which makes the boundary computable off-chain.
abstract contract BorrowAccountFuzzTests is BorrowAccountForkBase {
    using MorphoBalancesLib for IMorpho;

    function testFuzz_ltvBoundary(uint256 collSeed, uint256 maxLtvSeed) public {
        uint256 coll = bound(collSeed, 0.0001e18, lim.standardCap);
        uint256 maxLtvBps = bound(maxLtvSeed, 100, 10_000);
        uint256 limitBps = maxLtvBps < lim.standardCeiling ? maxLtvBps : lim.standardCeiling;
        uint256 atLimit = _maxMusdOut(coll, limitBps);
        vm.assume(atLimit != 0);

        // One wei more of MUSD pushes the debt over the limit...
        vm.deal(alice, coll);
        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        factory.openAndBorrow{value: coll}(atLimit + 1, maxLtvBps);

        // ...while the boundary itself passes, with the debt exactly musdOut + fee.
        IBorrowAccount acct = _open(alice, coll, atLimit, maxLtvBps);
        uint256 debt_ = acct.debt();
        assertEq(debt_, atLimit + _fee(atLimit), "debt");
        assertLe(debt_ * BPS, _value(coll) * limitBps, "within limit");
        assertGt((debt_ + 1 + _fee(atLimit + 1) - _fee(atLimit)) * BPS, _value(coll) * limitBps, "tight");
        _assertClean(acct);
    }

    function testFuzz_withdrawBoundary(uint256 collSeed, uint256 ltvSeed) public {
        uint256 coll = bound(collSeed, 0.002e18, lim.standardCap);
        uint256 openLtv = bound(ltvSeed, 500, lim.standardCeiling - 100);
        IBorrowAccount acct = _open(alice, coll, _maxMusdOut(coll, openLtv), 10_000);
        uint256 debt_ = acct.debt();

        // Smallest collateral that keeps debt * 1e4 <= value * ceiling.
        uint256 price = oracle.rawPrice();
        uint256 minColl = _minCollateral(debt_, price, lim.standardCeiling);
        vm.assume(minColl < coll);

        vm.prank(alice);
        vm.expectPartialRevert(IBorrowAccount.LtvTooHigh.selector);
        acct.withdrawCollateral(coll - minColl + 1, alice);

        vm.prank(alice);
        acct.withdrawCollateral(coll - minColl, alice);
        assertEq(acct.collateral(), minColl);
        assertLe(debt_ * BPS, (minColl * price / 1e36) * lim.standardCeiling);
        _assertClean(acct);
    }

    function testFuzz_feeRounding(uint256 musdSeed) public {
        uint256 coll = lim.standardCap;
        uint256 musdOut = bound(musdSeed, 1, _maxMusdOut(coll, lim.standardCeiling));
        uint256 expectedFee = (musdOut * 10 + BPS - 1) / BPS; // ceil(10 bps)

        IBorrowAccount acct = _open(alice, coll, musdOut, 10_000);
        assertEq(musd.balanceOf(alice), musdOut, "receiver gets exactly musdOut");
        assertEq(musd.balanceOf(feeTo), expectedFee, "fee rounds up");
        assertEq(acct.debt(), musdOut + expectedFee, "debt carries the fee");
        assertGe(expectedFee * BPS, musdOut * 10, "never under-charged");
        assertLt((expectedFee - 1) * BPS, musdOut * 10, "rounded up by less than 1 wei");
        _assertClean(acct);
    }

    function testFuzz_fullRepayByShares(uint256 musdSeed, uint256 warpSeed) public {
        uint256 coll = 0.005e18;
        uint256 musdOut = bound(musdSeed, 1e15, _maxMusdOut(coll, lim.standardCeiling));
        IBorrowAccount acct = _open(alice, coll, musdOut, 10_000);
        skip(bound(warpSeed, 1, 3650 days));

        uint256 expected = acct.debt();
        assertEq(expected, morpho.expectedBorrowAssets(params, address(acct)), "debt() == MorphoBalancesLib");
        deal(net.musd, alice, expected);
        vm.prank(alice);
        musd.approve(address(acct), expected);
        uint256 nativeBefore = alice.balance;
        vm.prank(alice);
        acct.repayAndWithdraw(alice);

        assertEq(musd.balanceOf(alice), 0, "pulled exactly the expected debt");
        assertEq(musd.allowance(alice, address(acct)), 0);
        assertEq(alice.balance - nativeBefore, coll);
        assertEq(_position(address(acct)).borrowShares, 0);
        assertEq(_position(address(acct)).collateral, 0);
        _assertClean(acct);
    }

    function testFuzz_repayNeverOverpulls(uint256 repaySeed, uint256 warpSeed) public {
        IBorrowAccount acct = _open(alice, 0.005e18, 150e18, 10_000);
        skip(bound(warpSeed, 0, 365 days));
        uint256 debtBefore = acct.debt();
        uint256 amount = bound(repaySeed, 1, 2 * debtBefore);
        deal(net.musd, alice, amount);
        vm.prank(alice);
        musd.approve(address(acct), amount);
        vm.prank(alice);
        uint256 repaid = acct.repay(amount);

        uint256 expected = amount < debtBefore ? amount : debtBefore;
        assertEq(repaid, expected);
        assertEq(musd.balanceOf(alice), amount - expected);
        if (amount >= debtBefore) assertEq(acct.debt(), 0);
        else assertApproxEqAbs(acct.debt(), debtBefore - amount, 1);
        _assertClean(acct);
    }

    function _minCollateral(uint256 debt_, uint256 price, uint256 ceilingBps) internal pure returns (uint256 c) {
        // Find the smallest c with debt * 1e4 <= floor(c * price / 1e36) * ceiling.
        c = (debt_ * BPS * 1e36) / (price * ceilingBps);
        while (debt_ * BPS > (c * price / 1e36) * ceilingBps) ++c;
        while (c != 0 && debt_ * BPS <= ((c - 1) * price / 1e36) * ceilingBps) --c;
    }
}

contract BorrowAccountTestnetFuzzTest is BorrowAccountFuzzTests {
    function setUp() public {
        _setUpNet(Net.TESTNET);
    }
}

contract BorrowAccountMainnetFuzzTest is BorrowAccountFuzzTests {
    function setUp() public {
        _setUpNet(Net.MAINNET);
    }
}
