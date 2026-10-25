// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IIrm} from "morpho-blue/interfaces/IIrm.sol";
import {IMorpho, Id, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {IBaserateAllocator} from "../interfaces/IBaserateAllocator.sol";
import {IWsMusdLiquidityAdapter} from "../interfaces/IWsMusdLiquidityAdapter.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";

/// @title BaserateAllocator
/// @notice Holds vMUSD's allocator role and runs a fixed, permissionless policy:
/// 1. Buffer: M1's idle liquidity (supply - borrow) is kept at or above `max(2,000 MUSD, 15% of M1 supply)`, so
///    borrowers can always borrow. If it is below, vMUSD supplies the deficit regardless of rates.
/// 2. Excess: above the buffer, funds move between the wsMUSD liquidity adapter and M1 only by comparing M1's supply
///    APY (`IRM.borrowRateView * utilization * (1 - fee)`) with wsMUSD's trailing 7-day APY (ring buffer of
///    `convertToAssets(1e18)` checkpoints). A move never overshoots: the amount is bisected so the post-move M1 rate
///    still beats (or still trails) wsMUSD. M1 supply is never withdrawn below the buffer.
/// 3. Bounds: at most `MAX_MOVE` per call and a `COOLDOWN` between moves; every move fits the vault's absolute and
///    relative caps for all ids it touches (computed up front, so the vault's own checks never trip).
/// It also offers `withdraw`/`redeem` for vMUSD holders: idle and wsMUSD pay first, and only the shortfall is
/// deallocated from M1, without the force-deallocate penalty, because it is consumed by the same withdrawal.
/// @dev No owner, no parameters to change: the curator governs through vault caps and can revoke the role.
/// Manipulation surface: a borrower can spike M1 utilization to attract at most `MAX_MOVE` per `COOLDOWN` into M1
/// (inside the curator's caps), and wsMUSD's share price only moves through vested yield, so neither rate can be
/// pushed far within one block. APYs are annualized simple rates (WAD), compared like for like.
contract BaserateAllocator is IBaserateAllocator, ReentrancyGuardTransient {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;
    using SafeCast for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    /// @notice Minimum M1 idle liquidity kept for borrowers.
    uint256 public constant BUFFER_FLOOR = 2000e18;
    /// @notice M1 idle liquidity kept for borrowers, as a share of M1 supply (15%).
    uint256 public constant BUFFER_BPS = 1500;
    /// @notice Largest M1 move per rebalance.
    uint256 public constant MAX_MOVE = 1000e18;
    /// @notice Moves smaller than this are skipped (dust).
    uint256 public constant MIN_MOVE = 1e18;
    /// @notice Minimum time between two moves.
    uint256 public constant COOLDOWN = 1 hours;
    /// @notice Minimum time between two wsMUSD checkpoints.
    uint256 public constant CHECKPOINT_INTERVAL = 1 hours;
    /// @notice Look-back of the wsMUSD trailing APY.
    uint256 public constant APY_WINDOW = 7 days;
    /// @notice APY-driven moves need at least this much wsMUSD history (buffer top-ups do not).
    uint256 public constant MIN_APY_WINDOW = 1 days;
    /// @notice Ring buffer size: 8 days of hourly checkpoints.
    uint256 public constant CHECKPOINT_CAPACITY = 192;
    /// @notice Bisection steps used to size an APY-driven move (resolution `MAX_MOVE / 2**8`).
    uint256 internal constant BISECTION_STEPS = 8;

    /// @dev Inputs of a post-move M1 APY check: market totals, the wsMUSD APY and the direction of the move.
    struct Simulation {
        MarketParams params;
        Market market;
        uint256 supply;
        uint256 borrow;
        uint256 wsApy;
        bool toMarket;
    }

    /// @inheritdoc IBaserateAllocator
    address public immutable VAULT;
    /// @inheritdoc IBaserateAllocator
    address public immutable LIQUIDITY_ADAPTER;
    /// @inheritdoc IBaserateAllocator
    address public immutable MARKET_ADAPTER;
    /// @inheritdoc IBaserateAllocator
    address public immutable MORPHO;
    /// @inheritdoc IBaserateAllocator
    address public immutable WSMUSD;
    /// @inheritdoc IBaserateAllocator
    address public immutable MUSD;
    /// @inheritdoc IBaserateAllocator
    bytes32 public immutable MARKET_ID;

    address internal immutable COLLATERAL_TOKEN;
    address internal immutable ORACLE;
    address internal immutable IRM;
    uint256 internal immutable LLTV;

    /// @dev Vault cap ids touched by M1 moves: the adapter id, the collateral id and the market id.
    bytes32 internal immutable ADAPTER_ID;
    bytes32 internal immutable COLLATERAL_ID;
    bytes32 internal immutable MARKET_PARAMS_ID;
    /// @dev The wsMUSD liquidity adapter's only cap id.
    bytes32 internal immutable LIQUIDITY_ID;

    Checkpoint[CHECKPOINT_CAPACITY] internal _checkpoints;
    /// @inheritdoc IBaserateAllocator
    uint256 public checkpointCount;
    /// @inheritdoc IBaserateAllocator
    uint64 public lastRebalance;

    /// @param vault The vMUSD Vault V2 (this contract must be granted its allocator role).
    /// @param liquidityAdapter The vault's WsMusdLiquidityAdapter.
    /// @param marketAdapter The vault's MorphoMarketV1AdapterV2.
    /// @param params The M1 market (MUSD loan); it must already exist on Morpho and use the adapter's IRM.
    constructor(address vault, address liquidityAdapter, address marketAdapter, MarketParams memory params) {
        if (vault == address(0) || liquidityAdapter == address(0) || marketAdapter == address(0)) {
            revert ZeroAddress();
        }
        if (IWsMusdLiquidityAdapter(liquidityAdapter).parentVault() != vault) revert AdapterMismatch();
        if (IMorphoMarketV1AdapterV2Lite(marketAdapter).parentVault() != vault) revert AdapterMismatch();
        address musd = IVaultV2(vault).asset();
        if (params.loanToken != musd) revert AssetMismatch();
        if (params.irm != IMorphoMarketV1AdapterV2Lite(marketAdapter).adaptiveCurveIrm()) revert IrmMismatch();
        address morpho = IMorphoMarketV1AdapterV2Lite(marketAdapter).morpho();
        Id id = params.id();
        if (IMorpho(morpho).market(id).lastUpdate == 0) revert MarketNotCreated();

        VAULT = vault;
        LIQUIDITY_ADAPTER = liquidityAdapter;
        MARKET_ADAPTER = marketAdapter;
        MORPHO = morpho;
        WSMUSD = IWsMusdLiquidityAdapter(liquidityAdapter).wsMusd();
        MUSD = musd;
        MARKET_ID = Id.unwrap(id);
        COLLATERAL_TOKEN = params.collateralToken;
        ORACLE = params.oracle;
        IRM = params.irm;
        LLTV = params.lltv;

        ADAPTER_ID = IMorphoMarketV1AdapterV2Lite(marketAdapter).adapterId();
        COLLATERAL_ID = keccak256(abi.encode("collateralToken", params.collateralToken));
        MARKET_PARAMS_ID = keccak256(abi.encode("this/marketParams", marketAdapter, params));
        LIQUIDITY_ID = IWsMusdLiquidityAdapter(liquidityAdapter).adapterId();

        _checkpoint();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Permissionless entry points
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBaserateAllocator
    function checkpoint() external nonReentrant returns (bool recorded) {
        recorded = _checkpoint();
    }

    /// @inheritdoc IBaserateAllocator
    function rebalance() external nonReentrant returns (Action action, uint256 amount) {
        uint256 ready = readyAt();
        if (block.timestamp < ready) revert CooldownActive(ready);

        _checkpoint();
        MarketParams memory params = marketParams();
        // Accrue so the market totals are current and the IRM view returns the instantaneous rate.
        IMorpho(MORPHO).accrueInterest(params);

        Snapshot memory s = _snapshot(params);
        (action, amount) = _plan(params, s);
        emit Rebalanced(action, amount, s.m1SupplyApy, s.wsMusdApy, s.apyWindow, s.m1Liquidity, s.bufferTarget);

        if (action != Action.NONE) {
            // forge-lint: disable-next-line(unsafe-typecast)
            lastRebalance = uint64(block.timestamp);
            if (action == Action.TO_LIQUIDITY) {
                IVaultV2(VAULT).deallocate(MARKET_ADAPTER, abi.encode(params), amount);
                IVaultV2(VAULT).allocate(LIQUIDITY_ADAPTER, "", amount);
            } else {
                uint256 fromIdle = Math.min(amount, s.vaultIdle);
                if (amount > fromIdle) IVaultV2(VAULT).deallocate(LIQUIDITY_ADAPTER, "", amount - fromIdle);
                IVaultV2(VAULT).allocate(MARKET_ADAPTER, abi.encode(params), amount);
            }
        }

        _allocateIdle();
    }

    /// @inheritdoc IBaserateAllocator
    function withdraw(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        _pullFromMarket(assets);
        shares = IVaultV2(VAULT).withdraw(assets, receiver, msg.sender);
    }

    /// @inheritdoc IBaserateAllocator
    function redeem(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        _pullFromMarket(IVaultV2(VAULT).previewRedeem(shares));
        assets = IVaultV2(VAULT).redeem(shares, receiver, msg.sender);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBaserateAllocator
    function previewRebalance() external view returns (Action action, uint256 amount, Snapshot memory s) {
        MarketParams memory params = marketParams();
        s = _snapshot(params);
        (action, amount) = _plan(params, s);
    }

    /// @inheritdoc IBaserateAllocator
    function snapshot() external view returns (Snapshot memory) {
        return _snapshot(marketParams());
    }

    /// @inheritdoc IBaserateAllocator
    function m1SupplyApy() external view returns (uint256) {
        MarketParams memory params = marketParams();
        Market memory m = _expectedMarket(params);
        return _supplyApy(params, m, m.totalSupplyAssets, m.totalBorrowAssets);
    }

    /// @inheritdoc IBaserateAllocator
    function wsMusdApy() public view returns (uint256 apy, uint256 window) {
        uint256 count = checkpointCount;
        uint256 n = Math.min(count, CHECKPOINT_CAPACITY);
        if (n == 0) return (0, 0);
        uint256 first = count - n;
        uint256 target = block.timestamp > APY_WINDOW ? block.timestamp - APY_WINDOW : 0;

        // Latest retained checkpoint at or before `target`; the oldest one if history is shorter than the window.
        uint256 lo = 0;
        uint256 hi = n;
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            if (_checkpoints[(first + mid) % CHECKPOINT_CAPACITY].timestamp <= target) lo = mid;
            else hi = mid;
        }
        Checkpoint memory c = _checkpoints[(first + lo) % CHECKPOINT_CAPACITY];

        window = block.timestamp - c.timestamp;
        uint256 priceNow = IERC4626(WSMUSD).convertToAssets(1e18);
        if (window == 0 || priceNow <= c.sharePrice) return (0, window);
        apy = Math.mulDiv(priceNow - c.sharePrice, WAD * YEAR, uint256(c.sharePrice) * window);
    }

    /// @inheritdoc IBaserateAllocator
    function checkpointAt(uint256 i) external view returns (Checkpoint memory) {
        uint256 count = checkpointCount;
        uint256 n = Math.min(count, CHECKPOINT_CAPACITY);
        if (i >= n) revert IndexOutOfRange(i, n);
        return _checkpoints[(count - n + i) % CHECKPOINT_CAPACITY];
    }

    /// @inheritdoc IBaserateAllocator
    function readyAt() public view returns (uint256) {
        uint256 last = lastRebalance;
        return last == 0 ? 0 : last + COOLDOWN;
    }

    /// @inheritdoc IBaserateAllocator
    function marketParams() public view returns (MarketParams memory) {
        return MarketParams({loanToken: MUSD, collateralToken: COLLATERAL_TOKEN, oracle: ORACLE, irm: IRM, lltv: LLTV});
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Decision inputs at this block (market totals with interest accrued to now).
    function _snapshot(MarketParams memory params) internal view returns (Snapshot memory s) {
        Market memory m = _expectedMarket(params);
        s.m1SupplyAssets = m.totalSupplyAssets;
        s.m1BorrowAssets = m.totalBorrowAssets;
        s.m1Liquidity = s.m1SupplyAssets > s.m1BorrowAssets ? s.m1SupplyAssets - s.m1BorrowAssets : 0;
        s.bufferTarget = _bufferTarget(s.m1SupplyAssets);
        s.m1SupplyApy = _supplyApy(params, m, s.m1SupplyAssets, s.m1BorrowAssets);
        (s.wsMusdApy, s.apyWindow) = wsMusdApy();
        s.vaultMarketAssets = IMorphoMarketV1AdapterV2Lite(MARKET_ADAPTER).expectedSupplyAssets(MARKET_ID);
        s.vaultIdle = IERC20(MUSD).balanceOf(VAULT);
        s.liquidityAvailable = _liquidityAvailable();
    }

    /// @dev The buffer rule first, then the APY rule on the excess. Amounts respect `MAX_MOVE`, the vault caps and
    /// what each side can release.
    function _plan(MarketParams memory params, Snapshot memory s) internal view returns (Action, uint256) {
        if (s.m1Liquidity < s.bufferTarget) return _planBufferTopUp(s);
        if (s.apyWindow < MIN_APY_WINDOW) return (Action.NONE, 0);
        if (s.m1SupplyApy > s.wsMusdApy) return _planToMarket(params, s);
        if (s.m1SupplyApy < s.wsMusdApy) return _planToLiquidity(params, s);
        return (Action.NONE, 0);
    }

    /// @dev Supplying x raises liquidity by x but the 15% target by only 0.15x, so the deficit closes at
    /// x = max(floor - L, (0.15 S - L) / 0.85). Rates are not consulted.
    function _planBufferTopUp(Snapshot memory s) internal view returns (Action, uint256) {
        uint256 liquidity = s.m1Liquidity;
        uint256 needed = BUFFER_FLOOR > liquidity ? BUFFER_FLOOR - liquidity : 0;
        uint256 pct = s.m1SupplyAssets * BUFFER_BPS;
        if (pct > liquidity * BPS) needed = Math.max(needed, Math.ceilDiv(pct - liquidity * BPS, BPS - BUFFER_BPS));
        uint256 amount = Math.min(Math.min(needed, MAX_MOVE), _roomToMarket(s));
        return amount >= MIN_MOVE ? (Action.BUFFER_TOP_UP, amount) : (Action.NONE, 0);
    }

    /// @dev M1 pays more: supply as much as keeps M1's post-move APY above wsMUSD's.
    function _planToMarket(MarketParams memory params, Snapshot memory s) internal view returns (Action, uint256) {
        uint256 maxAmount = Math.min(MAX_MOVE, _roomToMarket(s));
        uint256 amount = _bisect(_simulation(params, s, true), maxAmount);
        return amount >= MIN_MOVE ? (Action.TO_MARKET, amount) : (Action.NONE, 0);
    }

    /// @dev wsMUSD pays more: withdraw M1 supply above the buffer, as much as keeps M1's post-move APY below wsMUSD's.
    /// Withdrawing x lowers liquidity by x but the 15% target by 0.15x: x <= min(L - floor, (L - 0.15 S) / 0.85).
    function _planToLiquidity(MarketParams memory params, Snapshot memory s) internal view returns (Action, uint256) {
        uint256 liquidity = s.m1Liquidity;
        uint256 pct = s.m1SupplyAssets * BUFFER_BPS;
        uint256 excess = 0;
        if (liquidity > BUFFER_FLOOR && liquidity * BPS > pct) {
            excess = Math.min(liquidity - BUFFER_FLOOR, (liquidity * BPS - pct) / (BPS - BUFFER_BPS));
        }
        uint256 maxAmount = Math.min(Math.min(MAX_MOVE, excess), Math.min(s.vaultMarketAssets, _roomToLiquidity()));
        uint256 amount = _bisect(_simulation(params, s, false), maxAmount);
        return amount >= MIN_MOVE ? (Action.TO_LIQUIDITY, amount) : (Action.NONE, 0);
    }

    function _simulation(MarketParams memory params, Snapshot memory s, bool toMarket)
        internal
        view
        returns (Simulation memory)
    {
        return Simulation({
            params: params,
            market: _expectedMarket(params),
            supply: s.m1SupplyAssets,
            borrow: s.m1BorrowAssets,
            wsApy: s.wsMusdApy,
            toMarket: toMarket
        });
    }

    /// @dev Largest amount in [0, maxAmount] (to `maxAmount / 2**BISECTION_STEPS`) whose post-move M1 supply APY is
    /// still strictly above (`toMarket`) or strictly below (`!toMarket`) wsMUSD's. The APY is monotonic in supply.
    function _bisect(Simulation memory sim, uint256 maxAmount) internal view returns (uint256) {
        if (maxAmount == 0) return 0;
        if (_keepsSide(sim, maxAmount)) return maxAmount;
        uint256 lo = 0;
        uint256 hi = maxAmount;
        for (uint256 i; i < BISECTION_STEPS; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (_keepsSide(sim, mid)) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    function _keepsSide(Simulation memory sim, uint256 amount) internal view returns (bool) {
        if (sim.toMarket) return _supplyApy(sim.params, sim.market, sim.supply + amount, sim.borrow) > sim.wsApy;
        return _supplyApy(sim.params, sim.market, sim.supply - amount, sim.borrow) < sim.wsApy;
    }

    /// @dev `borrowRateView * utilization * (1 - fee) * 365 days` for hypothetical totals. `m` carries the market's
    /// fee and `lastUpdate == now`, so the AdaptiveCurveIrm returns the instantaneous rate at `rateAtTarget`.
    function _supplyApy(MarketParams memory params, Market memory m, uint256 supply, uint256 borrow)
        internal
        view
        returns (uint256)
    {
        if (supply == 0 || borrow == 0) return 0;
        m.totalSupplyAssets = supply.toUint128();
        m.totalBorrowAssets = borrow.toUint128();
        uint256 borrowRate = IIrm(params.irm).borrowRateView(params, m);
        uint256 utilization = Math.min(Math.mulDiv(borrow, WAD, supply), WAD);
        return Math.mulDiv(borrowRate * YEAR, utilization * (WAD - m.fee), WAD * WAD);
    }

    /// @dev The market with interest accrued to now and `lastUpdate = now`.
    function _expectedMarket(MarketParams memory params) internal view returns (Market memory m) {
        m = IMorpho(MORPHO).market(Id.wrap(MARKET_ID));
        (uint256 supply, uint256 supplyShares, uint256 borrow,) = IMorpho(MORPHO).expectedMarketBalances(params);
        m.totalSupplyAssets = supply.toUint128();
        m.totalSupplyShares = supplyShares.toUint128();
        m.totalBorrowAssets = borrow.toUint128();
        m.lastUpdate = block.timestamp.toUint128();
    }

    function _bufferTarget(uint256 supply) internal pure returns (uint256) {
        return Math.max(BUFFER_FLOOR, supply * BUFFER_BPS / BPS);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Caps and liquidity
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev MUSD that can move into M1: bounded by what vault idle + the liquidity adapter can release and by the
    /// cap room of the market adapter's three ids, net of interest the next allocation will book.
    function _roomToMarket(Snapshot memory s) internal view returns (uint256) {
        uint256 source = s.vaultIdle + s.liquidityAvailable;
        uint256 recorded = IVaultV2(VAULT).allocation(MARKET_PARAMS_ID);
        uint256 accrued = s.vaultMarketAssets > recorded ? s.vaultMarketAssets - recorded : 0;
        uint256 room =
            Math.min(_idRoom(ADAPTER_ID, 0), Math.min(_idRoom(COLLATERAL_ID, 0), _idRoom(MARKET_PARAMS_ID, 0)));
        room = room > accrued ? room - accrued : 0;
        return Math.min(source, room);
    }

    /// @dev MUSD that can move into the liquidity adapter: its next allocation is `heldAssets + x`.
    function _roomToLiquidity() internal view returns (uint256) {
        return _idRoom(LIQUIDITY_ID, IWsMusdLiquidityAdapter(LIQUIDITY_ADAPTER).heldAssets());
    }

    /// @dev Room under `id`'s absolute and relative caps. `floorAllocation` overrides the recorded allocation when
    /// larger (the liquidity adapter books its full position on the next allocation).
    function _idRoom(bytes32 id, uint256 floorAllocation) internal view returns (uint256 room) {
        IVaultV2 vault = IVaultV2(VAULT);
        uint256 alloc = Math.max(vault.allocation(id), floorAllocation);
        uint256 absCap = vault.absoluteCap(id);
        room = absCap > alloc ? absCap - alloc : 0;
        uint256 relCap = vault.relativeCap(id);
        if (relCap < WAD) {
            uint256 total = vault.firstTotalAssets();
            if (total == 0) total = vault.totalAssets();
            uint256 limit = Math.mulDiv(total, relCap, WAD);
            room = Math.min(room, limit > alloc ? limit - alloc : 0);
        }
    }

    /// @dev MUSD the vault's exit path can take from the liquidity adapter right now.
    function _liquidityAvailable() internal view returns (uint256) {
        if (IVaultV2(VAULT).liquidityAdapter() != LIQUIDITY_ADAPTER) return 0;
        if (IVaultV2(VAULT).allocation(LIQUIDITY_ID) == 0) return 0;
        return IWsMusdLiquidityAdapter(LIQUIDITY_ADAPTER).availableLiquidity();
    }

    /// @dev Parks MUSD idle in the vault in the liquidity adapter, within its caps.
    function _allocateIdle() internal {
        if (IVaultV2(VAULT).liquidityAdapter() != LIQUIDITY_ADAPTER) return;
        uint256 idleAssets = Math.min(IERC20(MUSD).balanceOf(VAULT), _roomToLiquidity());
        if (idleAssets < MIN_MOVE || IVaultV2(VAULT).absoluteCap(LIQUIDITY_ID) == 0) return;
        IVaultV2(VAULT).allocate(LIQUIDITY_ADAPTER, "", idleAssets);
        emit IdleAllocated(idleAssets);
    }

    /// @dev Deallocates from M1 only what vault idle plus the liquidity adapter cannot pay of `assets`.
    function _pullFromMarket(uint256 assets) internal {
        uint256 liquid = IERC20(MUSD).balanceOf(VAULT) + _liquidityAvailable();
        if (assets <= liquid) return;
        MarketParams memory params = marketParams();
        (uint256 supply,, uint256 borrow,) = IMorpho(MORPHO).expectedMarketBalances(params);
        uint256 marketLiquidity = supply > borrow ? supply - borrow : 0;
        uint256 position = IMorphoMarketV1AdapterV2Lite(MARKET_ADAPTER).expectedSupplyAssets(MARKET_ID);
        uint256 pull = Math.min(assets - liquid, Math.min(position, marketLiquidity));
        if (pull == 0) return;
        IVaultV2(VAULT).deallocate(MARKET_ADAPTER, abi.encode(params), pull);
        emit MarketLiquidityPulled(msg.sender, pull);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Checkpoints
    // ---------------------------------------------------------------------------------------------------------------

    function _checkpoint() internal returns (bool) {
        uint256 count = checkpointCount;
        if (count != 0) {
            uint256 last = _checkpoints[(count - 1) % CHECKPOINT_CAPACITY].timestamp;
            if (block.timestamp < last + CHECKPOINT_INTERVAL) return false;
        }
        uint256 price = IERC4626(WSMUSD).convertToAssets(1e18);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 ts = uint64(block.timestamp);
        _checkpoints[count % CHECKPOINT_CAPACITY] = Checkpoint({timestamp: ts, sharePrice: price.toUint192()});
        checkpointCount = count + 1;
        emit CheckpointRecorded(count, ts, price);
        return true;
    }
}
