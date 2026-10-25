// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IWsMUSD} from "../../src/interfaces/IWsMUSD.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {WsMUSDBase} from "./WsMUSDBase.t.sol";

contract WsMUSDTest is WsMUSDBase {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // =============================================================================================================
    // Constructor and metadata
    // =============================================================================================================

    function test_constructor_setsMetadataRolesAndSeed() public view {
        assertEq(ws.name(), "Wrapped Savings MUSD");
        assertEq(ws.symbol(), "wsMUSD");
        assertEq(ws.decimals(), 18);
        assertEq(ws.asset(), address(musd));
        assertEq(address(ws.SMUSD()), address(smusd));
        assertEq(ws.CAP_ADMIN(), capAdmin);
        assertEq(ws.depositCap(), CAP);
        assertEq(ws.VESTING(), 3 days);
        assertEq(ws.MIN_HARVEST(), 1e15);
        assertEq(ws.CAP_TIMELOCK(), 72 hours);
        assertEq(ws.balanceOf(DEAD), SEED);
        assertEq(ws.totalAssets(), SEED);
        assertEq(ws.convertToAssets(1e18), 1e18);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(IWsMUSD.ZeroAddress.selector);
        new WsMUSD(address(0), address(smusd), capAdmin, CAP);
        vm.expectRevert(IWsMUSD.ZeroAddress.selector);
        new WsMUSD(address(musd), address(0), capAdmin, CAP);
        vm.expectRevert(IWsMUSD.ZeroAddress.selector);
        new WsMUSD(address(musd), address(smusd), address(0), CAP);
    }

    function test_constructor_revertsWhenSMUSDAssetDiffers() public {
        MockMUSD other = new MockMUSD();
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.AssetMismatch.selector, address(other), address(musd)));
        new WsMUSD(address(other), address(smusd), capAdmin, CAP);
    }

    // =============================================================================================================
    // Deposit / mint / withdraw / redeem
    // =============================================================================================================

    function test_deposit_stakesEverythingInSMUSD() public {
        uint256 shares = _deposit(alice, 1000e18);
        assertEq(shares, 1000e18);
        assertEq(ws.balanceOf(alice), 1000e18);
        assertEq(smusd.balanceOf(address(ws)), 1001e18);
        assertEq(musd.balanceOf(address(ws)), 0);
        assertEq(musd.allowance(address(ws), address(smusd)), 0, "exact approval consumed");
        assertEq(_stored(), 1001e18);
        assertEq(ws.totalAssets(), 1001e18);
    }

    function test_mint_pullsExactlyPreviewMint() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        ws.sync();
        skip(3 days);

        uint256 shares = 100e18;
        uint256 expected = ws.previewMint(shares);
        assertGt(expected, shares, "share price above 1");
        _fund(bob, expected);
        vm.prank(bob);
        uint256 assets = ws.mint(shares, bob);
        assertEq(assets, expected);
        assertEq(ws.balanceOf(bob), shares);
        assertEq(musd.balanceOf(bob), 0);
    }

    function test_withdraw_unstakesFromSMUSD() public {
        _deposit(alice, 1000e18);
        vm.prank(alice);
        uint256 burned = ws.withdraw(400e18, alice, alice);
        assertEq(burned, 400e18);
        assertEq(musd.balanceOf(alice), 400e18);
        assertEq(smusd.balanceOf(address(ws)), 601e18);
        assertEq(_stored(), 601e18);
    }

    function test_redeem_fullExitAfterYieldVests() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        uint256 pending = ws.pendingYield();
        skip(3 days);
        assertEq(ws.totalAssets(), 1001e18, "unclaimed yield counts nothing, however long it waits");
        ws.sync();
        skip(3 days); // the harvest vests in full

        assertEq(ws.totalAssets(), 1001e18 + pending);
        vm.prank(alice);
        uint256 out = ws.redeem(1000e18, alice, alice);
        assertEq(out, Math.mulDiv(1000e18, 1001e18 + pending + 1, 1001e18 + 1));
        assertGt(out, 1029e18);
        assertGe(_held(), _accounted());
    }

    function test_withdraw_bySpenderUsesShareAllowance() public {
        _deposit(alice, 1000e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, 100e18));
        ws.withdraw(100e18, bob, alice);

        vm.prank(alice);
        ws.approve(bob, 100e18);
        vm.prank(bob);
        ws.withdraw(100e18, bob, alice);
        assertEq(musd.balanceOf(bob), 100e18);
        assertEq(ws.allowance(alice, bob), 0);
    }

    function test_zeroAmounts_areNoOps() public {
        _fund(alice, 0);
        vm.startPrank(alice);
        assertEq(ws.deposit(0, alice), 0);
        assertEq(ws.redeem(0, alice, alice), 0);
        assertEq(ws.withdraw(0, alice, alice), 0);
        vm.stopPrank();
        assertEq(ws.totalAssets(), SEED);
    }

    function test_tinyAmounts_neverBrickFlows() public {
        _deposit(alice, 1);
        assertEq(ws.balanceOf(alice), 1);
        _yieldForVault(1); // dust yield, far below MIN_HARVEST
        ws.sync();
        vm.prank(alice);
        ws.withdraw(1, alice, alice);
        _deposit(bob, 3);
        vm.prank(bob);
        ws.redeemInKind(1, bob, bob);
        vm.prank(bob);
        ws.redeem(2, bob, bob);
        assertGe(_held(), _accounted());
    }

    function test_roundTrip_neverReturnsMoreThanDeposited() public {
        _deposit(alice, 1000e18);
        _yieldForVault(7e18);
        ws.sync();
        skip(1 days + 7);

        uint256 shares = _deposit(bob, 333_333_333_333_333_333);
        vm.prank(bob);
        uint256 out = ws.redeem(shares, bob, bob);
        assertLe(out, 333_333_333_333_333_333);
    }

    // =============================================================================================================
    // Permit
    // =============================================================================================================

    function test_musdMock_usesLiveDomain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = musd.eip712Domain();
        assertEq(name, "Mezo USD");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(musd));
    }

    function test_depositWithPermit_depositsInOneCall() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitter");
        musd.mint(signer, 500e18);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, signer, 500e18, deadline);

        vm.prank(signer);
        uint256 shares = ws.depositWithPermit(500e18, signer, deadline, v, r, s);
        assertEq(shares, 500e18);
        assertEq(ws.balanceOf(signer), 500e18);
        assertEq(musd.nonces(signer), 1);
        assertEq(musd.allowance(signer, address(ws)), 0);
    }

    function test_depositWithPermit_survivesFrontRunPermit() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitter");
        musd.mint(signer, 500e18);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, signer, 500e18, deadline);

        // A griefer submits the permit first; the deposit's own permit then fails but the allowance suffices.
        vm.prank(attacker);
        musd.permit(signer, address(ws), 500e18, deadline, v, r, s);

        vm.prank(signer);
        uint256 shares = ws.depositWithPermit(500e18, signer, deadline, v, r, s);
        assertEq(shares, 500e18);
    }

    function test_depositWithPermit_revertsWithBadPermitAndNoAllowance() public {
        (address signer,) = makeAddrAndKey("permitter");
        (, uint256 wrongPk) = makeAddrAndKey("not-the-permitter");
        musd.mint(signer, 500e18);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(wrongPk, signer, 500e18, deadline);

        vm.prank(signer);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(ws), 0, 500e18)
        );
        ws.depositWithPermit(500e18, signer, deadline, v, r, s);
    }

    // =============================================================================================================
    // Harvest, vesting and instant part
    // =============================================================================================================

    function test_sync_harvestVestsLinearlyOverThreeDays() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        uint256 pending = ws.pendingYield();
        assertGt(pending, 29e18);

        uint256 ta0 = ws.totalAssets();
        assertEq(ta0, 1001e18, "yield in the harvest block counts 0");

        uint256 harvested = ws.sync();
        assertEq(harvested, pending);
        assertEq(ws.pendingYield(), 0);
        assertEq(ws.totalAssets(), ta0, "sync preserves totalAssets");
        (uint256 stored, uint256 unvested, uint64 lastSync, uint64 periodEnd) = ws.vestingState();
        assertEq(stored, 1001e18);
        assertEq(unvested, pending);
        assertEq(lastSync, block.timestamp);
        assertEq(periodEnd, block.timestamp + 3 days);
        assertEq(smusd.balanceOf(address(ws)), 1001e18 + pending, "harvest re-staked");
        assertEq(musd.balanceOf(address(ws)), 0);

        skip(1 days);
        assertEq(ws.totalAssets(), ta0 + pending / 3);
        skip(1 days);
        assertEq(ws.totalAssets(), ta0 + pending * 2 / 3);
        skip(1 days);
        assertEq(ws.totalAssets(), ta0 + pending);
        skip(10 days);
        assertEq(ws.totalAssets(), ta0 + pending);
    }

    function test_unclaimedYield_countsNothingUntilHarvested_thenVests() public {
        _deposit(alice, 1000e18);
        skip(1 days);
        _yieldForVault(30e18);
        uint256 pending = ws.pendingYield();
        assertGt(pending, 29e18);
        assertEq(ws.totalAssets(), 1001e18, "no instant credit for unclaimed yield");

        ws.sync();
        assertEq(ws.totalAssets(), 1001e18, "sync realizes exactly the preview");
        assertEq(_stored(), 1001e18);
        assertEq(_unvested(), pending);
        assertEq(ws.lastHarvest(), block.timestamp);

        skip(1 days);
        assertEq(ws.totalAssets(), 1001e18 + pending / 3);
        skip(2 days);
        assertEq(ws.totalAssets(), 1001e18 + pending);
    }

    function test_unclaimedYield_longAfterLastHarvest_stillVestsFromHarvest() public {
        _deposit(alice, 1000e18);
        skip(5 days);
        _yieldForVault(30e18);
        uint256 pending = ws.pendingYield();
        assertEq(ws.totalAssets(), 1001e18, "however old the last harvest, nothing counts instantly");

        ws.sync();
        (uint256 stored, uint256 unvested,, uint64 periodEnd) = ws.vestingState();
        assertEq(stored, 1001e18);
        assertEq(unvested, pending);
        assertEq(periodEnd, block.timestamp + 3 days, "a new 3-day period");
    }

    function test_sync_newYieldRestartsPeriodForRemainder() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        uint256 first = ws.pendingYield();
        ws.sync();
        skip(1 days);
        uint256 taMid = ws.totalAssets();
        assertEq(taMid, 1001e18 + first / 3);

        _yieldForVault(15e18);
        uint256 second = ws.pendingYield();
        assertEq(ws.totalAssets(), taMid, "unclaimed: 0");
        ws.sync();
        assertEq(ws.totalAssets(), taMid);
        (, uint256 unvested,, uint64 periodEnd) = ws.vestingState();
        assertEq(unvested, (first - first / 3) + second);
        assertEq(periodEnd, block.timestamp + 3 days);
        skip(3 days);
        assertEq(ws.totalAssets(), 1001e18 + first + second);
    }

    function test_sync_emitsSynced() public {
        _deposit(alice, 1000e18);
        skip(1 days);
        _yieldForVault(30e18);
        musd.mint(address(ws), 10e18); // direct donation
        uint256 pending = ws.pendingYield();

        vm.expectEmit(address(ws));
        emit IWsMUSD.Synced(pending, 0, 10e18, 1001e18, pending + 10e18, uint64(block.timestamp + 3 days));
        vm.prank(makeAddr("anyone"));
        assertEq(ws.sync(), pending);
    }

    function test_sync_dustYieldBelowMinHarvestIsNotClaimed() public {
        _deposit(alice, 1000e18);
        skip(1 days);
        _yieldForVault(5e14);
        uint256 pending = ws.pendingYield();
        assertGt(pending, 0);
        assertLt(pending, ws.MIN_HARVEST());
        assertEq(ws.totalAssets(), 1001e18, "dust has no instant part");

        vm.expectCall(address(smusd), abi.encodeWithSelector(SMUSDMock.claimYield.selector), 0);
        assertEq(ws.sync(), 0);
        assertEq(ws.pendingYield(), pending, "left accruing in sMUSD");
        assertEq(ws.totalAssets(), 1001e18);
    }

    // =============================================================================================================
    // Donations and surplus
    // =============================================================================================================

    function test_directDonation_neverMovesTotalAssetsInstantly() public {
        _deposit(alice, 1000e18);
        uint256 ta = ws.totalAssets();
        uint256 price = ws.convertToAssets(1e18);

        musd.mint(donor, 500e18);
        vm.prank(donor);
        musd.transfer(address(ws), 500e18);
        assertEq(ws.totalAssets(), ta);
        assertEq(ws.convertToAssets(1e18), price);

        ws.sync();
        assertEq(ws.totalAssets(), ta, "surplus has 0 instant part");
        assertEq(_unvested(), 500e18);
        assertEq(musd.balanceOf(address(ws)), 0, "surplus re-staked");

        skip(36 hours);
        assertEq(ws.totalAssets(), ta + 250e18);
        skip(36 hours);
        assertEq(ws.totalAssets(), ta + 500e18);
    }

    function test_smusdDonation_isAbsorbedAsVestingSurplus() public {
        _deposit(alice, 1000e18);
        uint256 ta = ws.totalAssets();
        vm.prank(whale);
        smusd.transfer(address(ws), 200e18);
        assertEq(ws.totalAssets(), ta);

        vm.expectEmit(address(ws));
        emit IWsMUSD.Synced(0, 0, 200e18, ta, 200e18, uint64(block.timestamp + 3 days));
        ws.sync();
        skip(3 days);
        assertEq(ws.totalAssets(), ta + 200e18);
    }

    function test_donationBelowMinHarvest_staysUnaccounted() public {
        _deposit(alice, 1000e18);
        musd.mint(address(ws), 1e14);
        ws.sync();
        assertEq(_unvested(), 0);
        assertEq(musd.balanceOf(address(ws)), 1e14, "dust not re-staked");
        assertEq(_held() - _accounted(), 1e14);
    }

    function test_inflationDonation_cannotStealFromNextDepositor() public {
        // Attacker owns most shares after the seed and donates a fortune right before a victim deposit.
        _deposit(attacker, 1);
        musd.mint(attacker, 1_000_000e18);
        vm.prank(attacker);
        musd.transfer(address(ws), 1_000_000e18);

        uint256 shares = _deposit(alice, 1000e18);
        assertEq(shares, 1000e18, "price unchanged in the donation block");
        vm.prank(alice);
        assertEq(ws.redeem(shares, alice, alice), 1000e18);
    }

    // =============================================================================================================
    // Sandwich resistance
    // =============================================================================================================

    function test_sandwich_frontRunYieldInSameBlockCapturesNothing() public {
        _deposit(alice, 10_000e18);
        skip(12 hours);

        uint256 amountIn = 100_000e18;
        uint256 shares = _deposit(attacker, amountIn);
        _protocolYield(500_000e18);
        vm.prank(attacker);
        uint256 out = ws.redeem(shares, attacker, attacker);
        assertLe(out, amountIn);
    }

    function test_sandwich_backRunYieldInSameBlockCapturesNothing() public {
        _deposit(alice, 10_000e18);
        skip(12 hours);
        _protocolYield(500_000e18); // the instant part goes to existing holders before the attacker's shares mint

        uint256 amountIn = 100_000e18;
        uint256 shares = _deposit(attacker, amountIn);
        vm.prank(attacker);
        uint256 out = ws.redeem(shares, attacker, attacker);
        assertLe(out, amountIn);
    }

    // =============================================================================================================
    // Previews equal execution
    // =============================================================================================================

    function test_previews_matchExecutionMidVesting() public {
        _deposit(alice, 10_000e18);
        _yieldForVault(40e18);
        ws.sync();
        skip(1 days + 3 hours);
        _yieldForVault(12e18); // pending with a non-zero instant part
        musd.mint(address(ws), 3e18); // unabsorbed surplus
        _fund(bob, 10_000e18);

        uint256 snap = vm.snapshotState();

        uint256 expected = ws.previewDeposit(1234e18);
        vm.prank(bob);
        assertEq(ws.deposit(1234e18, bob), expected, "deposit");
        vm.revertToState(snap);

        expected = ws.previewMint(777e18);
        vm.prank(bob);
        assertEq(ws.mint(777e18, bob), expected, "mint");
        vm.revertToState(snap);

        expected = ws.previewWithdraw(500e18);
        vm.prank(alice);
        assertEq(ws.withdraw(500e18, alice, alice), expected, "withdraw");
        vm.revertToState(snap);

        expected = ws.previewRedeem(300e18);
        vm.prank(alice);
        assertEq(ws.redeem(300e18, alice, alice), expected, "redeem");
        vm.revertToState(snap);

        uint256 maxW = ws.maxWithdraw(alice);
        vm.prank(alice);
        ws.withdraw(maxW, alice, alice);
        vm.revertToState(snap);

        (uint256 sPreview, uint256 mPreview) = ws.previewRedeemInKind(300e18);
        vm.prank(alice);
        (uint256 sOut, uint256 mOut) = ws.redeemInKind(300e18, alice, alice);
        assertEq(sOut, sPreview, "in-kind sMUSD");
        assertEq(mOut, mPreview, "in-kind MUSD");
    }

    // =============================================================================================================
    // In-kind exit
    // =============================================================================================================

    function test_redeemInKind_paysSMUSDOneToOne() public {
        _deposit(alice, 1000e18);
        vm.expectEmit(address(ws));
        emit IWsMUSD.RedeemedInKind(alice, alice, alice, 1000e18, 1000e18, 0);
        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(1000e18, alice, alice);
        assertEq(smusdOut, 1000e18);
        assertEq(musdOut, 0);
        assertEq(smusd.balanceOf(alice), 1000e18);
        assertEq(ws.balanceOf(alice), 0);
        assertEq(_stored(), SEED);

        // The sMUSD is real and redeemable at sMUSD.
        vm.prank(alice);
        smusd.withdraw(1000e18);
        assertEq(musd.balanceOf(alice), 1000e18);
    }

    function test_redeemInKind_includesVestedYield() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        uint256 pending = ws.pendingYield();
        ws.sync();
        skip(3 days);

        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(1000e18, alice, alice);
        assertEq(smusdOut, Math.mulDiv(1000e18, 1001e18 + pending + 1, 1001e18 + 1));
        assertEq(musdOut, 0);
        (uint256 stored, uint256 unvested, uint64 lastSync,) = ws.vestingState();
        assertEq(unvested, 0);
        assertEq(lastSync, block.timestamp, "vesting realized");
        assertEq(stored, 1001e18 + pending - smusdOut);
    }

    function test_redeemInKind_paysMUSDForSMUSDShortfall() public {
        _deposit(alice, 1000e18);
        smusd.setDisabled(true, false, false); // re-deposit fails: donation stays idle MUSD
        musd.mint(address(ws), 10e18);
        ws.sync();
        assertEq(musd.balanceOf(address(ws)), 10e18);
        assertEq(musd.allowance(address(ws), address(smusd)), 0, "approval reset after failed deposit");
        skip(3 days);

        uint256 assets = Math.mulDiv(1000e18, 1011e18 + 1, 1001e18 + 1);
        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(1000e18, alice, alice);
        assertEq(smusdOut, 1001e18, "all sMUSD first");
        assertEq(musdOut, assets - 1001e18, "MUSD for the shortfall");
        assertEq(musd.balanceOf(alice), musdOut);
        assertGe(_held(), _accounted());
    }

    function test_redeemInKind_makesNoSMUSDDepositWithdrawOrClaim() public {
        _deposit(alice, 1000e18);
        skip(1 days);
        _yieldForVault(30e18);
        musd.mint(address(ws), 5e18);

        vm.expectCall(address(smusd), abi.encodeWithSelector(SMUSDMock.deposit.selector), 0);
        vm.expectCall(address(smusd), abi.encodeWithSelector(SMUSDMock.withdraw.selector), 0);
        vm.expectCall(address(smusd), abi.encodeWithSelector(SMUSDMock.claimYield.selector), 0);
        vm.prank(alice);
        ws.redeemInKind(500e18, alice, alice);
    }

    function test_redeemInKind_worksWhenSMUSDIsBroken() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        ws.sync();
        skip(2 days);
        smusd.setDisabled(true, true, true);

        vm.prank(alice);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        ws.redeem(1000e18, alice, alice);

        uint256 expected = ws.previewRedeem(1000e18);
        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(1000e18, alice, alice);
        assertEq(smusdOut + musdOut, expected, "in-kind == redeem value");
        assertEq(smusd.balanceOf(alice), smusdOut);
    }

    function test_redeemInKind_paysRedeemValueAndNeverLowersPrice() public {
        _deposit(alice, 1000e18);
        _deposit(bob, 1000e18);
        _yieldForVault(30e18);
        ws.sync();
        skip(1 days); // mid-vesting
        _yieldForVault(10e18); // unclaimed: counted by nobody
        uint256 taBefore = ws.totalAssets();
        uint256 supplyBefore = ws.totalSupply();
        uint256 redeemValue = ws.previewRedeem(1000e18);
        (uint256 sPreview,) = ws.previewRedeemInKind(1000e18);
        assertEq(sPreview, redeemValue);

        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(1000e18, alice, alice);
        assertEq(smusdOut, redeemValue, "in kind pays exactly the redeem value");
        assertEq(musdOut, 0);

        uint256 taAfter = ws.totalAssets();
        uint256 supplyAfter = ws.totalSupply();
        assertGe((taAfter + 1) * (supplyBefore + 1), (taBefore + 1) * (supplyAfter + 1), "price never falls");
    }

    function test_redeemInKind_requiresAllowanceAndRespectsMaxRedeem() public {
        _deposit(alice, 1000e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, 10e18));
        ws.redeemInKind(10e18, bob, alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, alice, 1001e18, 1000e18));
        ws.redeemInKind(1001e18, alice, alice);

        vm.prank(alice);
        ws.approve(bob, 10e18);
        vm.prank(bob);
        (uint256 smusdOut,) = ws.redeemInKind(10e18, bob, alice);
        assertEq(smusdOut, 10e18);
        assertEq(smusd.balanceOf(bob), 10e18);
    }

    // =============================================================================================================
    // Deposit cap and its timelock
    // =============================================================================================================

    function test_capRaise_isTimelockedThenAcceptedByAnyone() public {
        uint256 newCap = 1_000_000e18;
        uint64 executableAt = uint64(block.timestamp + 72 hours);
        vm.expectEmit(address(ws));
        emit IWsMUSD.CapRaiseSubmitted(newCap, executableAt);
        vm.prank(capAdmin);
        ws.submitCapRaise(newCap);
        assertEq(ws.pendingCap(), newCap);
        assertEq(ws.pendingCapAt(), executableAt);
        assertEq(ws.depositCap(), CAP);

        skip(72 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.CapRaiseTimelocked.selector, executableAt));
        ws.acceptCapRaise();

        skip(1);
        vm.expectEmit(address(ws));
        emit IWsMUSD.CapRaised(CAP, newCap);
        vm.prank(makeAddr("anyone"));
        ws.acceptCapRaise();
        assertEq(ws.depositCap(), newCap);
        assertEq(ws.pendingCap(), 0);
        assertEq(ws.pendingCapAt(), 0);
    }

    function test_capRaise_onlyCapAdminCanSubmitOrRevoke() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.NotCapAdmin.selector, alice));
        ws.submitCapRaise(CAP + 1);

        vm.prank(capAdmin);
        ws.submitCapRaise(CAP + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.NotCapAdmin.selector, alice));
        ws.revokeCapRaise();
    }

    function test_capRaise_cannotLowerOrKeepCap() public {
        vm.startPrank(capAdmin);
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.CapNotRaised.selector, CAP, CAP));
        ws.submitCapRaise(CAP);
        vm.expectRevert(abi.encodeWithSelector(IWsMUSD.CapNotRaised.selector, CAP, CAP - 1));
        ws.submitCapRaise(CAP - 1);
        vm.stopPrank();
    }

    function test_capRaise_revokeClearsPending() public {
        vm.expectRevert(IWsMUSD.NoPendingCapRaise.selector);
        ws.acceptCapRaise();

        vm.startPrank(capAdmin);
        vm.expectRevert(IWsMUSD.NoPendingCapRaise.selector);
        ws.revokeCapRaise();
        ws.submitCapRaise(2 * CAP);
        vm.expectEmit(address(ws));
        emit IWsMUSD.CapRaiseRevoked(2 * CAP);
        ws.revokeCapRaise();
        vm.stopPrank();

        skip(72 hours);
        vm.expectRevert(IWsMUSD.NoPendingCapRaise.selector);
        ws.acceptCapRaise();
        assertEq(ws.depositCap(), CAP);
    }

    function test_maxDeposit_enforcesCap() public {
        _fund(alice, CAP);
        uint256 max = ws.maxDeposit(alice);
        assertEq(max, CAP - SEED);
        assertEq(ws.maxMint(alice), CAP - SEED);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, alice, max + 1, max));
        ws.deposit(max + 1, alice);

        vm.prank(alice);
        ws.deposit(max, alice);
        assertEq(ws.totalAssets(), CAP);
        assertEq(ws.maxDeposit(alice), 0);
        assertEq(ws.maxMint(alice), 0);
    }

    function test_maxDeposit_isZeroOnceYieldPushesAssetsAboveCap() public {
        _deposit(alice, CAP - SEED);
        _yieldForVault(100e18);
        ws.sync();
        skip(4 days);
        assertGt(ws.totalAssets(), CAP);
        assertEq(ws.maxDeposit(alice), 0);
        assertEq(ws.maxMint(alice), 0);

        _fund(bob, 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1, 0));
        ws.deposit(1, bob);
    }

    function test_maxMint_staysWithinCapAtPriceAboveOne() public {
        _deposit(alice, 100_000e18);
        _yieldForVault(3000e18);
        ws.sync();
        skip(3 days + 1);
        ws.sync();

        uint256 maxShares = ws.maxMint(bob);
        uint256 cost = ws.previewMint(maxShares);
        assertLe(cost, ws.maxDeposit(bob));
        _fund(bob, cost);
        vm.prank(bob);
        ws.mint(maxShares, bob);
        assertLe(ws.totalAssets(), CAP);
    }

    // =============================================================================================================
    // Robustness against sMUSD behaviour (auto-claim, PCV, failures)
    // =============================================================================================================

    function test_claimYieldRevert_doesNotBrickDepositsOrWithdrawals() public {
        _deposit(alice, 1000e18);
        _yieldForVault(30e18);
        skip(1 days);
        smusd.setDisabled(false, false, true);

        _deposit(bob, 500e18);
        assertGt(ws.pendingYield(), 0, "claim failed, yield still pending");

        uint256 aliceShares = ws.balanceOf(alice);
        vm.prank(alice);
        uint256 out = ws.redeem(aliceShares, alice, alice);
        assertGe(out, 1000e18);
        assertGe(_held(), _accounted());

        // sMUSD's withdraw auto-claimed the yield; the next sync absorbs it as surplus.
        assertEq(ws.pendingYield(), 0);
        assertGt(musd.balanceOf(address(ws)), 0);
        ws.sync();
        assertGt(_unvested(), 0);
    }

    function test_claimYieldRevert_keepsPriceAndPreviews_andLastHarvest() public {
        _deposit(alice, 10_000e18);
        _yieldForVault(30e18);
        ws.sync();
        skip(1 days);
        _yieldForVault(20e18);
        uint64 harvestedAt = ws.lastHarvest();
        skip(1 days);
        smusd.setDisabled(false, false, true); // claimYield reverts

        uint256 ta = ws.totalAssets();
        uint256 price = ws.convertToAssets(1e18);
        uint256 pending = ws.pendingYield();
        assertEq(ws.sync(), 0, "nothing harvested");
        assertEq(ws.totalAssets(), ta, "sync realizes exactly the preview");
        assertEq(ws.convertToAssets(1e18), price, "price unchanged");
        assertEq(ws.pendingYield(), pending, "yield left in sMUSD");
        assertEq(ws.lastHarvest(), harvestedAt, "a failed claim does not count as a harvest");

        uint256 snap = vm.snapshotState();
        uint256 expected = ws.previewRedeem(1000e18);
        vm.prank(alice);
        assertEq(ws.redeem(1000e18, alice, alice), expected, "redeem pays the preview");
        vm.revertToState(snap);
        uint256 maxW = ws.maxWithdraw(alice);
        vm.prank(alice);
        ws.withdraw(maxW, alice, alice);
        vm.revertToState(snap);

        // Claims work again: the yield is harvested and vests, it never steps the price up.
        smusd.setDisabled(false, false, false);
        uint256 ta2 = ws.totalAssets();
        assertEq(ws.sync(), pending);
        assertEq(ws.totalAssets(), ta2);
        assertEq(ws.lastHarvest(), block.timestamp);
    }

    function test_claimYieldPayingNothing_keepsPriceAndPreviews() public {
        _deposit(alice, 10_000e18);
        skip(2 days);
        _yieldForVault(30e18);
        skip(1 days);
        // A claim that "succeeds" but pays nothing (an sMUSD whose accounting diverged from the mirror).
        vm.mockCall(address(smusd), abi.encodeWithSelector(SMUSDMock.claimYield.selector), abi.encode(uint256(0)));
        uint256 ta = ws.totalAssets();
        uint256 expected = ws.previewRedeem(1000e18);
        vm.prank(alice);
        assertEq(ws.redeem(1000e18, alice, alice), expected);
        assertEq(ws.totalAssets(), ta - expected, "only the redemption left");
    }

    function test_sameBlockProtocolYield_neverMovesTotalAssets() public {
        _deposit(alice, 10_000e18);
        skip(10 days); // no harvest for longer than the vesting window
        uint256 ta = ws.totalAssets();
        uint256 price = ws.convertToAssets(1e18);
        _yieldForVault(500e18);
        assertEq(ws.totalAssets(), ta);
        assertEq(ws.convertToAssets(1e18), price);
        ws.sync();
        assertEq(ws.totalAssets(), ta, "harvested, vesting from now");
        skip(3 days);
        assertGt(ws.totalAssets(), ta + 499e18);
    }

    function test_deposit_revertsWhenSMUSDDepositReverts() public {
        smusd.setDisabled(true, false, false);
        _fund(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        ws.deposit(100e18, alice);
    }

    function test_withdraw_paysFromIdleMUSDFirst() public {
        _deposit(alice, 1000e18);
        smusd.setDisabled(true, false, false);
        musd.mint(address(ws), 50e18);
        ws.sync(); // re-deposit fails, 50 MUSD stays idle

        vm.prank(alice);
        ws.withdraw(20e18, alice, alice);
        assertEq(smusd.balanceOf(address(ws)), 1001e18, "sMUSD untouched");
        assertEq(musd.balanceOf(address(ws)), 30e18);
        assertEq(musd.balanceOf(alice), 20e18);

        // Beyond idle, the rest is unstaked from sMUSD.
        vm.prank(alice);
        ws.withdraw(100e18, alice, alice);
        assertEq(musd.balanceOf(address(ws)), 0);
        assertEq(smusd.balanceOf(address(ws)), 1001e18 - 70e18);
        assertGe(_held(), _accounted());
    }

    function test_pcvDistributionInsideDeposit_vestsWithZeroInstant() public {
        smusd.setPcv(address(pcv));
        musd.mint(address(pcv), 100_000e18);
        pcv.queue(100_000e18);

        // The seed's 1 sMUSD accrues during alice's deposit (sMUSD runs PCV before minting).
        uint256 expectedShares = ws.previewDeposit(1000e18);
        uint256 shares = _deposit(alice, 1000e18);
        assertEq(shares, expectedShares);
        assertEq(ws.totalAssets(), 1001e18, "PCV yield credited mid-block counts 0");
        uint256 pending = ws.pendingYield();
        assertGt(pending, ws.MIN_HARVEST());

        assertEq(ws.sync(), pending);
        assertEq(ws.totalAssets(), 1001e18);
        assertEq(_unvested(), pending);
    }

    function test_pcvRevert_isCaughtInsideSMUSD() public {
        smusd.setPcv(address(pcv));
        pcv.setRevert(true);
        _deposit(alice, 1000e18);
        vm.prank(alice);
        ws.redeem(1000e18, alice, alice);
        assertEq(musd.balanceOf(alice), 1000e18);
    }

    function test_withdrawAutoClaim_becomesVestingSurplus() public {
        smusd.setPcv(address(pcv));
        _deposit(alice, 100_000e18);
        musd.mint(address(pcv), 50_000e18);
        pcv.queue(50_000e18); // distributed inside sMUSD.withdraw, then auto-claimed to wsMUSD

        uint256 ta = ws.totalAssets();
        vm.prank(alice);
        ws.withdraw(10_000e18, alice, alice);
        uint256 idle = musd.balanceOf(address(ws));
        assertGt(idle, ws.MIN_HARVEST());
        assertEq(ws.totalAssets(), ta - 10_000e18, "auto-claimed yield does not move the price");

        ws.sync();
        assertEq(_unvested(), idle, "absorbed with 0 instant");
        assertEq(musd.balanceOf(address(ws)), 0);
    }

    function test_mock_amountTooSmallMirrorsSMUSD() public {
        musd.mint(donor, 1);
        vm.startPrank(donor);
        musd.approve(address(smusd), 1);
        vm.expectRevert(SMUSDMock.AmountTooSmall.selector);
        smusd.receiveProtocolYield(1);
        vm.stopPrank();
    }

    // =============================================================================================================
    // Helpers
    // =============================================================================================================

    function _permitSig(uint256 pk, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(ws), value, musd.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
