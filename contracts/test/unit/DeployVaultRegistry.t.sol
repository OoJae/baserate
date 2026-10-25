// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {DeployVault} from "../../script/DeployVault.s.sol";

/// @notice The vMUSD deploy script merges its keys into the existing registry without dropping any.
contract DeployVaultRegistryTest is Test, DeployVault {
    string internal constant TMP = "deployments/.registry-merge-test.json";

    function test_writeRegistry_mergesAndKeepsExistingKeys() public {
        string memory existing = vm.readFile("deployments/31611.json");
        vm.writeFile(TMP, existing);

        VaultConfig memory cfg;
        cfg.vaultFactory = VAULT_V2_FACTORY_TESTNET;
        cfg.liquidityCap = TESTNET_VAULT_CAP;
        cfg.marketCap = 5000e18;
        VaultDeployment memory d = VaultDeployment({
            vault: makeAddr("vault"),
            liquidityAdapter: makeAddr("liq"),
            marketAdapter: makeAddr("mm"),
            allocator: makeAddr("allocator")
        });
        _writeRegistry(TMP, existing, cfg, d);

        string memory merged = vm.readFile(TMP);
        vm.removeFile(TMP);

        // New keys.
        assertEq(vm.parseJsonAddress(merged, ".vMusd"), d.vault);
        assertEq(vm.parseJsonAddress(merged, ".wsMusdAdapter"), d.liquidityAdapter);
        assertEq(vm.parseJsonAddress(merged, ".m1Adapter"), d.marketAdapter);
        assertEq(vm.parseJsonAddress(merged, ".allocator"), d.allocator);
        assertEq(vm.parseJsonAddress(merged, ".vaultV2Factory"), VAULT_V2_FACTORY_TESTNET);
        assertEq(vm.parseJsonUint(merged, ".vMusdCap"), TESTNET_VAULT_CAP);
        assertEq(vm.parseJsonUint(merged, ".vMusdM1Cap"), 5000e18);
        assertTrue(vm.keyExistsJson(merged, ".vMusdRolesNote"));
        assertTrue(vm.keyExistsJson(merged, ".vMusdDeployBlock"));

        // Every existing key survives with its value.
        string[] memory keys = vm.parseJsonKeys(existing, "$");
        for (uint256 i; i < keys.length; ++i) {
            string memory path = string.concat(".", keys[i]);
            assertTrue(vm.keyExistsJson(merged, path), keys[i]);
            assertEq(vm.parseJson(merged, path), vm.parseJson(existing, path), keys[i]);
        }
        assertEq(vm.parseJsonUint(merged, ".lltv"), 0.77e18, "large integers stay exact");
        assertEq(vm.parseJsonBytes32(merged, ".marketId"), vm.parseJsonBytes32(existing, ".marketId"));
    }
}
