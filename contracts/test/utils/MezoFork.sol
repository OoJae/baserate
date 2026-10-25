// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MezoAddresses, MezoNetwork} from "../../script/config/MezoAddresses.sol";
import {BtcPrecompileMock} from "./BtcPrecompileMock.sol";
import {SkipMock} from "./SkipMock.sol";

/// @notice Base for fork tests against Mezo testnet or mainnet at pinned blocks.
/// @dev Mezo's precompiles are implemented in the Go node, so under a local fork they recurse and revert. We etch a
/// SkipMock seeded with the real Skip answer captured at the pinned block (test/fork/blocks.json).
abstract contract MezoFork is Test {
    enum Net {
        TESTNET,
        MAINNET
    }

    MezoNetwork internal net;
    SkipMock internal skipOracle;

    function _fork(Net which) internal {
        string memory key = which == Net.TESTNET ? ".testnet" : ".mainnet";
        string memory json = vm.readFile("test/fork/blocks.json");
        uint256 blockNumber = vm.parseJsonUint(json, string.concat(key, ".block"));
        int256 skipAnswer = vm.parseInt(vm.parseJsonString(json, string.concat(key, ".skipAnswer")));

        vm.createSelectFork(which == Net.TESTNET ? "mezo_testnet" : "mezo_mainnet", blockNumber);
        net = which == Net.TESTNET ? MezoAddresses.testnet() : MezoAddresses.mainnet();

        vm.etch(MezoAddresses.SKIP_BTC_USD, address(new SkipMock()).code);
        skipOracle = SkipMock(MezoAddresses.SKIP_BTC_USD);
        skipOracle.setAnswer(skipAnswer);
        vm.label(MezoAddresses.SKIP_BTC_USD, "SkipBtcUsd");
        vm.label(net.musd, "MUSD");
        vm.label(net.smusd, "sMUSD");
        vm.label(net.morpho, "Morpho");
    }

    /// @dev Etches the BTC precompile mock (native-balance mirror) at 0x7b7C...0000. On a fork Foundry only lets
    /// accounts it considers local call cheatcodes, and the precompile address exists on the forked chain, so the
    /// mock's `vm.deal` needs `allowCheatcodes` (verified: without it the first transfer reverts "cheatcodes are not
    /// enabled for 0x7b7C...").
    function _etchBtc() internal returns (BtcPrecompileMock btc) {
        vm.etch(MezoAddresses.BTC, address(new BtcPrecompileMock()).code);
        vm.allowCheatcodes(MezoAddresses.BTC);
        vm.label(MezoAddresses.BTC, "BTC");
        btc = BtcPrecompileMock(MezoAddresses.BTC);
    }
}
