// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {BtcMusdOracle} from "../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../src/savings/WsMUSD.sol";
import {BorrowAccountFactory} from "../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../src/interfaces/IBorrowAccountFactory.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MusdDispenser} from "../src/periphery/MusdDispenser.sol";
import {MezoAddresses, MezoNetwork} from "./config/MezoAddresses.sol";

/// @notice Deploys the Baserate core stack: oracle, wsMUSD, account factory (with the bcBTC receipt and BorrowAccount
/// implementation) and the M1 Morpho market, on Mezo testnet (31611) or mainnet (31612).
/// @dev Simulate first (no broadcast: nothing is sent and the registry is not written):
///   forge script script/Deploy.s.sol --rpc-url mezo_testnet --sender <deployer>
/// Broadcast:
///   forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --account <keystore> --sender <deployer> \
///     --gas-estimate-multiplier 130
/// Mezo charges more gas on-chain than local simulation for sMUSD calls, so broadcast with
/// `--gas-estimate-multiplier 130` (the factory deploy still fits the 10M block gas limit).
///
/// Testnet: the deployer EOA holds the governor role (and the sentinel role unless `SENTINEL` is set), receives the
/// origination fee until the timelocked switch to the FeeRouter, queues the canary-operator grant for
/// `CANARY_OPERATOR` (default: itself; timelocked, executable after 48 h), supplies
/// `TESTNET_M1_SEED` to M1 and funds the judge MUSD dispenser; this is labelled in the registry.
///
/// Mainnet (proof mode, docs/design/contracts.md sections 3 and 8): every role is explicit and none defaults to the
/// deployer. Required env: `GOVERNOR` (the Safe; also wsMUSD's cap admin), `SENTINEL`, `FEE_RECIPIENT` (the FeeRouter,
/// deployed first with `DeployPeriphery`, so the factory takes it in its constructor without a timelock). The script
/// refuses a governor without code, a fee recipient that is not a FeeRouter wired to mainnet MUSD/sMUSD/PoolsVoter or
/// that differs from the registry's `feeRouter`, and any role equal to the deployer. Optional `M1_SEED` (default 0)
/// supplies MUSD to M1. No canary operator and no dispenser: canary operators are granted later by the Safe.
/// Limits: STANDARD 0.02 BTC / 7100 bps, CANARY 0.002 BTC / 8575 bps, global borrow cap 2,000 MUSD.
///
/// Resumable: `ORACLE` / `WSMUSD` reuse contracts from an interrupted run; `M1_SEED` overrides the M1 supply (testnet
/// default 3,000 MUSD, mainnet default 0).
/// Registry: `deployments/<chainId>.json` is only written by `--broadcast` / `--resume`, and the new keys are merged
/// into the existing object (every other key, e.g. `feeRouter`, `vMusd` or `backstop`, is kept).
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant WSMUSD_CAP = 250_000e18;
    uint256 internal constant WSMUSD_SEED = 1e18;
    uint256 internal constant TESTNET_M1_SEED = 3000e18;
    uint256 internal constant DISPENSER_FUND = 600e18;

    /// @dev Roles, limits and seeding for one network.
    struct CoreConfig {
        bool mainnet;
        address governor;
        address sentinel;
        address feeRecipient;
        address capAdmin;
        uint256 globalBorrowCap;
        IBorrowAccountFactory.Limits standard;
        IBorrowAccountFactory.Limits canary;
        uint256 m1Seed;
    }

    struct Deployed {
        address deployer;
        BtcMusdOracle oracle;
        WsMUSD wsMusd;
        BorrowAccountFactory factory;
        MusdDispenser dispenser;
        MarketParams params;
    }

    function run() external returns (Deployed memory d) {
        MezoNetwork memory net = MezoAddresses.forChain(block.chainid);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory registry = vm.exists(path) ? vm.readFile(path) : "{}";

        vm.startBroadcast();
        (, d.deployer,) = vm.readCallers();
        CoreConfig memory cfg = block.chainid == MezoAddresses.MAINNET_CHAIN_ID
            ? _mainnetConfig(net, d.deployer, registry)
            : _testnetConfig(d.deployer);

        d.oracle = BtcMusdOracle(vm.envOr("ORACLE", address(0)));
        if (address(d.oracle) == address(0)) {
            d.oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        }

        d.wsMusd = WsMUSD(vm.envOr("WSMUSD", address(0)));
        if (address(d.wsMusd) == address(0)) d.wsMusd = new WsMUSD(net.musd, net.smusd, cfg.capAdmin, WSMUSD_CAP);
        if (d.wsMusd.totalSupply() == 0) {
            if (IERC20(net.musd).allowance(d.deployer, address(d.wsMusd)) < WSMUSD_SEED) {
                IERC20(net.musd).approve(address(d.wsMusd), WSMUSD_SEED);
            }
            d.wsMusd.deposit(WSMUSD_SEED, DEAD);
        }

        d.factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(d.oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: cfg.governor,
                sentinel: cfg.sentinel,
                feeRecipient: cfg.feeRecipient,
                globalBorrowCap: cfg.globalBorrowCap,
                standard: cfg.standard,
                canary: cfg.canary
            })
        );

        d.params = d.factory.marketParams();
        IMorpho(net.morpho).createMarket(d.params);
        require(Id.unwrap(d.params.id()) == Id.unwrap(d.factory.MARKET_ID()), "Deploy: market id");

        if (cfg.m1Seed != 0) {
            IERC20(net.musd).approve(net.morpho, cfg.m1Seed);
            IMorpho(net.morpho).supply(d.params, cfg.m1Seed, 0, d.deployer, "");
        }

        if (!cfg.mainnet) {
            // Testnet only: the deployer is the governor and queues the canary grant (a timelocked raise since audit
            // D-7) for `CANARY_OPERATOR` (the keeper's canary key) or itself; anyone executes it once due, 48 h later.
            address canaryOperator = vm.envOr("CANARY_OPERATOR", d.deployer);
            d.factory.submit(abi.encodeCall(IBorrowAccountFactory.setCanaryOperator, (canaryOperator, true)));
            d.dispenser = new MusdDispenser(d.deployer, net.musd, 25e18, 300e18);
            IERC20(net.musd).transfer(address(d.dispenser), DISPENSER_FUND);
        }

        vm.stopBroadcast();

        _check(net, cfg, d);
        _writeRegistry(path, registry, net, cfg, d);
    }

    function _testnetConfig(address deployer) internal view returns (CoreConfig memory c) {
        c.governor = deployer;
        // The keeper's SENTINEL key when given (decrease-only role); the deployer otherwise.
        c.sentinel = vm.envOr("SENTINEL", deployer);
        c.feeRecipient = deployer;
        c.capAdmin = deployer;
        c.globalBorrowCap = 5000e18;
        c.standard = IBorrowAccountFactory.Limits({positionCap: 0.01e18, ceilingBps: 6200});
        c.canary = IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 7675});
        c.m1Seed = vm.envOr("M1_SEED", TESTNET_M1_SEED);
    }

    /// @dev Mainnet roles come only from the environment; nothing defaults to the deployer.
    function _mainnetConfig(MezoNetwork memory net, address deployer, string memory registry)
        internal
        view
        returns (CoreConfig memory c)
    {
        c.mainnet = true;
        c.governor = vm.envAddress("GOVERNOR");
        c.sentinel = vm.envAddress("SENTINEL");
        c.feeRecipient = vm.envAddress("FEE_RECIPIENT");
        require(c.governor != address(0) && c.sentinel != address(0), "Deploy: GOVERNOR and SENTINEL required");
        require(
            c.governor != deployer && c.sentinel != deployer && c.feeRecipient != deployer,
            "Deploy: a mainnet role cannot be the deployer"
        );
        require(c.governor.code.length != 0, "Deploy: GOVERNOR must be the Safe (no code)");
        _requireFeeRouter(net, c.feeRecipient, registry);
        c.capAdmin = c.governor;
        c.globalBorrowCap = 2000e18;
        c.standard = IBorrowAccountFactory.Limits({positionCap: 0.02e18, ceilingBps: 7100});
        c.canary = IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 8575});
        c.m1Seed = vm.envOr("M1_SEED", uint256(0));
    }

    /// @dev `feeRecipient` must be a FeeRouter for this network (and the registry's `feeRouter`, when recorded).
    function _requireFeeRouter(MezoNetwork memory net, address feeRecipient, string memory registry) internal view {
        require(feeRecipient.code.length != 0, "Deploy: FEE_RECIPIENT has no code (deploy the FeeRouter first)");
        (bool ok, bytes memory ret) = feeRecipient.staticcall(abi.encodeCall(IFeeRouter.SMUSD, ()));
        require(ok && ret.length == 32, "Deploy: FEE_RECIPIENT is not a FeeRouter");
        IFeeRouter router = IFeeRouter(feeRecipient);
        require(
            router.MUSD() == net.musd && router.SMUSD() == net.smusd && router.VOTER() == net.poolsVoter,
            "Deploy: FEE_RECIPIENT is not this network's FeeRouter"
        );
        if (vm.keyExistsJson(registry, ".feeRouter")) {
            require(
                vm.parseJsonAddress(registry, ".feeRouter") == feeRecipient,
                "Deploy: FEE_RECIPIENT differs from the registry's feeRouter"
            );
        }
    }

    /// @dev Read-back of the roles and limits the factory was built with.
    function _check(MezoNetwork memory net, CoreConfig memory cfg, Deployed memory d) internal view {
        BorrowAccountFactory f = d.factory;
        require(f.governor() == cfg.governor && f.sentinel() == cfg.sentinel, "Deploy: roles");
        require(f.feeRecipient() == cfg.feeRecipient, "Deploy: fee recipient");
        require(f.globalBorrowCap() == cfg.globalBorrowCap, "Deploy: global cap");
        require(f.LLTV() == net.lltv && f.MORPHO() == net.morpho, "Deploy: market wiring");
        require(d.wsMusd.CAP_ADMIN() == cfg.capAdmin, "Deploy: wsMUSD cap admin");
        console2.log("oracle   ", address(d.oracle));
        console2.log("wsMUSD   ", address(d.wsMusd));
        console2.log("factory  ", address(f));
        console2.log("governor ", cfg.governor);
        console2.log("sentinel ", cfg.sentinel);
        console2.log("feeRecip.", cfg.feeRecipient);
        if (cfg.mainnet) console2.log("mainnet: the Safe grants canary operators and approves modules (timelocked)");
    }

    /// @dev Merges the core keys into the existing registry object; only written when broadcasting (or resuming).
    function _writeRegistry(
        string memory path,
        string memory registry,
        MezoNetwork memory net,
        CoreConfig memory cfg,
        Deployed memory d
    ) internal {
        string memory k = "registry";
        vm.serializeJson(k, registry);
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "deployer", d.deployer);
        if (cfg.mainnet) {
            vm.serializeString(
                k, "governanceNote", "Mainnet: governor is the Safe; sentinel and fee recipient set explicitly."
            );
            vm.serializeAddress(k, "governor", cfg.governor);
            vm.serializeAddress(k, "sentinel", cfg.sentinel);
            vm.serializeAddress(k, "feeRecipient", cfg.feeRecipient);
        } else {
            vm.serializeString(
                k,
                "governanceNote",
                "Testnet: the deployer EOA is governor; the sentinel is SENTINEL (default: the deployer)."
            );
            vm.serializeAddress(k, "dispenser", address(d.dispenser));
        }
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "wsMusd", address(d.wsMusd));
        vm.serializeAddress(k, "factory", address(d.factory));
        vm.serializeAddress(k, "collateral", d.factory.COLLATERAL());
        vm.serializeAddress(k, "borrowAccountImpl", d.factory.IMPLEMENTATION());
        vm.serializeAddress(k, "morpho", net.morpho);
        vm.serializeAddress(k, "irm", d.params.irm);
        vm.serializeUint(k, "lltv", d.params.lltv);
        string memory json = vm.serializeBytes32(k, "marketId", Id.unwrap(d.factory.MARKET_ID()));
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            vm.writeJson(json, path);
            console2.log("registry updated:", path);
        } else {
            console2.log("dry run, registry not written. Merged registry would be:");
            console2.log(json);
        }
    }
}
