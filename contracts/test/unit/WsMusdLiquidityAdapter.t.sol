// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IWsMusdLiquidityAdapter} from "../../src/interfaces/IWsMusdLiquidityAdapter.sol";
import {MockERC20} from "../utils/MockERC20.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {VaultBase} from "./VaultBase.t.sol";

/// @notice WsMusdLiquidityAdapter against a real VaultV2 and the local wsMUSD/sMUSD stack.
contract WsMusdLiquidityAdapterTest is VaultBase {
    function _wsId() internal view returns (bytes32) {
        return liq.adapterId();
    }

    // ---------------------------------------------------------------- construction

    function test_constructor_wiring() public view {
        assertEq(liq.parentVault(), address(vault));
        assertEq(liq.wsMusd(), address(ws));
        assertEq(liq.asset(), address(musd));
        assertEq(liq.adapterId(), keccak256(abi.encode("this", address(liq))));
        bytes32[] memory ids = liq.ids();
        assertEq(ids.length, 1);
        assertEq(ids[0], liq.adapterId());
        assertEq(musd.allowance(address(liq), address(vault)), type(uint256).max, "vault pulls deallocations");
        assertEq(musd.allowance(address(liq), address(ws)), type(uint256).max, "wsMUSD pulls deposits");
        assertEq(liq.skimRecipient(), address(0));
        assertEq(liq.rescueExecutableAt(), 0);
        assertFalse(liq.rescued());
        assertEq(liq.RESCUE_TIMELOCK(), 72 hours);
        assertEq(liq.RESCUE_PROBE_GAS(), 3_000_000);
    }

    function test_constructor_revertsOnAssetMismatch() public {
        MockMUSD other = new MockMUSD();
        address otherVault = IVaultV2Factory(vaultFactory).createVaultV2(curator, address(other), bytes32(0));
        vm.expectRevert(IWsMusdLiquidityAdapter.AssetMismatch.selector);
        new WsMusdLiquidityAdapter(otherVault, address(ws));
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(IWsMusdLiquidityAdapter.ZeroAddress.selector);
        new WsMusdLiquidityAdapter(address(0), address(ws));
        vm.expectRevert(IWsMusdLiquidityAdapter.ZeroAddress.selector);
        new WsMusdLiquidityAdapter(address(vault), address(0));
    }

    // ---------------------------------------------------------------- access control

    function test_allocate_onlyParentVault() public {
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        liq.allocate("", 1e18, bytes4(0), address(this));
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        liq.deallocate("", 1e18, bytes4(0), address(this));
    }

    function test_allocate_rejectsData() public {
        vm.startPrank(address(vault));
        vm.expectRevert(IWsMusdLiquidityAdapter.InvalidData.selector);
        liq.allocate(hex"01", 0, bytes4(0), address(this));
        vm.expectRevert(IWsMusdLiquidityAdapter.InvalidData.selector);
        liq.deallocate(hex"01", 0, bytes4(0), address(this));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- deposits

    function test_seed_landsInWsMusd() public view {
        assertEq(vault.balanceOf(DEAD), VAULT_SEED * vault.virtualShares(), "dead seed shares");
        assertEq(musd.balanceOf(address(vault)), 0, "no vault idle");
        assertEq(liq.idle(), 0, "no adapter idle");
        assertApproxEqAbs(liq.heldAssets(), VAULT_SEED, 1, "seed in wsMUSD");
        assertEq(vault.allocation(_wsId()), liq.heldAssets(), "allocation booked");
    }

    function test_deposit_landsInWsMusd() public {
        uint256 wsBefore = ws.balanceOf(address(liq));
        _deposit(lender, 10_000e18);
        assertEq(musd.balanceOf(address(vault)), 0, "nothing idle in the vault");
        assertEq(liq.idle(), 0, "nothing idle in the adapter");
        assertGt(ws.balanceOf(address(liq)), wsBefore, "wsMUSD shares minted");
        assertApproxEqAbs(liq.heldAssets(), 10_100e18, 2, "held");
        assertApproxEqAbs(vault.totalAssets(), 10_100e18, 2, "vault total");
        assertEq(vault.allocation(_wsId()), liq.heldAssets(), "allocation");
    }

    function test_fullWsMusd_doesNotBlockDeposits() public {
        _fillWsMusd();
        uint256 sharesBefore = ws.balanceOf(address(liq));

        uint256 shares = _deposit(lender, 5000e18);
        assertGt(shares, 0, "deposit went through");
        assertEq(liq.idle(), 5000e18, "kept idle in the adapter");
        assertEq(ws.balanceOf(address(liq)), sharesBefore, "no wsMUSD deposit attempted past the cap");
        assertApproxEqAbs(liq.realAssets(), 5100e18, 2, "idle counts in realAssets");
        assertApproxEqAbs(vault.totalAssets(), 5100e18, 2, "vault total");

        // Exit is served from the adapter's idle MUSD first.
        vm.prank(lender);
        vault.withdraw(2000e18, lender, lender);
        assertEq(liq.idle(), 3000e18, "idle used first");
        assertEq(ws.balanceOf(address(liq)), sharesBefore, "wsMUSD untouched");
    }

    function test_idle_isRedepositedOnceWsMusdHasRoom() public {
        _fillWsMusd();
        _deposit(lender, 5000e18);
        assertEq(liq.idle(), 5000e18);

        // Cap raise (72 h timelock), then the next allocation flushes the idle MUSD into wsMUSD.
        vm.prank(capAdmin);
        ws.submitCapRaise(WS_CAP + 10_000e18);
        skip(72 hours);
        ws.acceptCapRaise();

        _deposit(lender2, 1000e18);
        assertEq(liq.idle(), 0, "idle flushed");
        assertApproxEqAbs(liq.heldAssets(), 6100e18, 5, "all in wsMUSD");
    }

    function test_partialRoom_depositsUpToMaxDeposit() public {
        _fillWsMusd();
        vm.prank(capAdmin);
        ws.submitCapRaise(WS_CAP + 1000e18);
        skip(72 hours);
        ws.acceptCapRaise();
        uint256 room = ws.maxDeposit(address(liq));

        _deposit(lender, 3000e18);
        assertApproxEqAbs(liq.idle(), 3000e18 - room, 1, "only the excess stays idle");
        assertEq(ws.maxDeposit(address(liq)), 0, "wsMUSD filled to the cap");
    }

    function test_failingWsMusdDeposit_doesNotBlockDeposits() public {
        smusd.setDisabled(true, false, false); // sMUSD deposits revert (e.g. a broken upgrade)
        _deposit(lender, 1000e18);
        assertEq(liq.idle(), 1000e18, "kept idle");
        smusd.setDisabled(false, false, false);
        _deposit(lender2, 1e18);
        assertEq(liq.idle(), 0, "flushed once sMUSD works again");
    }

    // ---------------------------------------------------------------- withdrawals

    function test_withdraw_fromWsMusd() public {
        _deposit(lender, 10_000e18);
        vm.prank(lender);
        vault.withdraw(4000e18, lender, lender);
        assertEq(musd.balanceOf(lender), 4000e18);
        assertApproxEqAbs(liq.heldAssets(), 6100e18, 3, "held after");
        assertEq(vault.allocation(_wsId()), liq.heldAssets(), "allocation tracks the position");
    }

    function test_redeem_allShares() public {
        uint256 shares = _deposit(lender, 10_000e18);
        vm.prank(lender);
        uint256 assets = vault.redeem(shares, lender, lender);
        assertApproxEqAbs(assets, 10_000e18, 2, "full exit");
        assertApproxEqAbs(liq.heldAssets(), VAULT_SEED, 3, "only the seed left");
    }

    function test_deallocate_beyondHoldings_reverts() public {
        _deposit(lender, 1000e18);
        vm.prank(curator); // sentinel
        vm.expectRevert();
        vault.deallocate(address(liq), "", 5000e18);
    }

    function test_forceDeallocate_noPenalty_inKind() public {
        _deposit(lender, 1000e18);
        // Anyone can move the adapter's assets to vault idle; the liquidity adapter carries no penalty.
        vm.prank(stranger);
        uint256 penaltyShares = vault.forceDeallocate(address(liq), "", 500e18, stranger);
        assertEq(penaltyShares, 0);
        assertEq(musd.balanceOf(address(vault)), 500e18, "vault idle");
        // The allocator parks it back.
        allocator.rebalance();
        assertEq(musd.balanceOf(address(vault)), 0, "swept back");
    }

    // ---------------------------------------------------------------- yield

    function test_wsMusdYield_accruesToVault() public {
        _deposit(lender, 10_000e18);
        uint256 before = vault.totalAssets();
        _wsYield(30e18);
        skip(3 days);
        uint256 afterYield = vault.totalAssets();
        assertGt(afterYield, before, "yield");
        // The adapter owns ~98% of wsMUSD (1 MUSD dead seed), so it earns that share of the donation.
        assertApproxEqRel(afterYield - before, uint256(30e18) * 10_100 / 10_101, 0.001e18);
    }

    function test_realAssets_zeroWithoutAllocation() public {
        WsMusdLiquidityAdapter fresh = new WsMusdLiquidityAdapter(address(vault), address(ws));
        assertEq(fresh.realAssets(), 0);
        assertEq(fresh.allocation(), 0);
        assertEq(fresh.heldAssets(), 0);
    }

    // ---------------------------------------------------------------- skim

    function test_setSkimRecipient_onlyVaultOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        liq.setSkimRecipient(stranger);

        vm.prank(curator);
        vm.expectEmit(address(liq));
        emit IWsMusdLiquidityAdapter.SetSkimRecipient(team);
        liq.setSkimRecipient(team);
        assertEq(liq.skimRecipient(), team);
    }

    function test_skim_strayTokens() public {
        vm.prank(curator);
        liq.setSkimRecipient(team);
        MockERC20 reward = new MockERC20("Reward", "RWD");
        reward.mint(address(liq), 7e18);

        vm.prank(stranger);
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        liq.skim(address(reward));

        vm.prank(team);
        liq.skim(address(reward));
        assertEq(reward.balanceOf(team), 7e18);
    }

    function test_skim_cannotTakeWsMusdShares() public {
        vm.prank(curator);
        liq.setSkimRecipient(team);
        vm.prank(team);
        vm.expectRevert(IWsMusdLiquidityAdapter.CannotSkimWsMusdShares.selector);
        liq.skim(address(ws));
    }

    function test_skim_musdOnlyAboveIdle() public {
        _fillWsMusd();
        _deposit(lender, 1000e18); // 1000 idle, accounted
        vm.prank(curator);
        liq.setSkimRecipient(team);
        musd.mint(address(liq), 5e18); // stray donation

        uint256 teamBefore = musd.balanceOf(team);
        vm.prank(team);
        liq.skim(address(musd));
        assertEq(musd.balanceOf(team) - teamBefore, 5e18, "only the stray part");
        assertEq(liq.idle(), 1000e18, "idle untouched");
        assertEq(musd.balanceOf(address(liq)), 1000e18);
    }

    function test_donation_notCountedInRealAssets() public {
        _deposit(lender, 1000e18);
        uint256 held = liq.heldAssets();
        musd.mint(address(liq), 50e18);
        assertEq(liq.heldAssets(), held, "stray MUSD is not vault value");
    }

    // ---------------------------------------------------------------- rescue

    function test_rescue_rolesAndTimelock() public {
        address sentinel = makeAddr("sentinel");
        vm.prank(curator); // vault owner
        vault.setIsSentinel(sentinel, true);

        vm.expectRevert(IWsMusdLiquidityAdapter.NoPendingRescue.selector);
        vm.prank(curator);
        liq.rescue();
        vm.expectRevert(IWsMusdLiquidityAdapter.NoPendingRescue.selector);
        vm.prank(sentinel);
        liq.revokeRescue();

        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        vm.prank(sentinel); // only the curator submits
        liq.submitRescue();
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        vm.prank(stranger);
        liq.submitRescue();

        uint64 executableAt = uint64(block.timestamp + 72 hours);
        vm.expectEmit(address(liq));
        emit IWsMusdLiquidityAdapter.RescueSubmitted(executableAt);
        vm.prank(curator);
        liq.submitRescue();
        assertEq(liq.rescueExecutableAt(), executableAt);
        vm.expectRevert(IWsMusdLiquidityAdapter.RescuePending.selector);
        vm.prank(curator);
        liq.submitRescue();

        skip(72 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(IWsMusdLiquidityAdapter.RescueTimelocked.selector, executableAt));
        vm.prank(curator);
        liq.rescue();

        skip(1);
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        vm.prank(stranger);
        liq.rescue();
        vm.expectRevert(IWsMusdLiquidityAdapter.NotAuthorized.selector);
        vm.prank(stranger);
        liq.revokeRescue();

        // A sentinel cancels it.
        vm.expectEmit(address(liq));
        emit IWsMusdLiquidityAdapter.RescueRevoked(sentinel);
        vm.prank(sentinel);
        liq.revokeRescue();
        assertEq(liq.rescueExecutableAt(), 0);
        vm.expectRevert(IWsMusdLiquidityAdapter.NoPendingRescue.selector);
        vm.prank(curator);
        liq.rescue();
    }

    function test_rescue_whileWsMusdPays_unwindsToIdle_nothingLeaves() public {
        _deposit(lender, 10_000e18);
        uint256 held = liq.heldAssets();
        uint256 total = vault.totalAssets();
        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);

        uint256 shares = ws.balanceOf(address(liq));
        vm.prank(curator);
        (uint256 rescuedShares, bool unwound) = liq.rescue();
        assertEq(rescuedShares, shares);
        assertTrue(unwound, "wsMUSD paid: unwound into idle");
        assertFalse(liq.rescued());
        assertEq(ws.balanceOf(address(liq)), 0);
        assertEq(ws.balanceOf(curator), 0, "nothing left the adapter");
        assertApproxEqAbs(liq.idle(), held, 2);
        assertApproxEqAbs(liq.heldAssets(), held, 2);
        assertApproxEqAbs(vault.totalAssets(), total, 2, "no loss");

        // The next allocation puts the idle MUSD back into wsMUSD.
        _deposit(lender2, 1e18);
        assertEq(liq.idle(), 0);
    }

    function test_rescue_whenWsMusdCannotPay_sendsSharesInKindToOwner() public {
        _deposit(lender, 10_000e18);
        smusd.setDisabled(false, true, false); // sMUSD withdraw reverts: wsMUSD cannot pay out
        vm.prank(lender);
        vm.expectRevert(SMUSDMock.Disabled.selector);
        vault.withdraw(100e18, lender, lender);

        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);
        uint256 shares = ws.balanceOf(address(liq));
        vm.expectEmit(address(liq));
        emit IWsMusdLiquidityAdapter.RescuedInKind(curator, shares);
        vm.prank(curator); // curator and sentinel in this setup; the shares go to the vault's owner
        (, bool unwound) = liq.rescue();
        assertFalse(unwound);
        assertTrue(liq.rescued());
        assertEq(ws.balanceOf(curator), shares, "vault owner holds the wsMUSD shares");
        assertEq(liq.heldAssets(), 0);
        assertEq(liq.availableLiquidity(), 0);

        // The vault books the shares' value as a loss on its next accrual; the sentinel syncs the allocation.
        assertEq(vault.totalAssets(), 0);
        vm.prank(curator);
        vault.deallocate(address(liq), "", 0);
        assertEq(vault.allocation(liq.adapterId()), 0);

        // From now on the adapter keeps deposits idle (no new MUSD into the frozen wsMUSD), and they exit normally.
        _deposit(lender2, 500e18);
        assertEq(liq.idle(), 500e18);
        assertEq(ws.balanceOf(address(liq)), 0);
        uint256 lender2Shares = vault.balanceOf(lender2);
        vm.prank(lender2);
        assertApproxEqAbs(vault.redeem(lender2Shares, lender2, lender2), 500e18, 1, "idle pays out");

        // The owner unwinds manually: in kind to sMUSD needs no sMUSD withdraw.
        vm.prank(curator);
        (uint256 smusdOut,) = ws.redeemInKind(shares, curator, curator);
        assertApproxEqAbs(smusdOut, 10_100e18, 2);
    }

    function test_rescue_needsTheProbeStipend() public {
        _deposit(lender, 1000e18);
        vm.prank(curator);
        liq.submitRescue();
        skip(72 hours);
        vm.prank(curator);
        vm.expectRevert(IWsMusdLiquidityAdapter.InsufficientGas.selector);
        liq.rescue{gas: 2_000_000}();
        assertGt(ws.balanceOf(address(liq)), 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_depositWithdraw_roundTrip(uint256 amount, uint256 fillFirst) public {
        amount = bound(amount, 1e18, 100_000e18);
        if (fillFirst % 2 == 1) _fillWsMusd();
        uint256 shares = _deposit(lender, amount);
        assertApproxEqAbs(_realTotal(), vault.totalAssets(), 2, "accounting");
        vm.prank(lender);
        uint256 out = vault.redeem(shares, lender, lender);
        assertApproxEqAbs(out, amount, 3, "round trip");
        assertLe(out, amount, "never pays out more");
    }
}

interface IVaultV2Factory {
    function createVaultV2(address owner, address asset, bytes32 salt) external returns (address);
}
