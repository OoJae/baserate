// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";
import {IVaultV2Factory} from "vault-v2/interfaces/IVaultV2Factory.sol";

import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../../src/interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";

/// @notice vMUSD (Morpho Vault V2) creation and configuration, shared by `DeployVault` (inside a broadcast) and the
/// Vault V2 test suites (inside a prank of the same account). Every call is made by `cfg.owner`, which is the
/// vault's owner, curator and, until the end of the setup, an allocator.
/// @dev Order (docs/design/contracts.md section 4, "vMUSD (Vault V2)"). Vault V2 starts with every timelock at 0, so
/// the curator batches `submit(x); x` through `multicall`:
/// 1. `VaultV2Factory.createVaultV2(owner, MUSD, salt)`; owner sets curator, sentinel, name and symbol.
/// 2. Deploy MorphoMarketV1AdapterV2 (vault-v2 tag 2026-08-13, from its artifact), WsMusdLiquidityAdapter and
///    BaserateAllocator; raise the market adapter's own timelocks (burnShares, setSkimRecipient, abdicate) to 48 h
///    before it is added.
/// 3. Curator: add both adapters; allocator role to BaserateAllocator (and temporarily the owner); absolute AND
///    relative caps (1e18) for all four ids (the default relative cap 0 blocks every allocation); force-deallocate
///    penalty on the market adapter (the liquidity adapter's stays 0).
/// 4. Allocator (owner): liquidity adapter = wsMUSD adapter, `maxRate` = 50%/yr. Fees stay 0.
/// 5. Seed `cfg.seed` MUSD with shares to 0x...dEaD.
/// 6. Curator: drop the owner's allocator role, then raise the timelocks of every curator function to 48 h, last.
abstract contract VaultSetup is CommonBase {
    struct VaultConfig {
        address vaultFactory;
        address owner;
        address musd;
        address wsMusd;
        address morpho;
        MarketParams market;
        uint256 marketCap;
        uint256 liquidityCap;
        uint256 seed;
        bytes32 salt;
    }

    struct VaultDeployment {
        address vault;
        address liquidityAdapter;
        address marketAdapter;
        address allocator;
    }

    string internal constant VAULT_NAME = "Baserate MUSD Vault";
    string internal constant VAULT_SYMBOL = "vMUSD";
    string internal constant MARKET_ADAPTER_ARTIFACT = "MorphoMarketV1AdapterV2.sol:MorphoMarketV1AdapterV2";
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// @dev 50%/yr in WAD per second, as on Mezo's USDC vault (vault-v2 MAX_MAX_RATE is 200%/yr).
    uint256 internal constant MAX_RATE = 15_854_895_991;
    /// @dev Timelock of every curator function once configured (docs/design/contracts.md section 6).
    uint256 internal constant TIMELOCK = 48 hours;
    /// @dev Relative cap of every id: 100%. The vault's default of 0 would block every allocation.
    uint256 internal constant RELATIVE_CAP = 1e18;
    /// @dev Force-deallocate penalty on the M1 adapter (0.5%, paid to the remaining lenders). Without it anyone could
    /// pull vMUSD's M1 supply to idle for free and starve borrowers; normal exits use `BaserateAllocator.withdraw`.
    uint256 internal constant MARKET_FORCE_DEALLOCATE_PENALTY = 0.005e18;

    error SetupCheckFailed(string what);

    function _deployVault(VaultConfig memory cfg) internal returns (VaultDeployment memory d) {
        // 1. Vault and owner settings.
        d.vault = IVaultV2Factory(cfg.vaultFactory).createVaultV2(cfg.owner, cfg.musd, cfg.salt);
        IVaultV2 vault = IVaultV2(d.vault);
        vault.setCurator(cfg.owner);
        vault.setIsSentinel(cfg.owner, true);
        vault.setName(VAULT_NAME);
        vault.setSymbol(VAULT_SYMBOL);

        // 2. Adapters and allocator.
        d.marketAdapter = _create(
            abi.encodePacked(vm.getCode(MARKET_ADAPTER_ARTIFACT), abi.encode(d.vault, cfg.morpho, cfg.market.irm))
        );
        d.liquidityAdapter = address(new WsMusdLiquidityAdapter(d.vault, cfg.wsMusd));
        d.allocator = address(new BaserateAllocator(d.vault, d.liquidityAdapter, d.marketAdapter, cfg.market));
        _lockMarketAdapter(IMorphoMarketV1AdapterV2Lite(d.marketAdapter));

        // 3. Curator configuration.
        vault.multicall(_curatorCalls(cfg, d));

        // 4. Allocator settings (the owner is a temporary allocator).
        vault.setLiquidityAdapterAndData(d.liquidityAdapter, "");
        vault.setMaxRate(MAX_RATE);

        // 5. Dead seed against share-price manipulation of an empty vault.
        if (cfg.seed != 0) {
            IERC20(cfg.musd).approve(d.vault, cfg.seed);
            vault.deposit(cfg.seed, DEAD);
        }

        // 6. Drop the owner's allocator role, then lock the curator functions.
        vault.multicall(_lockCalls(cfg.owner));

        _checkSetup(cfg, d);
    }

    /// @dev Cap id payloads, as returned by the adapters (`keccak256` of these are the ids).
    function _idData(VaultConfig memory cfg, VaultDeployment memory d) internal pure returns (bytes[4] memory ids) {
        ids[0] = abi.encode("this", d.marketAdapter);
        ids[1] = abi.encode("collateralToken", cfg.market.collateralToken);
        ids[2] = abi.encode("this/marketParams", d.marketAdapter, cfg.market);
        ids[3] = abi.encode("this", d.liquidityAdapter);
    }

    function _curatorCalls(VaultConfig memory cfg, VaultDeployment memory d) internal pure returns (bytes[] memory) {
        bytes[4] memory ids = _idData(cfg, d);
        bytes[] memory inner = new bytes[](13);
        uint256 n;
        inner[n++] = abi.encodeCall(IVaultV2.addAdapter, (d.marketAdapter));
        inner[n++] = abi.encodeCall(IVaultV2.addAdapter, (d.liquidityAdapter));
        inner[n++] = abi.encodeCall(IVaultV2.setIsAllocator, (d.allocator, true));
        inner[n++] = abi.encodeCall(IVaultV2.setIsAllocator, (cfg.owner, true));
        for (uint256 i; i < 4; ++i) {
            uint256 cap = i < 3 ? cfg.marketCap : cfg.liquidityCap;
            inner[n++] = abi.encodeCall(IVaultV2.increaseAbsoluteCap, (ids[i], cap));
            inner[n++] = abi.encodeCall(IVaultV2.increaseRelativeCap, (ids[i], RELATIVE_CAP));
        }
        inner[n++] =
            abi.encodeCall(IVaultV2.setForceDeallocatePenalty, (d.marketAdapter, MARKET_FORCE_DEALLOCATE_PENALTY));
        return _withSubmits(inner);
    }

    function _lockCalls(address owner) internal pure returns (bytes[] memory) {
        bytes4[16] memory selectors = _timelockedSelectors();
        bytes[] memory inner = new bytes[](1 + selectors.length);
        inner[0] = abi.encodeCall(IVaultV2.setIsAllocator, (owner, false));
        for (uint256 i; i < selectors.length; ++i) {
            inner[i + 1] = abi.encodeCall(IVaultV2.increaseTimelock, (selectors[i], TIMELOCK));
        }
        return _withSubmits(inner);
    }

    /// @dev Curator functions that get the 48 h timelock. `decreaseTimelock` is automatically timelocked by the
    /// duration it decreases; `increaseTimelock` stays at 0 because raising a timelock is always safe.
    function _timelockedSelectors() internal pure returns (bytes4[16] memory s) {
        s[0] = IVaultV2.addAdapter.selector;
        s[1] = IVaultV2.removeAdapter.selector;
        s[2] = IVaultV2.setIsAllocator.selector;
        s[3] = IVaultV2.setReceiveSharesGate.selector;
        s[4] = IVaultV2.setSendSharesGate.selector;
        s[5] = IVaultV2.setReceiveAssetsGate.selector;
        s[6] = IVaultV2.setSendAssetsGate.selector;
        s[7] = IVaultV2.setAdapterRegistry.selector;
        s[8] = IVaultV2.abdicate.selector;
        s[9] = IVaultV2.setPerformanceFee.selector;
        s[10] = IVaultV2.setManagementFee.selector;
        s[11] = IVaultV2.setPerformanceFeeRecipient.selector;
        s[12] = IVaultV2.setManagementFeeRecipient.selector;
        s[13] = IVaultV2.increaseAbsoluteCap.selector;
        s[14] = IVaultV2.increaseRelativeCap.selector;
        s[15] = IVaultV2.setForceDeallocatePenalty.selector;
    }

    /// @dev `[submit(c0), c0, submit(c1), c1, ...]`: executable in one multicall while the timelocks are still 0.
    function _withSubmits(bytes[] memory inner) internal pure returns (bytes[] memory calls) {
        calls = new bytes[](inner.length * 2);
        for (uint256 i; i < inner.length; ++i) {
            calls[2 * i] = abi.encodeCall(IVaultV2.submit, (inner[i]));
            calls[2 * i + 1] = inner[i];
        }
    }

    /// @dev Raise the market adapter's own curator timelocks before it holds funds (vault-v2: "Before adding the
    /// adapter to the vault, its timelocks must be properly set"). `burnShares` writes off vault assets.
    function _lockMarketAdapter(IMorphoMarketV1AdapterV2Lite adapter) internal {
        bytes4[3] memory selectors = [
            IMorphoMarketV1AdapterV2Lite.burnShares.selector,
            IMorphoMarketV1AdapterV2Lite.setSkimRecipient.selector,
            IMorphoMarketV1AdapterV2Lite.abdicate.selector
        ];
        for (uint256 i; i < selectors.length; ++i) {
            adapter.submit(abi.encodeCall(IMorphoMarketV1AdapterV2Lite.increaseTimelock, (selectors[i], TIMELOCK)));
            adapter.increaseTimelock(selectors[i], TIMELOCK);
        }
    }

    function _checkSetup(VaultConfig memory cfg, VaultDeployment memory d) internal view {
        IVaultV2 vault = IVaultV2(d.vault);
        bytes[4] memory ids = _idData(cfg, d);
        if (vault.asset() != cfg.musd) revert SetupCheckFailed("asset");
        if (vault.owner() != cfg.owner || vault.curator() != cfg.owner) revert SetupCheckFailed("roles");
        if (!vault.isAllocator(d.allocator) || vault.isAllocator(cfg.owner)) revert SetupCheckFailed("allocators");
        if (vault.liquidityAdapter() != d.liquidityAdapter) revert SetupCheckFailed("liquidity adapter");
        if (vault.maxRate() != MAX_RATE) revert SetupCheckFailed("maxRate");
        if (vault.performanceFee() != 0 || vault.managementFee() != 0) revert SetupCheckFailed("fees");
        if (!vault.isAdapter(d.marketAdapter) || !vault.isAdapter(d.liquidityAdapter)) {
            revert SetupCheckFailed("adapters");
        }
        for (uint256 i; i < 4; ++i) {
            bytes32 id = keccak256(ids[i]);
            uint256 cap = i < 3 ? cfg.marketCap : cfg.liquidityCap;
            if (vault.absoluteCap(id) != cap || vault.relativeCap(id) != RELATIVE_CAP) revert SetupCheckFailed("caps");
        }
        if (keccak256(ids[3]) != WsMusdLiquidityAdapter(d.liquidityAdapter).adapterId()) {
            revert SetupCheckFailed("liquidity id");
        }
        if (keccak256(ids[0]) != IMorphoMarketV1AdapterV2Lite(d.marketAdapter).adapterId()) {
            revert SetupCheckFailed("market id");
        }
        bytes4[16] memory selectors = _timelockedSelectors();
        for (uint256 i; i < selectors.length; ++i) {
            if (vault.timelock(selectors[i]) != TIMELOCK) revert SetupCheckFailed("timelocks");
        }
        if (cfg.seed != 0 && vault.balanceOf(DEAD) == 0) revert SetupCheckFailed("seed");
    }

    /// @dev CREATE from this contract (a broadcastable deployment inside `forge script`).
    function _create(bytes memory initCode) internal returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0)) revert SetupCheckFailed("create");
    }
}
