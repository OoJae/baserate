// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";
import {IVaultV2Factory} from "vault-v2/interfaces/IVaultV2Factory.sol";

import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../../src/interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {VaultSetup} from "../../script/base/VaultSetup.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice vMUSD end to end on Mezo testnet and mainnet forks: a real VaultV2 created through Mezo's own
/// VaultV2Factory and configured by `VaultSetup` (the deploy script's code), the real Morpho/AdaptiveCurveIrm, real
/// MUSD and sMUSD, and a fresh Baserate stack (oracle with Skip mocked at the fork price, wsMUSD, account factory, M1)
/// built like EndToEndFork. Borrowers borrow through BorrowAccount clones with native BTC.
contract VaultForkTest is MezoFork, VaultSetup {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 internal constant TEAM_M1_SUPPLY = 3000e18;
    uint256 internal constant GLOBAL_BORROW_CAP = 20_000e18;
    uint256 internal constant VAULT_CAP = 250_000e18;
    uint256 internal constant WS_CAP = 250_000e18;

    address internal team = makeAddr("team");
    address internal lender = makeAddr("lender");
    address internal stranger = makeAddr("stranger");

    BtcMusdOracle internal oracle;
    WsMUSD internal wsMusd;
    BorrowAccountFactory internal accounts;
    IMorpho internal morpho;
    IERC20 internal musd;
    MarketParams internal params;
    VaultConfig internal cfg;

    IVaultV2 internal vault;
    WsMusdLiquidityAdapter internal liq;
    IMorphoMarketV1AdapterV2Lite internal mm;
    BaserateAllocator internal allocator;
    address internal vaultFactory;

    function _setUpNet(Net which) internal {
        _fork(which);
        morpho = IMorpho(net.morpho);
        musd = IERC20(net.musd);
        vaultFactory = which == Net.TESTNET
            ? 0x25eB93DA2F1b5D8f5D60c7563B8009a0330eb239
            : 0xA64f3dA6196dab93392b6f649F662Fc7Da7540A6;

        oracle = new BtcMusdOracle(net.pyth, MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);
        wsMusd = new WsMUSD(net.musd, net.smusd, team, WS_CAP);
        accounts = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: net.morpho,
                musd: net.musd,
                oracle: address(oracle),
                irm: net.irm,
                lltv: net.lltv,
                bos: net.borrowerOperationsSignatures,
                collSurplusPool: net.collSurplusPool,
                governor: team,
                sentinel: team,
                feeRecipient: team,
                globalBorrowCap: GLOBAL_BORROW_CAP,
                standard: IBorrowAccountFactory.Limits({positionCap: 1e18, ceilingBps: 6200}),
                canary: IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 7675})
            })
        );
        params = accounts.marketParams();
        morpho.createMarket(params);

        deal(net.musd, team, 10_000e18);
        vm.startPrank(team);
        musd.approve(address(wsMusd), 1e18);
        wsMusd.deposit(1e18, DEAD);
        musd.approve(net.morpho, TEAM_M1_SUPPLY);
        morpho.supply(params, TEAM_M1_SUPPLY, 0, team, "");
        vm.stopPrank();

        cfg = VaultConfig({
            vaultFactory: vaultFactory,
            owner: team,
            musd: net.musd,
            wsMusd: address(wsMusd),
            morpho: net.morpho,
            market: params,
            marketCap: accounts.globalBorrowCap(),
            liquidityCap: VAULT_CAP,
            seed: 100e18,
            salt: keccak256("baserate.vMUSD.fork")
        });
        vm.startPrank(team);
        VaultDeployment memory d = _deployVault(cfg);
        vm.stopPrank();
        vault = IVaultV2(d.vault);
        liq = WsMusdLiquidityAdapter(d.liquidityAdapter);
        mm = IMorphoMarketV1AdapterV2Lite(d.marketAdapter);
        allocator = BaserateAllocator(d.allocator);
        vm.label(d.vault, "vMUSD");
        vm.label(d.liquidityAdapter, "WsMusdLiquidityAdapter");
        vm.label(d.marketAdapter, "M1Adapter");
        vm.label(d.allocator, "BaserateAllocator");
    }

    // ---------------------------------------------------------------- helpers

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        deal(net.musd, who, musd.balanceOf(who) + amount);
        vm.startPrank(who);
        musd.approve(address(vault), amount);
        shares = vault.deposit(amount, who);
        vm.stopPrank();
    }

    /// @dev Borrows through a BorrowAccount clone with 0.1 BTC of native collateral (the Skip mock prices it).
    function _borrow(string memory name, uint256 amount) internal returns (address who) {
        who = makeAddr(name);
        vm.deal(who, 0.1 ether);
        skipOracle.setAnswer(skipOracle.answer());
        vm.prank(who);
        accounts.openAndBorrow{value: 0.1 ether}(amount, 6000);
        assertEq(musd.balanceOf(who), amount, "borrowed");
    }

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

    /// @dev The next block (a later timestamp), so M1 counts as untouched in it.
    function _nextBlock() internal {
        skip(4);
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = block.timestamp - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (365 days * 1e18);
        vm.mockCall(address(wsMusd), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }

    function _m1Liquidity() internal view returns (uint256) {
        (uint256 supply,, uint256 borrow,) = morpho.expectedMarketBalances(params);
        return supply - borrow;
    }

    function _bufferTarget() internal view returns (uint256) {
        (uint256 supply,,,) = morpho.expectedMarketBalances(params);
        uint256 pct = supply * 1500 / 10_000;
        return pct > 2000e18 ? pct : 2000e18;
    }

    function _vaultM1() internal view returns (uint256) {
        return mm.expectedSupplyAssets(Id.unwrap(params.id()));
    }

    function _realTotal() internal view returns (uint256) {
        return musd.balanceOf(address(vault)) + liq.realAssets() + IAdapterLike(address(mm)).realAssets();
    }

    /// @dev Lender liquidity, a borrower using ~900 of M1's 3,000, a day of checkpoints, then three moves into M1.
    function _buildM1Position() internal {
        _deposit(lender, 10_000e18);
        _borrow("borrower", 900e18); // M1 borrow 900.9 with the 10 bps fee: buffer intact
        _advanceWithCheckpoints(1 days);
        for (uint256 i; i < 3; ++i) {
            (IBaserateAllocator.Action action,) = allocator.rebalance();
            assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_MARKET), "M1 pays, wsMUSD is flat");
            skip(1 hours);
        }
        assertApproxEqRel(_vaultM1(), 3000e18, 0.001e18);
    }

    // ---------------------------------------------------------------- scenarios

    function _configuredByRealFactory() internal view {
        assertTrue(IVaultV2Factory(vaultFactory).isVaultV2(address(vault)), "created by Mezo's VaultV2Factory");
        assertEq(IVaultV2Factory(vaultFactory).vaultV2(team, net.musd, cfg.salt), address(vault));
        assertEq(vault.name(), "Baserate MUSD Vault");
        assertEq(vault.symbol(), "vMUSD");
        assertEq(vault.asset(), net.musd);
        assertEq(vault.maxRate(), 15_854_895_991);
        assertEq(vault.performanceFee(), 0);
        assertEq(vault.managementFee(), 0);
        assertEq(vault.liquidityAdapter(), address(liq));
        assertTrue(vault.isAllocator(address(allocator)));
        assertFalse(vault.isAllocator(team), "deployer allocator role dropped");
        assertEq(vault.timelock(IVaultV2.increaseAbsoluteCap.selector), 48 hours);
        assertEq(vault.timelock(IVaultV2.addAdapter.selector), 48 hours);
        assertEq(vault.forceDeallocatePenalty(address(mm)), 0.005e18);
        assertEq(vault.forceDeallocatePenalty(address(liq)), 0);
        assertEq(
            IMorphoMarketV1AdapterV2Lite(address(mm)).timelock(IMorphoMarketV1AdapterV2Lite.burnShares.selector),
            48 hours
        );
        bytes[4] memory ids = _idData(cfg, _deployment());
        for (uint256 i; i < 4; ++i) {
            assertGt(vault.absoluteCap(keccak256(ids[i])), 0, "absolute cap");
            assertEq(vault.relativeCap(keccak256(ids[i])), 1e18, "relative cap");
        }
        assertEq(vault.absoluteCap(keccak256(ids[0])), GLOBAL_BORROW_CAP, "M1 caps at the global borrow cap");
        assertEq(vault.balanceOf(DEAD), 100e18, "dead seed");
    }

    function _depositLandsInWsMusd() internal {
        _configuredByRealFactory();
        _deposit(lender, 10_000e18);
        assertEq(musd.balanceOf(address(vault)), 0, "nothing idle in the vault");
        assertEq(liq.idle(), 0, "nothing idle in the adapter");
        assertApproxEqAbs(wsMusd.previewRedeem(wsMusd.balanceOf(address(liq))), 10_100e18, 2, "in wsMUSD");
        assertApproxEqAbs(IERC20(net.smusd).balanceOf(address(wsMusd)), 10_101e18, 2, "staked in the real sMUSD");
        assertApproxEqAbs(vault.totalAssets(), _realTotal(), 2, "accounting");
    }

    function _fullWsMusdDoesNotBlockDeposits() internal {
        uint256 room = wsMusd.maxDeposit(address(0));
        deal(net.musd, stranger, room);
        vm.startPrank(stranger);
        musd.approve(address(wsMusd), room);
        wsMusd.deposit(room, stranger);
        vm.stopPrank();
        assertEq(wsMusd.maxDeposit(address(liq)), 0, "wsMUSD full");

        _deposit(lender, 5000e18);
        assertEq(liq.idle(), 5000e18, "parked idle in the adapter");
        assertApproxEqAbs(vault.totalAssets(), 5100e18, 2, "still counted");
        vm.prank(lender);
        vault.withdraw(1000e18, lender, lender);
        assertEq(liq.idle(), 4000e18, "exits use idle first");
    }

    function _noMoveWhileWsMusdPaysMore() internal {
        _deposit(lender, 10_000e18);
        _borrow("borrower", 900e18); // M1 borrow 900.9 with the 10 bps fee: buffer intact
        // A real wsMUSD yield: 50 MUSD donated, absorbed by sync() and vested over 3 days.
        deal(net.musd, address(wsMusd), musd.balanceOf(address(wsMusd)) + 50e18);
        wsMusd.sync();
        _advanceWithCheckpoints(1 days);
        (uint256 wsApy,) = allocator.wsMusdApy();
        assertGt(wsApy, allocator.m1SupplyApy(), "wsMUSD pays more");

        (IBaserateAllocator.Action action, uint256 amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.NONE));
        assertEq(amount, 0);
        assertEq(_vaultM1(), 0, "excess stays in wsMUSD");
    }

    function _movesWhenM1PaysMore() internal {
        _buildM1Position();
        // wsMUSD now pays more: excess above the buffer goes back, the buffer stays.
        _mockWsApy(0.5e18);
        (IBaserateAllocator.Action action, uint256 amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.TO_LIQUIDITY));
        assertEq(amount, 1000e18);
        assertGe(_m1Liquidity(), _bufferTarget(), "buffer kept");
    }

    function _borrowerAlwaysHasBuffer() internal {
        _deposit(lender, 10_000e18);
        _borrow("b1", 1500e18); // M1 liquidity ~1,498.5 (10 bps origination fee) < 2,000
        _nextBlock(); // a top-up runs on M1 state left by earlier blocks (R2X-3)
        uint256 deficit = 2000e18 - _m1Liquidity();
        (IBaserateAllocator.Action action, uint256 amount) = allocator.rebalance();
        assertEq(uint256(action), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, deficit);
        assertGe(_m1Liquidity(), 2000e18);

        _borrow("b2", 1900e18); // drawn from the standing buffer
        assertLt(_m1Liquidity(), 2000e18);
        skip(1 hours);
        allocator.rebalance(); // +1,000 (bounded)
        skip(1 hours);
        allocator.rebalance(); // the rest
        assertGe(_m1Liquidity(), _bufferTarget(), "buffer rebuilt");
        _borrow("b3", 1500e18);
    }

    function _withdrawalsUseIdleAndWsMusdFirst() internal {
        _buildM1Position();
        uint256 m1Before = _vaultM1();

        vm.prank(lender);
        vault.withdraw(5000e18, lender, lender);
        assertApproxEqAbs(_vaultM1(), m1Before, 1, "served by wsMUSD, M1 untouched");

        uint256 liquid = liq.availableLiquidity();
        uint256 want = liquid + 500e18;
        vm.prank(lender);
        vm.expectRevert();
        vault.withdraw(want, lender, lender);

        vm.startPrank(lender);
        vault.approve(address(allocator), type(uint256).max);
        allocator.withdraw(want, lender);
        vm.stopPrank();
        assertEq(musd.balanceOf(lender), 5000e18 + want);
        assertApproxEqAbs(m1Before - _vaultM1(), 500e18, 3, "only the shortfall from M1");
        assertApproxEqAbs(vault.totalAssets(), _realTotal(), 2, "accounting");
    }

    function _forceDeallocateInKindExit() internal {
        _buildM1Position();
        // Drain the liquidity side: the lender exits the rest through M1 in kind, atomically via multicall.
        uint256 liquid = liq.availableLiquidity();
        vm.prank(lender);
        vault.withdraw(liquid, lender, lender);

        uint256 sharesBefore = vault.balanceOf(lender);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IVaultV2.forceDeallocate, (address(mm), abi.encode(params), 1000e18, lender));
        calls[1] = abi.encodeCall(IERC4626.withdraw, (1000e18, lender, lender));
        vm.prank(lender);
        vault.multicall(calls);

        assertEq(musd.balanceOf(lender), liquid + 1000e18, "exited through M1");
        uint256 burnt = sharesBefore - vault.balanceOf(lender);
        // 1,000 withdrawn plus the 0.5% penalty (5 MUSD) left to the remaining lenders.
        assertApproxEqRel(vault.convertToAssets(burnt), 1005e18, 0.0005e18);
    }

    function _capsRespected() internal {
        _deposit(lender, 10_000e18);
        _borrow("borrower", 900e18); // M1 borrow 900.9 with the 10 bps fee: buffer intact
        _advanceWithCheckpoints(1 days);
        bytes[4] memory ids = _idData(cfg, _deployment());

        // Sentinel/curator cuts are instant; raises wait 48 h.
        vm.startPrank(team);
        vault.decreaseAbsoluteCap(ids[2], 400e18);
        vault.submit(abi.encodeCall(IVaultV2.increaseAbsoluteCap, (ids[2], 10_000e18)));
        vm.expectRevert();
        vault.increaseAbsoluteCap(ids[2], 10_000e18);
        vm.stopPrank();

        (, uint256 amount) = allocator.rebalance();
        assertEq(amount, 400e18, "bounded by the cap");
        skip(1 hours);
        (, amount) = allocator.rebalance();
        assertEq(amount, 0, "cap full");
        for (uint256 i; i < 4; ++i) {
            bytes32 id = keccak256(ids[i]);
            assertLe(vault.allocation(id), vault.absoluteCap(id), "within caps");
        }

        skip(48 hours);
        vault.increaseAbsoluteCap(ids[2], 10_000e18); // anyone executes after the timelock
        assertEq(vault.absoluteCap(keccak256(ids[2])), 10_000e18);
    }

    function _deployment() internal view returns (VaultDeployment memory) {
        return VaultDeployment({
            vault: address(vault),
            liquidityAdapter: address(liq),
            marketAdapter: address(mm),
            allocator: address(allocator)
        });
    }

    // ---------------------------------------------------------------- testnet

    function test_testnet_depositLandsInWsMusd() public {
        _setUpNet(Net.TESTNET);
        _depositLandsInWsMusd();
    }

    function test_testnet_fullWsMusdDoesNotBlockDeposits() public {
        _setUpNet(Net.TESTNET);
        _fullWsMusdDoesNotBlockDeposits();
    }

    function test_testnet_noMoveWhileWsMusdPaysMore() public {
        _setUpNet(Net.TESTNET);
        _noMoveWhileWsMusdPaysMore();
    }

    function test_testnet_movesWhenM1PaysMore() public {
        _setUpNet(Net.TESTNET);
        _movesWhenM1PaysMore();
    }

    function test_testnet_borrowerAlwaysHasBuffer() public {
        _setUpNet(Net.TESTNET);
        _borrowerAlwaysHasBuffer();
    }

    function test_testnet_withdrawalsUseIdleAndWsMusdFirst() public {
        _setUpNet(Net.TESTNET);
        _withdrawalsUseIdleAndWsMusdFirst();
    }

    function test_testnet_forceDeallocateInKindExit() public {
        _setUpNet(Net.TESTNET);
        _forceDeallocateInKindExit();
    }

    function test_testnet_capsRespected() public {
        _setUpNet(Net.TESTNET);
        _capsRespected();
    }

    // ---------------------------------------------------------------- mainnet

    function test_mainnet_depositLandsInWsMusd() public {
        _setUpNet(Net.MAINNET);
        _depositLandsInWsMusd();
    }

    function test_mainnet_fullWsMusdDoesNotBlockDeposits() public {
        _setUpNet(Net.MAINNET);
        _fullWsMusdDoesNotBlockDeposits();
    }

    function test_mainnet_noMoveWhileWsMusdPaysMore() public {
        _setUpNet(Net.MAINNET);
        _noMoveWhileWsMusdPaysMore();
    }

    function test_mainnet_movesWhenM1PaysMore() public {
        _setUpNet(Net.MAINNET);
        _movesWhenM1PaysMore();
    }

    function test_mainnet_borrowerAlwaysHasBuffer() public {
        _setUpNet(Net.MAINNET);
        _borrowerAlwaysHasBuffer();
    }

    function test_mainnet_withdrawalsUseIdleAndWsMusdFirst() public {
        _setUpNet(Net.MAINNET);
        _withdrawalsUseIdleAndWsMusdFirst();
    }

    function test_mainnet_forceDeallocateInKindExit() public {
        _setUpNet(Net.MAINNET);
        _forceDeallocateInKindExit();
    }

    function test_mainnet_capsRespected() public {
        _setUpNet(Net.MAINNET);
        _capsRespected();
    }
}

interface IAdapterLike {
    function realAssets() external view returns (uint256);
}
