// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IMorpho, Id, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../../src/interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";
import {VaultSetup} from "../../script/base/VaultSetup.sol";
import {MockERC20} from "../utils/MockERC20.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";

/// @notice Local vMUSD stack for the adapter, allocator and invariant suites: MockMUSD + SMUSDMock + wsMUSD (250k cap,
/// 1 MUSD dead seed), real Morpho Blue + AdaptiveCurveIrm with an M1-like market (LLTV 0.77, mock collateral and
/// oracle), 3,000 MUSD of team supply in M1, a real VaultV2 from a local VaultV2Factory, configured by the same
/// `VaultSetup` code the deploy script runs (100 MUSD dead seed, timelocks raised).
abstract contract VaultBase is Test, VaultSetup {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant WS_CAP = 250_000e18;
    uint256 internal constant TEAM_SUPPLY = 3000e18;
    uint256 internal constant MARKET_CAP = 20_000e18;
    uint256 internal constant VAULT_CAP = 250_000e18;
    uint256 internal constant VAULT_SEED = 100e18;
    uint256 internal constant LLTV = 0.77e18;
    uint256 internal constant BTC_PRICE = 80_000e36;

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    WsMUSD internal ws;
    MockERC20 internal collateral;
    MockMorphoOracle internal oracle;
    IMorpho internal morpho;
    address internal irm;
    MarketParams internal params;
    Id internal marketId;
    address internal vaultFactory;

    IVaultV2 internal vault;
    WsMusdLiquidityAdapter internal liq;
    IMorphoMarketV1AdapterV2Lite internal mm;
    BaserateAllocator internal allocator;
    VaultConfig internal cfg;

    address internal curator = makeAddr("curator");
    address internal capAdmin = makeAddr("capAdmin");
    address internal morphoOwner = makeAddr("morphoOwner");
    address internal team = makeAddr("team");
    address internal lender = makeAddr("lender");
    address internal lender2 = makeAddr("lender2");
    address internal borrower = makeAddr("borrower");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.warp(1_792_942_983);
        vm.roll(16_363_000);

        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        ws = new WsMUSD(address(musd), address(smusd), capAdmin, WS_CAP);
        _fundApprove(team, 1e18, address(ws));
        vm.prank(team);
        ws.deposit(1e18, DEAD);

        morpho = IMorpho(deployCode("Morpho.sol:Morpho", abi.encode(morphoOwner)));
        irm = deployCode("AdaptiveCurveIrm.sol:AdaptiveCurveIrm", abi.encode(address(morpho)));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        vm.stopPrank();

        collateral = new MockERC20("Collateral BTC", "cBTC");
        oracle = new MockMorphoOracle(BTC_PRICE);
        params = MarketParams({
            loanToken: address(musd),
            collateralToken: address(collateral),
            oracle: address(oracle),
            irm: irm,
            lltv: LLTV
        });
        marketId = params.id();
        morpho.createMarket(params);

        _fundApprove(team, TEAM_SUPPLY, address(morpho));
        vm.prank(team);
        morpho.supply(params, TEAM_SUPPLY, 0, team, "");

        vaultFactory = deployCode("VaultV2Factory.sol:VaultV2Factory");
        cfg = VaultConfig({
            vaultFactory: vaultFactory,
            owner: curator,
            musd: address(musd),
            wsMusd: address(ws),
            morpho: address(morpho),
            market: params,
            marketCap: MARKET_CAP,
            liquidityCap: VAULT_CAP,
            seed: VAULT_SEED,
            salt: keccak256("baserate.vMUSD.test")
        });
        musd.mint(curator, VAULT_SEED);
        vm.startPrank(curator);
        VaultDeployment memory d = _deployVault(cfg);
        vm.stopPrank();

        vault = IVaultV2(d.vault);
        liq = WsMusdLiquidityAdapter(d.liquidityAdapter);
        mm = IMorphoMarketV1AdapterV2Lite(d.marketAdapter);
        allocator = BaserateAllocator(d.allocator);

        vm.label(address(musd), "MUSD");
        vm.label(address(smusd), "sMUSD");
        vm.label(address(ws), "wsMUSD");
        vm.label(address(morpho), "Morpho");
        vm.label(irm, "AdaptiveCurveIrm");
        vm.label(d.vault, "vMUSD");
        vm.label(d.liquidityAdapter, "WsMusdLiquidityAdapter");
        vm.label(d.marketAdapter, "M1Adapter");
        vm.label(d.allocator, "BaserateAllocator");
    }

    // ---------------------------------------------------------------- helpers

    function _fundApprove(address who, uint256 amount, address spender) internal {
        musd.mint(who, amount);
        vm.prank(who);
        musd.approve(spender, type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _fundApprove(who, amount, address(vault));
        vm.prank(who);
        shares = vault.deposit(amount, who);
    }

    /// @dev Borrows `amount` MUSD from M1 directly, against ample mock collateral.
    function _borrow(address who, uint256 amount) internal {
        collateral.mint(who, 1e18);
        vm.startPrank(who);
        collateral.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(params, 1e18, who, "");
        morpho.borrow(params, amount, 0, who, who);
        vm.stopPrank();
    }

    /// @dev Fills wsMUSD to its deposit cap from an outside depositor.
    function _fillWsMusd() internal {
        uint256 room = ws.maxDeposit(address(0));
        if (room == 0) return;
        _fundApprove(stranger, room, address(ws));
        vm.prank(stranger);
        ws.deposit(room, stranger);
        assertEq(ws.maxDeposit(address(0)), 0, "wsMUSD full");
    }

    /// @dev Donates MUSD to wsMUSD; `sync()` absorbs it as yield vesting over 3 days (a steady share-price rise).
    function _wsYield(uint256 amount) internal {
        musd.mint(address(ws), amount);
        ws.sync();
    }

    /// @dev Advances time in hourly steps, recording an allocator checkpoint at every step.
    function _advanceWithCheckpoints(uint256 duration) internal {
        uint256 now_ = vm.getBlockTimestamp();
        uint256 end = now_ + duration;
        while (now_ < end) {
            uint256 step = end - now_ < 1 hours ? end - now_ : 1 hours;
            now_ += step;
            vm.warp(now_);
            vm.roll(vm.getBlockNumber() + step / 4);
            allocator.checkpoint();
        }
    }

    function _market() internal view returns (uint256 supply, uint256 borrow) {
        (supply,, borrow,) = morpho.expectedMarketBalances(params);
    }

    function _m1Liquidity() internal view returns (uint256) {
        (uint256 supply, uint256 borrow) = _market();
        return supply - borrow;
    }

    function _vaultM1() internal view returns (uint256) {
        return mm.expectedSupplyAssets(Id.unwrap(marketId));
    }

    function _bufferTarget() internal view returns (uint256) {
        (uint256 supply,) = _market();
        uint256 pct = supply * 1500 / 10_000;
        return pct > 2000e18 ? pct : 2000e18;
    }

    function _marketData() internal view returns (bytes memory) {
        return abi.encode(params);
    }

    function _ids() internal view returns (bytes32[4] memory ids) {
        bytes[4] memory data = _idData(cfg, _deployment());
        for (uint256 i; i < 4; ++i) {
            ids[i] = keccak256(data[i]);
        }
    }

    function _deployment() internal view returns (VaultDeployment memory d) {
        d = VaultDeployment({
            vault: address(vault),
            liquidityAdapter: address(liq),
            marketAdapter: address(mm),
            allocator: address(allocator)
        });
    }

    /// @dev Idle MUSD in the vault plus every adapter's `realAssets()`.
    function _realTotal() internal view returns (uint256) {
        return musd.balanceOf(address(vault)) + liq.realAssets() + IRealAssets(address(mm)).realAssets();
    }

    function _marketState() internal view returns (Market memory) {
        return morpho.market(marketId);
    }
}

interface IRealAssets {
    function realAssets() external view returns (uint256);
}
