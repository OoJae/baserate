// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {BorrowAccount} from "../../src/account/BorrowAccount.sol";
import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {MockERC20} from "../utils/MockERC20.sol";

/// @notice BorrowAccount unit tests that need no Morpho: ownership, access control, modules, native BTC handling.
/// @dev Every gated entry point rejects the caller before touching Morpho, so code-less placeholders suffice here;
/// the economic paths are covered by the fork suites.
contract BorrowAccountTest is Test {
    BorrowAccountFactory internal factory;
    IBorrowAccount internal acct;

    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal module = makeAddr("module");

    function setUp() public {
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: makeAddr("morpho"),
                musd: makeAddr("musd"),
                oracle: makeAddr("oracle"),
                irm: makeAddr("irm"),
                lltv: 0.77e18,
                bos: address(0),
                collSurplusPool: address(0),
                governor: governor,
                sentinel: sentinel,
                feeRecipient: makeAddr("feeRecipient"),
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits(0.01e18, 6200),
                canary: IBorrowAccountFactory.Limits(0.002e18, 7675)
            })
        );
        acct = IBorrowAccount(factory.createAccount(alice));
    }

    function _approveModule(address m) internal {
        vm.prank(governor);
        factory.submit(abi.encodeCall(IBorrowAccountFactory.setModuleApproval, (m, true)));
        skip(48 hours);
        factory.setModuleApproval(m, true);
    }

    function test_owner_isImmutableCloneArg() public view {
        assertEq(acct.owner(), alice);
        assertEq(acct.FACTORY(), address(factory));
        assertEq(acct.MORPHO(), factory.MORPHO());
        (address bobs,) = factory.accountOf(bob, Profile.STANDARD);
        assertEq(bobs.code.length, 0);
    }

    function test_implementation_isInert() public {
        IBorrowAccount impl = IBorrowAccount(factory.IMPLEMENTATION());
        assertEq(impl.owner(), address(0));
        vm.startPrank(alice);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        impl.borrow(1, 1, alice);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        impl.rescueNative(alice);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        impl.sweep(address(1), alice);
        vm.stopPrank();
    }

    function test_nonOwnerRejectedOnEveryGatedEntryPoint() public {
        vm.deal(bob, 1e18);
        vm.startPrank(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.openAndBorrow{value: 1}(1, 1, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.borrow(1, 1, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.addCollateral{value: 1}();
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.supplyIdle(0, 0, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.repay(1);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.repayAndWithdraw(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.repayAndWithdrawWithPermit(1, block.timestamp, 27, bytes32(0), bytes32(0), bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.withdrawCollateral(1, bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.setModule(module, false);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.rescueNative(bob);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.sweep(address(1), bob);
        vm.stopPrank();
    }

    function test_factoryCannotUseOwnerOnlyFunctions() public {
        vm.startPrank(address(factory));
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.setModule(module, false);
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.rescueNative(address(factory));
        vm.expectRevert(IBorrowAccount.Unauthorized.selector);
        acct.sweep(address(1), address(factory));
        vm.stopPrank();
    }

    function test_zeroAmountsRejected() public {
        vm.startPrank(alice);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.openAndBorrow(0, 0, alice);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.borrow(0, 6000, alice);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.addCollateral();
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.repay(0);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.withdrawCollateral(0, alice);
        // No idle BTC and no borrow: nothing to do.
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.supplyIdle(0, 0, alice);
        vm.stopPrank();
    }

    /// @dev A-4: no entry point accepts the clone itself as a receiver, so borrowed MUSD can never end a call inside
    /// it. Every check here runs before any Morpho call (`supplyIdle` is covered on the real stack in CoreAudit).
    function test_selfReceiverRejectedEverywhere() public {
        address self = address(acct);
        bytes memory err = abi.encodeWithSelector(IBorrowAccount.InvalidReceiver.selector, self);
        vm.startPrank(alice);
        vm.expectRevert(err);
        acct.borrow(1e18, 6000, self);
        vm.expectRevert(err);
        acct.withdrawCollateral(1, self);
        vm.expectRevert(err);
        acct.rescueNative(self);
        vm.expectRevert(err);
        acct.sweep(address(1), self);
        vm.stopPrank();

        vm.prank(address(factory));
        vm.expectRevert(err);
        acct.openAndBorrow(1e18, 6000, self);

        _approveModule(module);
        vm.prank(alice);
        acct.setModule(module, true);
        vm.prank(module);
        vm.expectRevert(err);
        acct.borrowByModule(1e18, 6000, self);
    }

    /// @dev A-4: tokens transferred to the clone directly (MUSD included) can be swept out by the owner.
    function test_sweep_movesWholeBalanceToOwnerChoice() public {
        MockERC20 token = new MockERC20("Mezo USD", "MUSD");
        token.mint(address(acct), 7e18);

        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.ZeroAddress.selector);
        acct.sweep(address(token), address(0));

        vm.expectEmit(true, true, false, true, address(acct));
        emit IBorrowAccount.Swept(address(token), bob, 7e18);
        vm.prank(alice);
        assertEq(acct.sweep(address(token), bob), 7e18);
        assertEq(token.balanceOf(bob), 7e18);
        assertEq(token.balanceOf(address(acct)), 0);

        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.sweep(address(token), bob);
    }

    function test_borrowByModule_requiresEnabledAndApprovedModule() public {
        vm.prank(module);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.ModuleNotApproved.selector, module));
        acct.borrowByModule(1e18, 6000, module);

        // Enabling needs factory approval first.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.ModuleNotApproved.selector, module));
        acct.setModule(module, true);

        _approveModule(module);
        vm.expectEmit(true, false, false, true, address(acct));
        emit IBorrowAccount.ModuleSet(module, true);
        vm.prank(alice);
        acct.setModule(module, true);
        assertTrue(acct.moduleEnabled(module));

        // Credit pause blocks module draws before any Morpho call.
        vm.prank(sentinel);
        factory.setPaused(false, true);
        vm.prank(module);
        vm.expectRevert(IBorrowAccount.CreditPaused.selector);
        acct.borrowByModule(1e18, 6000, module);

        // The sentinel's instant removal cuts the module off even while the owner still has it enabled.
        vm.prank(sentinel);
        factory.setModuleApproval(module, false);
        vm.prank(module);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccount.ModuleNotApproved.selector, module));
        acct.borrowByModule(1e18, 6000, module);

        vm.prank(alice);
        acct.setModule(module, false);
        assertFalse(acct.moduleEnabled(module));
    }

    function test_borrowByModule_blockedByBorrowPause() public {
        _approveModule(module);
        vm.prank(alice);
        acct.setModule(module, true);
        vm.prank(sentinel);
        factory.setPaused(true, false);
        vm.prank(module);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        acct.borrowByModule(1e18, 6000, module);
    }

    function test_openAndBorrow_blockedWhilePaused() public {
        vm.prank(sentinel);
        factory.setPaused(true, false);
        vm.deal(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.BorrowPaused.selector);
        acct.openAndBorrow{value: 1e18}(0, 0, alice);
    }

    function test_receiveAndRescueNative() public {
        vm.deal(bob, 1e18);
        vm.prank(bob);
        (bool ok,) = address(acct).call{value: 0.3e18}("");
        assertTrue(ok, "clone accepts BTC");

        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.ZeroAddress.selector);
        acct.rescueNative(address(0));

        vm.expectEmit(true, false, false, true, address(acct));
        emit IBorrowAccount.NativeRescued(alice, 0.3e18);
        vm.prank(alice);
        acct.rescueNative(alice);
        assertEq(alice.balance, 0.3e18);

        vm.prank(alice);
        vm.expectRevert(IBorrowAccount.ZeroAmount.selector);
        acct.rescueNative(alice);
    }

    function test_btcCanLandBeforeDeployment() public {
        // The come-back flow pays the CREATE2 address before the clone exists.
        address carol = makeAddr("carol");
        (address predicted, bool deployed) = factory.accountOf(carol, Profile.STANDARD);
        assertFalse(deployed);
        vm.deal(predicted, 0.5e18);
        address account = factory.createAccount(carol);
        assertEq(account, predicted);
        assertEq(account.balance, 0.5e18);
        vm.prank(carol);
        IBorrowAccount(account).rescueNative(carol);
        assertEq(carol.balance, 0.5e18);
    }
}
