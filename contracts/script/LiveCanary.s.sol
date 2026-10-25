// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {BorrowAccountFactory} from "../src/account/BorrowAccountFactory.sol";
import {Profile} from "../src/interfaces/IBorrowAccountFactory.sol";

/// @notice Instructions only, never transactions: prints the exact `cast` commands the team runs to open a canary at
/// the canary ceiling on the live chain, watch it, and liquidate it through the FlashLiquidator.
/// @dev Why `cast` and not a broadcast: forge executes scripts locally against a fork of the RPC, and Mezo's Skip
/// precompile (0x7b7c...0015) is implemented in the Go node; locally its stub bytecode recurses and reverts. Both
/// `openCanary` (two oracle reads) and `liquidate` read Skip, so they can only run as real transactions sent with
/// `cast send`, which the node executes with the real precompile. This script reads the live oracle price with
/// `vm.rpc("eth_call")` (also executed by the node), sizes the canary at the ceiling, and prints the commands.
///
/// Usage (the registry must hold `factory`, `oracle`, `deployer` and, for steps 2-3, `flashLiquidator`):
///   forge script script/LiveCanary.s.sol --rpc-url mezo_testnet
///   CANARY_BTC=1000000000000000 forge script script/LiveCanary.s.sol --rpc-url mezo_testnet
/// Env: CANARY_BTC (collateral in BTC wei, default: the canary position cap), CANARY_BUFFER_BPS (default 5), CANARY_OPERATOR (default: the registry `deployer`, the testnet canary operator), KEYSTORE (the cast
/// `--account` name, default "baserate-deployer").
///
/// The canary flow:
/// 1. The canary operator opens a position at the canary ceiling (LLTV - 25 bps: 7,675 bps on testnet at LLTV 0.77,
///    8,575 on mainnet at 0.86), capped at the canary position cap (0.002 BTC). Only canary operators can open the
///    CANARY profile, so nobody else can plant near-LLTV positions in a market lenders fund.
/// 2. A BTC/USD move of about 0.3% against it (plus interest) makes it liquidatable; poll `previewLiquidation`.
/// 3. Anyone liquidates it with zero capital through the FlashLiquidator; lenders are repaid in full and the caller
///    keeps the venue's surplus.
contract LiveCanary is Script {
    bytes4 internal constant PRICE_SELECTOR = 0xa035b1fe; // price()
    uint256 internal constant BPS = 10_000;

    struct Plan {
        address factory;
        address account;
        string rpc;
        string keystore;
        uint256 btcIn;
        uint256 price;
        uint256 ceilingBps;
        uint256 lltvBps;
        uint256 musdOut;
        uint256 debt;
        uint256 liqPrice;
    }

    function run() external {
        uint256 btcIn = vm.envOr("CANARY_BTC", uint256(0));
        string memory json = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        Plan memory p = _plan(json, btcIn);
        _printSummary(p);
        _printOpen(p);
        if (!vm.keyExistsJson(json, ".flashLiquidator")) {
            console2.log("2-3) Deploy the liquidation layer first (script/DeployLiquidation.s.sol).");
            return;
        }
        _printLiquidate(p, vm.parseJsonAddress(json, ".flashLiquidator"));
    }

    function _plan(string memory json, uint256 btcIn) internal returns (Plan memory p) {
        BorrowAccountFactory factory = BorrowAccountFactory(vm.parseJsonAddress(json, ".factory"));
        address operator = vm.envOr("CANARY_OPERATOR", vm.parseJsonAddress(json, ".deployer"));
        require(factory.isCanaryOperator(operator), "LiveCanary: not a canary operator");
        require(!factory.borrowPaused(), "LiveCanary: borrowing is paused");

        (uint128 cap, uint16 ceilingBps) = factory.limits(Profile.CANARY);
        if (btcIn == 0) btcIn = cap;
        require(btcIn <= cap, "LiveCanary: above the canary position cap");

        p.factory = address(factory);
        (p.account,) = factory.accountOf(operator, Profile.CANARY);
        p.rpc = block.chainid == 31_612 ? "mezo_mainnet" : "mezo_testnet";
        p.keystore = vm.envOr("KEYSTORE", string("baserate-deployer"));
        p.btcIn = btcIn;
        p.ceilingBps = ceilingBps;
        p.lltvBps = factory.LLTV() / 1e14;
        p.price = _livePrice(vm.parseJsonAddress(json, ".oracle"));

        bool fee = factory.feeRecipient() != address(0);
        // Size a few bps under the ceiling so a small tick down between this read and the send does not revert.
        uint256 bufferBps = vm.envOr("CANARY_BUFFER_BPS", uint256(5));
        p.musdOut = _maxMusdOut(btcIn, p.price, ceilingBps - bufferBps, fee);
        p.debt = p.musdOut + (fee ? (p.musdOut * 10 + BPS - 1) / BPS : 0);
        // Liquidatable once collateral x price x LLTV < debt.
        p.liqPrice = p.debt * 1e18 * BPS / (btcIn * p.lltvBps);
    }

    function _printSummary(Plan memory p) internal pure {
        console2.log("== Baserate live canary (instructions only; nothing is broadcast) ==");
        console2.log("live oracle price, MUSD per BTC", p.price / 1e36);
        console2.log("canary ceiling (bps)", p.ceilingBps);
        console2.log("LLTV (bps)", p.lltvBps);
        console2.log("collateral (BTC wei)", p.btcIn);
        console2.log("musdOut (MUSD wei)", p.musdOut);
        console2.log("debt incl. 10 bps fee (MUSD wei)", p.debt);
        console2.log("liquidatable below, MUSD per BTC (1e18)", p.liqPrice);
        console2.log("canary account (CREATE2, may not exist yet)", p.account);
        console2.log("");
    }

    function _printOpen(Plan memory p) internal pure {
        console2.log("1) Open the canary at the ceiling (as the canary operator):");
        console2.log(
            string.concat(
                "cast send ",
                vm.toString(p.factory),
                ' "openCanary(uint256,uint256)" ',
                vm.toString(p.musdOut),
                " ",
                vm.toString(p.ceilingBps),
                " --value ",
                vm.toString(p.btcIn),
                " --rpc-url ",
                p.rpc,
                " --account ",
                p.keystore,
                " --gas-estimate-multiplier 130"
            )
        );
        console2.log("   Sized CANARY_BUFFER_BPS (default 5) under the ceiling; if the price falls further before the");
        console2.log("   send, the ceiling check reverts LtvTooHigh: rerun this script and send again.");
        console2.log("");
    }

    function _printLiquidate(Plan memory p, address liq) internal view {
        console2.log("2) Watch it (eth_call; QuoterV2 makes previewLiquidation non-view, so use cast call):");
        console2.log(
            string.concat(
                "cast call ",
                vm.toString(liq),
                ' "previewLiquidation(address)((bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256,',
                'uint256,(uint256,uint256,bool)[3]))" ',
                vm.toString(p.account),
                " --rpc-url ",
                p.rpc
            )
        );
        console2.log("   Liquidatable when the second field is true; quotes are [BACKSTOP, CL200, VAMM].");
        console2.log("");
        console2.log("3) Liquidate with zero capital (venue 0 = BACKSTOP, 1 = CL200, 2 = VAMM; 0 seizes in full):");
        console2.log(
            string.concat(
                "cast send ",
                vm.toString(liq),
                ' "liquidate(address,uint256,uint8,uint256)" ',
                vm.toString(p.account),
                " 0 ",
                block.chainid == 31_612 ? "1" : "2",
                " <minProfit from the preview> --rpc-url ",
                p.rpc,
                " --account ",
                p.keystore,
                " --gas-estimate-multiplier 130"
            )
        );
    }

    /// @dev The oracle's `price()` executed by the node (real Skip precompile), at the latest block.
    function _livePrice(address oracle) internal returns (uint256) {
        string memory params = string.concat(
            '[{"to":"', vm.toString(oracle), '","data":"', vm.toString(abi.encodePacked(PRICE_SELECTOR)), '"},"latest"]'
        );
        return abi.decode(vm.rpc("eth_call", params), (uint256));
    }

    /// @dev Largest `musdOut` whose debt (plus the 10 bps fee) keeps `coll` at or under `ceilingBps` at `price`.
    function _maxMusdOut(uint256 coll, uint256 price, uint256 ceilingBps, bool fee) internal pure returns (uint256 m) {
        uint256 maxDebt = coll * price / 1e36 * ceilingBps / BPS;
        if (!fee) return maxDebt;
        m = maxDebt * BPS / (BPS + 10);
        while (m + 1 + (m + 1 + 999) / 1000 <= maxDebt) ++m;
        while (m != 0 && m + (m * 10 + BPS - 1) / BPS > maxDebt) --m;
    }
}
