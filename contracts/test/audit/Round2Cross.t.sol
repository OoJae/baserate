// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IBorrowAccount} from "../../src/interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";
import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {ILiquidationVenues, Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {IRiskLens} from "../../src/interfaces/IRiskLens.sol";
import {IWsMusdLiquidityAdapter} from "../../src/interfaces/IWsMusdLiquidityAdapter.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../../src/interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";
import {RiskLens} from "../../src/lens/RiskLens.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {FlashLiquidator} from "../../src/liquidation/FlashLiquidator.sol";
import {BtcMusdOracle} from "../../src/oracle/BtcMusdOracle.sol";
import {IBtcMusdOracle} from "../../src/oracle/IBtcMusdOracle.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {VaultSetup} from "../../script/base/VaultSetup.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";

import {BtcPrecompileMock} from "../utils/BtcPrecompileMock.sol";
import {MezoFork} from "../utils/MezoFork.sol";
import {MockSlipstreamPool, MockToken, MockTroves} from "../utils/LensMocks.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {PythMock} from "../utils/PythMock.sol";
import {SkipMock} from "../utils/SkipMock.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";
import {MockBribe, MockPoolsVoter} from "../utils/VoterMocks.sol";
import {
    CLPoolMock,
    CLQuoterMock,
    CLRouterMock,
    FeeSandwich,
    MockBosSurplus,
    TransientWithdrawLooper,
    VammPoolMock,
    VammRouterMock
} from "./Round2CrossHelpers.sol";

/// @notice Round-2 cross-cutting audit stack: everything Baserate deploys, wired together locally the way the deploy
/// scripts wire it on Mezo mainnet (LLTV 0.86, STANDARD ceiling 7100 bps, CANARY 8575 bps), on top of
/// - the real BtcMusdOracle, reading a SkipMock etched at the Skip precompile and a PythMock;
/// - the BTC ERC-20 precompile mock etched at 0x7b7C...0000 (native balance mirror, `vm.deal` moves);
/// - real Morpho Blue + AdaptiveCurveIrm, real VaultV2 configured by the deploy script's own `VaultSetup`;
/// - Tigris venue stand-ins that make the same BTC-precompile calls as the verified pool/router code (vAMM: router
///   `transferFrom`, pool 2x `balanceOf` + fee `transfer`; CL200: pool 2x `balance0()`, router `transferFrom` or own
///   BTC + `refundBTC`; QuoterV2: one `balance0()` inside a reverted swap);
/// - SMUSDMock (line-for-line sMUSD replica with fault switches), PoolsVoter/BribeVotingReward mocks, trove mocks.
/// Precompile calls are counted from `vm.startStateDiffRecording` (every CALL/STATICCALL/DELEGATECALL into the Skip or
/// BTC precompile address, reads included, reverted frames included because Mezo's counter is not journaled), native
/// value transfers are counted separately (internal CALLs with value, the transaction's own value excluded). Gas is the
/// execution gas of the call measured from the test with every account and slot cooled first (add 21k intrinsic and
/// calldata for a transaction; Mezo also charges precompile work that local mocks do not, see the report).
/// Run: FOUNDRY_OUT=out/r2-cross FOUNDRY_CACHE_PATH=cache/r2-cross forge test --match-path
/// test/audit/Round2Cross.t.sol -vv
abstract contract R2Base is Test, VaultSetup {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    struct Cost {
        uint256 skip;
        uint256 btc;
        uint256 native;
        uint256 reverted;
        uint256 gas;
    }

    address internal constant SKIP = MezoAddresses.SKIP_BTC_USD;
    address internal constant BTC = MezoAddresses.BTC;
    uint256 internal constant M1_LLTV = 0.86e18;
    uint16 internal constant CEILING = 7100;
    uint16 internal constant CANARY_CEILING = 8575;
    uint128 internal constant POSITION_CAP = 0.1e18;
    uint256 internal constant BTC_USD = 80_000e18;
    uint256 internal constant TEAM_SUPPLY = 1000e18;
    uint256 internal constant M1_CAP = 20_000e18;
    uint256 internal constant WS_CAP = 250_000e18;
    uint256 internal constant BACKSTOP_SEED = 5000e18;
    uint256 internal constant MAX_IMPACT_BPS = 419; // break-even 1 - 1/LIF at LLTV 0.86
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    SkipMock internal skipOracle;
    PythMock internal pyth;
    MockMUSD internal musd;
    SMUSDMock internal smusd;
    WsMUSD internal ws;
    IMorpho internal morpho;
    address internal irm;
    BtcMusdOracle internal oracle;
    BorrowAccountFactory internal factory;
    MarketParams internal params;
    Id internal marketId;

    IVaultV2 internal vault;
    WsMusdLiquidityAdapter internal liq;
    IMorphoMarketV1AdapterV2Lite internal mm;
    BaserateAllocator internal allocator;
    VaultConfig internal cfg;

    VammPoolMock internal vammPool;
    VammRouterMock internal vammRouter;
    CLPoolMock internal clPool;
    CLRouterMock internal clRouter;
    CLQuoterMock internal clQuoter;
    Backstop internal backstop;
    FlashLiquidator internal liquidator;

    MockPoolsVoter internal voter;
    MockBribe internal bribeA;
    MockBribe internal bribeB;
    FeeRouter internal feeRouter;
    MockBosSurplus internal bos;
    MockTroves internal troves;
    MockSlipstreamPool internal pricePool;
    RiskLens internal lens;

    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal curator = makeAddr("curator");
    address internal capAdmin = makeAddr("capAdmin");
    address internal morphoOwner = makeAddr("morphoOwner");
    address internal team = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal gaugeA = makeAddr("gaugeCL200");
    address internal gaugeB = makeAddr("gaugeVAMM");
    address internal saver = makeAddr("saver");
    address internal keeper = makeAddr("keeper");
    address internal lender = makeAddr("lender");
    address internal m1Lender = makeAddr("m1Lender");
    address internal bpLp = makeAddr("backstopLP");
    address internal stranger = makeAddr("stranger");
    address internal alice;
    uint256 internal aliceKey;

    uint256 internal _g0;
    uint256 internal _maxTotal;

    function setUp() public virtual {
        vm.warp(1_792_942_983); // Sunday 2026-10-25: 3.65 days into a Mezo Earn epoch
        vm.roll(12_758_000);
        (alice, aliceKey) = makeAddrAndKey("alice");

        // Mezo precompiles.
        vm.etch(SKIP, address(new SkipMock()).code);
        skipOracle = SkipMock(SKIP);
        skipOracle.setAnswer(int256(BTC_USD));
        vm.etch(BTC, address(new BtcPrecompileMock()).code);
        vm.allowCheatcodes(BTC);
        pyth = new PythMock();
        _setPyth(BTC_USD, block.timestamp);

        // MUSD, sMUSD (100k held by outside savers), wsMUSD (1 MUSD dead seed).
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        _fundApprove(saver, 100_000e18, address(smusd));
        vm.prank(saver);
        smusd.deposit(100_000e18);
        ws = new WsMUSD(address(musd), address(smusd), capAdmin, WS_CAP);
        _fundApprove(team, 1e18, address(ws));
        vm.prank(team);
        ws.deposit(1e18, DEAD);

        // Morpho Blue + AdaptiveCurveIrm.
        morpho = IMorpho(deployCode("Morpho.sol:Morpho", abi.encode(morphoOwner)));
        irm = deployCode("AdaptiveCurveIrm.sol:AdaptiveCurveIrm", abi.encode(address(morpho)));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(irm);
        morpho.enableLltv(M1_LLTV);
        vm.stopPrank();
        oracle = new BtcMusdOracle(address(pyth), MezoAddresses.PYTH_BTC_USD, MezoAddresses.PYTH_MUSD_USD);

        _deployFeeRouter();
        bos = new MockBosSurplus();
        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: address(morpho),
                musd: address(musd),
                oracle: address(oracle),
                irm: irm,
                lltv: M1_LLTV,
                bos: address(bos),
                collSurplusPool: address(bos),
                governor: governor,
                sentinel: sentinel,
                feeRecipient: address(feeRouter),
                globalBorrowCap: 100_000e18,
                standard: IBorrowAccountFactory.Limits({positionCap: POSITION_CAP, ceilingBps: CEILING}),
                canary: IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: CANARY_CEILING})
            })
        );
        params = factory.marketParams();
        marketId = params.id();
        morpho.createMarket(params);
        _supplyM1(team, TEAM_SUPPLY);

        _deployVaultStack();
        _deployVenuesAndLiquidation();
        _deployLens();
        _label();
    }

    // ---------------------------------------------------------------- deployment pieces

    function _deployFeeRouter() internal {
        voter = new MockPoolsVoter();
        address[] memory rewards = new address[](1);
        rewards[0] = address(musd);
        bribeA = new MockBribe(address(voter), rewards);
        bribeB = new MockBribe(address(voter), rewards);
        voter.addGauge(gaugeA, address(bribeA));
        voter.addGauge(gaugeB, address(bribeB));
        voter.setWhitelisted(address(musd), true);
        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](2);
        t[0] = IFeeRouter.BribeTarget({gauge: gaugeA, bribe: address(bribeA)});
        t[1] = IFeeRouter.BribeTarget({gauge: gaugeB, bribe: address(bribeB)});
        feeRouter = new FeeRouter(address(musd), address(smusd), address(voter), treasury, t);
    }

    function _deployVaultStack() internal {
        cfg = VaultConfig({
            vaultFactory: deployCode("VaultV2Factory.sol:VaultV2Factory"),
            owner: curator,
            musd: address(musd),
            wsMusd: address(ws),
            morpho: address(morpho),
            market: params,
            marketCap: M1_CAP,
            liquidityCap: WS_CAP,
            seed: 100e18,
            salt: keccak256("baserate.vMUSD.r2")
        });
        musd.mint(curator, 100e18);
        vm.startPrank(curator);
        VaultDeployment memory d = _deployVault(cfg);
        vm.stopPrank();
        vault = IVaultV2(d.vault);
        liq = WsMusdLiquidityAdapter(d.liquidityAdapter);
        mm = IMorphoMarketV1AdapterV2Lite(d.marketAdapter);
        allocator = BaserateAllocator(d.allocator);
    }

    function _deployVenuesAndLiquidation() internal {
        vammPool = new VammPoolMock(address(musd));
        vm.deal(address(vammPool), 2e18);
        musd.mint(address(vammPool), 160_000e18);
        vammPool.sync();
        vammRouter = new VammRouterMock(vammPool);
        clPool = new CLPoolMock(address(musd));
        clPool.set(5e18, 400_000e18);
        musd.mint(address(clPool), 400_000e18);
        clRouter = new CLRouterMock(clPool);
        clQuoter = new CLQuoterMock(clPool);

        ILiquidationVenues.VenueConfig memory venues = ILiquidationVenues.VenueConfig({
            clRouter: address(clRouter),
            clQuoter: address(clQuoter),
            router: address(vammRouter),
            poolFactory: address(vammPool)
        });
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        backstop = new Backstop(
            IBackstop.BackstopParams({
                musd: address(musd),
                wsMusd: address(ws),
                oracle: address(oracle),
                lltv: M1_LLTV,
                liquidator: predicted,
                sentinel: sentinel,
                maxKeeperSale: 0.05e18,
                venues: venues
            })
        );
        liquidator = new FlashLiquidator(address(morpho), params, address(backstop), MAX_IMPACT_BPS, venues);
        require(address(liquidator) == predicted, "liquidator address");
        _depositBackstop(bpLp, BACKSTOP_SEED);
    }

    function _deployLens() internal {
        troves = new MockTroves();
        troves.push(makeAddr("troveA"), 1e18, 40_000e18, 100e18);
        troves.push(makeAddr("troveB"), 1e18, 50_000e18, 100e18);
        MockToken usdc = new MockToken("mUSDC", 6);
        pricePool = new MockSlipstreamPool(address(musd), address(usdc));
        pricePool.set(79_228_162_514_264_337_593_543, -276_325);
        lens = new RiskLens(
            IRiskLens.LensConfig({
                factory: address(factory),
                wsMusd: address(ws),
                troveManager: address(troves),
                sortedTroves: address(troves),
                router: address(vammRouter),
                poolFactory: address(vammPool),
                quoter: address(clQuoter),
                clTickSpacing: 200,
                musdPricePool: address(pricePool)
            })
        );
    }

    function _label() internal {
        vm.label(SKIP, "SkipPrecompile");
        vm.label(BTC, "BtcPrecompile");
        vm.label(address(musd), "MUSD");
        vm.label(address(smusd), "sMUSD");
        vm.label(address(ws), "wsMUSD");
        vm.label(address(morpho), "Morpho");
        vm.label(address(vault), "vMUSD");
        vm.label(address(liq), "WsMusdLiquidityAdapter");
        vm.label(address(mm), "M1Adapter");
        vm.label(address(allocator), "BaserateAllocator");
        vm.label(address(backstop), "Backstop");
        vm.label(address(liquidator), "FlashLiquidator");
        vm.label(address(oracle), "BtcMusdOracle");
        vm.label(address(factory), "Factory");
        vm.label(address(feeRouter), "FeeRouter");
    }

    // ---------------------------------------------------------------- price helpers

    function _setPyth(uint256 px18, uint256 publishTime) internal {
        // forge-lint: disable-next-line(unsafe-typecast)
        pyth.setPrice(MezoAddresses.PYTH_BTC_USD, int64(int256(px18 / 1e10)), -8, publishTime);
        pyth.setPrice(MezoAddresses.PYTH_MUSD_USD, 1e8, -8, publishTime);
    }

    /// @dev Skip and Pyth both at `px18` now, and both Tigris pools repriced to it.
    function _setBtc(uint256 px18) internal {
        skipOracle.setAnswer(int256(px18));
        _setPyth(px18, block.timestamp);
        _repricePools(px18);
    }

    function _repricePools(uint256 px18) internal {
        uint256 target = address(vammPool).balance * px18 / 1e18;
        uint256 held = musd.balanceOf(address(vammPool));
        if (held > target) musd.burn(address(vammPool), held - target);
        else musd.mint(address(vammPool), target - held);
        vammPool.sync();
        clPool.set(5e18, 5e18 * px18 / 1e18);
    }

    // ---------------------------------------------------------------- funding helpers

    function _fundApprove(address who, uint256 amount, address spender) internal {
        musd.mint(who, amount);
        vm.prank(who);
        musd.approve(spender, type(uint256).max);
    }

    function _supplyM1(address who, uint256 amount) internal {
        _fundApprove(who, amount, address(morpho));
        vm.prank(who);
        morpho.supply(params, amount, 0, who, "");
    }

    function _depositVault(address who, uint256 amount) internal returns (uint256 shares) {
        _fundApprove(who, amount, address(vault));
        vm.prank(who);
        shares = vault.deposit(amount, who);
    }

    function _depositBackstop(address who, uint256 amount) internal returns (uint256 shares) {
        _fundApprove(who, amount, address(backstop));
        vm.prank(who);
        shares = backstop.deposit(amount, who);
    }

    /// @dev Largest `musdOut` whose debt (musdOut + 10 bps fee) keeps `coll` under `ltvBps` at the oracle price.
    function _maxOut(uint256 coll, uint256 ltvBps) internal view returns (uint256 m) {
        uint256 maxDebt = coll * oracle.price() / 1e36 * ltvBps / BPS;
        m = maxDebt * BPS / (BPS + 10);
        while (m != 0 && m + (m * 10 + BPS - 1) / BPS + 1 > maxDebt) --m;
    }

    /// @dev Opens a STANDARD position for `who` with `coll` BTC at `ltvBps`, topping M1 up through the allocator
    /// whenever the borrow needs more M1 liquidity than there is (vMUSD is M1's lender).
    function _open(address who, uint256 coll, uint256 ltvBps) internal returns (address account) {
        vm.deal(who, who.balance + coll);
        vm.prank(who);
        account = factory.openAndBorrow{value: coll}(0, CEILING);
        uint256 remaining = _maxOut(coll, ltvBps);
        while (remaining != 0) {
            uint256 liquidity = _m1Liquidity();
            uint256 chunk = remaining;
            if (chunk + chunk / 500 + 1 > liquidity) chunk = liquidity > 10e18 ? liquidity * 99 / 100 : 0;
            if (chunk == 0) {
                _topUpUntilDone();
                require(_m1Liquidity() > 10e18, "no M1 liquidity");
                continue;
            }
            vm.prank(who);
            IBorrowAccount(account).borrow(chunk, CEILING, who);
            remaining -= chunk;
            _topUpUntilDone();
        }
    }

    /// @dev Top-ups run at most once per block and on M1 state left by earlier blocks (R2X-3), so each one is taken in
    /// a new block whenever M1 was touched (or topped up) in the current one.
    function _topUpUntilDone() internal {
        for (uint256 i; i < 30; ++i) {
            uint256 now_ = vm.getBlockTimestamp();
            if (morpho.market(marketId).lastUpdate == now_ || allocator.lastTopUpAt() == now_) _nextBlock();
            (IBaserateAllocator.Action a,,) = allocator.previewRebalance();
            if (a != IBaserateAllocator.Action.BUFFER_TOP_UP) return;
            allocator.rebalance();
        }
    }

    function _m1Liquidity() internal view returns (uint256) {
        (uint256 supply,, uint256 borrow,) = morpho.expectedMarketBalances(params);
        return supply > borrow ? supply - borrow : 0;
    }

    function _vaultM1() internal view returns (uint256) {
        return mm.expectedSupplyAssets(Id.unwrap(marketId));
    }

    function _nextBlock() internal {
        skip(4);
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _advanceWithCheckpoints(uint256 duration) internal {
        uint256 now_ = vm.getBlockTimestamp();
        uint256 end = now_ + duration;
        while (now_ < end) {
            uint256 step = end - now_ < 1 hours ? end - now_ : 1 hours;
            now_ += step;
            vm.warp(now_);
            vm.roll(vm.getBlockNumber() + step / 4);
            skipOracle.setAnswer(skipOracle.answer());
            allocator.checkpoint();
        }
    }

    /// @dev Makes wsMUSD's trailing APY exactly `apy` against the oldest retained checkpoint.
    function _mockWsApy(uint256 apy) internal {
        IBaserateAllocator.Checkpoint memory c = allocator.checkpointAt(0);
        uint256 window = block.timestamp - c.timestamp;
        uint256 priceNow = uint256(c.sharePrice) + uint256(c.sharePrice) * apy * window / (YEAR * 1e18);
        vm.mockCall(address(ws), abi.encodeCall(IERC4626.convertToAssets, (1e18)), abi.encode(priceNow));
    }

    // ---------------------------------------------------------------- counting harness

    function _coolAll() internal {
        address[30] memory a = [
            SKIP,
            BTC,
            address(pyth),
            address(musd),
            address(smusd),
            address(ws),
            address(morpho),
            irm,
            address(oracle),
            address(factory),
            factory.COLLATERAL(),
            factory.IMPLEMENTATION(),
            address(vault),
            address(liq),
            address(mm),
            address(allocator),
            address(vammPool),
            address(vammRouter),
            address(clPool),
            address(clRouter),
            address(clQuoter),
            address(backstop),
            address(liquidator),
            address(voter),
            address(bribeA),
            address(bribeB),
            address(feeRouter),
            address(bos),
            address(lens),
            address(troves)
        ];
        for (uint256 i; i < a.length; ++i) {
            vm.cool(a[i]);
        }
    }

    function _begin() internal {
        _coolAll();
        vm.startStateDiffRecording();
        _g0 = gasleft();
    }

    function _end(string memory flow) internal returns (Cost memory c) {
        c.gas = _g0 - gasleft();
        VmSafe.AccountAccess[] memory a = vm.stopAndReturnStateDiff();
        uint256 minDepth = type(uint256).max;
        for (uint256 i; i < a.length; ++i) {
            if (_isCall(a[i].kind) && a[i].depth < minDepth) minDepth = a[i].depth;
        }
        for (uint256 i; i < a.length; ++i) {
            if (!_isCall(a[i].kind)) continue;
            if (a[i].account == SKIP) {
                c.skip++;
                if (a[i].reverted) c.reverted++;
            } else if (a[i].account == BTC) {
                c.btc++;
                if (a[i].reverted) c.reverted++;
            } else if (
                a[i].kind == VmSafe.AccountAccessKind.Call && a[i].value != 0 && a[i].depth > minDepth
                    && a[i].account != address(vm)
            ) {
                c.native++;
            }
        }
        uint256 total = c.skip + c.btc;
        if (total > _maxTotal) _maxTotal = total;
        console2.log(
            string.concat(
                "| ",
                flow,
                " | ",
                vm.toString(c.btc),
                " | ",
                vm.toString(c.skip),
                " | ",
                vm.toString(c.native),
                " | ",
                vm.toString(total),
                c.reverted != 0 ? string.concat(" (", vm.toString(c.reverted), " in reverted frames)") : "",
                " | ",
                vm.toString(c.gas),
                " |"
            )
        );
    }

    function _isCall(VmSafe.AccountAccessKind k) internal pure returns (bool) {
        return k == VmSafe.AccountAccessKind.Call || k == VmSafe.AccountAccessKind.StaticCall
            || k == VmSafe.AccountAccessKind.DelegateCall || k == VmSafe.AccountAccessKind.CallCode;
    }

    function _permit(uint256 key, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 typehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typehash, owner, spender, value, musd.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    /// @dev Drops Skip by `bps` (Pyth and the pools follow) so positions opened near the ceiling become liquidatable.
    function _crash(uint256 bps) internal {
        uint256 px = uint256(skipOracle.answer()) * (BPS - bps) / BPS;
        _setBtc(px);
    }
}

/// @notice Section 4/5 of the round-2 brief: measured precompile calls and gas for every user and keeper flow.
contract Round2BudgetTest is R2Base {
    function setUp() public override {
        super.setUp();
        _supplyM1(m1Lender, 60_000e18); // M1 liquidity for the borrow flows
        console2.log("| flow | BTC precompile | Skip | native transfers | total precompile | gas |");
    }

    function test_budget_borrowFlows() public {
        vm.deal(alice, 1e18);
        uint256 coll = 0.05e18;
        uint256 out = _maxOut(coll, 7000);

        _begin();
        vm.prank(alice);
        address acct = factory.openAndBorrow{value: coll}(out, CEILING);
        _end("factory.openAndBorrow (new clone, supply + borrow)");

        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).borrow(10e18, CEILING, alice);
        _end("account.borrow");

        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).addCollateral{value: 0.01e18}();
        _end("account.addCollateral");

        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).withdrawCollateral(0.005e18, alice);
        _end("account.withdrawCollateral (debt outstanding)");

        _fundApprove(alice, 100e18, acct);
        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).repay(50e18);
        _end("account.repay (partial)");

        uint256 snap = vm.snapshotState();
        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).repayAndWithdraw(alice);
        _end("account.repayAndWithdraw");
        vm.revertToState(snap);

        skipOracle.setMode(SkipMock.Mode.REVERT);
        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).repayAndWithdraw(alice);
        _end("account.repayAndWithdraw (Skip down)");
        vm.revertToState(snap);

        vm.prank(alice);
        musd.approve(acct, 0);
        uint256 maxRepay = IBorrowAccount(acct).debt() + 1e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, alice, acct, maxRepay, deadline);
        _begin();
        vm.prank(alice);
        IBorrowAccount(acct).repayAndWithdrawWithPermit(maxRepay, deadline, v, r, s, alice);
        _end("account.repayAndWithdrawWithPermit");
        vm.revertToState(snap);

        address bob = makeAddr("bob");
        bos.setSurplus(bob, 0.03e18);
        vm.deal(address(bos), 0.03e18);
        _begin();
        vm.prank(bob);
        factory.comeBack("", block.timestamp + 1, 500e18, CEILING);
        _end("factory.comeBack (claim + new clone + supplyIdle + borrow)");

        _begin();
        factory.createAccount(makeAddr("anyone"));
        _end("factory.createAccount (permissionless, any owner)");

        assertLe(_maxTotal, 15, "borrow flows stay well under Mezo's 20");
    }

    function test_budget_savingsAndVaultFlows() public {
        address carol = makeAddr("carol");
        _fundApprove(carol, 10_000e18, address(ws));
        _begin();
        vm.prank(carol);
        ws.deposit(1000e18, carol);
        _end("wsMUSD.deposit");

        // sMUSD protocol yield so the next sync harvests.
        _fundApprove(stranger, 1000e18, address(smusd));
        vm.prank(stranger);
        smusd.receiveProtocolYield(1000e18);
        _begin();
        ws.sync();
        _end("wsMUSD.sync (harvest + re-deposit)");
        skip(1 days);
        _begin();
        vm.prank(carol);
        ws.withdraw(500e18, carol, carol);
        _end("wsMUSD.withdraw");
        _begin();
        vm.prank(carol);
        ws.redeem(100e18, carol, carol);
        _end("wsMUSD.redeem");
        _begin();
        vm.prank(carol);
        ws.redeemInKind(100e18, carol, carol);
        _end("wsMUSD.redeemInKind");

        // vMUSD
        _fundApprove(lender, 30_000e18, address(vault));
        _begin();
        vm.prank(lender);
        vault.deposit(20_000e18, lender);
        _end("vMUSD.deposit (allocates to wsMUSD)");

        // M1 borrowers so vMUSD gets an M1 leg through buffer top-ups.
        vm.prank(m1Lender);
        morpho.withdraw(params, 59_000e18, 0, m1Lender, m1Lender);
        _open(makeAddr("b1"), 0.1e18, 7000);
        _open(makeAddr("b2"), 0.1e18, 6000);
        _nextBlock();
        _borrowMore(makeAddr("b2"), 500e18);
        _nextBlock(); // a top-up runs on M1 state left by earlier blocks (R2X-3)
        (IBaserateAllocator.Action a,,) = allocator.previewRebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP), "top-up pending");
        _begin();
        allocator.rebalance();
        _end("allocator.rebalance (BUFFER_TOP_UP)");
        _topUpUntilDone();
        // A borrower repays 3k: M1 liquidity above the buffer for a day, so a TO_LIQUIDITY move becomes possible.
        _repay(makeAddr("b1"), 3000e18);

        _advanceWithCheckpoints(1 days + 1 hours);
        skip(1 hours);
        _begin();
        allocator.checkpoint();
        _end("allocator.checkpoint");

        uint256 snap = vm.snapshotState();
        _nextBlock();
        _mockWsApy(0.5e18);
        _begin();
        (IBaserateAllocator.Action act,) = allocator.rebalance();
        _end(string.concat("allocator.rebalance (rate move ", _actionName(act), ")"));
        vm.revertToState(snap);
        _nextBlock();
        _mockWsApy(0);
        _begin();
        (act,) = allocator.rebalance();
        _end(string.concat("allocator.rebalance (rate move ", _actionName(act), ")"));
        vm.clearMockedCalls();

        _nextBlock();
        vm.prank(lender);
        vault.approve(address(allocator), type(uint256).max);
        _begin();
        vm.prank(lender);
        vault.withdraw(1000e18, lender, lender);
        _end("vMUSD.withdraw (direct, wsMUSD leg)");

        uint256 inWs = liq.availableLiquidity();
        _begin();
        vm.prank(lender);
        allocator.withdraw(inWs + 500e18, lender);
        _end("allocator.withdraw (wsMUSD leg + M1 pull)");

        _depositVault(lender, 5000e18);
        smusd.setDisabled(false, true, false);
        _begin();
        vm.prank(lender);
        allocator.withdraw(300e18, lender);
        _end("allocator.withdraw (wsMUSD reverts -> M1-first retry)");
        smusd.setDisabled(false, false, false);

        uint256 tenth = vault.balanceOf(lender) / 10;
        _begin();
        vm.prank(lender);
        allocator.redeem(tenth, lender);
        _end("allocator.redeem");

        assertLe(_maxTotal, 15);
    }

    function test_budget_liquidationAndBackstopFlows() public {
        address b1 = makeAddr("b1");
        address acct = _open(b1, 0.05e18, 7000);
        _crash(1900);
        IFlashLiquidator.LiquidationPreview memory p = liquidator.previewLiquidation(acct);
        assertTrue(p.liquidatable, "liquidatable");
        uint256 snap = vm.snapshotState();

        Venue[3] memory venues = [Venue.BACKSTOP, Venue.CL200, Venue.VAMM];
        string[3] memory names = ["BACKSTOP", "CL200", "VAMM"];
        for (uint256 i; i < 3; ++i) {
            _begin();
            vm.prank(keeper);
            liquidator.liquidate(acct, 0, venues[i], 0);
            _end(string.concat("FlashLiquidator.liquidate full, ", names[i]));
            vm.revertToState(snap);
            _begin();
            vm.prank(keeper);
            liquidator.liquidate(acct, p.collateral / 4, venues[i], 0);
            _end(string.concat("FlashLiquidator.liquidate partial seize, ", names[i]));
            vm.revertToState(snap);
        }

        clPool.setRange(p.seizable * 98 / 100);
        _begin();
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.CL200, 0);
        _end("FlashLiquidator.liquidate full, CL200 partial fill (+approve(0))");
        vm.revertToState(snap);

        vm.deal(address(clRouter), 1e18); // stray BTC in the router: pay() uses it, refundBTC() returns the rest
        _begin();
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.CL200, 0);
        _end("FlashLiquidator.liquidate full, CL200 router pays own BTC + refund");
        vm.revertToState(snap);

        // Bad debt: a further 30% drop before anyone liquidates.
        _crash(3000);
        _begin();
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.BACKSTOP, 0);
        _end("FlashLiquidator.liquidate full with bad debt, BACKSTOP");
        vm.revertToState(snap);

        _begin();
        liquidator.previewLiquidation(acct);
        _end("FlashLiquidator.previewLiquidation (eth_call)");
        _begin();
        liquidator.quoteVenues(0.05e18);
        _end("FlashLiquidator.quoteVenues (eth_call)");

        // Backstop deposits never read Skip: open while no BTC is held, refused (before any read) while it is.
        address lp2 = makeAddr("lp2");
        _fundApprove(lp2, 2000e18, address(backstop));
        _begin();
        vm.prank(lp2);
        uint256 shares = backstop.deposit(1000e18, lp2);
        _end("Backstop.deposit");

        // Backstop with inventory (above dust) after a backstop liquidation.
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.BACKSTOP, 0);
        assertGt(backstop.inventory(), backstop.DUST_INVENTORY());
        {
            bytes memory holding = abi.encodeWithSelector(IBackstop.HoldingInventory.selector, backstop.inventory());
            _begin();
            vm.expectRevert(holding);
            vm.prank(lp2);
            backstop.deposit(1000e18, lp2);
            _end("Backstop.deposit (holding BTC: refused, HoldingInventory)");
        }
        _begin();
        vm.prank(lp2);
        uint256 id = backstop.requestRedeem(shares, lp2, lp2);
        _end("Backstop.requestRedeem");
        uint256 lpShares = backstop.balanceOf(bpLp);
        vm.prank(bpLp);
        uint256 bigId = backstop.requestRedeem(lpShares, bpLp, bpLp);
        skip(7 days);
        skipOracle.setAnswer(skipOracle.answer()); // fresh Skip (Pyth is now stale: band off)
        _repricePools(uint256(skipOracle.answer()));
        uint256 snapClaims = vm.snapshotState();
        _begin();
        backstop.claimRedeem(id);
        _end("Backstop.claimRedeem");
        _begin();
        backstop.claimRedeem(bigId);
        _end("Backstop.claimRedeem (cash short: partial)");

        uint256 inv = backstop.inventory();
        address taker = makeAddr("taker");
        _fundApprove(taker, 10_000e18, address(backstop));
        _begin();
        vm.prank(taker);
        backstop.takeAuction(inv / 4, type(uint256).max, taker);
        _end("Backstop.takeAuction");
        _begin();
        backstop.sellInventory(inv / 4, Venue.VAMM, 0);
        _end("Backstop.sellInventory VAMM");
        _begin();
        backstop.sellInventory(inv / 8, Venue.CL200, 0);
        _end("Backstop.sellInventory CL200");
        clPool.setRange(inv / 16 * 99 / 100);
        _begin();
        backstop.sellInventory(inv / 16, Venue.CL200, 0);
        _end("Backstop.sellInventory CL200 partial fill");
        clPool.setRange(type(uint256).max);
        _begin();
        backstop.sync();
        _end("Backstop.sync");

        vm.revertToState(snapClaims);
        skipOracle.setMode(SkipMock.Mode.REVERT);
        _begin();
        vm.prank(lp2);
        backstop.claimRedeemWithoutOracle(id);
        _end("Backstop.claimRedeemWithoutOracle (Skip down)");
        skipOracle.setMode(SkipMock.Mode.LIVE);

        assertLe(_maxTotal, 15);
    }

    function test_budget_feesAndLens() public {
        // Fees from a few borrows.
        _open(makeAddr("b1"), 0.05e18, 7000);
        _open(makeAddr("b2"), 0.05e18, 7000);
        assertGt(musd.balanceOf(address(feeRouter)), 0);
        _begin();
        feeRouter.distribute();
        _end("FeeRouter.distribute (2 live gauges + sMUSD)");

        // Backstop holding BTC so its totalAssets reads the oracle.
        address acct = _open(makeAddr("b3"), 0.05e18, 7000);
        _crash(1900);
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.BACKSTOP, 0);

        IRiskLens.Query memory q;
        q.backstop = address(backstop);
        q.btcSizes = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            q.btcSizes[i] = 0.005e18 * (i + 1);
        }
        q.troveCount = 2;
        _begin();
        (bool ok, bytes memory ret) = address(lens).call(abi.encodeCall(RiskLens.snapshot, (q)));
        Cost memory c = _end("RiskLens.snapshot (8 sizes, backstop with BTC, eth_call)");
        assertTrue(ok, "snapshot");
        IRiskLens.Snapshot memory s = abi.decode(ret, (IRiskLens.Snapshot));
        console2.log("lens self-reported precompileCalls", s.precompileCalls);
        assertEq(c.skip + c.btc, s.precompileCalls + 1, "lens under-counts the backstop's Skip read by 1");
        assertLe(_maxTotal, 15);
    }

    function _repay(address who, uint256 amount) internal {
        (address account,) = factory.accountOf(who, Profile.STANDARD);
        _fundApprove(who, amount, account);
        vm.prank(who);
        IBorrowAccount(account).repay(amount);
    }

    function _borrowMore(address who, uint256 amount) internal {
        (address account,) = factory.accountOf(who, Profile.STANDARD);
        vm.prank(who);
        IBorrowAccount(account).borrow(amount, CEILING, who);
    }

    function _actionName(IBaserateAllocator.Action a) internal pure returns (string memory) {
        if (a == IBaserateAllocator.Action.TO_MARKET) return "TO_MARKET";
        if (a == IBaserateAllocator.Action.TO_LIQUIDITY) return "TO_LIQUIDITY";
        if (a == IBaserateAllocator.Action.BUFFER_TOP_UP) return "BUFFER_TOP_UP";
        return "NONE";
    }
}

/// @notice Round-2 cross-cutting findings (R2X-*), each a PoC on the full local stack.
contract Round2CrossTest is R2Base {
    using MorphoBalancesLib for IMorpho;

    // =============================================================================================================
    // R2X-1 (fixed): a broken sMUSD `withdraw` no longer freezes Backstop exits, and the BACKSTOP venue keeps running
    // on idle MUSD
    // =============================================================================================================

    function test_fix_R2X1_brokenSMUSDWithdraw_backstopExitsInKind_venueRunsOnIdleCash() public {
        _supplyM1(m1Lender, 60_000e18);
        address lp = makeAddr("bpAlice");
        uint256 shares = _depositBackstop(lp, 10_000e18);
        address a1 = _open(makeAddr("b1"), 0.05e18, 7000);
        address a2 = _open(makeAddr("b2"), 0.05e18, 7000);

        vm.prank(lp);
        uint256 id = backstop.requestRedeem(shares, lp, lp);
        skip(7 days);
        _crash(2000);
        vm.prank(keeper);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0); // inventory to sell later
        uint256 inv = backstop.inventory();
        assertGt(inv, 0);

        // sMUSD's withdraw breaks (an upgrade, an illiquid strategy, a pause). Deposits still work.
        smusd.setDisabled(false, true, false);

        // 1. The matured exit is paid in full, in kind: wsMUSD shares worth min(request NAV, NAV now), rounded down.
        uint256 paid = _claimPaidInKind(id, lp);

        // 2. Parking pauses, so sale proceeds stay idle instead of going back into the broken wsMUSD.
        assertEq(backstop.parkingPausedUntil(), block.timestamp + backstop.PARK_PAUSE(), "parking paused");
        address taker = makeAddr("taker");
        _fundApprove(taker, 10_000e18, address(backstop));
        vm.prank(taker);
        uint256 proceeds = backstop.takeAuction(inv, type(uint256).max, taker);
        assertEq(musd.balanceOf(address(backstop)), proceeds, "proceeds kept idle");

        // 3. The BACKSTOP venue: preview and execution agree, and the purchase clears from idle MUSD.
        IFlashLiquidator.LiquidationPreview memory p = liquidator.previewLiquidation(a2);
        assertTrue(p.liquidatable && p.quotes[uint256(Venue.BACKSTOP)].ok, "preview: backstop clears from idle MUSD");
        vm.prank(keeper);
        liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
        assertGt(backstop.inventory(), 0, "the backstop bought the seized BTC");

        // 4. A purchase the idle MUSD cannot cover is quoted as unavailable (the liquidator then picks a DEX) and
        // reverts cleanly, although free cash covers it on paper.
        _buyAboveIdleIsUnavailable(0.03e18);
        emit log_named_decimal_uint("matured backstop claim, paid in kind (MUSD)", paid, 18);
    }

    /// @dev Claims the matured request `id` (receiver `lp`) while sMUSD's withdraw reverts, checks the in-kind payment,
    /// then unwinds the wsMUSD shares through wsMUSD's own in-kind exit.
    function _claimPaidInKind(uint256 id, address lp) internal returns (uint256 paid) {
        IBackstop.RedeemRequest memory r = backstop.redeemRequest(id);
        uint256 valueNow = backstop.convertToAssets(r.shares);
        uint256 owed = r.assets < valueNow ? r.assets : valueNow;
        assertGt(backstop.cash(), owed, "cash covers the claim");
        paid = backstop.claimRedeem(id);
        assertEq(paid, owed, "min(NAV at request, NAV at claim)");
        assertEq(backstop.redeemRequest(id).shares, 0, "closed");
        assertEq(backstop.reservedAssets(), 0, "reservation released");
        uint256 lpWs = ws.balanceOf(lp);
        uint256 lpMusd = musd.balanceOf(lp);
        uint256 received = lpMusd + ws.convertToAssets(lpWs);
        assertGt(lpWs, 0, "paid in wsMUSD shares");
        assertLe(received, paid, "rounded in the backstop's favour");
        assertApproxEqAbs(received, paid, 3, "worth the claim");
        // wsMUSD's own in-kind exit turns the shares into sMUSD without sMUSD's withdraw.
        vm.prank(lp);
        (uint256 smusdOut, uint256 musdOut) = ws.redeemInKind(lpWs, lp, lp);
        assertEq(smusdOut + musdOut, received - lpMusd, "in kind, all the way down");
        assertEq(smusd.balanceOf(lp), smusdOut, "sMUSD to the receiver");
    }

    /// @dev While parking is paused, a purchase of `btc` costing more than the idle MUSD (but less than the free cash)
    /// is quoted as unavailable and reverts `CashUnavailable`.
    function _buyAboveIdleIsUnavailable(uint256 btc) internal {
        uint256 need = btc * oracle.price() / 1e36 * (1e18 - backstop.DISCOUNT()) / 1e18;
        uint256 idle = musd.balanceOf(address(backstop));
        assertGt(need, idle, "more than the idle MUSD");
        assertLt(need, backstop.availableCash(), "less than the free cash");
        assertEq(backstop.quoteBuy(btc), 0, "quoted as unavailable");
        vm.deal(address(liquidator), btc);
        vm.prank(address(liquidator));
        vm.expectPartialRevert(IBackstop.CashUnavailable.selector);
        backstop.buyCollateral{value: btc}(0);
    }

    // =============================================================================================================
    // R2X-2 (fixed): the Pyth band only gates while Pyth BTC is at most 600 s old, so a lagging Pyth can no longer
    // freeze liquidations through a fast crash; the positions clear at the first unhealthy step, with no bad debt
    // =============================================================================================================

    /// @notice R2X-2 (fixed). The band used to stay on for 3,900 s after a Pyth push: with BTC falling 3% every 5
    /// minutes, every liquidation from -18% to -30% reverted `PythDeviation` until Pyth's next hourly push, and over 250
    /// MUSD of bad debt per position landed on vMUSD. The band now stops gating `PYTH_BTC_BAND_MAX_AGE` (600 s) after
    /// Pyth's last push: it still rejects a bad Skip print in those 10 minutes, the crash clears at -18%, and a crash
    /// right after a push is frozen for at most the rest of those 10 minutes.
    function test_fix_R2X2_lateBandStopsGating_liquidationsClearInAFastCrash() public {
        uint256 lenderShares = _depositVault(lender, 20_000e18);
        _depositBackstop(bpLp, 20_000e18); // ample backstop cash: the venue is never the constraint
        address a1 = _open(makeAddr("b1"), 0.1e18, 7090); // STANDARD positions just under the 7100 ceiling
        address a2 = _open(makeAddr("b2"), 0.1e18, 7090);
        _nextBlock();
        assertGt(_vaultM1(), 10_000e18, "vMUSD is M1's lender");
        uint256 before = vault.previewRedeem(lenderShares);
        uint256 t0 = block.timestamp;
        _setPyth(BTC_USD, t0); // Pyth's last (hourly) push
        uint256 bandAge = oracle.PYTH_BTC_BAND_MAX_AGE();
        uint256 snap = vm.snapshotState();

        // BTC falls 3% every 5 minutes; Skip follows every block, Pyth's next push is at t0 + 60 min.
        uint256 cleared = 0;
        for (uint256 step = 1; step <= 10; ++step) {
            _stepCrash(t0, step);
            IBtcMusdOracle.Status memory s = oracle.status();
            assertTrue(s.ok, "prices at every step");
            assertEq(s.pythBtcFresh, step * 5 minutes <= bandAge, "band on for 600 s after the push");
            if (s.pythBtcFresh) {
                // Steps 1-2: the band still gates, so a Skip print more than 10% away from Pyth is rejected.
                uint256 gate = vm.snapshotState();
                skipOracle.setAnswer(int256(BTC_USD * 89 / 100));
                vm.expectRevert(
                    abi.encodeWithSelector(IBtcMusdOracle.PythDeviation.selector, BTC_USD * 89 / 100, BTC_USD)
                );
                oracle.price();
                vm.revertToState(gate);
            }
            if (!_unhealthy(a1)) continue;
            vm.startPrank(keeper);
            liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
            liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
            vm.stopPrank();
            cleared = step;
            break;
        }
        assertEq(cleared, 6, "both cleared at the first unhealthy step (-18%; 17.6% for a 7090 bps position)");
        assertEq(morpho.position(marketId, a1).borrowShares, 0);
        assertEq(morpho.position(marketId, a2).borrowShares, 0);
        assertGe(vault.previewRedeem(lenderShares) + 1, before, "no bad debt for vMUSD lenders");

        // Worst case: BTC drops 20% one minute after a Pyth push. The band holds liquidations until 600 s after the
        // push, no longer; at 601 s both positions clear, still with no bad debt.
        vm.revertToState(snap);
        uint256 px = BTC_USD * 80 / 100;
        vm.warp(t0 + 1 minutes);
        vm.roll(vm.getBlockNumber() + 15);
        skipOracle.setAnswer(int256(px));
        _repricePools(px);
        assertTrue(_unhealthy(a1) && _unhealthy(a2));
        vm.prank(keeper);
        vm.expectPartialRevert(IBtcMusdOracle.PythDeviation.selector);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
        vm.warp(t0 + bandAge);
        vm.roll(vm.getBlockNumber() + 135);
        vm.prank(keeper);
        vm.expectPartialRevert(IBtcMusdOracle.PythDeviation.selector);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
        vm.warp(t0 + bandAge + 1);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(keeper);
        liquidator.liquidate(a1, 0, Venue.BACKSTOP, 0);
        liquidator.liquidate(a2, 0, Venue.BACKSTOP, 0);
        vm.stopPrank();
        assertEq(morpho.position(marketId, a1).borrowShares, 0);
        assertEq(morpho.position(marketId, a2).borrowShares, 0);
        assertGe(vault.previewRedeem(lenderShares) + 1, before, "no bad debt after a 10-minute freeze");
    }

    function _stepCrash(uint256 t0, uint256 step) internal {
        vm.warp(t0 + step * 5 minutes);
        vm.roll(vm.getBlockNumber() + 80);
        uint256 px = BTC_USD * (100 - 3 * step) / 100;
        skipOracle.setAnswer(int256(px));
        _repricePools(px);
    }

    /// @dev Morpho's health check at the current Skip price (what the oracle would return without the band).
    function _unhealthy(address account) internal view returns (bool) {
        uint256 coll = IBorrowAccount(account).collateral();
        uint256 debt = IBorrowAccount(account).debt();
        uint256 value = coll * uint256(skipOracle.answer()) / 1e18;
        return value * M1_LLTV / 1e18 < debt;
    }

    // =============================================================================================================
    // R2X-3 (fixed): a direct M1 supplier's withdraw -> rebalance -> re-supply loop no longer triggers buffer top-ups;
    // a top-up in a touched block is sized on the larger of spot and the last checkpoint, at most one per block
    // =============================================================================================================

    /// @notice R2X-3 (fixed). Buffer top-ups used to ignore the same-block guard and the cooldown, so a direct M1
    /// supplier could withdraw its supply, call `rebalance()` (a top-up from vMUSD's wsMUSD leg) and re-supply, ten
    /// times in one transaction, pushing over 3,000 MUSD of vMUSD into M1 against the policy, for free, in every block.
    /// Now a top-up in a block where M1 was touched first is sized on the larger of spot and the last checkpoint's
    /// liquidity, and at most one runs per block. A real low (the supplier actually leaves) is still topped up.
    function test_fix_R2X3_transientWithdrawLoop_cannotTriggerTopUps() public {
        _depositVault(lender, 20_000e18);
        TransientWithdrawLooper looper = new TransientWithdrawLooper(
            morpho, IBaserateAllocator(address(allocator)), IERC20(address(musd)), allocator.marketParams()
        );
        musd.mint(address(looper), 12_000e18);
        looper.supply(12_000e18); // a standing M1 supply position, earning M1 interest
        _open(makeAddr("b1"), 0.05e18, 7000);
        assertEq(_vaultM1(), 0, "vMUSD has nothing in M1");
        _advanceWithCheckpoints(1 days);
        _nextBlock();
        _mockWsApy(0.3e18); // wsMUSD pays more on the trailing view: the policy keeps vMUSD out of M1
        (IBaserateAllocator.Action honest,, IBaserateAllocator.Snapshot memory s) = allocator.previewRebalance();
        assertLt(s.m1TrailingApy, s.wsMusdApy);
        assertEq(uint256(honest), uint256(IBaserateAllocator.Action.NONE), "honest policy: nothing moves");

        // The same loop in three consecutive blocks: the last checkpoint still sees the supplier's liquidity, so no
        // top-up runs at all, and the supplier just gets its supply back.
        uint256 own = looper.positionAssets();
        for (uint256 i; i < 3; ++i) {
            (uint256 moved, uint256 calls) = looper.attack(10);
            assertEq(calls, 0, "no top-up on a transient low");
            assertEq(moved, 0);
            _nextBlock();
        }
        assertEq(_vaultM1(), 0, "vMUSD still has nothing in M1");
        assertEq(allocator.lastTopUpAt(), 0);
        assertGe(looper.positionAssets() + 10, own, "the supplier keeps its supply (plus interest)");

        // A real low: the supplier really leaves (its own transaction). From the next block on the buffer is topped
        // up, one top-up per block.
        uint256 leaving = _m1Liquidity() - 100e18;
        vm.prank(address(looper));
        morpho.withdraw(params, leaving, 0, address(looper), address(looper));
        _nextBlock();
        (IBaserateAllocator.Action a, uint256 amount) = allocator.rebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, allocator.MAX_MOVE());
        (a, amount) = allocator.rebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.NONE), "one top-up per block");
        assertEq(amount, 0);
        _nextBlock();
        (a, amount) = allocator.rebalance();
        assertEq(uint256(a), uint256(IBaserateAllocator.Action.BUFFER_TOP_UP));
        assertEq(amount, 900e18, "the rest of the deficit to the 2,000 floor");
        assertEq(_m1Liquidity(), 2000e18);
    }

    // =============================================================================================================
    // R2X-4 (fixed): `forceDeallocate` on the wsMUSD liquidity adapter reverts while it is vMUSD's exit path, so nobody
    // can idle vMUSD's savings leg for free after a harvest; idle vault MUSD is parked again even during a cooldown
    // =============================================================================================================

    /// @notice R2X-4 (fixed). The liquidity adapter's force-deallocate penalty is 0, so anyone, with no vMUSD shares,
    /// could `forceDeallocate` vMUSD's whole wsMUSD position into vault idle right after a harvest: a direct wsMUSD
    /// holder then more than tripled its share of the vesting yield, vMUSD lenders lost theirs, and the keeper's
    /// allocator job saw nothing to do. The adapter now rejects `forceDeallocate` while it is the vault's liquidity
    /// adapter (every withdrawal reaches it anyway), and `rebalance` parks idle vault MUSD at once, also in the cooldown
    /// of a rate-driven move, with `readyAt()` telling the keeper to call.
    function test_fix_R2X4_forceDeallocateOnLiquidityAdapter_reverts() public {
        address attacker = makeAddr("attacker");
        uint256 lenderShares = _depositVault(lender, 20_000e18);
        _topUpUntilDone(); // M1 buffer met: the allocator is at rest (no pending action)
        (IBaserateAllocator.Action rest,,) = allocator.previewRebalance();
        assertEq(uint256(rest), uint256(IBaserateAllocator.Action.NONE));
        _fundApprove(attacker, 2000e18, address(ws));
        vm.prank(attacker);
        uint256 attackerWs = ws.deposit(2000e18, attacker);
        // A harvest: e.g. the FeeRouter's sMUSD leg, a PCV distribution, or a few days of sMUSD yield.
        musd.mint(address(ws), 300e18);
        ws.sync();
        uint256 snap = vm.snapshotState();

        // Control: everyone holds through the vesting (10 days also lets vMUSD's maxRate release all of it).
        skip(3 days);
        uint256 attackerControl = ws.previewRedeem(attackerWs);
        skip(7 days);
        uint256 lenderControl = vault.previewRedeem(lenderShares);
        vm.revertToState(snap);

        // The attack is rejected, for a stranger and for a vMUSD holder alike.
        uint256 held = liq.heldAssets();
        vm.prank(attacker);
        vm.expectRevert(IWsMusdLiquidityAdapter.ForceDeallocateDisabled.selector);
        vault.forceDeallocate(address(liq), "", held, attacker);
        vm.prank(lender);
        vm.expectRevert(IWsMusdLiquidityAdapter.ForceDeallocateDisabled.selector);
        vault.forceDeallocate(address(liq), "", 1000e18, lender);
        assertEq(liq.heldAssets(), held, "vMUSD's savings leg stays in wsMUSD");

        skip(3 days);
        uint256 attackerAfter = ws.previewRedeem(attackerWs);
        skip(7 days);
        uint256 lenderAfter = vault.previewRedeem(lenderShares);
        assertEq(attackerAfter, attackerControl, "the direct holder earns only its own share");
        assertEq(lenderAfter, lenderControl, "vMUSD lenders keep theirs");
        assertGt(lenderAfter, 20_000e18 + 200e18, "including their share of the harvest");

        // Idle vault MUSD (a sentinel deallocation is the only way left to idle the savings leg) is parked again by
        // the next rebalance, even inside the cooldown of a rate-driven move.
        _open(makeAddr("b1"), 0.05e18, 7000); // an M1 borrower: M1 pays
        _advanceWithCheckpoints(1 days);
        _nextBlock();
        _mockWsApy(0);
        (IBaserateAllocator.Action move,) = allocator.rebalance();
        assertEq(uint256(move), uint256(IBaserateAllocator.Action.TO_MARKET), "a rate-driven move starts the cooldown");
        uint256 cooldownEnd = uint256(allocator.lastRebalance()) + allocator.COOLDOWN();
        _nextBlock();
        vm.prank(curator); // a sentinel
        vault.deallocate(address(liq), "", 5000e18);
        assertEq(allocator.readyAt(), block.timestamp, "idle to park: the keeper calls now");
        vm.expectEmit(address(allocator));
        emit IBaserateAllocator.IdleAllocated(5000e18);
        (move,) = allocator.rebalance();
        assertEq(uint256(move), uint256(IBaserateAllocator.Action.NONE), "the rate move waits for the cooldown");
        assertEq(musd.balanceOf(address(vault)), 0, "the idle MUSD does not");
        assertEq(allocator.readyAt(), cooldownEnd);
        vm.clearMockedCalls();
    }

    // =============================================================================================================
    // R2X-5 (known): the FeeRouter's sMUSD leg can be sandwiched (permissionless distribute, instant sMUSD index)
    // =============================================================================================================

    /// @notice R2X-5 (known limitation). `FeeRouter.distribute()` is permissionless and sMUSD credits the donation to its
    /// holders at once, so MUSD deposited into sMUSD just before the call and withdrawn just after takes a share of the
    /// sMUSD leg (40% of fees) equal to its share of sMUSD's supply. Flash-borrowed MUSD makes that free: here Morpho
    /// flash-lends 60k MUSD of M1 liquidity against 100k of sMUSD and the sandwich takes over 30% of the leg in one
    /// transaction. It is bounded by the MUSD that can be borrowed for one transaction relative to sMUSD's supply
    /// (Mezo's Morpho held no MUSD to flash-lend at the pinned block; see the mainnet fork twin) and by the leg itself
    /// (a week of origination fees). It dilutes the yield sMUSD holders (wsMUSD among them) get from the leg; no
    /// principal is at risk. A fix needs vesting on sMUSD's side, which is Mezo's contract.
    function test_known_R2X5_feeRouterSmusdLeg_flashSandwich() public {
        _supplyM1(m1Lender, 60_000e18); // MUSD Morpho can flash-lend
        musd.mint(address(feeRouter), 1000e18); // a week of origination fees
        FeeSandwich s = new FeeSandwich(address(morpho), address(smusd), address(feeRouter), address(musd));
        IFeeRouter.Plan memory plan = feeRouter.previewDistribute();
        uint256 profit = s.attack(60_000e18);
        emit log_named_decimal_uint("sMUSD leg", plan.toSmusd, 18);
        emit log_named_decimal_uint("taken by a zero-capital sandwich", profit, 18);
        assertGt(profit, plan.toSmusd * 30 / 100, "over 30% of the sMUSD leg, no capital, one tx");
    }

    // =============================================================================================================
    // R2X-6: account spam makes the keeper's liquidation pass arbitrarily slow, cheaply
    // =============================================================================================================

    function test_R2X6_accountSpamCost() public {
        uint256 n = 200;
        uint256 g = gasleft();
        for (uint256 i; i < n; ++i) {
            factory.createAccount(address(uint160(0xB0B0000 + i)));
        }
        uint256 per = (g - gasleft()) / n + 21_000;
        // Mainnet gas price from docs/design/contracts.md section 1: 1.46e6 wei.
        uint256 costFor10k = per * 10_000 * 1.46e6;
        emit log_named_uint("gas per spam account (incl. 21k intrinsic)", per);
        emit log_named_decimal_uint("BTC to register 10,000 empty accounts on mainnet", costFor10k, 18);
        (address acct,) = factory.accountOf(address(uint160(0xB0B0000)), Profile.STANDARD);
        assertTrue(factory.isAccount(acct));
        assertEq(IBorrowAccount(acct).collateral(), 0);
        assertEq(IBorrowAccount(acct).debt(), 0);
        assertLt(costFor10k, 0.003e18, "under 0.003 BTC for 10k accounts the keeper must read every 12 s");
    }

    // =============================================================================================================
    // R2X-7: a 1-wei MUSD bribe makes the keeper skip the epoch's fee flush
    // =============================================================================================================

    function test_R2X7_oneWeiBribe_tripsKeeperFlushGuard() public {
        uint256 epochStart = block.timestamp - (block.timestamp % 7 days);
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), epochStart), 0);
        _fundApprove(stranger, 1, address(bribeA));
        vm.prank(stranger);
        bribeA.notifyRewardAmount(address(musd), 1); // permissionless on BribeVotingReward
        // apps/keeper feeFlushJob: `if (posted > 0n) return 'a MUSD bribe ... is already posted this epoch'`
        assertEq(bribeA.tokenRewardsPerEpoch(address(musd), epochStart), 1, "keeper now skips this epoch");
    }

    // =============================================================================================================
    // R2X-8: the keeper's depth sample (24 h minimum of spot quotes) can be zeroed by one skewed block
    // =============================================================================================================

    function test_R2X8_skewedPoolsZeroTheKeeperDepthSample() public {
        // Skew both pools for one block boundary: sell 0.06 BTC into the vAMM and move the CL price 5% down.
        address skewer = makeAddr("skewer");
        vm.deal(skewer, 0.06e18);
        vm.startPrank(skewer);
        IERC20(BTC).approve(address(vammRouter), 0.06e18);
        uint256 got = _sellVamm(0.06e18, skewer);
        vm.stopPrank();
        clPool.set(5e18, 5e18 * 76_000);
        (uint256 oracleValue, uint256[3] memory proceeds) = liquidator.quoteVenues(0.005e18);
        uint256 best = proceeds[1] > proceeds[2] ? proceeds[1] : proceeds[2];
        // keeper capsDepthJob: breaks on the first size whose best venue is > 4% under the oracle -> depth 0
        assertGt((oracleValue - best) * BPS, oracleValue * 400, "smallest size fails: depth sample = 0");
        emit log_named_decimal_uint("skew trade: BTC sold", 0.06e18, 18);
        emit log_named_decimal_uint("skew trade: MUSD received", got, 18);
        emit log_named_decimal_uint("backstop free cash (cap = min(2x, free + 0))", backstop.availableCash(), 18);
    }

    // =============================================================================================================
    // R2X-9 (fixed): a Backstop deposit between a liquidation purchase and the inventory sale is refused (deposits are
    // closed while BTC is held), so the incumbents keep the recovery they paid for
    // =============================================================================================================

    function test_fix_R2X9_depositBetweenPurchaseAndSale_isRefused() public {
        _supplyM1(m1Lender, 60_000e18);
        address acct = _open(makeAddr("b1"), 0.05e18, 7000);
        _crash(2000);
        uint256 lpShares = backstop.balanceOf(bpLp); // the incumbent: 5,000 MUSD seed
        address attacker = makeAddr("jit");
        address taker = makeAddr("taker");
        _fundApprove(taker, 100_000e18, address(backstop));
        uint256 stake = 50_000e18;
        _fundApprove(attacker, stake, address(backstop));
        uint256 snap = vm.snapshotState();

        // Control: the backstop buys the seized BTC, the auction sells it at factor 1.00, the incumbent keeps it all.
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.BACKSTOP, 0);
        uint256 inv = backstop.inventory();
        vm.prank(taker);
        backstop.takeAuction(inv, type(uint256).max, taker);
        skip(7 days);
        uint256 lpControl = backstop.convertToAssets(lpShares);
        vm.revertToState(snap);

        // Attack: same liquidation; the deposit right after it (same block) is refused.
        vm.prank(keeper);
        liquidator.liquidate(acct, 0, Venue.BACKSTOP, 0);
        assertEq(backstop.inventory(), inv);
        assertEq(backstop.maxDeposit(attacker), 0, "closed while holding");
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IBackstop.HoldingInventory.selector, inv));
        backstop.deposit(stake, attacker);
        vm.prank(taker);
        backstop.takeAuction(inv, type(uint256).max, taker);

        // After the sale the same deposit is priced at gross: it pays for the recovery still vesting.
        vm.prank(attacker);
        uint256 attShares = backstop.deposit(stake, attacker);
        skip(7 days);
        uint256 lpAfter = backstop.convertToAssets(lpShares);
        vm.prank(attacker);
        uint256 id = backstop.requestRedeem(attShares, attacker, attacker);
        skip(7 days);
        uint256 out = backstop.claimRedeem(id);

        emit log_named_decimal_uint("incumbent value after the cycle, control", lpControl, 18);
        emit log_named_decimal_uint("incumbent value after the cycle, with a late deposit", lpAfter, 18);
        emit log_named_decimal_uint("late depositor out - in (rounding)", stake - out, 18);
        assertGt(lpControl, BACKSTOP_SEED, "control: the incumbent who funded the purchase profits");
        assertApproxEqAbs(lpAfter, lpControl, 1e6, "and keeps the whole recovery with a late depositor around");
        assertLe(out, stake, "no profit for the late depositor");
    }

    function _sellVamm(uint256 btcIn, address to) internal returns (uint256) {
        ITigrisRouterLite.Route[] memory r = new ITigrisRouterLite.Route[](1);
        r[0] = ITigrisRouterLite.Route({from: BTC, to: address(musd), stable: false, factory: address(vammPool)});
        uint256[] memory amounts =
            ITigrisRouterLite(address(vammRouter)).swapExactTokensForTokens(btcIn, 0, r, to, block.timestamp);
        return amounts[1];
    }
}

interface ITigrisRouterLite {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @notice Mainnet-fork cross-check of the zero-precompile flows against Mezo's live sMUSD (with its PCV hook),
/// PoolsVoter and BribeVotingReward contracts. Counts calls into any Mezo precompile (0x7b7c...00xx: BTC, MEZO,
/// Skip and the rest). Run with -j 1; the RPC is flaky.
contract Round2MainnetForkBudgetTest is MezoFork {
    function test_fork_mainnet_savingsAndFeesTouchNoPrecompile() public {
        _fork(Net.MAINNET);
        _etchBtc();
        IERC20 m = IERC20(net.musd);
        WsMUSD w = new WsMUSD(net.musd, net.smusd, makeAddr("capAdmin"), 250_000e18);
        address user = makeAddr("user");
        deal(net.musd, user, 10_000e18);
        vm.startPrank(user);
        m.approve(address(w), type(uint256).max);
        vm.startStateDiffRecording();
        w.deposit(5000e18, user);
        _report("fork wsMUSD.deposit (real sMUSD + PCV hook)");
        skip(1 days);
        vm.startStateDiffRecording();
        w.sync();
        _report("fork wsMUSD.sync");
        vm.startStateDiffRecording();
        w.withdraw(1000e18, user, user);
        _report("fork wsMUSD.withdraw (real sMUSD withdraw + PCV hook)");
        vm.startStateDiffRecording();
        w.redeemInKind(500e18, user, user);
        _report("fork wsMUSD.redeemInKind");
        vm.stopPrank();

        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](2);
        t[0] = IFeeRouter.BribeTarget({gauge: net.gauge0, bribe: net.bribe0});
        t[1] = IFeeRouter.BribeTarget({gauge: net.gauge1, bribe: net.bribe1});
        FeeRouter r = new FeeRouter(net.musd, net.smusd, net.poolsVoter, makeAddr("treasury"), t);
        deal(net.musd, address(r), 1000e18);
        vm.startStateDiffRecording();
        r.distribute();
        _report("fork FeeRouter.distribute (live voter, bribes, sMUSD)");
    }

    /// @notice R2X-5 (known limitation; see `test_known_R2X5_feeRouterSmusdLeg_flashSandwich`) against the live
    /// contracts: a just-in-time sMUSD deposit around a FeeRouter `distribute()` wired to the live voter, bribes and
    /// sMUSD (with its PCV hook). Mainnet Morpho holds no MUSD at the pinned block, so the attacker uses its own MUSD
    /// here (any flash source works the same way; it is returned in the same tx). The share it takes is its share of
    /// sMUSD's supply, so doubling that supply for one transaction takes about half of the leg.
    function test_fork_mainnet_known_R2X5_jitAroundDistributeOnLiveSmusd() public {
        _fork(Net.MAINNET);
        _etchBtc();
        IFeeRouter.BribeTarget[] memory t = new IFeeRouter.BribeTarget[](2);
        t[0] = IFeeRouter.BribeTarget({gauge: net.gauge0, bribe: net.bribe0});
        t[1] = IFeeRouter.BribeTarget({gauge: net.gauge1, bribe: net.bribe1});
        FeeRouter r = new FeeRouter(net.musd, net.smusd, net.poolsVoter, makeAddr("treasury"), t);
        deal(net.musd, address(r), 1000e18);
        IFeeRouter.Plan memory plan = r.previewDistribute();
        uint256 supply = IERC20(net.smusd).totalSupply();
        uint256 capital = supply; // doubling sMUSD's supply for one transaction
        address att = makeAddr("jit");
        deal(net.musd, att, capital);
        vm.startPrank(att);
        IERC20(net.musd).approve(net.smusd, capital);
        ISMUSDLive(net.smusd).deposit(capital);
        r.distribute();
        ISMUSDLive(net.smusd).withdraw(capital);
        vm.stopPrank();
        uint256 profit = IERC20(net.musd).balanceOf(att) - capital;
        console2.log("live sMUSD supply (wei)", supply);
        console2.log("sMUSD leg of 1000 MUSD fees (wei)", plan.toSmusd);
        console2.log("JIT profit, same tx (wei)", profit);
        assertGt(profit, plan.toSmusd * 45 / 100, "about half of the sMUSD leg with capital = supply");
    }

    function _report(string memory flow) internal {
        VmSafe.AccountAccess[] memory a = vm.stopAndReturnStateDiff();
        uint256 calls;
        for (uint256 i; i < a.length; ++i) {
            VmSafe.AccountAccessKind k = a[i].kind;
            if (
                k != VmSafe.AccountAccessKind.Call && k != VmSafe.AccountAccessKind.StaticCall
                    && k != VmSafe.AccountAccessKind.DelegateCall && k != VmSafe.AccountAccessKind.CallCode
            ) continue;
            if (uint160(a[i].account) >> 16 == uint160(MezoAddresses.BTC) >> 16) calls++;
        }
        console2.log(string.concat(flow, ": Mezo precompile calls = ", vm.toString(calls)));
        assertEq(calls, 0, flow);
    }
}

interface ISMUSDLive {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
}
