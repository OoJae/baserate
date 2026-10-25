// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {BorrowAccount} from "../../src/account/BorrowAccount.sol";
import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {CollateralBTC} from "../../src/collateral/CollateralBTC.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";

/// @notice Factory unit tests that need no Morpho: wiring, deterministic clones, roles, timelocks and pause rules.
/// @dev Morpho, MUSD, the oracle and the IRM are code-less placeholders; nothing here calls them.
contract BorrowAccountFactoryTest is Test {
    using MarketParamsLib for MarketParams;

    BorrowAccountFactory internal factory;

    address internal morpho = makeAddr("morpho");
    address internal musd = makeAddr("musd");
    address internal oracle = makeAddr("oracle");
    address internal irm = makeAddr("irm");
    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal feeTo = makeAddr("feeRecipient");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal module = makeAddr("module");

    function _params() internal view returns (IBorrowAccountFactory.FactoryParams memory p) {
        p = IBorrowAccountFactory.FactoryParams({
            morpho: morpho,
            musd: musd,
            oracle: oracle,
            irm: irm,
            lltv: 0.77e18,
            bos: address(0),
            collSurplusPool: address(0),
            governor: governor,
            sentinel: sentinel,
            feeRecipient: feeTo,
            globalBorrowCap: 5000e18,
            standard: IBorrowAccountFactory.Limits(0.01e18, 6200),
            canary: IBorrowAccountFactory.Limits(0.002e18, 7675)
        });
    }

    function setUp() public {
        factory = new BorrowAccountFactory(_params());
    }

    // ---------------------------------------------------------------- construction

    function test_constructor_wiring() public view {
        assertEq(factory.MORPHO(), morpho);
        assertEq(factory.MUSD(), musd);
        assertEq(factory.ORACLE(), oracle);
        assertEq(factory.IRM(), irm);
        assertEq(factory.LLTV(), 0.77e18);
        assertEq(factory.ORIGINATION_FEE_BPS(), 10);
        assertEq(factory.TIMELOCK(), 48 hours);
        assertEq(factory.MAX_CEILING_BPS(), 7675);
        assertEq(factory.governor(), governor);
        assertEq(factory.sentinel(), sentinel);
        assertEq(factory.feeRecipient(), feeTo);
        assertEq(factory.globalBorrowCap(), 5000e18);
        (uint128 cap, uint16 ceiling) = factory.limits(Profile.STANDARD);
        assertEq(cap, 0.01e18);
        assertEq(ceiling, 6200);
        (cap, ceiling) = factory.limits(Profile.CANARY);
        assertEq(cap, 0.002e18);
        assertEq(ceiling, 7675);
        assertFalse(factory.borrowPaused());
        assertFalse(factory.creditPaused());
    }

    function test_constructor_deploysReceiptAndImplementation() public view {
        CollateralBTC receipt = CollateralBTC(factory.COLLATERAL());
        assertEq(receipt.FACTORY(), address(factory));
        assertEq(receipt.MORPHO(), morpho);
        assertEq(receipt.symbol(), "bcBTC");

        BorrowAccount impl = BorrowAccount(payable(factory.IMPLEMENTATION()));
        assertEq(impl.FACTORY(), address(factory));
        assertEq(impl.MORPHO(), morpho);
        assertEq(impl.owner(), address(0), "implementation is inert");
        assertFalse(factory.isAccount(address(impl)));

        MarketParams memory p = factory.marketParams();
        assertEq(p.loanToken, musd);
        assertEq(p.collateralToken, address(receipt));
        assertEq(p.oracle, oracle);
        assertEq(p.irm, irm);
        assertEq(p.lltv, 0.77e18);
        assertEq(Id.unwrap(factory.MARKET_ID()), Id.unwrap(p.id()));
        assertEq(Id.unwrap(impl.MARKET_ID()), Id.unwrap(p.id()));
        assertEq(keccak256(abi.encode(impl.marketParams())), keccak256(abi.encode(p)));
    }

    function test_constructor_mainnetLltvCeiling() public {
        IBorrowAccountFactory.FactoryParams memory p = _params();
        p.lltv = 0.86e18;
        p.standard = IBorrowAccountFactory.Limits(0.02e18, 7100);
        p.canary = IBorrowAccountFactory.Limits(0.002e18, 8575);
        BorrowAccountFactory f = new BorrowAccountFactory(p);
        assertEq(f.MAX_CEILING_BPS(), 8575);
    }

    function test_constructor_revertsOnZeroAddresses() public {
        IBorrowAccountFactory.FactoryParams memory p;
        for (uint256 i; i < 5; ++i) {
            p = _params();
            if (i == 0) p.morpho = address(0);
            if (i == 1) p.musd = address(0);
            if (i == 2) p.oracle = address(0);
            if (i == 3) p.irm = address(0);
            if (i == 4) p.governor = address(0);
            vm.expectRevert(IBorrowAccountFactory.ZeroAddress.selector);
            new BorrowAccountFactory(p);
        }
    }

    function test_constructor_revertsOnInvalidLltv() public {
        IBorrowAccountFactory.FactoryParams memory p = _params();
        p.lltv = 1e18;
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.InvalidLltv.selector, 1e18));
        new BorrowAccountFactory(p);
        p.lltv = 0;
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.InvalidLltv.selector, 0));
        new BorrowAccountFactory(p);
    }

    function test_constructor_revertsOnCeilingAboveLltvMinus25() public {
        IBorrowAccountFactory.FactoryParams memory p = _params();
        p.canary.ceilingBps = 7676;
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.CeilingTooHigh.selector, 7676, 7675));
        new BorrowAccountFactory(p);
    }

    function test_constructor_doesNotUseDeployerAsAdmin() public {
        // Deployed through a CREATE2-style proxy deployer, roles still come from the params.
        address deployer = makeAddr("create2Deployer");
        vm.prank(deployer);
        BorrowAccountFactory f = new BorrowAccountFactory(_params());
        assertEq(f.governor(), governor);
        vm.prank(deployer);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        f.setSentinel(deployer);
    }

    /// @dev Mezo's block gas limit is 10M; the factory deploy (with embedded receipt and implementation) must stay
    /// under ~8M so `--gas-estimate-multiplier 110` still fits.
    function test_deployGas_fitsMezoBlock() public {
        bytes memory init = abi.encodePacked(type(BorrowAccountFactory).creationCode, abi.encode(_params()));
        uint256 calldataGas = 21_000 + 2 * ((init.length + 31) / 32); // base tx + EIP-3860 initcode words
        for (uint256 i; i < init.length; ++i) {
            calldataGas += init[i] == 0 ? 4 : 16;
        }
        uint256 before = gasleft();
        address f;
        assembly {
            f := create(0, add(init, 0x20), mload(init))
        }
        uint256 execGas = before - gasleft();
        assertTrue(f != address(0), "deploy failed");
        emit log_named_uint("factory deploy gas (approx)", execGas + calldataGas);
        assertLt(execGas + calldataGas, 8_000_000);
        assertLt(init.length, 49_152, "EIP-3860 initcode limit");
    }

    // ---------------------------------------------------------------- clones

    function test_createAccount_deploysAtPredictedAddress() public {
        (address predicted, bool deployed) = factory.accountOf(alice, Profile.STANDARD);
        assertFalse(deployed);
        assertEq(
            predicted,
            Clones.predictDeterministicAddressWithImmutableArgs(
                factory.IMPLEMENTATION(),
                abi.encodePacked(alice),
                keccak256(abi.encode(alice, Profile.STANDARD)),
                address(factory)
            )
        );

        vm.expectEmit(true, true, false, true, address(factory));
        emit IBorrowAccountFactory.AccountCreated(alice, predicted, Profile.STANDARD);
        vm.prank(stranger); // permissionless
        address account = factory.createAccount(alice);

        assertEq(account, predicted);
        (, deployed) = factory.accountOf(alice, Profile.STANDARD);
        assertTrue(deployed);
        assertTrue(factory.isAccount(account));
        assertEq(uint8(factory.profileOf(account)), uint8(Profile.STANDARD));
        assertEq(BorrowAccount(payable(account)).owner(), alice);
        assertEq(BorrowAccount(payable(account)).FACTORY(), address(factory));
        assertEq(Clones.fetchCloneArgs(account), abi.encodePacked(alice));
    }

    function test_createAccount_isIdempotent() public {
        address first = factory.createAccount(alice);
        vm.recordLogs();
        address second = factory.createAccount(alice);
        assertEq(first, second);
        assertEq(vm.getRecordedLogs().length, 0, "no second AccountCreated");
    }

    function test_createAccount_revertsOnZeroOwner() public {
        vm.expectRevert(IBorrowAccountFactory.ZeroAddress.selector);
        factory.createAccount(address(0));
    }

    function testFuzz_accountOf_uniquePerOwnerAndProfile(address a, address b) public view {
        vm.assume(a != b);
        (address aStd,) = factory.accountOf(a, Profile.STANDARD);
        (address aCan,) = factory.accountOf(a, Profile.CANARY);
        (address bStd,) = factory.accountOf(b, Profile.STANDARD);
        assertTrue(aStd != aCan && aStd != bStd && aCan != bStd);
    }

    function test_openCanary_revertsForNonOperator() public {
        vm.deal(stranger, 1e18);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.NotCanaryOperator.selector, stranger));
        factory.openCanary{value: 1e18}(0, 0);
    }

    function test_setCanaryOperator_onlyGovernor() public {
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setCanaryOperator(alice, true);

        vm.expectEmit(true, false, false, true, address(factory));
        emit IBorrowAccountFactory.CanaryOperatorSet(alice, true);
        vm.prank(governor);
        factory.setCanaryOperator(alice, true);
        assertTrue(factory.isCanaryOperator(alice));
    }

    function test_comeBack_disabledWithoutBos() public {
        vm.prank(alice);
        vm.expectRevert(IBorrowAccountFactory.ComeBackDisabled.selector);
        factory.comeBack("", block.timestamp, 0, 0);
        assertEq(factory.claimableSurplus(alice), 0);
    }

    function test_riskParams_bundle() public {
        address account = factory.createAccount(alice);
        vm.prank(governor);
        factory.setCanaryOperator(alice, true);
        IBorrowAccountFactory.RiskParams memory rp = factory.riskParams(account);
        assertEq(uint8(rp.profile), uint8(Profile.STANDARD));
        assertEq(rp.positionCap, 0.01e18);
        assertEq(rp.ceilingBps, 6200);
        assertEq(rp.globalBorrowCap, 5000e18);
        assertFalse(rp.borrowPaused);
        assertFalse(rp.creditPaused);
        assertEq(rp.feeRecipient, feeTo);
        assertEq(rp.feeBps, 10);
    }

    // ---------------------------------------------------------------- pause

    function test_setPaused_roles() public {
        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(true, true);

        vm.prank(sentinel);
        factory.setPaused(true, false);
        assertTrue(factory.borrowPaused());
        vm.prank(sentinel);
        factory.setPaused(true, true);
        assertTrue(factory.creditPaused());

        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(false, true);
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(true, false);

        vm.expectEmit(true, false, false, true, address(factory));
        emit IBorrowAccountFactory.PausedSet(governor, false, false);
        vm.prank(governor);
        factory.setPaused(false, false);
        assertFalse(factory.borrowPaused());
        assertFalse(factory.creditPaused());
    }

    // ---------------------------------------------------------------- caps and timelock

    function test_setGlobalBorrowCap_decreaseIsInstantForSentinelAndGovernor() public {
        vm.prank(sentinel);
        factory.setGlobalBorrowCap(1000e18);
        assertEq(factory.globalBorrowCap(), 1000e18);
        vm.prank(governor);
        factory.setGlobalBorrowCap(0);
        assertEq(factory.globalBorrowCap(), 0);
        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setGlobalBorrowCap(0);
    }

    function test_setGlobalBorrowCap_increaseNeedsTimelock() public {
        bytes memory data = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (6000e18));

        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(6000e18);

        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.submit(data);

        vm.expectEmit(true, false, false, true, address(factory));
        emit IBorrowAccountFactory.Submitted(
            IBorrowAccountFactory.setGlobalBorrowCap.selector, data, block.timestamp + 48 hours
        );
        vm.prank(governor);
        factory.submit(data);
        assertEq(factory.executableAt(data), block.timestamp + 48 hours);

        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataAlreadyPending.selector);
        factory.submit(data);

        skip(48 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.TimelockNotExpired.selector, block.timestamp + 1));
        factory.setGlobalBorrowCap(6000e18);

        skip(1);
        vm.prank(stranger); // anyone may execute a due raise
        factory.setGlobalBorrowCap(6000e18);
        assertEq(factory.globalBorrowCap(), 6000e18);
        assertEq(factory.executableAt(data), 0, "consumed");

        // A raise to a different value was never queued.
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(7000e18);
    }

    function test_revoke_bySentinelOrGovernor() public {
        bytes memory data = abi.encodeCall(IBorrowAccountFactory.setGlobalBorrowCap, (9000e18));
        vm.prank(governor);
        factory.submit(data);

        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.revoke(data);

        vm.expectEmit(true, true, false, true, address(factory));
        emit IBorrowAccountFactory.Revoked(sentinel, IBorrowAccountFactory.setGlobalBorrowCap.selector, data);
        vm.prank(sentinel);
        factory.revoke(data);
        assertEq(factory.executableAt(data), 0);

        skip(48 hours);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setGlobalBorrowCap(9000e18);

        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.revoke(data);
    }

    function test_submit_rejectsNonTimelockedSelectors() public {
        bytes memory pause = abi.encodeCall(IBorrowAccountFactory.setPaused, (false, false));
        vm.startPrank(governor);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBorrowAccountFactory.InvalidTimelockedCall.selector, IBorrowAccountFactory.setPaused.selector
            )
        );
        factory.submit(pause);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.InvalidTimelockedCall.selector, bytes4(0)));
        factory.submit(hex"01");
        vm.stopPrank();
    }

    function test_setLimits_decreaseInstantIncreaseTimelocked() public {
        vm.prank(sentinel);
        factory.setLimits(Profile.STANDARD, 0.005e18, 5000);
        (uint128 cap, uint16 ceiling) = factory.limits(Profile.STANDARD);
        assertEq(cap, 0.005e18);
        assertEq(ceiling, 5000);

        // Cap down but ceiling up is a raise.
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setLimits(Profile.STANDARD, 0.004e18, 5100);

        bytes memory raise = abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.STANDARD, 0.02e18, 7000));
        vm.prank(governor);
        factory.submit(raise);
        skip(48 hours);
        factory.setLimits(Profile.STANDARD, 0.02e18, 7000);
        (cap, ceiling) = factory.limits(Profile.STANDARD);
        assertEq(cap, 0.02e18);
        assertEq(ceiling, 7000);
    }

    function test_setLimits_ceilingNeverAboveMax() public {
        bytes memory raise = abi.encodeCall(IBorrowAccountFactory.setLimits, (Profile.CANARY, 0.002e18, 7676));
        vm.prank(governor);
        factory.submit(raise);
        skip(48 hours);
        vm.expectRevert(abi.encodeWithSelector(IBorrowAccountFactory.CeilingTooHigh.selector, 7676, 7675));
        factory.setLimits(Profile.CANARY, 0.002e18, 7676);
    }

    function test_setFeeRecipient_alwaysTimelocked() public {
        address router = makeAddr("feeRouter");
        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setFeeRecipient(router);

        vm.prank(governor);
        factory.submit(abi.encodeCall(IBorrowAccountFactory.setFeeRecipient, (router)));
        skip(48 hours);
        vm.expectEmit(true, false, false, true, address(factory));
        emit IBorrowAccountFactory.FeeRecipientSet(router);
        factory.setFeeRecipient(router);
        assertEq(factory.feeRecipient(), router);
    }

    function test_setModuleApproval_addTimelockedRemoveInstant() public {
        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.DataNotTimelocked.selector);
        factory.setModuleApproval(module, true);

        vm.prank(governor);
        factory.submit(abi.encodeCall(IBorrowAccountFactory.setModuleApproval, (module, true)));
        skip(48 hours);
        factory.setModuleApproval(module, true);
        assertTrue(factory.isApprovedModule(module));

        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setModuleApproval(module, false);
        vm.prank(sentinel);
        factory.setModuleApproval(module, false);
        assertFalse(factory.isApprovedModule(module));
    }

    // ---------------------------------------------------------------- roles

    function test_governance_twoStepTransfer() public {
        address next = makeAddr("nextGovernor");
        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.transferGovernance(next);

        vm.prank(governor);
        factory.transferGovernance(next);
        assertEq(factory.pendingGovernor(), next);
        assertEq(factory.governor(), governor, "unchanged until accepted");

        vm.prank(stranger);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.acceptGovernance();

        vm.expectEmit(true, true, false, true, address(factory));
        emit IBorrowAccountFactory.GovernanceTransferred(governor, next);
        vm.prank(next);
        factory.acceptGovernance();
        assertEq(factory.governor(), next);
        assertEq(factory.pendingGovernor(), address(0));

        vm.prank(governor);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(false, false);
    }

    function test_setSentinel_onlyGovernor() public {
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setSentinel(stranger);

        vm.prank(governor);
        factory.setSentinel(address(0));
        assertEq(factory.sentinel(), address(0));
        vm.prank(sentinel);
        vm.expectRevert(IBorrowAccountFactory.Unauthorized.selector);
        factory.setPaused(true, true);
    }
}
