// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {CollateralBTC} from "../../src/collateral/CollateralBTC.sol";
import {ICollateralBTC} from "../../src/interfaces/ICollateralBTC.sol";

/// @dev Native-BTC recipient that refuses payment.
contract RejectingRecipient {
    receive() external payable {
        revert("no thanks");
    }
}

/// @dev Recipient that tries to re-enter `unwrap` from its receive hook.
contract ReentrantRecipient {
    CollateralBTC internal immutable token;

    constructor(CollateralBTC token_) {
        token = token_;
    }

    receive() external payable {
        token.unwrap(1, address(this));
    }
}

/// @notice Unit tests for the bcBTC receipt: minting rights, the clone <-> Morpho transfer gate and unwrapping.
/// @dev This test contract plays the factory (the token's deployer), exposing `isAccount`.
contract CollateralBTCTest is Test {
    CollateralBTC internal token;
    address internal morpho = makeAddr("morpho");
    address internal account = makeAddr("account");
    address internal account2 = makeAddr("account2");
    address internal eoa = makeAddr("eoa");
    address internal eoa2 = makeAddr("eoa2");

    mapping(address => bool) internal accounts;

    function isAccount(address a) external view returns (bool) {
        return accounts[a];
    }

    function setUp() public {
        token = new CollateralBTC(morpho);
        accounts[account] = true;
        accounts[account2] = true;
    }

    function _wrap(address who, uint256 amount) internal {
        vm.deal(who, who.balance + amount);
        vm.prank(who);
        token.wrap{value: amount}();
    }

    // ---------------------------------------------------------------- metadata and minting

    function test_metadataAndWiring() public view {
        assertEq(token.name(), "Baserate Collateral BTC");
        assertEq(token.symbol(), "bcBTC");
        assertEq(token.decimals(), 18);
        assertEq(token.FACTORY(), address(this));
        assertEq(token.MORPHO(), morpho);
    }

    function test_constructor_revertsOnZeroMorpho() public {
        vm.expectRevert(ICollateralBTC.ZeroAddress.selector);
        new CollateralBTC(address(0));
    }

    function test_wrap_mintsOneToOneForAccounts() public {
        vm.deal(account, 1e18);
        vm.expectEmit(true, false, false, true, address(token));
        emit ICollateralBTC.Wrapped(account, 0.4e18);
        vm.prank(account);
        uint256 minted = token.wrap{value: 0.4e18}();
        assertEq(minted, 0.4e18);
        assertEq(token.balanceOf(account), 0.4e18);
        assertEq(token.totalSupply(), 0.4e18);
        assertEq(address(token).balance, 0.4e18);
    }

    function test_wrap_revertsForNonAccount() public {
        vm.deal(eoa, 1e18);
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.NotAccount.selector, eoa));
        token.wrap{value: 1e18}();
    }

    function test_wrap_revertsOnZeroValue() public {
        vm.prank(account);
        vm.expectRevert(ICollateralBTC.ZeroAmount.selector);
        token.wrap();
    }

    function test_noReceiveOrFallback() public {
        vm.deal(eoa, 1e18);
        vm.prank(eoa);
        (bool ok,) = address(token).call{value: 1e18}("");
        assertFalse(ok, "plain BTC send must fail");
        vm.prank(eoa);
        (ok,) = address(token).call{value: 1}(hex"deadbeef");
        assertFalse(ok, "fallback must not exist");
    }

    // ---------------------------------------------------------------- transfer gate

    function test_gate_accountToMorphoAllowed() public {
        _wrap(account, 1e18);
        vm.prank(account);
        token.transfer(morpho, 0.3e18);
        assertEq(token.balanceOf(morpho), 0.3e18);
    }

    function test_gate_morphoPullsFromAccountWithAllowance() public {
        _wrap(account, 1e18);
        vm.prank(account);
        token.approve(morpho, 1e18);
        vm.prank(morpho);
        token.transferFrom(account, morpho, 1e18);
        assertEq(token.balanceOf(morpho), 1e18);
        assertEq(token.allowance(account, morpho), 0);
    }

    function test_gate_morphoToAnyoneAllowed() public {
        _wrap(account, 1e18);
        vm.prank(account);
        token.transfer(morpho, 1e18);
        vm.startPrank(morpho);
        token.transfer(eoa, 0.25e18); // liquidator
        token.transfer(account2, 0.25e18); // withdrawCollateral to a clone
        token.transfer(account, 0.25e18);
        vm.stopPrank();
        assertEq(token.balanceOf(eoa), 0.25e18);
        assertEq(token.balanceOf(account2), 0.25e18);
    }

    function test_gate_accountToEoaReverts() public {
        _wrap(account, 1e18);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, account, eoa));
        token.transfer(eoa, 1);
    }

    function test_gate_accountToAccountReverts() public {
        _wrap(account, 1e18);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, account, account2));
        token.transfer(account2, 1);
    }

    function test_gate_holderToMorphoRevertsForNonAccount() public {
        // A liquidator who received bcBTC from Morpho cannot put it back as collateral.
        _wrap(account, 1e18);
        vm.prank(account);
        token.transfer(morpho, 1e18);
        vm.prank(morpho);
        token.transfer(eoa, 1e18);

        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, eoa, morpho));
        token.transfer(morpho, 1);

        vm.prank(eoa);
        token.approve(morpho, 1e18);
        vm.prank(morpho);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, eoa, morpho));
        token.transferFrom(eoa, morpho, 1);
    }

    function test_gate_eoaToEoaReverts() public {
        deal(address(token), eoa, 1e18); // storage write bypasses the gate to give a non-account a balance
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, eoa, eoa2));
        token.transfer(eoa2, 1);
    }

    function test_gate_thirdPartySpenderCannotMoveAccountFunds() public {
        _wrap(account, 1e18);
        vm.prank(account);
        token.approve(eoa, 1e18);
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, account, eoa));
        token.transferFrom(account, eoa, 1e18);
    }

    function test_gate_zeroValueTransfersAreGatedToo() public {
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, eoa, eoa2));
        token.transfer(eoa2, 0);
    }

    /// @dev Full matrix: from x to over {account, other account, Morpho, EOA}, with random registration flags.
    function testFuzz_gateMatrix(uint8 fromSel, uint8 toSel, bool fromRegistered, uint96 amount) public {
        address[4] memory actors = [account, account2, morpho, eoa];
        address from = actors[fromSel % 4];
        address to = actors[toSel % 4];
        accounts[from] = from == morpho ? false : fromRegistered;
        vm.assume(amount > 0);
        deal(address(token), from, amount);

        bool allowed = from == morpho || (to == morpho && accounts[from]);
        vm.prank(from);
        if (!allowed) vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.TransferRestricted.selector, from, to));
        token.transfer(to, amount);
        if (allowed) assertEq(token.balanceOf(to), amount);
    }

    // ---------------------------------------------------------------- unwrap

    function test_unwrap_burnsThenSendsNative() public {
        _wrap(account, 1e18);
        vm.expectEmit(true, true, false, true, address(token));
        emit ICollateralBTC.Unwrapped(account, eoa, 0.6e18);
        vm.prank(account);
        token.unwrap(0.6e18, eoa);
        assertEq(eoa.balance, 0.6e18);
        assertEq(token.balanceOf(account), 0.4e18);
        assertEq(token.totalSupply(), 0.4e18);
        assertEq(address(token).balance, 0.4e18);
    }

    function test_unwrap_openToAnyHolder() public {
        _wrap(account, 1e18);
        vm.prank(account);
        token.transfer(morpho, 1e18);
        vm.prank(morpho);
        token.transfer(eoa, 1e18); // liquidation seizure
        vm.prank(eoa);
        token.unwrap(1e18, eoa);
        assertEq(eoa.balance, 1e18);
        assertEq(token.totalSupply(), 0);
    }

    function test_unwrap_revertsOnZeroAmountOrRecipient() public {
        _wrap(account, 1e18);
        vm.startPrank(account);
        vm.expectRevert(ICollateralBTC.ZeroAmount.selector);
        token.unwrap(0, eoa);
        vm.expectRevert(ICollateralBTC.ZeroAddress.selector);
        token.unwrap(1, address(0));
        vm.stopPrank();
    }

    function test_unwrap_revertsAboveBalance() public {
        _wrap(account, 1e18);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, account, 1e18, 1e18 + 1));
        token.unwrap(1e18 + 1, account);
    }

    function test_unwrap_revertsWhenRecipientRejects() public {
        _wrap(account, 1e18);
        address rejecter = address(new RejectingRecipient());
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.NativeSendFailed.selector, rejecter, 1e18));
        token.unwrap(1e18, rejecter);
        assertEq(token.balanceOf(account), 1e18, "burn rolled back");
    }

    function test_unwrap_reentryBlocked() public {
        ReentrantRecipient re = new ReentrantRecipient(token);
        deal(address(token), address(re), 1e18);
        vm.deal(address(token), 2e18);
        vm.prank(address(re));
        // The nested unwrap hits the transient guard, so the outer native send fails.
        vm.expectRevert(abi.encodeWithSelector(ICollateralBTC.NativeSendFailed.selector, address(re), 0.5e18));
        token.unwrap(0.5e18, address(re));
    }

    function test_forcedSurplusIsNotClaimable() public {
        // BTC forced in (for example through the precompile) is surplus: accounting follows supply only.
        _wrap(account, 1e18);
        vm.deal(address(token), address(token).balance + 5e18);
        vm.prank(account);
        token.unwrap(1e18, account);
        assertEq(token.totalSupply(), 0);
        assertEq(address(token).balance, 5e18);
    }

    function testFuzz_balanceCoversSupply(uint96[4] memory wraps, uint96[4] memory unwraps) public {
        for (uint256 i; i < 4; ++i) {
            uint256 w = bound(wraps[i], 1, 10e18);
            _wrap(i % 2 == 0 ? account : account2, w);
            address holder = i % 2 == 0 ? account : account2;
            uint256 u = bound(unwraps[i], 0, token.balanceOf(holder));
            if (u != 0) {
                vm.prank(holder);
                token.unwrap(u, eoa);
            }
            assertGe(address(token).balance, token.totalSupply());
            assertEq(address(token).balance, token.totalSupply());
        }
    }
}
