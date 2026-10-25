// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {PCVMock, SMUSDMock} from "../utils/SMUSDMock.sol";

/// @notice Shared local stack for the wsMUSD unit, fuzz and invariant suites: MockMUSD + SMUSDMock (+ PCVMock),
/// a wsMUSD with the production 250k cap, a 1 MUSD dead seed, and a 1M MUSD outside sMUSD holder so protocol yield
/// is diluted across the sMUSD supply exactly like on-chain.
abstract contract WsMUSDBase is Test {
    uint256 internal constant CAP = 250_000e18;
    uint256 internal constant SEED = 1e18;
    uint256 internal constant OUTSIDE_SMUSD = 1_000_000e18;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    PCVMock internal pcv;
    WsMUSD internal ws;

    address internal capAdmin = makeAddr("capAdmin");
    address internal seeder = makeAddr("seeder");
    address internal whale = makeAddr("whale");
    address internal donor = makeAddr("donor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_792_942_983);
        vm.roll(16_363_000);

        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        pcv = new PCVMock(address(musd), address(smusd));
        ws = new WsMUSD(address(musd), address(smusd), capAdmin, CAP);

        vm.label(address(musd), "MUSD");
        vm.label(address(smusd), "sMUSD");
        vm.label(address(ws), "wsMUSD");
        vm.label(address(pcv), "PCV");

        // Outside sMUSD holders: protocol yield is spread over the whole sMUSD supply.
        musd.mint(whale, OUTSIDE_SMUSD);
        vm.startPrank(whale);
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(OUTSIDE_SMUSD);
        vm.stopPrank();

        // Deploy-script seed: 1 MUSD of dead shares.
        _deposit(seeder, SEED, DEAD);
    }

    // ----- helpers -----

    function _fund(address who, uint256 amount) internal {
        musd.mint(who, amount);
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

    /// @dev Donates `amount` MUSD to all sMUSD holders through `receiveProtocolYield`.
    function _protocolYield(uint256 amount) internal {
        musd.mint(donor, amount);
        vm.startPrank(donor);
        musd.approve(address(smusd), amount);
        smusd.receiveProtocolYield(amount);
        vm.stopPrank();
    }

    /// @dev Donates enough protocol yield for wsMUSD's pro-rata share to be about `target`.
    function _yieldForVault(uint256 target) internal returns (uint256 donation) {
        uint256 supply = smusd.totalSupply();
        donation = target * supply / smusd.balanceOf(address(ws));
        uint256 minDonation = supply / 1e18 + 1; // below this sMUSD reverts AmountTooSmall
        if (donation < minDonation) donation = minDonation;
        _protocolYield(donation);
    }

    function _held() internal view returns (uint256) {
        return smusd.balanceOf(address(ws)) + musd.balanceOf(address(ws));
    }

    function _accounted() internal view returns (uint256) {
        (uint256 stored, uint256 unvested,,) = ws.vestingState();
        return stored + unvested;
    }

    function _stored() internal view returns (uint256 stored) {
        (stored,,,) = ws.vestingState();
    }

    function _unvested() internal view returns (uint256 unvested) {
        (, unvested,,) = ws.vestingState();
    }
}
