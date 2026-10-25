// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MusdDispenser} from "../../src/periphery/MusdDispenser.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice The dispenser against the real testnet MUSD (it is testnet-only; mainnet gets no dispenser).
/// Wave 1 parameters: 25 MUSD per address per day, 300 MUSD globally.
contract MusdDispenserForkTest is MezoFork {
    uint256 internal constant PER = 25e18;
    uint256 internal constant GLOBAL = 300e18;
    uint256 internal constant FUNDED = 300e18;

    IERC20 internal musd;
    MusdDispenser internal dispenser;

    address internal owner = makeAddr("owner");
    address internal judge = makeAddr("judge");
    address internal judge2 = makeAddr("judge2");

    function setUp() public {
        _fork(Net.TESTNET);
        assertEq(block.chainid, MezoAddresses.TESTNET_CHAIN_ID, "testnet fork");
        musd = IERC20(net.musd);
        dispenser = new MusdDispenser(owner, net.musd, PER, GLOBAL);
        deal(net.musd, address(dispenser), FUNDED);
    }

    function test_fork_openModeClaim() public {
        uint256 before = musd.balanceOf(judge);
        assertEq(dispenser.claimable(judge), PER);

        vm.prank(judge);
        dispenser.claim(PER, 0, "");

        assertEq(musd.balanceOf(judge), before + PER, "judge paid in real MUSD");
        assertEq(musd.balanceOf(address(dispenser)), FUNDED - PER, "dispenser debited");
        assertEq(dispenser.claimable(judge), 0, "judge capped for today");
        assertEq(dispenser.claimable(judge2), PER, "others unaffected");

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, 1, 0));
        vm.prank(judge);
        dispenser.claim(1, 0, "");

        skip(1 days);
        vm.prank(judge);
        dispenser.claim(PER, 0, "");
        assertEq(musd.balanceOf(judge), before + 2 * PER, "next day refill");
    }

    function test_fork_voucherClaim() public {
        (address signerAddr, uint256 signerPk) = makeAddrAndKey("dispenserSigner");
        vm.prank(owner);
        dispenser.setSigner(signerAddr);

        uint256 deadline = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, dispenser.claimDigest(judge, 10e18, deadline));
        bytes memory sig = abi.encodePacked(r, s, v);

        (,,, uint256 chainId, address verifying,,) = dispenser.eip712Domain();
        assertEq(chainId, MezoAddresses.TESTNET_CHAIN_ID, "domain chainId");
        assertEq(verifying, address(dispenser), "domain verifyingContract");

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(judge2);
        dispenser.claim(10e18, deadline, sig);

        uint256 before = musd.balanceOf(judge);
        vm.prank(judge);
        dispenser.claim(10e18, deadline, sig);
        assertEq(musd.balanceOf(judge), before + 10e18);
    }

    function test_fork_drainBoundedByGlobalDailyThenSweep() public {
        for (uint256 i; i < GLOBAL / PER; ++i) {
            vm.prank(address(uint160(0xBEEF0000 + i)));
            dispenser.claim(PER, 0, "");
        }
        assertEq(musd.balanceOf(address(dispenser)), FUNDED - GLOBAL);
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.GlobalLimitExceeded.selector, 1, 0));
        vm.prank(judge);
        dispenser.claim(1, 0, "");

        deal(net.musd, address(dispenser), 50e18);
        vm.prank(owner);
        dispenser.sweep(owner, 50e18);
        assertEq(musd.balanceOf(owner), 50e18);
        assertEq(musd.balanceOf(address(dispenser)), 0);
    }
}
