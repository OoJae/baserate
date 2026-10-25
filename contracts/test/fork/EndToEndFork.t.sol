// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {BorrowAccount} from "../../src/account/BorrowAccount.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {MusdDispenser} from "../../src/periphery/MusdDispenser.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {MezoFork} from "../utils/MezoFork.sol";
import {SkipMock} from "../utils/SkipMock.sol";

/// @notice The judge journey on the assembled stack with the real BtcMusdOracle (Skip mocked at the fork-block price,
/// real Pyth): borrow with faucet-sized BTC, top up from the dispenser, save in wsMUSD, then repay and exit.
contract EndToEndForkTest is MezoFork {
    address internal team = makeAddr("team");
    address internal judge = makeAddr("judge");

    BtcMusdOracle internal oracle;
    WsMUSD internal wsMusd;
    BorrowAccountFactory internal factory;
    MusdDispenser internal dispenser;
    MarketParams internal params;

    function _deploy() internal {
        oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        wsMusd = new WsMUSD(net.musd, net.smusd, team, 250_000e18);
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: team,
                sentinel: team,
                feeRecipient: team,
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits({positionCap: 0.01e18, ceilingBps: 6200}),
                canary: IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 7675})
            })
        );
        params = factory.marketParams();
        IMorpho(net.morpho).createMarket(params);

        deal(net.musd, team, 10_000e18);
        vm.startPrank(team);
        IERC20(net.musd).approve(net.morpho, 3000e18);
        IMorpho(net.morpho).supply(params, 3000e18, 0, team, "");
        dispenser = new MusdDispenser(team, net.musd, 25e18, 300e18);
        IERC20(net.musd).transfer(address(dispenser), 600e18);
        vm.stopPrank();
    }

    function _journey() internal {
        _deploy();
        vm.deal(judge, 0.001 ether);

        // 1. Borrow ~30 MUSD against one faucet drip, in one transaction, priced by the real oracle.
        vm.prank(judge);
        address account = factory.openAndBorrow{value: 0.001 ether}(30e18, 5000);
        BorrowAccount a = BorrowAccount(payable(account));
        assertEq(a.collateral(), 0.001 ether, "collateral");
        assertEq(IERC20(net.musd).balanceOf(judge), 30e18, "borrowed");
        uint256 ltvBps = a.debt() * 1e4 * 1e36 / (a.collateral() * oracle.price());
        assertLt(ltvBps, 5000, "ltv under requested max");

        // 2. Interest accrues; top up from the dispenser to cover it.
        vm.warp(block.timestamp + 7 days);
        skipOracle.setAnswer(skipOracle.answer());
        vm.prank(judge);
        dispenser.claim(10e18, 0, "");

        // 3. Save: deposit into wsMUSD and redeem.
        vm.startPrank(judge);
        IERC20(net.musd).approve(address(wsMusd), 5e18);
        uint256 shares = wsMusd.deposit(5e18, judge);
        assertGt(shares, 0, "shares");
        wsMusd.redeem(shares, judge, judge);

        // 4. Exit: repay everything and get native BTC back, even with the oracle down.
        skipOracle.setMode(SkipMock.Mode.REVERT);
        uint256 debt = a.debt();
        IERC20(net.musd).approve(account, debt);
        uint256 btcBefore = judge.balance;
        a.repayAndWithdraw(judge);
        vm.stopPrank();

        assertEq(a.debt(), 0, "debt cleared");
        assertEq(a.collateral(), 0, "collateral returned");
        assertEq(judge.balance - btcBefore, 0.001 ether, "native BTC back");
    }

    function test_judgeJourney_testnet() public {
        _fork(Net.TESTNET);
        _journey();
    }

    function test_judgeJourney_mainnet() public {
        _fork(Net.MAINNET);
        _journey();
    }
}
