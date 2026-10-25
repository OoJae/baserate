// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BorrowAccountFactory} from "../src/account/BorrowAccountFactory.sol";
import {BorrowAccount} from "../src/account/BorrowAccount.sol";
import {Profile} from "../src/interfaces/IBorrowAccountFactory.sol";

/// @notice Live evidence on Mezo testnet with real precompiles: borrow MUSD against native BTC in one transaction,
/// then repay and withdraw in one transaction.
/// @dev `forge script script/LiveDemo.s.sol --sig "open()" --rpc-url mezo_testnet --broadcast --account <ks>` and
/// then `--sig "exit()"`. Reads the factory address from deployments/<chainId>.json.
contract LiveDemo is Script {
    uint256 internal constant BTC_IN = 0.001 ether;
    uint256 internal constant MUSD_OUT = 30e18;
    uint256 internal constant MAX_LTV_BPS = 5000;

    function _factory() internal view returns (BorrowAccountFactory) {
        string memory json = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        return BorrowAccountFactory(vm.parseJsonAddress(json, ".factory"));
    }

    function open() external {
        BorrowAccountFactory factory = _factory();
        vm.startBroadcast();
        address account = factory.openAndBorrow{value: BTC_IN}(MUSD_OUT, MAX_LTV_BPS);
        vm.stopBroadcast();
        BorrowAccount a = BorrowAccount(payable(account));
        console2.log("account", account);
        console2.log("collateral", a.collateral());
        console2.log("debt", a.debt());
    }

    function exit() external {
        BorrowAccountFactory factory = _factory();
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        (address account,) = factory.accountOf(me, Profile.STANDARD);
        BorrowAccount a = BorrowAccount(payable(account));
        IERC20(factory.marketParams().loanToken).approve(account, a.debt() + 1e18);
        a.repayAndWithdraw(me);
        vm.stopBroadcast();
        console2.log("collateral after", a.collateral());
        console2.log("debt after", a.debt());
    }
}
