// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {SharesMathLib} from "morpho-blue/libraries/SharesMathLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../../src/interfaces/ICollateralBTC.sol";
import {MezoFork} from "../utils/MezoFork.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";

/// @notice Shared fixture for the M1 account suites: real Morpho, AdaptiveCurveIrm and MUSD on a pinned Mezo fork,
/// a fresh M1 market (MUSD loan, bcBTC collateral) created through the factory's market params, a settable mock
/// oracle and 10k MUSD of seeded liquidity.
abstract contract BorrowAccountForkBase is MezoFork {
    using MarketParamsLib for MarketParams;
    using SharesMathLib for uint256;
    using MorphoBalancesLib for IMorpho;

    struct NetLimits {
        uint128 standardCap;
        uint16 standardCeiling;
        uint128 canaryCap;
        uint16 canaryCeiling;
        uint256 globalCap;
    }

    uint256 internal constant SEED = 10_000e18;
    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BPS = 10_000;

    BorrowAccountFactory internal factory;
    ICollateralBTC internal receipt;
    MockMorphoOracle internal oracle;
    IMorpho internal morpho;
    IERC20 internal musd;
    MarketParams internal params;
    Id internal marketId;
    NetLimits internal lim;
    uint256 internal price0;

    address internal alice;
    address internal bob = makeAddr("bob");
    address internal lender = makeAddr("lender");
    address internal liquidator = makeAddr("liquidator");
    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal feeTo = makeAddr("feeRecipient");
    address internal canaryOp = makeAddr("canaryOperator");

    function _setUpNet(Net which) internal {
        _fork(which);
        assertEq(block.chainid, net.chainId, "forked chain");
        lim = which == Net.TESTNET
            ? NetLimits({
                standardCap: 0.01e18,
                standardCeiling: 6200,
                canaryCap: 0.002e18,
                canaryCeiling: 7675,
                globalCap: 5000e18
            })
            : NetLimits({
                standardCap: 0.02e18,
                standardCeiling: 7100,
                canaryCap: 0.002e18,
                canaryCeiling: 8575,
                globalCap: 2000e18
            });
        alice = vm.addr(ALICE_PK);
        vm.label(alice, "alice");

        (, int256 skipAnswer,,,) = skipOracle.latestRoundData();
        price0 = uint256(skipAnswer) * 1e18; // 18-dec BTC/USD -> 1e36-scaled MUSD per bcBTC, MUSD at 1.00
        oracle = new MockMorphoOracle(price0);
        morpho = IMorpho(net.morpho);
        musd = IERC20(net.musd);

        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: governor,
                sentinel: sentinel,
                feeRecipient: feeTo,
                globalBorrowCap: lim.globalCap,
                standard: IBorrowAccountFactory.Limits(lim.standardCap, lim.standardCeiling),
                canary: IBorrowAccountFactory.Limits(lim.canaryCap, lim.canaryCeiling)
            })
        );
        receipt = ICollateralBTC(factory.COLLATERAL());
        vm.label(address(factory), "factory");
        vm.label(address(receipt), "bcBTC");

        // Market creation is permissionless; the deploy script does the same.
        params = factory.marketParams();
        morpho.createMarket(params);
        marketId = params.id();
        assertEq(Id.unwrap(marketId), Id.unwrap(factory.MARKET_ID()), "market id");
        assertGt(morpho.market(marketId).lastUpdate, 0, "market created");

        deal(net.musd, lender, SEED);
        vm.startPrank(lender);
        musd.approve(net.morpho, SEED);
        morpho.supply(params, SEED, 0, lender, "");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _open(address who, uint256 coll, uint256 musdOut, uint256 maxLtvBps) internal returns (IBorrowAccount) {
        vm.deal(who, who.balance + coll);
        vm.prank(who);
        return IBorrowAccount(factory.openAndBorrow{value: coll}(musdOut, maxLtvBps));
    }

    function _accountOf(address who) internal view returns (IBorrowAccount acct) {
        (address a,) = factory.accountOf(who, Profile.STANDARD);
        acct = IBorrowAccount(a);
    }

    function _value(uint256 coll) internal view returns (uint256) {
        return coll * oracle.rawPrice() / 1e36;
    }

    function _fee(uint256 musdOut) internal pure returns (uint256) {
        return (musdOut * 10 + BPS - 1) / BPS;
    }

    /// @dev Largest `musdOut` whose debt (musdOut + fee) keeps `coll` at or under `ltvBps` on a fresh market.
    function _maxMusdOut(uint256 coll, uint256 ltvBps) internal view returns (uint256 m) {
        uint256 maxDebt = _value(coll) * ltvBps / BPS;
        m = maxDebt * BPS / (BPS + 10);
        while (m + 1 + _fee(m + 1) <= maxDebt) ++m;
        while (m != 0 && m + _fee(m) > maxDebt) --m;
    }

    function _position(address acct) internal view returns (Position memory) {
        return morpho.position(marketId, acct);
    }

    function _ltvBps(address acct) internal view returns (uint256) {
        return morpho.expectedBorrowAssets(params, acct) * BPS / _value(_position(acct).collateral);
    }

    function _assertClean(IBorrowAccount acct) internal view {
        assertEq(musd.balanceOf(address(acct)), 0, "clone holds MUSD");
        assertEq(IERC20(address(receipt)).balanceOf(address(acct)), 0, "clone holds bcBTC");
    }

    function _assertReceiptBacked() internal view {
        uint256 supply = IERC20(address(receipt)).totalSupply();
        assertGe(address(receipt).balance, supply, "receipt under-backed");
        assertEq(IERC20(address(receipt)).balanceOf(net.morpho), supply, "receipt outside Morpho");
    }

    function _permitSig(uint256 pk, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address owner_ = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner_,
                spender,
                value,
                IERC20Permit(net.musd).nonces(owner_),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(net.musd).DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _submitAndExecute(bytes memory data) internal {
        vm.prank(governor);
        factory.submit(data);
        skip(factory.TIMELOCK());
        (bool ok, bytes memory ret) = address(factory).call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
