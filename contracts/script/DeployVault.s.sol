// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {IBorrowAccountFactory} from "../src/interfaces/IBorrowAccountFactory.sol";
import {IWsMUSD} from "../src/interfaces/IWsMUSD.sol";
import {MezoAddresses, MezoNetwork} from "./config/MezoAddresses.sol";
import {VaultSetup} from "./base/VaultSetup.sol";

/// @notice Deploys vMUSD, Baserate's MUSD lending vault, on top of the network's existing Baserate deployment
/// (deployments/<chainId>.json): a Morpho Vault V2 created through Mezo's own VaultV2Factory, the wsMUSD liquidity
/// adapter, a MorphoMarketV1AdapterV2 for the M1 market and the permissionless BaserateAllocator. Configuration
/// follows `VaultSetup` (timelocks raised last) and the new addresses are merged into the registry.
/// @dev Simulate:  forge script script/DeployVault.s.sol --rpc-url mezo_testnet --sender <deployer>
/// Broadcast:      forge script script/DeployVault.s.sol --rpc-url mezo_testnet --broadcast --account <keystore>
///                 --sender <deployer> --gas-estimate-multiplier 130
/// Mezo charges more gas on-chain than local simulation for sMUSD calls (the seed deposit reaches sMUSD through
/// wsMUSD), so broadcast with `--gas-estimate-multiplier 130`; every transaction stays under the 10M block gas limit.
/// The deployer needs `SEED` MUSD. On testnet the deployer stays owner, curator and sentinel (labelled in the
/// registry). On mainnet set `VAULT_SAFE`: the Safe becomes curator, sentinel and owner at the end.
/// The registry is only written by `--broadcast`/`--resume`; a dry run prints the keys it would add.
contract DeployVault is Script, VaultSetup {
    using MarketParamsLib for MarketParams;

    /// @dev Mezo's VaultV2Factory (bytecode identical to vault-v2 tag 2026-08-13 built with its own settings).
    address internal constant VAULT_V2_FACTORY_TESTNET = 0x25eB93DA2F1b5D8f5D60c7563B8009a0330eb239;
    address internal constant VAULT_V2_FACTORY_MAINNET = 0xA64f3dA6196dab93392b6f649F662Fc7Da7540A6;

    uint256 internal constant SEED = 100e18;
    /// @dev Deposit cap of vMUSD, enforced as the wsMUSD adapter id's absolute cap (every deposit allocates there).
    uint256 internal constant TESTNET_VAULT_CAP = 250_000e18;
    uint256 internal constant MAINNET_VAULT_CAP = 3000e18;
    bytes32 internal constant SALT = keccak256("baserate.vMUSD.v1");

    function run() external returns (VaultDeployment memory d) {
        MezoNetwork memory net = MezoAddresses.forChain(block.chainid);
        string memory path = _registryPath();
        string memory registry = vm.readFile(path);
        VaultConfig memory cfg = _config(net, registry);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        cfg.owner = deployer;
        if (IERC20(cfg.musd).balanceOf(deployer) < cfg.seed) revert SetupCheckFailed("deployer MUSD for the seed");
        d = _deployVault(cfg);
        if (block.chainid == MezoAddresses.MAINNET_CHAIN_ID) _handOver(d.vault, deployer, vm.envAddress("VAULT_SAFE"));
        vm.stopBroadcast();

        _logDeployment(cfg, d);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _writeRegistry(path, registry, cfg, d);
        } else {
            console2.log("dry run: registry not written (", path, ")");
        }
    }

    /// @dev Network wiring from the registry, cross-checked against MezoAddresses and Morpho.
    function _config(MezoNetwork memory net, string memory registry) internal view returns (VaultConfig memory cfg) {
        MarketParams memory m1 = MarketParams({
            loanToken: net.musd,
            collateralToken: vm.parseJsonAddress(registry, ".collateral"),
            oracle: vm.parseJsonAddress(registry, ".oracle"),
            irm: vm.parseJsonAddress(registry, ".irm"),
            lltv: vm.parseJsonUint(registry, ".lltv")
        });
        address morpho = vm.parseJsonAddress(registry, ".morpho");
        address wsMusd = vm.parseJsonAddress(registry, ".wsMusd");
        address accountFactory = vm.parseJsonAddress(registry, ".factory");

        if (morpho != net.morpho || m1.irm != net.irm || m1.lltv != net.lltv) revert SetupCheckFailed("registry net");
        if (Id.unwrap(m1.id()) != vm.parseJsonBytes32(registry, ".marketId")) revert SetupCheckFailed("market id");
        if (IMorpho(morpho).market(m1.id()).lastUpdate == 0) revert SetupCheckFailed("M1 not created");
        if (IWsMUSD(wsMusd).asset() != net.musd) revert SetupCheckFailed("wsMUSD asset");

        bool mainnet = block.chainid == MezoAddresses.MAINNET_CHAIN_ID;
        cfg.vaultFactory = mainnet ? VAULT_V2_FACTORY_MAINNET : VAULT_V2_FACTORY_TESTNET;
        cfg.musd = net.musd;
        cfg.wsMusd = wsMusd;
        cfg.morpho = morpho;
        cfg.market = m1;
        // M1 ids are capped at the factory's global borrow cap: vMUSD never supplies more than M1 can lend out.
        cfg.marketCap = IBorrowAccountFactory(accountFactory).globalBorrowCap();
        cfg.liquidityCap = mainnet ? MAINNET_VAULT_CAP : TESTNET_VAULT_CAP;
        cfg.seed = SEED;
        cfg.salt = SALT;
        if (cfg.liquidityCap < cfg.marketCap) revert SetupCheckFailed("liquidity cap below market cap");
    }

    /// @dev Mainnet: the Safe takes the curator, sentinel and owner roles; the deployer keeps none.
    function _handOver(address vault, address deployer, address safe) internal {
        IVaultV2(vault).setIsSentinel(safe, true);
        IVaultV2(vault).setIsSentinel(deployer, false);
        IVaultV2(vault).setCurator(safe);
        IVaultV2(vault).setOwner(safe);
    }

    function _registryPath() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".json");
    }

    /// @dev Merges the vMUSD keys into the existing registry object; every existing key is kept.
    function _writeRegistry(
        string memory path,
        string memory registry,
        VaultConfig memory cfg,
        VaultDeployment memory d
    ) internal {
        string memory k = "vaultRegistry";
        vm.serializeJson(k, registry);
        vm.serializeAddress(k, "vMusd", d.vault);
        vm.serializeAddress(k, "vaultV2Factory", cfg.vaultFactory);
        vm.serializeAddress(k, "wsMusdAdapter", d.liquidityAdapter);
        vm.serializeAddress(k, "m1Adapter", d.marketAdapter);
        vm.serializeAddress(k, "allocator", d.allocator);
        vm.serializeUint(k, "vMusdCap", cfg.liquidityCap);
        vm.serializeUint(k, "vMusdM1Cap", cfg.marketCap);
        vm.serializeString(
            k,
            "vMusdRolesNote",
            block.chainid == MezoAddresses.MAINNET_CHAIN_ID
                ? "vMUSD owner, curator and sentinel: VAULT_SAFE. Only allocator: BaserateAllocator. Timelocks 48h."
                : "Testnet: the deployer EOA is vMUSD owner, curator and sentinel. Only allocator: BaserateAllocator. Timelocks 48h."
        );
        string memory json = vm.serializeUint(k, "vMusdDeployBlock", block.number);
        vm.writeJson(json, path);
        console2.log("registry updated:", path);
    }

    function _logDeployment(VaultConfig memory cfg, VaultDeployment memory d) internal pure {
        console2.log("vMUSD (VaultV2)       ", d.vault);
        console2.log("WsMusdLiquidityAdapter", d.liquidityAdapter);
        console2.log("M1 adapter (MMV1AV2)  ", d.marketAdapter);
        console2.log("BaserateAllocator     ", d.allocator);
        console2.log("vault cap (wsMUSD id) ", cfg.liquidityCap);
        console2.log("M1 caps (3 ids)       ", cfg.marketCap);
    }
}

