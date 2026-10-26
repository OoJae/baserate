// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {BorrowAccountFactory} from "../src/account/BorrowAccountFactory.sol";
import {IBackstop} from "../src/interfaces/IBackstop.sol";
import {ILiquidationVenues} from "../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../src/liquidation/Backstop.sol";
import {FlashLiquidator} from "../src/liquidation/FlashLiquidator.sol";
import {MezoAddresses, MezoNetwork} from "./config/MezoAddresses.sol";

/// @notice Deploys the zero-capital liquidation layer for M1: the Backstop (bMUSD) and the FlashLiquidator, for the
/// network whose core stack is recorded in deployments/<chainId>.json, then merges their addresses into that registry
/// (every existing key is kept).
/// @dev The two contracts reference each other, so the liquidator's CREATE address is predicted from the deployer's
/// nonce and asserted after deployment. Everything is read from the registry and MezoAddresses; the only inputs are:
/// - `SENTINEL` (env): the backstop's deposit-pause role. Required on mainnet (the script reverts without it, since
///   `Backstop.SENTINEL` is immutable); optional elsewhere, defaulting to the deployer;
/// - `MAX_KEEPER_SALE` (env, optional): BTC per keeper sale, default 0.05 BTC.
/// `MAX_IMPACT_BPS` is the break-even impact `1 - 1/LIF` (419 bps at LLTV 0.86, 689 bps at 0.77). The deployer must
/// hold 1 MUSD: it seeds the backstop with 1 MUSD of dead shares, and the script reverts before deploying anything
/// without it. The seed is load-bearing, not hygiene: deposits are priced at gross (book + unvested), which a direct
/// MUSD transfer raises at once, so on an unseeded backstop a donation after a 1-wei first deposit would price every
/// later deposit (the ERC-4626 inflation attack); vesting does not help, since deposits pay the unvested gains too.
/// With 1e18 dead shares a donation is shared with them and moves a deposit by at most one share-wei of value.
/// No precompile is called, so a local simulation is faithful.
///
/// Simulate (no broadcast):
///   forge script script/DeployLiquidation.s.sol --rpc-url mezo_testnet \
///     --sender 0x787b4E3AaD7DA9217Ca222E4C6112B2ebC0da330
/// A simulation writes the merged registry to deployments/<chainId>.dryrun.json (git-ignored); only a broadcast run
/// (`--broadcast --account <keystore> --gas-estimate-multiplier 130`) rewrites deployments/<chainId>.json.
contract DeployLiquidation is Script {
    using MarketParamsLib for MarketParams;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant BACKSTOP_SEED = 1e18;
    uint256 internal constant DEFAULT_MAX_KEEPER_SALE = 0.05e18;

    struct Deployed {
        Backstop backstop;
        FlashLiquidator liquidator;
        address sentinel;
        uint256 maxImpactBps;
        uint256 maxKeeperSale;
    }

    function run() external returns (address backstop, address liquidator) {
        MezoNetwork memory net = MezoAddresses.forChain(block.chainid);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);

        MarketParams memory params = _checkedMarket(net, json);
        address wsMusd = vm.parseJsonAddress(json, ".wsMusd");
        ILiquidationVenues.VenueConfig memory venues = ILiquidationVenues.VenueConfig({
            clRouter: net.clSwapRouter, clQuoter: net.clQuoter, router: net.router, poolFactory: net.poolFactory
        });

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        _requireSeedFunds(params.loanToken, deployer);
        Deployed memory d;
        d.sentinel = _sentinel(deployer);
        d.maxKeeperSale = vm.envOr("MAX_KEEPER_SALE", DEFAULT_MAX_KEEPER_SALE);
        d.maxImpactBps = _breakEvenImpactBps(params.lltv);

        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.backstop = new Backstop(
            IBackstop.BackstopParams({
                musd: params.loanToken,
                wsMusd: wsMusd,
                oracle: params.oracle,
                lltv: params.lltv,
                liquidator: predicted,
                sentinel: d.sentinel,
                maxKeeperSale: d.maxKeeperSale,
                venues: venues
            })
        );
        d.liquidator = new FlashLiquidator(net.morpho, params, address(d.backstop), d.maxImpactBps, venues);
        require(address(d.liquidator) == predicted, "DeployLiquidation: liquidator address");

        _seed(d.backstop, params.loanToken);
        vm.stopBroadcast();

        _check(d, params, net);
        _writeRegistry(path, json, d);
        return (address(d.backstop), address(d.liquidator));
    }

    /// @dev The 1 MUSD dead-share seed is mandatory (see the contract notes): checked before anything is deployed.
    function _requireSeedFunds(address musd, address deployer) internal view {
        require(
            IERC20(musd).balanceOf(deployer) >= BACKSTOP_SEED,
            "DeployLiquidation: deployer must hold 1 MUSD to seed the backstop"
        );
    }

    /// @dev Deposits `BACKSTOP_SEED` from the broadcaster into `backstop` for dead shares.
    function _seed(Backstop backstop, address musd) internal {
        IERC20(musd).approve(address(backstop), BACKSTOP_SEED);
        backstop.deposit(BACKSTOP_SEED, DEAD);
    }

    /// @dev `Backstop.SENTINEL` is immutable, so mainnet takes no default: `SENTINEL` must be set explicitly.
    function _sentinel(address deployer) internal view returns (address) {
        bool set = vm.envExists("SENTINEL");
        return _pickSentinel(block.chainid, deployer, set, set ? vm.envAddress("SENTINEL") : address(0));
    }

    /// @dev The sentinel for `chainId` given the `SENTINEL` env (`set`, `fromEnv`): required and nonzero on mainnet,
    /// defaulting to the deployer elsewhere.
    function _pickSentinel(uint256 chainId, address deployer, bool set, address fromEnv)
        internal
        pure
        returns (address)
    {
        if (chainId == MezoAddresses.MAINNET_CHAIN_ID) {
            require(set, "DeployLiquidation: set SENTINEL on mainnet");
            require(fromEnv != address(0), "DeployLiquidation: SENTINEL is zero");
            return fromEnv;
        }
        return set ? fromEnv : deployer;
    }

    /// @dev The registry's market must be the factory's and exist on Morpho.
    function _checkedMarket(MezoNetwork memory net, string memory json) internal view returns (MarketParams memory p) {
        require(vm.parseJsonAddress(json, ".morpho") == net.morpho, "DeployLiquidation: morpho mismatch");
        p = BorrowAccountFactory(vm.parseJsonAddress(json, ".factory")).marketParams();
        require(Id.unwrap(p.id()) == vm.parseJsonBytes32(json, ".marketId"), "DeployLiquidation: market id");
        require(p.oracle == vm.parseJsonAddress(json, ".oracle"), "DeployLiquidation: oracle");
        require(p.collateralToken == vm.parseJsonAddress(json, ".collateral"), "DeployLiquidation: collateral");
        require(IMorpho(net.morpho).market(p.id()).lastUpdate != 0, "DeployLiquidation: market not created");
    }

    function _check(Deployed memory d, MarketParams memory params, MezoNetwork memory net) internal view {
        require(d.backstop.LIQUIDATOR() == address(d.liquidator), "DeployLiquidation: backstop wiring");
        require(d.liquidator.BACKSTOP() == address(d.backstop), "DeployLiquidation: liquidator wiring");
        require(Id.unwrap(d.liquidator.MARKET_ID()) == Id.unwrap(params.id()), "DeployLiquidation: market");
        require(d.liquidator.MAX_IMPACT_BPS() >= d.backstop.DISCOUNT() * 1e4 / 1e18, "DeployLiquidation: impact");
        require(d.liquidator.CL_ROUTER() == net.clSwapRouter, "DeployLiquidation: CL router");
        require(d.backstop.balanceOf(DEAD) == BACKSTOP_SEED, "DeployLiquidation: seed");
        console2.log("Backstop (bMUSD)", address(d.backstop));
        console2.log("FlashLiquidator", address(d.liquidator));
        console2.log("sentinel", d.sentinel);
        console2.log("liquidation incentive factor (WAD)", d.liquidator.LIQUIDATION_INCENTIVE_FACTOR());
        console2.log("max impact (bps)", d.maxImpactBps);
        console2.log("backstop discount (WAD)", d.backstop.DISCOUNT());
        console2.log("CL200 venue enabled", net.clSwapRouter != address(0));
        console2.log("backstop dead-share seed (MUSD wei)", BACKSTOP_SEED);
    }

    /// @dev Merges the new addresses into the existing registry, keeping every existing key.
    function _writeRegistry(string memory path, string memory json, Deployed memory d) internal {
        string memory k = "registry";
        vm.serializeJson(k, json);
        vm.serializeAddress(k, "backstop", address(d.backstop));
        vm.serializeAddress(k, "flashLiquidator", address(d.liquidator));
        vm.serializeAddress(k, "backstopSentinel", d.sentinel);
        vm.serializeUint(k, "liquidationDeployBlock", block.number);
        vm.serializeUint(k, "maxImpactBps", d.maxImpactBps);
        vm.serializeUint(k, "backstopDiscountWad", d.backstop.DISCOUNT());
        string memory out = vm.serializeUint(k, "maxKeeperSale", d.maxKeeperSale);

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        string memory target = live ? path : string.concat("deployments/", vm.toString(block.chainid), ".dryrun.json");
        vm.writeJson(out, target);
        console2.log(live ? "registry updated:" : "dry run, registry preview written to:", target);
    }

    /// @dev `1 - 1/LIF` in bps (rounded down), with Morpho's LIF = min(1.15, 1 / (1 - 0.3 (1 - lltv))).
    function _breakEvenImpactBps(uint256 lltv) internal pure returns (uint256) {
        uint256 lif = uint256(1e36) / (1e18 - 0.3e18 * (1e18 - lltv) / 1e18);
        if (lif > 1.15e18) lif = 1.15e18;
        return (lif - 1e18) * 1e4 / lif;
    }
}
