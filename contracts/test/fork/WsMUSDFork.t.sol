// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {IMUSDSavingsRate} from "../../src/interfaces/external/IMUSDSavingsRate.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice wsMUSD against the real sMUSD (MUSDSavingsRate proxy) and real MUSD at the pinned fork blocks.
/// @dev Run by `WsMUSDForkTestnetTest` (pcv = 0) and `WsMUSDForkMainnetTest` (pcv set: sMUSD itself calls
/// `distributeMUSD()` inside deposit/withdraw). MUSD balances come from `deal` (OZ v5 storage).
abstract contract WsMUSDForkBase is MezoFork {
    uint256 internal constant CAP = 250_000e18;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    WsMUSD internal ws;
    IERC20 internal musd;
    IMUSDSavingsRate internal smusd;

    address internal capAdmin = makeAddr("capAdmin");
    address internal seeder = makeAddr("seeder");
    address internal alice = makeAddr("alice");
    address internal attacker = makeAddr("attacker");
    address internal donor = makeAddr("donor");

    function _setUpNetwork(Net which) internal {
        _fork(which);
        musd = IERC20(net.musd);
        smusd = IMUSDSavingsRate(net.smusd);
        ws = new WsMUSD(net.musd, net.smusd, capAdmin, CAP);
        vm.label(address(ws), "wsMUSD");
        _deposit(seeder, 1e18, DEAD);
    }

    // ----- helpers -----

    function _fund(address who, uint256 amount) internal {
        deal(address(musd), who, musd.balanceOf(who) + amount);
        vm.prank(who);
        musd.approve(address(ws), type(uint256).max);
    }

    function _deposit(address who, uint256 amount, address receiver) internal returns (uint256 shares) {
        _fund(who, amount);
        vm.prank(who);
        shares = ws.deposit(amount, receiver);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256) {
        return _deposit(who, amount, who);
    }

    /// @dev Real `receiveProtocolYield`: spread over the whole live sMUSD supply.
    function _protocolYield(uint256 amount) internal {
        deal(address(musd), donor, musd.balanceOf(donor) + amount);
        vm.startPrank(donor);
        musd.approve(address(smusd), amount);
        smusd.receiveProtocolYield(amount);
        vm.stopPrank();
    }

    function _held() internal view returns (uint256) {
        return smusd.balanceOf(address(ws)) + musd.balanceOf(address(ws));
    }

    function _accounted() internal view returns (uint256) {
        (uint256 stored, uint256 unvested,,) = ws.vestingState();
        return stored + unvested;
    }

    // ----- tests -----

    function test_fork_wiringAndPcvExpectation() public view {
        assertEq(ws.asset(), net.musd);
        assertEq(address(ws.SMUSD()), net.smusd);
        assertEq(smusd.musdToken(), net.musd);
        assertEq(ws.decimals(), 18);
        assertEq(ws.totalAssets(), 1e18);
        assertEq(smusd.balanceOf(address(ws)), 1e18, "seed staked in the real sMUSD");
        if (net.chainId == 31_611) assertEq(smusd.pcv(), address(0), "testnet pcv is 0");
        else assertEq(smusd.pcv(), net.pcv, "mainnet pcv set");
    }

    function test_fork_depositRedeemRoundTrip() public {
        uint256 shares = _deposit(alice, 10_000e18);
        assertEq(shares, 10_000e18);
        assertEq(smusd.balanceOf(address(ws)), 10_001e18);
        assertEq(musd.balanceOf(address(ws)), 0);

        vm.prank(alice);
        uint256 out = ws.redeem(shares, alice, alice);
        assertEq(out, 10_000e18, "same block: exactly par");
        assertEq(musd.balanceOf(alice), 10_000e18);
        assertGe(_held(), _accounted());
    }

    function test_fork_protocolYieldIsHarvestedExactlyAndVests() public {
        _deposit(alice, 100_000e18);
        uint256 base = ws.totalAssets();
        _protocolYield(1_000_000e18);

        uint256 pending = ws.pendingYield();
        uint256 expectedShare = 1_000_000e18 * 100_001e18 / smusd.totalSupply();
        assertApproxEqRel(pending, expectedShare, 0.001e18, "pro-rata share of the donation");
        assertEq(ws.totalAssets(), base, "same block as the last harvest: 0 instant");

        uint256 harvested = ws.sync();
        assertEq(harvested, pending, "pendingYield mirrors the real sMUSD claim exactly");
        assertEq(ws.totalAssets(), base);
        (, uint256 unvested,, uint64 periodEnd) = ws.vestingState();
        assertEq(unvested, harvested);
        assertEq(periodEnd, block.timestamp + 3 days);
        assertEq(smusd.balanceOf(address(ws)), 100_001e18 + harvested, "harvest re-staked");

        skip(1 days);
        assertGe(ws.totalAssets(), base + harvested / 3);
        skip(2 days);
        assertGe(ws.totalAssets(), base + harvested);

        vm.prank(alice);
        uint256 out = ws.redeem(100_000e18, alice, alice);
        assertGt(out, 100_000e18 + harvested * 99 / 100);
        assertGe(_held(), _accounted());
    }

    function test_fork_directDonationVestsWithZeroInstant() public {
        _deposit(alice, 10_000e18);
        uint256 ta = ws.totalAssets();

        deal(address(musd), address(ws), 5000e18);
        assertEq(ws.totalAssets(), ta, "donation invisible until vested");
        ws.sync();
        assertEq(ws.totalAssets(), ta, "absorbed with 0 instant part");
        (, uint256 unvested,,) = ws.vestingState();
        assertGe(unvested, 5000e18);
        assertEq(musd.balanceOf(address(ws)), 0, "re-staked into sMUSD");

        skip(36 hours);
        assertApproxEqAbs(ws.totalAssets(), ta + 2500e18, 1e16);
        skip(36 hours);
        assertGe(ws.totalAssets(), ta + 5000e18);
    }

    function test_fork_sameBlockSandwichCapturesNothing() public {
        _deposit(alice, 10_000e18);
        skip(6 hours);

        uint256 amountIn = 200_000e18;
        uint256 shares = _deposit(attacker, amountIn);
        _protocolYield(5_000_000e18);
        assertGt(ws.pendingYield(), 100e18, "a large lump landed");

        vm.prank(attacker);
        uint256 out = ws.redeem(shares, attacker, attacker);
        assertLe(out, amountIn, "front-run + back-run in one block gets 0");
    }

    function test_fork_backRunAfterLumpCapturesNothing() public {
        _deposit(alice, 10_000e18);
        skip(6 hours);
        _protocolYield(5_000_000e18);

        uint256 amountIn = 200_000e18;
        uint256 shares = _deposit(attacker, amountIn);
        vm.prank(attacker);
        uint256 out = ws.redeem(shares, attacker, attacker);
        assertLe(out, amountIn);
    }

    function test_fork_redeemInKindReturnsRealSMUSD() public {
        _deposit(alice, 10_000e18);
        _protocolYield(1_000_000e18);
        ws.sync();
        skip(3 days);

        uint256 value = ws.previewRedeem(10_000e18);
        (uint256 sPreview, uint256 mPreview) = ws.previewRedeemInKind(10_000e18);

        vm.expectCall(address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.deposit.selector), 0);
        vm.expectCall(address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.withdraw.selector), 0);
        vm.expectCall(address(smusd), abi.encodeWithSelector(IMUSDSavingsRate.claimYield.selector), 0);
        vm.prank(alice);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(10_000e18, alice, alice);

        assertEq(smusdOut, sPreview);
        assertEq(musdOut, mPreview);
        assertEq(musdOut, 0, "fully staked: pays sMUSD only");
        assertGt(smusdOut, 10_000e18, "includes vested yield");
        assertLe(smusdOut, value);
        assertEq(smusd.balanceOf(alice), smusdOut);
        assertGe(_held(), _accounted());
    }

    function test_fork_inKindSMUSDIsRedeemableAtSMUSD() public {
        _deposit(alice, 10_000e18);
        vm.prank(alice);
        (uint256 smusdOut,) = ws.redeemInKind(10_000e18, alice, alice);
        vm.prank(alice);
        smusd.withdraw(smusdOut);
        assertGe(musd.balanceOf(alice), smusdOut);
    }

    function test_fork_depositWithPermitOnRealMUSD() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitter");
        deal(address(musd), signer, 2500e18);
        uint256 deadline = block.timestamp + 1 hours;
        IERC20Permit permitToken = IERC20Permit(address(musd));
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, signer, address(ws), 2500e18, permitToken.nonces(signer), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", permitToken.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        vm.prank(signer);
        uint256 shares = ws.depositWithPermit(2500e18, signer, deadline, v, r, s);
        assertEq(shares, 2500e18);
        assertEq(ws.balanceOf(signer), 2500e18);
        assertEq(musd.balanceOf(signer), 0);
    }

    function test_fork_previewsMatchExecutionMidVesting() public {
        _deposit(alice, 50_000e18);
        _protocolYield(1_000_000e18);
        ws.sync();
        skip(1 days + 1 hours);
        _protocolYield(500_000e18); // pending with an instant part
        deal(address(musd), address(ws), 100e18); // unabsorbed surplus
        _fund(attacker, 10_000e18);

        uint256 snap = vm.snapshotState();
        uint256 expected = ws.previewDeposit(7777e18);
        vm.prank(attacker);
        assertEq(ws.deposit(7777e18, attacker), expected, "deposit");
        vm.revertToState(snap);

        expected = ws.previewRedeem(12_345e18);
        vm.prank(alice);
        assertEq(ws.redeem(12_345e18, alice, alice), expected, "redeem");
        vm.revertToState(snap);

        expected = ws.previewWithdraw(12_345e18);
        vm.prank(alice);
        assertEq(ws.withdraw(12_345e18, alice, alice), expected, "withdraw");
        vm.revertToState(snap);

        uint256 ta = ws.totalAssets();
        ws.sync();
        assertEq(ws.totalAssets(), ta, "sync realizes exactly the preview");
        assertGe(_held(), _accounted());
    }
}

contract WsMUSDForkTestnetTest is WsMUSDForkBase {
    function setUp() public {
        _setUpNetwork(Net.TESTNET);
    }
}

contract WsMUSDForkMainnetTest is WsMUSDForkBase {
    function setUp() public {
        _setUpNetwork(Net.MAINNET);
    }

    /// @dev Mainnet sMUSD calls `PCV.distributeMUSD()` inside its own deposit; the PCV then pushes its fee split
    /// back into sMUSD through `receiveProtocolYield`. wsMUSD never calls PCV itself, yet that mid-transaction yield
    /// must not move its price: it is pending yield harvested later with a 0 instant part for this block.
    function test_fork_pcvDistributionTriggeredBySMUSDDoesNotMovePrice() public {
        IPCVView pcv = IPCVView(net.pcv);
        assertEq(pcv.feeRecipient(), net.smusd, "PCV pays sMUSD");
        assertGt(pcv.feeSplitPercentage(), 0, "fee split enabled");

        _deposit(alice, 100_000e18);
        // Fees accumulate in the PCV; the next sMUSD deposit (wsMUSD's, here) distributes them.
        deal(address(musd), net.pcv, musd.balanceOf(net.pcv) + 2_000_000e18);
        uint256 indexBefore = smusd.yieldIndex();
        uint256 ta = ws.totalAssets();
        uint256 pendingBefore = ws.pendingYield();

        uint256 expectedShares = ws.previewDeposit(10_000e18);
        uint256 shares = _deposit(attacker, 10_000e18);
        assertEq(shares, expectedShares, "preview honoured despite the mid-call distribution");

        assertGt(smusd.yieldIndex(), indexBefore, "sMUSD distributed PCV fees inside wsMUSD's deposit");
        uint256 pending = ws.pendingYield();
        assertGt(pending, pendingBefore + ws.MIN_HARVEST(), "wsMUSD accrued its share");
        assertEq(ws.totalAssets(), ta + 10_000e18, "price unchanged in this block");

        // A same-block exit by the new depositor gets par, not the distribution; its sync harvests the pending
        // yield with a 0 instant part, so all of it vests to holders over the next 3 days.
        vm.prank(attacker);
        assertEq(ws.redeem(shares, attacker, attacker), 10_000e18);
        assertEq(ws.totalAssets(), ta, "price unchanged after the same-block exit");
        (, uint256 unvested,,) = ws.vestingState();
        assertGe(unvested, pending);

        skip(3 days);
        assertGe(ws.totalAssets(), ta + pending);
        assertGe(_held(), _accounted());
    }
}

interface IPCVView {
    function feeRecipient() external view returns (address);
    function feeSplitPercentage() external view returns (uint256);
}
