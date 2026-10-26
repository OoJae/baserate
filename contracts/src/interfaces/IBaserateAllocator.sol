// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

/// @notice Permissionless allocator for vMUSD (Vault V2): keeps a standing borrow buffer in the M1 market and moves
/// only the excess between the wsMUSD liquidity adapter and M1, by trailing (time-weighted) supply APY.
interface IBaserateAllocator {
    /// @notice What a rebalance did.
    /// @dev NONE: nothing to do. BUFFER_TOP_UP: supplied M1 because its idle liquidity was below the buffer target.
    /// TO_MARKET: supplied M1 because its trailing and post-move supply APYs beat wsMUSD's trailing APY. TO_LIQUIDITY:
    /// withdrew M1 supply above the (conservative) buffer back to wsMUSD because wsMUSD pays more on both views.
    enum Action {
        NONE,
        BUFFER_TOP_UP,
        TO_MARKET,
        TO_LIQUIDITY
    }

    /// @notice An observation recorded at most hourly.
    /// @param timestamp When it was recorded.
    /// @param sharePrice wsMUSD `convertToAssets(1e18)`.
    /// @param m1SharePrice M1 supply-share price: MUSD wei per 1e24 supply shares (1e18 at par), interest accrued.
    /// @param m1ExternalLiquidity M1 supply minus borrow minus vMUSD's own M1 supply (may be negative). If M1 was
    /// touched earlier in the recording block (its totals may be transient), the previous checkpoint's value, carried
    /// forward unchanged.
    struct Checkpoint {
        uint64 timestamp;
        uint192 sharePrice;
        uint128 m1SharePrice;
        int128 m1ExternalLiquidity;
    }

    /// @notice Inputs of an allocation decision (all MUSD amounts in wei, rates annualized in WAD).
    /// @param m1SupplyAssets M1 total supply, interest accrued to now.
    /// @param m1BorrowAssets M1 total borrow, interest accrued to now.
    /// @param m1Liquidity M1 supply minus borrow: what borrowers can draw right now.
    /// @param bufferTarget `max(BUFFER_FLOOR, BUFFER_BPS * m1SupplyAssets / BPS)`.
    /// @param m1SupplyApy Spot: `borrowRate * utilization * (1 - fee) * 365 days` (non-compounded); sizes moves.
    /// @param wsMusdApy wsMUSD share-price growth over `apyWindow`, annualized (non-compounded).
    /// @param apyWindow Seconds covered by the trailing observations (target 7 days; 0 without history).
    /// @param vaultMarketAssets vMUSD's M1 supply (market adapter position).
    /// @param vaultIdle MUSD held by vMUSD itself.
    /// @param liquidityAvailable MUSD the wsMUSD liquidity adapter reports it can release now (optimistic: a view
    /// cannot see an sMUSD withdraw that reverts; the allocator's exits catch that and pay from M1).
    /// @param m1TrailingApy M1 supply-share price growth over `apyWindow`, annualized; with `wsMusdApy`, picks the
    /// direction of rate-driven moves.
    /// @param conservativeLiquidity `vaultMarketAssets` plus the lowest external M1 liquidity of now and of the
    /// checkpoints of the last `LIQUIDITY_WINDOW` (<= `m1Liquidity`); `TO_LIQUIDITY` is sized on it.
    /// @param marketTouched M1 was touched earlier in this block: no rate-driven move, and a buffer top-up is sized on
    /// the larger of `m1Liquidity` and the last checkpoint's liquidity (its external liquidity plus
    /// `vaultMarketAssets`), so a transient low cannot trigger one.
    struct Snapshot {
        uint256 m1SupplyAssets;
        uint256 m1BorrowAssets;
        uint256 m1Liquidity;
        uint256 bufferTarget;
        uint256 m1SupplyApy;
        uint256 wsMusdApy;
        uint256 apyWindow;
        uint256 vaultMarketAssets;
        uint256 vaultIdle;
        uint256 liquidityAvailable;
        uint256 m1TrailingApy;
        uint256 conservativeLiquidity;
        bool marketTouched;
    }

    /// @notice Emitted when a checkpoint is recorded (`sharePrice`: wsMUSD; the M1 fields are in `checkpointAt`).
    event CheckpointRecorded(uint256 indexed index, uint64 timestamp, uint256 sharePrice);

    /// @notice Emitted by every successful `rebalance`, including no-ops. `m1SupplyApy` is the spot rate (the
    /// trailing one that picks the direction is in `snapshot()`/`m1TrailingApy()`).
    event Rebalanced(
        Action indexed action,
        uint256 amount,
        uint256 m1SupplyApy,
        uint256 wsMusdApy,
        uint256 apyWindow,
        uint256 m1Liquidity,
        uint256 bufferTarget
    );

    /// @notice Emitted when MUSD idle in vMUSD is parked in the wsMUSD liquidity adapter.
    event IdleAllocated(uint256 amount);

    /// @notice Emitted when `withdraw`/`redeem` deallocates M1 supply to cover a withdrawal.
    event MarketLiquidityPulled(address indexed caller, uint256 assets);

    error ZeroAddress();
    error AdapterMismatch();
    error AssetMismatch();
    error IrmMismatch();
    error MarketNotCreated();
    error CooldownActive(uint256 readyAt);
    error IndexOutOfRange(uint256 index, uint256 length);

    /// @notice Records a checkpoint (wsMUSD share price, M1 supply-share price, M1 external liquidity) if, and only if,
    /// the last one is at least `CHECKPOINT_INTERVAL` old. Permissionless; `rebalance` calls it too.
    function checkpoint() external returns (bool recorded);

    /// @notice Permissionless: tops up the M1 buffer, or moves excess between wsMUSD and M1 by APY, by at most
    /// `MAX_MOVE`, then parks idle vMUSD MUSD in the liquidity adapter. Buffer top-ups ignore the cooldown but run at
    /// most once per block. During the cooldown that follows a rate-driven move, a call with idle MUSD to park parks it
    /// and returns `NONE` (any rate-driven move waits); otherwise it reverts `CooldownActive`.
    function rebalance() external returns (Action action, uint256 amount);

    /// @notice Withdraws exactly `assets` MUSD of the caller's vMUSD to `receiver`. Idle MUSD and wsMUSD are used
    /// first; only the shortfall is deallocated from M1, without the force-deallocate penalty. If the wsMUSD leg
    /// reverts (sMUSD's withdraw broken), it retries M1-first: `min(assets - idle, vMUSD's M1 position, M1 liquidity)`
    /// is deallocated before the vault touches wsMUSD, so up to that amount always exits penalty-free.
    /// @dev The caller must have approved this contract for the vMUSD shares burnt.
    function withdraw(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Redeems `shares` of the caller's vMUSD to `receiver`, pulling from M1 only the part idle MUSD and
    /// wsMUSD cannot cover, with the same M1-first retry as `withdraw`. The caller must have approved this contract
    /// for `shares`.
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);

    /// @notice What `rebalance` would do now (ignoring the cooldown, honouring the one-top-up-per-block rule), with its
    /// inputs.
    function previewRebalance() external view returns (Action action, uint256 amount, Snapshot memory snapshot);

    /// @notice Current decision inputs.
    function snapshot() external view returns (Snapshot memory);

    /// @notice M1 supply APY now (spot): `borrowRateView * utilization * (1 - fee)`, annualized (WAD).
    function m1SupplyApy() external view returns (uint256);

    /// @notice wsMUSD trailing APY (WAD) over the checkpoint closest to `APY_WINDOW` ago, and that window.
    function wsMusdApy() external view returns (uint256 apy, uint256 window);

    /// @notice M1 trailing supply APY (WAD): growth of its supply-share price over the same window as `wsMusdApy`.
    function m1TrailingApy() external view returns (uint256 apy, uint256 window);

    /// @notice Number of checkpoints ever recorded.
    function checkpointCount() external view returns (uint256);

    /// @notice The `i`-th retained checkpoint, oldest first (`i < min(checkpointCount, CHECKPOINT_CAPACITY)`).
    function checkpointAt(uint256 i) external view returns (Checkpoint memory);

    /// @notice Timestamp of the last rate-driven move (`TO_MARKET` or `TO_LIQUIDITY`); buffer top-ups do not set it.
    function lastRebalance() external view returns (uint64);

    /// @notice Timestamp of the block of the last buffer top-up (at most one per block).
    function lastTopUpAt() external view returns (uint64);

    /// @notice Earliest timestamp at which `rebalance` can move funds: `lastRebalance + COOLDOWN`, or now while a buffer
    /// top-up is due or idle vault MUSD can be parked (both ignore the cooldown).
    function readyAt() external view returns (uint256);

    /// @notice The M1 market parameters.
    function marketParams() external view returns (MarketParams memory);

    /// @notice The vMUSD Vault V2.
    function VAULT() external view returns (address);

    /// @notice The wsMUSD liquidity adapter.
    function LIQUIDITY_ADAPTER() external view returns (address);

    /// @notice The MorphoMarketV1AdapterV2 holding vMUSD's M1 supply.
    function MARKET_ADAPTER() external view returns (address);

    /// @notice Morpho Blue.
    function MORPHO() external view returns (address);

    /// @notice wsMUSD.
    function WSMUSD() external view returns (address);

    /// @notice MUSD.
    function MUSD() external view returns (address);

    /// @notice M1 market id.
    function MARKET_ID() external view returns (bytes32);
}
