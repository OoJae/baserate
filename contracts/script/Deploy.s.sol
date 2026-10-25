// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {BtcMusdOracle} from "../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../src/savings/WsMUSD.sol";
import {BorrowAccountFactory} from "../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../src/interfaces/IBorrowAccountFactory.sol";
import {MusdDispenser} from "../src/periphery/MusdDispenser.sol";
import {MezoAddresses, MezoNetwork} from "./config/MezoAddresses.sol";

/// @notice Deploys the Baserate core stack on Mezo testnet: oracle, wsMUSD, account factory (with the bcBTC receipt and
/// BorrowAccount implementation), the M1 Morpho market, team-supplied M1 liquidity and the judge MUSD dispenser.
/// @dev Run with `forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --account <keystore>`.
/// On testnet the deployer holds the governor and sentinel roles; this is labelled in the registry. Mainnet uses a
/// separate script with a Safe as governor. Mezo charges more gas on-chain than local simulation for sMUSD calls, so
/// broadcast with `--gas-estimate-multiplier 130` (the factory deploy still fits the 10M block gas limit).
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant WSMUSD_CAP = 250_000e18;
    uint256 internal constant WSMUSD_SEED = 1e18;
    uint256 internal constant M1_SEED = 3000e18;
    uint256 internal constant DISPENSER_FUND = 600e18;

    function run() external {
        MezoNetwork memory net = MezoAddresses.forChain(block.chainid);
        require(block.chainid == MezoAddresses.TESTNET_CHAIN_ID, "Deploy: testnet only");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        // Resumable: reuse contracts from an interrupted run when their addresses are passed in.
        BtcMusdOracle oracle = BtcMusdOracle(vm.envOr("ORACLE", address(0)));
        if (address(oracle) == address(0)) {
            oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        }

        WsMUSD wsMusd = WsMUSD(vm.envOr("WSMUSD", address(0)));
        if (address(wsMusd) == address(0)) wsMusd = new WsMUSD(net.musd, net.smusd, deployer, WSMUSD_CAP);
        if (wsMusd.totalSupply() == 0) {
            if (IERC20(net.musd).allowance(deployer, address(wsMusd)) < WSMUSD_SEED) {
                IERC20(net.musd).approve(address(wsMusd), WSMUSD_SEED);
            }
            wsMusd.deposit(WSMUSD_SEED, DEAD);
        }

        BorrowAccountFactory factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: deployer,
                sentinel: deployer,
                feeRecipient: deployer,
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits({positionCap: 0.01e18, ceilingBps: 6200}),
                canary: IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 7675})
            })
        );
        factory.setCanaryOperator(deployer, true);

        MarketParams memory params = factory.marketParams();
        IMorpho(net.morpho).createMarket(params);
        require(Id.unwrap(params.id()) == Id.unwrap(factory.MARKET_ID()), "Deploy: market id");

        IERC20(net.musd).approve(net.morpho, M1_SEED);
        IMorpho(net.morpho).supply(params, M1_SEED, 0, deployer, "");

        MusdDispenser dispenser = new MusdDispenser(deployer, net.musd, 25e18, 300e18);
        IERC20(net.musd).transfer(address(dispenser), DISPENSER_FUND);

        vm.stopBroadcast();

        _writeRegistry(net, deployer, oracle, wsMusd, factory, dispenser, params);
    }

    function _writeRegistry(
        MezoNetwork memory net,
        address deployer,
        BtcMusdOracle oracle,
        WsMUSD wsMusd,
        BorrowAccountFactory factory,
        MusdDispenser dispenser,
        MarketParams memory params
    ) internal {
        string memory k = "registry";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeString(k, "governanceNote", "Testnet: the deployer EOA holds governor and sentinel roles.");
        vm.serializeAddress(k, "oracle", address(oracle));
        vm.serializeAddress(k, "wsMusd", address(wsMusd));
        vm.serializeAddress(k, "factory", address(factory));
        vm.serializeAddress(k, "collateral", factory.COLLATERAL());
        vm.serializeAddress(k, "borrowAccountImpl", factory.IMPLEMENTATION());
        vm.serializeAddress(k, "dispenser", address(dispenser));
        vm.serializeAddress(k, "morpho", net.morpho);
        vm.serializeAddress(k, "irm", params.irm);
        vm.serializeUint(k, "lltv", params.lltv);
        string memory json = vm.serializeBytes32(k, "marketId", Id.unwrap(factory.MARKET_ID()));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console2.log("registry written for chain", block.chainid);
    }
}
