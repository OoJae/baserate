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
///    borrowers can always borrow. If it is below, vMUSD supplies the deficit regardless of rates. A buffer top-up
///    ignores the cooldown and does not start it, so no earlier move can delay one. At most one top-up runs per block,
///    and when M1 was touched earlier in the block (its totals may hold a transient borrow or withdrawal) the deficit
///    is measured on the larger of spot liquidity and the last checkpoint's, so a transient low inside a transaction
///    cannot trigger one (round-2 audit R2X-3).
/// 2. Excess: above the buffer, funds move between the wsMUSD liquidity adapter and M1 only when two views agree:
///    - the direction comes from trailing, realized APYs over the same checkpoint window (about 7 days, at least 1):
///      the growth of M1's supply-share price against the growth of wsMUSD's `convertToAssets(1e18)`. Neither moves
///      inside a transaction: supplying, withdrawing, borrowing or repaying does not change a share price (only
///      accrued interest and realized bad debt do), and Morpho accrues interest on the state left by earlier blocks;
///    - the size comes from the spot rate: the amount is bisected so M1's post-move supply APY
///      (`IRM.borrowRateView * utilization * (1 - fee)`) still beats (or still trails) wsMUSD's trailing APY.
///    Rate-driven moves only run on M1 state left by earlier blocks: when M1 was touched earlier in the same block
///    (Morpho's `lastUpdate == now`), its totals may hold a transient supply, repay or borrow, and nothing moves.
///    Anyone can therefore cancel a block's rate-driven move at no cost (a bare `Morpho.accrueInterest` first): a
///    liveness cost only, kept because sizing on transient totals would be worse (round-2 audit R2V-4).
/// 3. `TO_LIQUIDITY` is sized on a conservative M1 liquidity: vMUSD's own M1 position plus the lowest "external"
///    liquidity (M1 supply by others minus borrow) seen now and at every checkpoint of the last `LIQUIDITY_WINDOW`.
///    A move never leaves that conservative liquidity below the buffer, so M1 liquidity that appeared in the last day
///    (outside supply, repayments) is never what vMUSD withdraws against. A checkpoint taken in a block where M1 was
///    already touched carries the previous external liquidity forward, so neither a transient high nor a transient
///    low (a borrow, `checkpoint()`, repay in one transaction; round-2 audit R2V-3) is ever recorded.
/// 4. Bounds: at most `MAX_MOVE` per call and a `COOLDOWN` between rate-driven moves; every move fits the vault's
///    absolute and relative caps for all ids it touches (computed up front, so the vault's own checks never trip).
/// 5. Idle: MUSD idle in the vault is parked in the liquidity adapter (within its caps) at the end of every
///    `rebalance`, including during the cooldown, where a pending rate-driven move is skipped instead of reverting.
/// It also offers `withdraw`/`redeem` for vMUSD holders: idle and wsMUSD pay first and only the shortfall is
/// deallocated from M1, without the force-deallocate penalty, because it is consumed by the same withdrawal. If the
/// wsMUSD leg reverts (for instance sMUSD's withdraw is broken), the exit is retried M1-first, so the M1-backed part of
/// vMUSD always exits penalty-free.
/// @dev No owner, no parameters to change: the curator governs through vault caps and can revoke the role.
/// Remaining manipulation surface, each bounded by `MAX_MOVE` per call and the curator's caps:
/// - a borrower (or an outside supplier withdrawing) can lower M1 liquidity across a block boundary to trigger a buffer
///   top-up, at most one per block; it only adds M1 liquidity (a yield drag at worst);
/// - touching M1 earlier in a block skips that block's rate-driven move, and sizes that block's top-up on the larger of
///   spot and the last checkpoint (liveness only); an actor who touches M1 before every checkpoint keeps the recorded
///   external liquidity at its last untouched value, which is no weaker than a window with no checkpoints (spot only);
/// - capital parked in M1 across blocks moves the spot sizing, not the direction, and for a day it is excluded from the
///   liquidity `TO_LIQUIDITY` withdraws against.
/// The trailing direction lags real rate changes by up to the window. APYs are annualized simple rates (WAD).
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
    /// @notice Minimum time between two rate-driven moves (buffer top-ups are exempt).
    uint256 public constant COOLDOWN = 1 hours;
    /// @notice Minimum time between two checkpoints.
    uint256 public constant CHECKPOINT_INTERVAL = 1 hours;
    /// @notice Look-back of the trailing APYs.
    uint256 public constant APY_WINDOW = 7 days;
    /// @notice APY-driven moves need at least this much checkpoint history (buffer top-ups do not).
    uint256 public constant MIN_APY_WINDOW = 1 days;
    /// @notice Look-back of the conservative M1 liquidity that `TO_LIQUIDITY` is sized on.
    uint256 public constant LIQUIDITY_WINDOW = 1 days;
    /// @notice Ring buffer size: 8 days of hourly checkpoints.
    uint256 public constant CHECKPOINT_CAPACITY = 192;
    /// @notice Bisection steps used to size an APY-driven move (resolution `MAX_MOVE / 2**8`).
    uint256 internal constant BISECTION_STEPS = 8;
    /// @dev M1's supply-share price is quoted in MUSD wei per 1e24 shares (Morpho mints 1e6 shares per wei at par).
    uint256 internal constant M1_PRICE_SHARES = 1e24;
    /// @dev Morpho Blue's virtual shares and assets (SharesMathLib).
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

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
    /// @inheritdoc IBaserateAllocator
    uint64 public lastTopUpAt;

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

        _checkpoint(_marketTouched());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Permissionless entry points
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBaserateAllocator
    function checkpoint() external nonReentrant returns (bool recorded) {
        recorded = _checkpoint(_marketTouched());
    }

    /// @inheritdoc IBaserateAllocator
    function rebalance() external nonReentrant returns (Action action, uint256 amount) {
        // Read before this contract's own accrual below touches M1.
        bool touched = _marketTouched();
        _checkpoint(touched);
        MarketParams memory params = marketParams();
        // Accrue so the market totals are current and the IRM view returns the instantaneous rate.
        IMorpho(MORPHO).accrueInterest(params);

        Snapshot memory s = _snapshot(params, touched);
        (action, amount) = _plan(params, s);
        if (action == Action.BUFFER_TOP_UP) {
            // Top-ups ignore the cooldown and do not start it (no earlier move can ever delay one), but at most one
            // runs per block.
            // forge-lint: disable-next-line(unsafe-typecast)
            lastTopUpAt = uint64(block.timestamp);
        } else {
            uint256 ready = _cooldownEnd();
            if (block.timestamp < ready) {
                // Rate-driven moves wait for the cooldown; idle vault MUSD is still parked (round-2 audit R2X-4).
                if (_idleToPark() < MIN_MOVE) revert CooldownActive(ready);
                (action, amount) = (Action.NONE, 0);
            } else if (action != Action.NONE) {
                // forge-lint: disable-next-line(unsafe-typecast)
                lastRebalance = uint64(block.timestamp);
            }
        }
        emit Rebalanced(action, amount, s.m1SupplyApy, s.wsMusdApy, s.apyWindow, s.m1Liquidity, s.bufferTarget);

        if (action == Action.TO_LIQUIDITY) {
            IVaultV2(VAULT).deallocate(MARKET_ADAPTER, abi.encode(params), amount);
            IVaultV2(VAULT).allocate(LIQUIDITY_ADAPTER, "", amount);
        } else if (action != Action.NONE) {
            uint256 fromIdle = Math.min(amount, s.vaultIdle);
            if (amount > fromIdle) IVaultV2(VAULT).deallocate(LIQUIDITY_ADAPTER, "", amount - fromIdle);
            IVaultV2(VAULT).allocate(MARKET_ADAPTER, abi.encode(params), amount);
        }

        _allocateIdle();
    }

    /// @inheritdoc IBaserateAllocator
    function withdraw(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        _pullFromMarket(assets, false);
        try IVaultV2(VAULT).withdraw(assets, receiver, msg.sender) returns (uint256 burnt) {
            shares = burnt;
        } catch {
            // The liquidity adapter could not pay (a reverting wsMUSD/sMUSD withdraw): pay from M1 first.
            _pullFromMarket(assets, true);
            shares = IVaultV2(VAULT).withdraw(assets, receiver, msg.sender);
        }
    }

    /// @inheritdoc IBaserateAllocator
    function redeem(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        _pullFromMarket(IVaultV2(VAULT).previewRedeem(shares), false);
        try IVaultV2(VAULT).redeem(shares, receiver, msg.sender) returns (uint256 paid) {
            assets = paid;
        } catch {
            _pullFromMarket(IVaultV2(VAULT).previewRedeem(shares), true);
            assets = IVaultV2(VAULT).redeem(shares, receiver, msg.sender);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBaserateAllocator
    function previewRebalance() external view returns (Action action, uint256 amount, Snapshot memory s) {
        MarketParams memory params = marketParams();
        s = _snapshot(params, _marketTouched());
        (action, amount) = _plan(params, s);
    }

    /// @inheritdoc IBaserateAllocator
    function snapshot() external view returns (Snapshot memory) {
        return _snapshot(marketParams(), _marketTouched());
    }

    /// @inheritdoc IBaserateAllocator
    function m1SupplyApy() external view returns (uint256) {
        MarketParams memory params = marketParams();
        Market memory m = _expectedMarket(params);
        return _supplyApy(params, m, m.totalSupplyAssets, m.totalBorrowAssets);
    }

    /// @inheritdoc IBaserateAllocator
    function wsMusdApy() external view returns (uint256 apy, uint256 window) {
        (apy,, window) = _trailingApys(_expectedMarket(marketParams()));
    }

    /// @inheritdoc IBaserateAllocator
    function m1TrailingApy() external view returns (uint256 apy, uint256 window) {
        (, apy, window) = _trailingApys(_expectedMarket(marketParams()));
    }

    /// @inheritdoc IBaserateAllocator
    function checkpointAt(uint256 i) external view returns (Checkpoint memory) {
        uint256 count = checkpointCount;
        uint256 n = Math.min(count, CHECKPOINT_CAPACITY);
        if (i >= n) revert IndexOutOfRange(i, n);
        return _checkpoints[(count - n + i) % CHECKPOINT_CAPACITY];
    }

    /// @inheritdoc IBaserateAllocator
    function readyAt() external view returns (uint256) {
        uint256 ready = _cooldownEnd();
        if (block.timestamp < ready) {
            if (_idleToPark() >= MIN_MOVE) return block.timestamp;
            MarketParams memory params = marketParams();
            (Action action,) = _plan(params, _snapshot(params, _marketTouched()));
            if (action == Action.BUFFER_TOP_UP) return block.timestamp;
        }
        return ready;
    }

    /// @inheritdoc IBaserateAllocator
    function marketParams() public view returns (MarketParams memory) {
        return MarketParams({loanToken: MUSD, collateralToken: COLLATERAL_TOKEN, oracle: ORACLE, irm: IRM, lltv: LLTV});
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Decision inputs at this block (market totals with interest accrued to now). `touched`: M1 was touched
    /// earlier in this block, so its totals may be transient.
    function _snapshot(MarketParams memory params, bool touched) internal view returns (Snapshot memory s) {
        Market memory m = _expectedMarket(params);
        s.m1SupplyAssets = m.totalSupplyAssets;
        s.m1BorrowAssets = m.totalBorrowAssets;
        s.m1Liquidity = s.m1SupplyAssets > s.m1BorrowAssets ? s.m1SupplyAssets - s.m1BorrowAssets : 0;
        s.bufferTarget = _bufferTarget(s.m1SupplyAssets);
        s.m1SupplyApy = _supplyApy(params, m, s.m1SupplyAssets, s.m1BorrowAssets);
        (s.wsMusdApy, s.m1TrailingApy, s.apyWindow) = _trailingApys(m);
        s.vaultMarketAssets = IMorphoMarketV1AdapterV2Lite(MARKET_ADAPTER).expectedSupplyAssets(MARKET_ID);
        s.vaultIdle = IERC20(MUSD).balanceOf(VAULT);
        s.liquidityAvailable = _liquidityAvailable();
        s.conservativeLiquidity = _conservativeLiquidity(s.m1Liquidity, s.vaultMarketAssets);
        s.marketTouched = touched;
    }

    /// @dev The buffer rule first, then the APY rule on the excess: the trailing APYs pick the direction and the spot
    /// model must agree (`_bisect` returns 0 otherwise). Amounts respect `MAX_MOVE`, the vault caps and what each side
    /// can release.
    function _plan(MarketParams memory params, Snapshot memory s) internal view returns (Action, uint256) {
        uint256 liquidity = _topUpLiquidity(s);
        if (liquidity < s.bufferTarget) return _planBufferTopUp(s, liquidity);
        if (s.marketTouched || s.apyWindow < MIN_APY_WINDOW) return (Action.NONE, 0);
        if (s.m1TrailingApy > s.wsMusdApy) return _planToMarket(params, s);
        if (s.m1TrailingApy < s.wsMusdApy) return _planToLiquidity(params, s);
        return (Action.NONE, 0);
    }

    /// @dev M1 liquidity a buffer top-up is sized on: spot, or, when M1 was touched earlier in the block (its totals may
    /// hold a transient borrow or withdrawal), the larger of spot and the last checkpoint's liquidity (its external
    /// liquidity plus vMUSD's current M1 position). A transient low can then never trigger or enlarge a top-up.
    function _topUpLiquidity(Snapshot memory s) internal view returns (uint256 liquidity) {
        liquidity = s.m1Liquidity;
        if (!s.marketTouched) return liquidity;
        // checkpointCount >= 1: the constructor records the first checkpoint.
        int256 recorded = SafeCast.toInt256(s.vaultMarketAssets)
            + _checkpoints[(checkpointCount - 1) % CHECKPOINT_CAPACITY].m1ExternalLiquidity;
        // forge-lint: disable-next-line(unsafe-typecast) recorded > 0 is checked first.
        if (recorded > 0 && uint256(recorded) > liquidity) liquidity = uint256(recorded);
    }

    /// @dev Supplying x raises liquidity by x but the 15% target by only 0.15x, so the deficit closes at
    /// x = max(floor - L, (0.15 S - L) / 0.85), with L from `_topUpLiquidity`. Rates are not consulted. At most one
    /// top-up per block.
    function _planBufferTopUp(Snapshot memory s, uint256 liquidity) internal view returns (Action, uint256) {
        if (lastTopUpAt == block.timestamp) return (Action.NONE, 0);
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
    /// Withdrawing x lowers liquidity by x but the 15% target by 0.15x: x <= min(L - floor, (L - 0.15 S) / 0.85), with
    /// L the conservative liquidity (<= spot), so the buffer holds both on spot and once recent outside supply leaves.
    function _planToLiquidity(MarketParams memory params, Snapshot memory s) internal view returns (Action, uint256) {
        uint256 liquidity = s.conservativeLiquidity;
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

    /// @dev Whether M1 was touched earlier in this block: Morpho stamps `lastUpdate` on the first interaction of a
    /// block, before any change to its supply or borrow totals.
    function _marketTouched() internal view returns (bool) {
        return IMorpho(MORPHO).market(Id.wrap(MARKET_ID)).lastUpdate == block.timestamp;
    }

    /// @dev M1's supply-share price: MUSD wei per `M1_PRICE_SHARES` shares, with Morpho's virtual shares and assets.
    function _m1SharePrice(Market memory m) internal pure returns (uint256) {
        return Math.mulDiv(
            M1_PRICE_SHARES,
            uint256(m.totalSupplyAssets) + VIRTUAL_ASSETS,
            uint256(m.totalSupplyShares) + VIRTUAL_SHARES
        );
    }

    /// @dev Trailing wsMUSD and M1 supply APYs against the latest retained checkpoint at or before `APY_WINDOW` ago
    /// (the oldest one while history is shorter), and the window they cover. `m` is M1 accrued to now.
    function _trailingApys(Market memory m) internal view returns (uint256 wsApy, uint256 m1Apy, uint256 window) {
        uint256 count = checkpointCount;
        uint256 n = Math.min(count, CHECKPOINT_CAPACITY);
        if (n == 0) return (0, 0, 0);
        uint256 first = count - n;
        uint256 target = block.timestamp > APY_WINDOW ? block.timestamp - APY_WINDOW : 0;

        uint256 lo = 0;
        uint256 hi = n;
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            if (_checkpoints[(first + mid) % CHECKPOINT_CAPACITY].timestamp <= target) lo = mid;
            else hi = mid;
        }
        Checkpoint memory c = _checkpoints[(first + lo) % CHECKPOINT_CAPACITY];

        window = block.timestamp - c.timestamp;
        if (window == 0) return (0, 0, 0);
        wsApy = _annualized(c.sharePrice, IERC4626(WSMUSD).convertToAssets(1e18), window);
        m1Apy = _annualized(c.m1SharePrice, _m1SharePrice(m), window);
    }

    /// @dev Simple annualized growth from `then` to `now_` over `window` seconds (WAD); 0 if it did not grow.
    function _annualized(uint256 then, uint256 now_, uint256 window) internal pure returns (uint256) {
        if (then == 0 || now_ <= then) return 0;
        return Math.mulDiv(now_ - then, WAD * YEAR, then * window);
    }

    /// @dev vMUSD's M1 position plus the lowest external M1 liquidity (`liquidity - vaultMarketAssets`) of now and of
    /// every checkpoint in the last `LIQUIDITY_WINDOW`, floored at 0. Never above `liquidity`.
    function _conservativeLiquidity(uint256 liquidity, uint256 vaultMarketAssets) internal view returns (uint256) {
        int256 external_ = SafeCast.toInt256(liquidity) - SafeCast.toInt256(vaultMarketAssets);
        uint256 count = checkpointCount;
        uint256 n = Math.min(count, CHECKPOINT_CAPACITY);
        for (uint256 i = 1; i <= n; ++i) {
            Checkpoint storage c = _checkpoints[(count - i) % CHECKPOINT_CAPACITY];
            if (uint256(c.timestamp) + LIQUIDITY_WINDOW < block.timestamp) break;
            if (c.m1ExternalLiquidity < external_) external_ = c.m1ExternalLiquidity;
        }
        int256 total = SafeCast.toInt256(vaultMarketAssets) + external_;
        // forge-lint: disable-next-line(unsafe-typecast)
        return total > 0 ? uint256(total) : 0;
    }

    /// @dev End of the cooldown that follows a rate-driven move (0 before the first one).
    function _cooldownEnd() internal view returns (uint256) {
        uint256 last = lastRebalance;
        return last == 0 ? 0 : last + COOLDOWN;
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
        uint256 idleAssets = _idleToPark();
        if (idleAssets < MIN_MOVE) return;
        IVaultV2(VAULT).allocate(LIQUIDITY_ADAPTER, "", idleAssets);
        emit IdleAllocated(idleAssets);
    }

    /// @dev MUSD idle in the vault that the liquidity adapter can take now (0 unless it is the vault's liquidity
    /// adapter with a non-zero cap).
    function _idleToPark() internal view returns (uint256) {
        IVaultV2 vault = IVaultV2(VAULT);
        if (vault.liquidityAdapter() != LIQUIDITY_ADAPTER || vault.absoluteCap(LIQUIDITY_ID) == 0) return 0;
        return Math.min(IERC20(MUSD).balanceOf(VAULT), _roomToLiquidity());
    }

    /// @dev Deallocates from M1 what vault idle (plus, unless `marketFirst`, the liquidity adapter) cannot pay of
    /// `assets`, within vMUSD's M1 position and M1's liquidity.
    function _pullFromMarket(uint256 assets, bool marketFirst) internal {
        uint256 liquid = IERC20(MUSD).balanceOf(VAULT);
        if (!marketFirst) liquid += _liquidityAvailable();
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

    /// @dev Records wsMUSD's share price, M1's supply-share price and M1's external liquidity, at most hourly. When M1
    /// was touched earlier in this block (`touched`) its totals may be transient in either direction (a supply or
    /// repay, a borrow or withdrawal undone later in the transaction), so the previous checkpoint's external
    /// liquidity is carried forward unchanged (round-2 audit R2V-3). Share prices do not move inside a transaction.
    function _checkpoint(bool touched) internal returns (bool) {
        uint256 count = checkpointCount;
        int256 external_;
        if (count != 0) {
            Checkpoint storage last = _checkpoints[(count - 1) % CHECKPOINT_CAPACITY];
            if (block.timestamp < last.timestamp + CHECKPOINT_INTERVAL) return false;
            if (touched) external_ = last.m1ExternalLiquidity;
        }
        Market memory m = _expectedMarket(marketParams());
        if (count == 0 || !touched) {
            external_ = SafeCast.toInt256(m.totalSupplyAssets) - SafeCast.toInt256(m.totalBorrowAssets)
                - SafeCast.toInt256(IMorphoMarketV1AdapterV2Lite(MARKET_ADAPTER).expectedSupplyAssets(MARKET_ID));
        }
        uint256 price = IERC4626(WSMUSD).convertToAssets(1e18);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 ts = uint64(block.timestamp);
        _checkpoints[count % CHECKPOINT_CAPACITY] = Checkpoint({
            timestamp: ts,
            sharePrice: price.toUint192(),
            m1SharePrice: _m1SharePrice(m).toUint128(),
            m1ExternalLiquidity: SafeCast.toInt128(external_)
        });
        checkpointCount = count + 1;
        emit CheckpointRecorded(count, ts, price);
        return true;
    }
}
