// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {FeeRouter} from "../src/fees/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IRiskLens} from "../src/interfaces/IRiskLens.sol";
import {RiskLens} from "../src/lens/RiskLens.sol";
import {MezoAddresses, MezoNetwork} from "./config/MezoAddresses.sol";

/// @title DeployPeriphery
/// @notice Deploys the Wave 2 periphery for the network in `deployments/<chainId>.json`: the FeeRouter (40% sMUSD
/// yield / 40% MUSD bribes on the BTC/MUSD pool gauges / 20% treasury) and the RiskLens, then merges `feeRouter`,
/// `feeRouterTreasury` and `riskLens` into that registry, keeping every existing key.
/// @dev Simulate (no broadcast; the registry is only written when broadcasting):
///   forge script script/DeployPeriphery.s.sol --rpc-url mezo_testnet --sender 0x787b4E3AaD7DA9217Ca222E4C6112B2ebC0da330
/// Broadcast (testnet; treasury = the deployer):
///   forge script script/DeployPeriphery.s.sol --rpc-url mezo_testnet --broadcast --account <keystore> \
///     --gas-estimate-multiplier 130
/// Wiring per network (from `MezoAddresses`):
/// - Testnet: one bribe target, the MUSD/BTC vAMM gauge 0x72D8...Cd2c -> bribe 0x75b6...0ee1 on PoolsVoter
///   0x263F...0D. RiskLens without QuoterV2 and without a MUSD price pool (neither exists on testnet).
/// - Mainnet: CL200 gauge 0x21d7...209E -> bribe 0x80cC...0e1a and vAMM gauge 0x8Be2...9AaF -> bribe 0x94A9...E305 on
///   PoolsVoter 0x4823...1f03; `TREASURY` env var required (the Safe). RiskLens with QuoterV2 0x4E56...dC7 on CL200
///   and the CL10 mUSDC/MUSD pool 0xCC37...aC1a for the MUSD TWAP. Per docs/design/contracts.md section 8, deploy the
///   FeeRouter before the core stack so the mainnet factory takes it as its constructor `feeRecipient` (no timelock):
///   with no `factory` in the registry this script deploys only the FeeRouter; run it again after the core deploy
///   with `FEE_ROUTER=<address>` to add the RiskLens.
/// Optional env: `FEE_ROUTER` / `RISK_LENS` reuse an existing deployment instead of deploying a new one.
///
/// Pointing the existing testnet factory's origination fee at the FeeRouter is a timelocked governance action
/// (`setFeeRecipient` is always timelocked, 48 h). With FACTORY=0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE (testnet
/// registry; the governor is the deployer EOA) and FEE_ROUTER from the updated registry:
///   DATA=$(cast calldata "setFeeRecipient(address)" $FEE_ROUTER)
///   # 1. Governor queues the exact calldata; executableAt = now + 172800.
///   cast send $FACTORY "submit(bytes)" $DATA --rpc-url mezo_testnet --account <governor-keystore>
///   cast call $FACTORY "executableAt(bytes)(uint256)" $DATA --rpc-url mezo_testnet
///   # 2. After executableAt, anyone executes it with the same calldata.
///   cast send $FACTORY "setFeeRecipient(address)" $FEE_ROUTER --rpc-url mezo_testnet --account <any-keystore>
///   # 3. Check.
///   cast call $FACTORY "feeRecipient()(address)" --rpc-url mezo_testnet
///   # To cancel while pending (governor or sentinel):
///   cast send $FACTORY "revoke(bytes)" $DATA --rpc-url mezo_testnet --account <governor-keystore>
/// Until step 2, origination fees keep going to the current `feeRecipient` (the deployer on testnet).
///
/// Live read-only checks with the real precompiles (no deployment needed): RiskLens's runtime code can be placed at an
/// arbitrary address with `cast call --override-code` (both Mezo RPCs honour eth_call state overrides); this is how the
/// CL200 QuoterV2 path, which a local fork cannot execute without a BTC-precompile mock, was verified live.
contract DeployPeriphery is Script {
    struct Deployed {
        address feeRouter;
        address riskLens;
        address treasury;
    }

    function run() external returns (Deployed memory d) {
        MezoNetwork memory net = MezoAddresses.forChain(block.chainid);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory registry = vm.exists(path) ? vm.readFile(path) : "{}";
        address factory =
            vm.keyExistsJson(registry, ".factory") ? vm.parseJsonAddress(registry, ".factory") : address(0);
        address wsMusd = vm.keyExistsJson(registry, ".wsMusd") ? vm.parseJsonAddress(registry, ".wsMusd") : address(0);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        d.treasury = block.chainid == MezoAddresses.TESTNET_CHAIN_ID ? deployer : vm.envAddress("TREASURY");

        d.feeRouter = vm.envOr("FEE_ROUTER", address(0));
        if (d.feeRouter == address(0)) {
            d.feeRouter = address(new FeeRouter(net.musd, net.smusd, net.poolsVoter, d.treasury, _bribeTargets(net)));
        }

        d.riskLens = vm.envOr("RISK_LENS", address(0));
        if (d.riskLens == address(0) && factory != address(0)) {
            d.riskLens = address(
                new RiskLens(
                    IRiskLens.LensConfig({
                        factory: factory,
                        wsMusd: wsMusd,
                        troveManager: net.troveManager,
                        sortedTroves: net.sortedTroves,
                        router: net.router,
                        poolFactory: net.poolFactory,
                        quoter: net.clQuoter,
                        clTickSpacing: net.clBtcMusdTickSpacing,
                        musdPricePool: net.clMusdUsdPool
                    })
                )
            );
        }
        vm.stopBroadcast();

        _check(net, d, factory);
        _writeRegistry(path, registry, d);
    }

    /// @dev The BTC/MUSD pool gauges for this network (one on testnet, two on mainnet).
    function _bribeTargets(MezoNetwork memory net) internal pure returns (IFeeRouter.BribeTarget[] memory t) {
        uint256 n = net.gauge1 == address(0) ? 1 : 2;
        t = new IFeeRouter.BribeTarget[](n);
        t[0] = IFeeRouter.BribeTarget({gauge: net.gauge0, bribe: net.bribe0});
        if (n == 2) t[1] = IFeeRouter.BribeTarget({gauge: net.gauge1, bribe: net.bribe1});
    }

    /// @dev Post-deploy assertions that make no precompile calls (a local simulation cannot execute Mezo's
    /// precompiles, so `snapshot()` is exercised by the fork suites and by live `cast call`s instead).
    function _check(MezoNetwork memory net, Deployed memory d, address factory) internal view {
        FeeRouter router = FeeRouter(d.feeRouter);
        require(router.MUSD() == net.musd && router.SMUSD() == net.smusd, "router tokens");
        require(router.VOTER() == net.poolsVoter && router.TREASURY() == d.treasury, "router wiring");
        IFeeRouter.Plan memory plan = router.previewDistribute();
        for (uint256 i; i < plan.gaugeAlive.length; ++i) {
            require(plan.gaugeAlive[i], "gauge not alive");
        }
        console2.log("FeeRouter", d.feeRouter);
        console2.log("  treasury", d.treasury);
        console2.log("  gauges", router.GAUGE_COUNT());
        console2.log("  MUSD balance to distribute", plan.total);
        console2.log("  bribe epoch start", plan.epochStart);

        if (d.riskLens == address(0)) {
            console2.log("RiskLens skipped: no factory in the registry yet");
            return;
        }
        RiskLens lens = RiskLens(d.riskLens);
        require(lens.FACTORY() == factory, "lens factory");
        IRiskLens.MarketState memory m = lens.marketState();
        require(m.created, "M1 not created");
        IRiskLens.FactoryState memory f = lens.factoryState();
        IRiskLens.TroveQueue memory q = lens.troveQueue(3, 0);
        console2.log("RiskLens", d.riskLens);
        console2.log("  M1 supply", m.totalSupplyAssets);
        console2.log("  M1 borrow", m.totalBorrowAssets);
        console2.log("  M1 borrow APR (WAD)", m.borrowApr);
        console2.log("  global borrow cap", f.globalBorrowCap);
        console2.log("  vAMM 0.001 BTC -> MUSD", lens.vammQuote(0.001e18));
        console2.log("  troves in queue", q.size);
    }

    /// @dev Merges the new addresses into the existing registry object; only written when broadcasting.
    function _writeRegistry(string memory path, string memory registry, Deployed memory d) internal {
        string memory k = "periphery";
        vm.serializeJson(k, registry);
        vm.serializeAddress(k, "feeRouterTreasury", d.treasury);
        if (d.riskLens != address(0)) vm.serializeAddress(k, "riskLens", d.riskLens);
        string memory json = vm.serializeAddress(k, "feeRouter", d.feeRouter);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(json, path);
            console2.log("registry updated:", path);
        } else {
            console2.log("dry run, registry not written. Merged registry would be:");
            console2.log(json);
        }
    }
}
