// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {MusdDispenser} from "../../src/periphery/MusdDispenser.sol";

/// @dev Plain mintable ERC20 standing in for MUSD.
contract MusdDispenserTestToken is ERC20 {
    constructor() ERC20("Mezo USD", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Token that re-enters `claim` while the dispenser is paying out.
contract MusdDispenserReentrantToken is ERC20 {
    MusdDispenser public target;

    constructor() ERC20("Reentrant", "RE") {}

    function setTarget(MusdDispenser target_) external {
        target = target_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(target) && address(target) != address(0)) target.claim(1, 0, "");
    }
}

contract MusdDispenserTest is Test {
    uint256 internal constant PER = 25e18;
    uint256 internal constant GLOBAL = 300e18;
    uint256 internal constant FUNDED = 1000e18;
    uint256 internal constant START = 1_792_942_983; // testnet pinned-block timestamp (Fri, mid-day UTC)

    MusdDispenserTestToken internal token;
    MusdDispenser internal dispenser;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    address internal signerAddr;
    uint256 internal signerPk;

    event Claimed(address indexed to, uint256 amount, uint256 indexed day);
    event LimitsSet(uint256 perAddressDaily, uint256 globalDaily);
    event SignerSet(address indexed signer);
    event PausedSet(bool paused);
    event Swept(address indexed to, uint256 amount);

    function setUp() public {
        vm.warp(START);
        token = new MusdDispenserTestToken();
        dispenser = new MusdDispenser(owner, address(token), PER, GLOBAL);
        token.mint(address(dispenser), FUNDED);
        (signerAddr, signerPk) = makeAddrAndKey("dispenserSigner");
    }

    // ---------------------------------------------------------------- helpers

    function _sign(uint256 pk, address to, uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, dispenser.claimDigest(to, amount, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _voucherMode() internal {
        vm.prank(owner);
        dispenser.setSigner(signerAddr);
    }

    function _claim(address who, uint256 amount) internal {
        vm.prank(who);
        dispenser.claim(amount, 0, "");
    }

    function _today() internal view returns (uint256) {
        return vm.getBlockTimestamp() / 1 days;
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_initialState() public view {
        assertEq(dispenser.owner(), owner, "owner");
        assertEq(dispenser.pendingOwner(), address(0), "pendingOwner");
        assertEq(address(dispenser.TOKEN()), address(token), "token");
        assertEq(dispenser.perAddressDaily(), PER, "perAddressDaily");
        assertEq(dispenser.globalDaily(), GLOBAL, "globalDaily");
        assertEq(dispenser.signer(), address(0), "open mode");
        assertFalse(dispenser.paused(), "paused");
        assertEq(dispenser.currentDay(), START / 1 days, "day");
        assertEq(dispenser.CLAIM_TYPEHASH(), keccak256("Claim(address to,uint256 amount,uint256 deadline)"), "typehash");

        (, string memory name, string memory version, uint256 chainId, address verifying,,) = dispenser.eip712Domain();
        assertEq(name, "Baserate MUSD Dispenser", "domain name");
        assertEq(version, "1", "domain version");
        assertEq(chainId, block.chainid, "domain chainId");
        assertEq(verifying, address(dispenser), "domain verifyingContract");
    }

    function test_constructor_ownerIsExplicitNotDeployer() public {
        vm.prank(alice);
        MusdDispenser d = new MusdDispenser(owner, address(token), PER, GLOBAL);
        assertEq(d.owner(), owner);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(MusdDispenser.ZeroAddress.selector);
        new MusdDispenser(owner, address(0), PER, GLOBAL);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new MusdDispenser(address(0), address(token), PER, GLOBAL);
    }

    // ---------------------------------------------------------------- open mode

    function test_claim_openMode_paysCaller() public {
        vm.expectEmit(address(dispenser));
        emit Claimed(alice, 10e18, _today());
        _claim(alice, 10e18);

        assertEq(token.balanceOf(alice), 10e18, "alice paid");
        assertEq(token.balanceOf(address(dispenser)), FUNDED - 10e18, "dispenser debited");
        assertEq(dispenser.claimedBy(_today(), alice), 10e18, "claimedBy");
        assertEq(dispenser.claimedTotal(_today()), 10e18, "claimedTotal");
    }

    function test_claim_openMode_ignoresDeadlineAndSig() public {
        vm.prank(alice);
        dispenser.claim(5e18, 0, hex"deadbeef"); // expired deadline and junk signature are irrelevant in open mode
        assertEq(token.balanceOf(alice), 5e18);
    }

    function test_claim_revertsOnZeroAmount() public {
        vm.expectRevert(MusdDispenser.ZeroAmount.selector);
        _claim(alice, 0);
    }

    // ---------------------------------------------------------------- limits

    function test_claim_perAddressLimit() public {
        _claim(alice, 10e18);
        _claim(alice, 15e18);
        assertEq(token.balanceOf(alice), PER);

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, 1, 0));
        _claim(alice, 1);

        // Another address is unaffected.
        _claim(bob, PER);
        assertEq(token.balanceOf(bob), PER);
    }

    function test_claim_perAddressLimit_singleOversizedClaim() public {
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, PER + 1, PER));
        _claim(alice, PER + 1);
    }

    function test_claim_globalLimit() public {
        for (uint256 i; i < GLOBAL / PER; ++i) {
            _claim(address(uint160(0x1000 + i)), PER);
        }
        assertEq(dispenser.claimedTotal(_today()), GLOBAL);
        assertEq(dispenser.claimable(alice), 0, "global cap reached");

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.GlobalLimitExceeded.selector, 1e18, 0));
        _claim(alice, 1e18);
    }

    function test_claim_globalLimit_partialRemaining() public {
        vm.prank(owner);
        dispenser.setLimits(PER, 30e18);
        _claim(alice, PER);

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.GlobalLimitExceeded.selector, 10e18, 5e18));
        _claim(bob, 10e18);

        _claim(bob, 5e18);
        assertEq(dispenser.claimedTotal(_today()), 30e18);
    }

    function test_claim_dayRollover() public {
        uint256 day0 = _today();
        _claim(alice, PER);

        // Last second of the same day: still capped.
        vm.warp((day0 + 1) * 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, 1, 0));
        _claim(alice, 1);

        // First second of the next day: fresh limits.
        vm.warp((day0 + 1) * 1 days);
        assertEq(dispenser.currentDay(), day0 + 1);
        assertEq(dispenser.claimable(alice), PER);

        vm.expectEmit(address(dispenser));
        emit Claimed(alice, PER, day0 + 1);
        _claim(alice, PER);

        assertEq(token.balanceOf(alice), 2 * PER);
        assertEq(dispenser.claimedBy(day0, alice), PER, "day0 kept");
        assertEq(dispenser.claimedBy(day0 + 1, alice), PER, "day1");
        assertEq(dispenser.claimedTotal(day0 + 1), PER, "day1 total");
    }

    function test_claim_globalLimitResetsNextDay() public {
        vm.prank(owner);
        dispenser.setLimits(PER, PER);
        _claim(alice, PER);

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.GlobalLimitExceeded.selector, 1, 0));
        _claim(bob, 1);

        skip(1 days);
        _claim(bob, PER);
        assertEq(token.balanceOf(bob), PER);
    }

    function test_claim_revertsWhenDispenserShort() public {
        vm.prank(owner);
        dispenser.sweep(treasury, FUNDED - 5e18);

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.InsufficientBalance.selector, 10e18, 5e18));
        _claim(alice, 10e18);

        _claim(alice, 5e18);
        assertEq(token.balanceOf(address(dispenser)), 0);
    }

    // ---------------------------------------------------------------- pause

    function test_claim_paused() public {
        vm.expectEmit(address(dispenser));
        emit PausedSet(true);
        vm.prank(owner);
        dispenser.setPaused(true);

        assertEq(dispenser.claimable(alice), 0, "claimable while paused");
        vm.expectRevert(MusdDispenser.DispenserPaused.selector);
        _claim(alice, 1e18);

        vm.prank(owner);
        dispenser.setPaused(false);
        _claim(alice, 1e18);
        assertEq(token.balanceOf(alice), 1e18);
    }

    function test_paused_ownerCanStillSweep() public {
        vm.startPrank(owner);
        dispenser.setPaused(true);
        dispenser.sweep(treasury, FUNDED);
        vm.stopPrank();
        assertEq(token.balanceOf(treasury), FUNDED);
    }

    // ---------------------------------------------------------------- voucher mode

    function test_voucher_validSignature() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, 20e18, deadline);

        vm.expectEmit(address(dispenser));
        emit Claimed(alice, 20e18, _today());
        vm.prank(alice);
        dispenser.claim(20e18, deadline, sig);
        assertEq(token.balanceOf(alice), 20e18);
    }

    function test_voucher_deadlineIsInclusive() public {
        _voucherMode();
        bytes memory sig = _sign(signerPk, alice, 1e18, block.timestamp);
        vm.prank(alice);
        dispenser.claim(1e18, block.timestamp, sig);
        assertEq(token.balanceOf(alice), 1e18);
    }

    function test_voucher_expired() public {
        _voucherMode();
        uint256 deadline = vm.getBlockTimestamp() + 10 minutes;
        bytes memory sig = _sign(signerPk, alice, 1e18, deadline);
        skip(10 minutes + 1);

        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.SignatureExpired.selector, deadline));
        vm.prank(alice);
        dispenser.claim(1e18, deadline, sig);
    }

    function test_voucher_wrongSigner() public {
        _voucherMode();
        (, uint256 otherPk) = makeAddrAndKey("impostor");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(otherPk, alice, 1e18, deadline);

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(1e18, deadline, sig);
    }

    function test_voucher_missingOrMalformedSignature() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory good = _sign(signerPk, alice, 1e18, deadline);

        bytes[] memory bad = new bytes[](4);
        bad[0] = "";
        bad[1] = new bytes(65); // zeroed r, s, v
        bad[2] = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2))); // 64 bytes (ERC-2098 rejected)
        bad[3] = bytes.concat(good, hex"00"); // 66 bytes
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(MusdDispenser.InvalidSignature.selector);
            vm.prank(alice);
            dispenser.claim(1e18, deadline, bad[i]);
        }
    }

    function test_voucher_boundToClaimer() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory aliceSig = _sign(signerPk, alice, 10e18, deadline);

        // Bob front-runs with Alice's voucher: the digest is rebuilt with msg.sender, so it fails.
        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(bob);
        dispenser.claim(10e18, deadline, aliceSig);

        vm.prank(alice);
        dispenser.claim(10e18, deadline, aliceSig);
        assertEq(token.balanceOf(alice), 10e18);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_voucher_boundToAmountAndDeadline() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, 10e18, deadline);

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(20e18, deadline, sig);

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(10e18, deadline + 1, sig);
    }

    function test_voucher_highSMalleabilityRejected() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, dispenser.claimDigest(alice, 1e18, deadline));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(1e18, deadline, flipped);
    }

    function test_voucher_replayBoundedByDailyLimit() public {
        _voucherMode();
        uint256 deadline = vm.getBlockTimestamp() + 3 days;
        bytes memory sig = _sign(signerPk, alice, 10e18, deadline);

        vm.startPrank(alice);
        dispenser.claim(10e18, deadline, sig);
        dispenser.claim(10e18, deadline, sig); // no nonce: reuse is allowed within the cap
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, 10e18, 5e18));
        dispenser.claim(10e18, deadline, sig);

        skip(1 days);
        dispenser.claim(10e18, deadline, sig);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 30e18);
    }

    function test_voucher_signerRotationInvalidatesOldVouchers() public {
        _voucherMode();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, 1e18, deadline);

        (address newSigner, uint256 newPk) = makeAddrAndKey("newSigner");
        vm.prank(owner);
        dispenser.setSigner(newSigner);

        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(1e18, deadline, sig);

        bytes memory fresh = _sign(newPk, alice, 1e18, deadline);
        vm.prank(alice);
        dispenser.claim(1e18, deadline, fresh);
        assertEq(token.balanceOf(alice), 1e18);
    }

    function test_voucher_backToOpenMode() public {
        _voucherMode();
        vm.expectRevert(MusdDispenser.InvalidSignature.selector);
        vm.prank(alice);
        dispenser.claim(1e18, block.timestamp, "");

        vm.expectEmit(address(dispenser));
        emit SignerSet(address(0));
        vm.prank(owner);
        dispenser.setSigner(address(0));

        _claim(alice, 1e18);
        assertEq(token.balanceOf(alice), 1e18);
    }

    function test_claimDigest_matchesEip712Spec() public view {
        address to = alice;
        uint256 amount = 25e18;
        uint256 deadline = START + 600;
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Baserate MUSD Dispenser"),
                keccak256("1"),
                block.chainid,
                address(dispenser)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Claim(address to,uint256 amount,uint256 deadline)"), to, amount, deadline));
        assertEq(dispenser.DOMAIN_SEPARATOR(), domainSeparator, "domain separator");
        assertEq(
            dispenser.claimDigest(to, amount, deadline),
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash)),
            "digest"
        );
    }

    // ---------------------------------------------------------------- claimable

    function test_claimable_tracksAddressGlobalAndBalance() public {
        assertEq(dispenser.claimable(alice), PER, "fresh: per-address limit");

        _claim(alice, 10e18);
        assertEq(dispenser.claimable(alice), 15e18, "after own claim");
        assertEq(dispenser.claimable(bob), PER, "others unaffected");

        vm.prank(owner);
        dispenser.setLimits(PER, 30e18);
        assertEq(dispenser.claimable(bob), 20e18, "global remaining binds");

        vm.prank(owner);
        dispenser.sweep(treasury, FUNDED - 10e18 - 3e18);
        assertEq(dispenser.claimable(bob), 3e18, "balance binds");
        assertEq(dispenser.claimable(alice), 3e18, "balance binds for alice too");
    }

    function test_setLimits_belowClaimedSaturatesToZero() public {
        _claim(alice, 20e18);

        vm.expectEmit(address(dispenser));
        emit LimitsSet(10e18, 15e18);
        vm.prank(owner);
        dispenser.setLimits(10e18, 15e18);

        assertEq(dispenser.claimable(alice), 0, "per-address below claimed");
        assertEq(dispenser.claimable(bob), 0, "global below claimed");
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.AddressLimitExceeded.selector, 1, 0));
        _claim(alice, 1);
        vm.expectRevert(abi.encodeWithSelector(MusdDispenser.GlobalLimitExceeded.selector, 1, 0));
        _claim(bob, 1);
    }

    function testFuzz_claimSucceedsIffWithinClaimable(
        uint256 priorAlice,
        uint256 priorOthers,
        uint256 leftover,
        uint256 amount
    ) public {
        priorAlice = bound(priorAlice, 0, PER);
        priorOthers = bound(priorOthers, 0, GLOBAL - priorAlice);
        if (priorAlice > 0) _claim(alice, priorAlice);
        if (priorOthers > 0) {
            vm.prank(owner);
            dispenser.setLimits(type(uint256).max, GLOBAL);
            _claim(bob, priorOthers);
            vm.prank(owner);
            dispenser.setLimits(PER, GLOBAL);
        }
        uint256 balance = token.balanceOf(address(dispenser));
        leftover = bound(leftover, 0, balance);
        if (balance > leftover) {
            vm.prank(owner);
            dispenser.sweep(treasury, balance - leftover);
        }
        amount = bound(amount, 1, 2 * PER);

        uint256 expected = PER - priorAlice;
        if (GLOBAL - priorAlice - priorOthers < expected) expected = GLOBAL - priorAlice - priorOthers;
        if (leftover < expected) expected = leftover;
        uint256 c = dispenser.claimable(alice);
        assertEq(c, expected, "claimable math");

        if (amount <= c) {
            _claim(alice, amount);
            assertEq(token.balanceOf(alice), priorAlice + amount);
            assertEq(dispenser.claimable(alice), c - amount);
        } else {
            vm.expectRevert();
            _claim(alice, amount);
        }
    }

    function testFuzz_claimsNeverExceedDailyCaps(uint256 seed) public {
        address[3] memory actors = [alice, bob, treasury];
        for (uint256 i; i < 40; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address who = actors[seed % 3];
            uint256 amount = bound(seed >> 8, 1, 2 * PER);
            if ((seed >> 128) % 7 == 0) skip(6 hours);
            if (amount <= dispenser.claimable(who)) _claim(who, amount);
            uint256 day = _today();
            assertLe(dispenser.claimedTotal(day), GLOBAL, "global cap");
            for (uint256 j; j < 3; ++j) {
                assertLe(dispenser.claimedBy(day, actors[j]), PER, "address cap");
            }
        }
    }

    // ---------------------------------------------------------------- admin

    function test_admin_onlyOwner() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(unauthorized);
        dispenser.setLimits(1, 1);
        vm.expectRevert(unauthorized);
        dispenser.setSigner(alice);
        vm.expectRevert(unauthorized);
        dispenser.setPaused(true);
        vm.expectRevert(unauthorized);
        dispenser.sweep(alice, 1);
        vm.expectRevert(unauthorized);
        dispenser.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_sweep() public {
        vm.expectEmit(address(dispenser));
        emit Swept(treasury, 100e18);
        vm.prank(owner);
        dispenser.sweep(treasury, 100e18);
        assertEq(token.balanceOf(treasury), 100e18);
        assertEq(token.balanceOf(address(dispenser)), FUNDED - 100e18);
    }

    function test_sweep_reverts() public {
        vm.startPrank(owner);
        vm.expectRevert(MusdDispenser.ZeroAddress.selector);
        dispenser.sweep(address(0), 1);
        vm.expectRevert(MusdDispenser.ZeroAmount.selector);
        dispenser.sweep(treasury, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, address(dispenser), FUNDED, FUNDED + 1
            )
        );
        dispenser.sweep(treasury, FUNDED + 1);
        vm.stopPrank();
    }

    function test_ownable2Step() public {
        vm.prank(owner);
        dispenser.transferOwnership(bob);
        assertEq(dispenser.owner(), owner, "not yet transferred");
        assertEq(dispenser.pendingOwner(), bob);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        dispenser.acceptOwnership();

        vm.prank(bob);
        dispenser.acceptOwnership();
        assertEq(dispenser.owner(), bob);

        vm.prank(bob);
        dispenser.setPaused(true);
        assertTrue(dispenser.paused());
    }

    function test_renounceOwnership_disabled() public {
        vm.expectRevert(MusdDispenser.RenounceDisabled.selector);
        vm.prank(owner);
        dispenser.renounceOwnership();
        assertEq(dispenser.owner(), owner);
    }

    // ---------------------------------------------------------------- reentrancy

    function test_claim_nonReentrant() public {
        MusdDispenserReentrantToken evil = new MusdDispenserReentrantToken();
        MusdDispenser d = new MusdDispenser(owner, address(evil), PER, GLOBAL);
        evil.mint(address(d), FUNDED);
        evil.setTarget(d);

        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        vm.prank(alice);
        d.claim(1e18, 0, "");
    }
}
