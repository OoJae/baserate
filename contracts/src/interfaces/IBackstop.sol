// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {ILiquidationVenues, Venue} from "./ILiquidationVenues.sol";

/// @notice Baserate liquidation backstop (bMUSD): an ERC-4626 over MUSD that buys M1's seized BTC from the
/// FlashLiquidator at the oracle price less half the liquidation incentive, and sells it back to MUSD through a
/// permissionless Dutch auction and bounded keeper sales on Tigris.
/// @dev Exits go through a 7-day queue paid at min(NAV at request, NAV at claim), in part when cash is short; instant
/// ERC-4626 withdraw and redeem are disabled (`maxWithdraw` and `maxRedeem` are 0). Deposits and mints are priced at
/// book + unvested gains (gross), not at `totalAssets`, so a new share pays for its part of the gains still vesting,
/// and are closed while the backstop holds at least `DUST_INVENTORY` of BTC (`maxDeposit` and `maxMint` are then 0).
/// Exits are paid in kind (wsMUSD shares) when wsMUSD cannot pay out MUSD.
interface IBackstop is IERC4626, ILiquidationVenues {
    /// @notice Constructor parameters (roles are explicit: deployment may go through a CREATE2 deployer).
    /// @param musd MUSD, the ERC-4626 asset.
    /// @param wsMusd Baserate wsMUSD, where idle MUSD is parked; its asset must be `musd`.
    /// @param oracle The M1 oracle (BtcMusdOracle), the same price Morpho uses to size liquidations.
    /// @param lltv M1's LLTV, from which Morpho's liquidation incentive (and so `DISCOUNT`) is derived.
    /// @param liquidator The FlashLiquidator, the only seller `buyCollateral` accepts (its address is predicted
    /// before deployment because the two contracts reference each other).
    /// @param sentinel May pause and unpause deposits only.
    /// @param maxKeeperSale Largest BTC amount per `sellInventory` call (0 disables keeper sales).
    /// @param venues Tigris addresses for keeper sales.
    struct BackstopParams {
        address musd;
        address wsMusd;
        address oracle;
        uint256 lltv;
        address liquidator;
        address sentinel;
        uint256 maxKeeperSale;
        VenueConfig venues;
    }

    /// @notice A queued exit (after a partial claim: what is left of it).
    /// @param owner Whose shares were escrowed.
    /// @param receiver Who receives the MUSD.
    /// @param shares Escrowed shares not yet paid, burned as they are paid.
    /// @param assets NAV of `shares` at request; claims pay at most this.
    /// @param claimableAt Earliest claim time.
    struct RedeemRequest {
        address owner;
        address receiver;
        uint128 shares;
        uint128 assets;
        uint64 claimableAt;
    }

    /// @notice Emitted on every accounting checkpoint.
    /// @param book Recognised NAV (the ERC-4626 `totalAssets` right after the checkpoint).
    /// @param unvested Gains still vesting (premiums, auction and keeper-sale gains, yield, donations).
    /// @param periodEnd When `unvested` is fully vested.
    /// @param inventory BTC held for sale.
    event Checkpoint(uint256 book, uint256 unvested, uint64 periodEnd, uint256 inventory);
    /// @notice Emitted when the FlashLiquidator sells seized BTC to the backstop.
    event CollateralBought(address indexed seller, uint256 btcIn, uint256 musdOut, uint256 price);
    /// @notice Emitted when an exit is queued.
    event RedeemRequested(
        uint256 indexed id,
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 assets,
        uint64 claimableAt
    );
    /// @notice Emitted on every claim payment: `shares` burned, `assets` paid (a partial claim emits it too, followed
    /// by `RedeemPartiallyClaimed`).
    event RedeemClaimed(uint256 indexed id, address indexed receiver, uint256 shares, uint256 assets);
    /// @notice Emitted after a partial claim: what stays queued under `id`, claimable again at any time.
    event RedeemPartiallyClaimed(uint256 indexed id, uint256 sharesLeft, uint256 assetsLeft);
    /// @notice Emitted when someone buys inventory from the Dutch auction.
    event AuctionTaken(address indexed taker, address indexed to, uint256 btcOut, uint256 musdIn, uint256 factorWad);
    /// @notice Emitted when inventory is sold on a DEX venue.
    event InventorySold(address indexed caller, Venue indexed venue, uint256 btcIn, uint256 musdOut);
    /// @notice Emitted when the sentinel pauses or unpauses deposits.
    event DepositsPausedSet(bool paused);
    /// @notice Emitted when an exit is paid in kind because wsMUSD's withdraw reverted: `receiver` got all the idle
    /// `musd` plus `wsMusdShares` worth the rest of `assets` (rounded down), instead of `assets` MUSD.
    event PaidInKind(address indexed receiver, uint256 assets, uint256 musd, uint256 wsMusdShares);
    /// @notice Emitted when an exit paid in kind (wsMUSD's withdraw reverted) pauses parking until `until`: idle MUSD
    /// stays idle meanwhile.
    event ParkingPaused(uint256 until);

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice A zero amount.
    error ZeroAmount();
    /// @notice The LLTV is not in (0, 1e18).
    error InvalidLltv(uint256 lltv);
    /// @notice wsMUSD's asset is not MUSD.
    error AssetMismatch(address expected, address actual);
    /// @notice Only the FlashLiquidator may sell collateral to the backstop.
    error NotLiquidator(address caller);
    /// @notice Only the sentinel may pause or unpause deposits.
    error NotSentinel(address caller);
    /// @notice Free cash (cash minus MUSD reserved for queued exits) cannot cover a payment.
    error InsufficientCash(uint256 needed, uint256 available);
    /// @notice A payment is below the caller's minimum, or a sale is below its floor.
    error InsufficientOutput(uint256 out, uint256 minOut);
    /// @notice An auction purchase costs more than the taker's maximum.
    error ExcessiveInput(uint256 musdIn, uint256 maxMusdIn);
    /// @notice More BTC than the inventory holds, or than one keeper sale may move.
    error ExceedsInventory(uint256 btc, uint256 limit);
    /// @notice Instant exits are disabled; use `requestRedeem` and `claimRedeem`.
    error UseRedeemQueue();
    /// @notice No pending request with this id.
    error UnknownRequest(uint256 id);
    /// @notice The request's 7-day delay has not elapsed.
    error NotClaimable(uint256 id, uint64 claimableAt);
    /// @notice The M1 oracle reverted while the backstop holds BTC, so NAV cannot be computed.
    error OracleUnavailable();
    /// @notice Sending native BTC failed.
    error NativeSendFailed(address to, uint256 amount);
    /// @notice Only the request's owner may value the inventory at 0 for its claim.
    error NotRequestOwner(address caller);
    /// @notice A sale would leave less than `DUST_INVENTORY` of BTC (take it all instead).
    error DustRemainder(uint256 remaining);
    /// @notice Deposits and mints are closed while the backstop holds at least `DUST_INVENTORY` of BTC.
    error HoldingInventory(uint256 inventory);
    /// @notice A purchase needs MUSD parked in wsMUSD and wsMUSD's withdraw reverted; only `idle` MUSD was at hand.
    error CashUnavailable(uint256 needed, uint256 idle);

    /// @notice Buys seized BTC (`msg.value`) and pays `btc x price x (1 - DISCOUNT)` MUSD to the caller.
    /// @dev FlashLiquidator only; paid from free cash, never from MUSD reserved for queued exits. Idle MUSD pays first;
    /// if the rest must come out of wsMUSD and its withdraw reverts, reverts `CashUnavailable` (the liquidator then
    /// uses a DEX venue).
    function buyCollateral(uint256 minOut) external payable returns (uint256 musdOut);

    /// @notice MUSD `buyCollateral` would pay for `btcIn` now, or 0 if free cash cannot cover it or the oracle is down.
    /// While parking is paused after a failed wsMUSD withdraw, only idle MUSD counts as payable.
    function quoteBuy(uint256 btcIn) external view returns (uint256 musdOut);

    /// @notice Queues an exit: escrows `shares` from `owner`, records their NAV, and makes them claimable in 7 days.
    function requestRedeem(uint256 shares, address receiver, address owner) external returns (uint256 id);

    /// @notice Pays a matured request at min(NAV at request, NAV now) and burns its shares. Anyone may call.
    /// @dev When cash cannot cover it, pays all the cash, burns the matching fraction of the shares (rounded up) and
    /// keeps the rest queued at the same request NAV per share; reverts `InsufficientCash` only with no cash at all.
    /// Reads the oracle while the inventory is at least `DUST_INVENTORY`. If the wsMUSD withdraw it needs reverts, the
    /// payment is made in kind: all the idle MUSD plus the wsMUSD shares worth the rest, rounded down (`PaidInKind`).
    /// @return assets MUSD value paid by this call.
    function claimRedeem(uint256 id) external returns (uint256 assets);

    /// @notice Like `claimRedeem`, but values the BTC inventory at 0 for this claim only, so an exit can complete
    /// during an oracle outage. Owner only: it pays min(NAV at request, min(book, cash) per share), never more than
    /// `claimRedeem` would, and always in full from cash (in kind, like `claimRedeem`, if wsMUSD cannot pay MUSD).
    /// @dev Tries the oracle: if it answers (or only dust is held) the usual checkpoints run around the claim; if it is
    /// down, vested gains move into the book and no gain or loss is recognised for anyone else.
    /// @return assets MUSD value paid by this call.
    function claimRedeemWithoutOracle(uint256 id) external returns (uint256 assets);

    /// @notice Buys `btcOut` of inventory at the current Dutch-auction price, paying MUSD; BTC goes to `to`.
    /// @dev Must take all the inventory or leave at least `DUST_INVENTORY`.
    function takeAuction(uint256 btcOut, uint256 maxMusdIn, address to) external returns (uint256 musdIn);

    /// @notice Sells up to `MAX_KEEPER_SALE` of inventory on a DEX venue, at no less than the current auction price.
    /// @dev Permissionless: the floor makes any caller's sale at least as good for depositors as an auction fill.
    /// Must sell all the inventory or leave at least `DUST_INVENTORY`.
    function sellInventory(uint256 btcIn, Venue venue, uint256 minOut) external returns (uint256 musdOut);

    /// @notice Recognises vested gains and any losses now. Permissionless.
    function sync() external;

    /// @notice Pauses or unpauses deposits and mints. Sentinel only; nothing else can be paused.
    function setDepositsPaused(bool paused) external;

    /// @notice Current auction price factor in WAD: 1.00 at the start, decaying linearly to 0.95 over 6 hours.
    function auctionFactor() external view returns (uint256);

    /// @notice MUSD a taker pays for `btcOut` from the auction now (0 if the oracle is down).
    function quoteAuction(uint256 btcOut) external view returns (uint256 musdIn);

    /// @notice MUSD idle in the contract plus the redeemable value of its wsMUSD.
    function cash() external view returns (uint256);

    /// @notice Cash not reserved for queued exits, available to buy collateral.
    function availableCash() external view returns (uint256);

    /// @notice Realisable value: cash plus inventory marked at the oracle price x 0.95 (0 if the oracle is down or
    /// the inventory is below `DUST_INVENTORY`). Deposits and mints are priced at this value.
    function grossAssets() external view returns (uint256);

    /// @notice Accounting state: recognised book, unvested gains, last checkpoint and vesting end.
    function vestingState() external view returns (uint256 book, uint256 unvested, uint64 lastSync, uint64 periodEnd);

    /// @notice A pending exit (zeroed once claimed).
    function redeemRequest(uint256 id) external view returns (RedeemRequest memory);

    /// @notice BTC held for sale, by internal accounting.
    function inventory() external view returns (uint256);

    /// @notice Start of the current auction clock (weighted back when more BTC arrives).
    function auctionStart() external view returns (uint64);

    /// @notice Sum of request-time NAV of all pending exits.
    function reservedAssets() external view returns (uint256);

    /// @notice Id of the next exit request.
    function nextRequestId() external view returns (uint256);

    /// @notice Whether the sentinel paused deposits and mints (they are also closed while BTC inventory is held).
    function depositsPaused() external view returns (bool);

    /// @notice Until when idle MUSD stays idle instead of being parked in wsMUSD (0 or past: parking is on). Set to
    /// now + `PARK_PAUSE` when an exit is paid in kind because wsMUSD's withdraw reverted (a purchase reverts instead
    /// and sets nothing); cleared by the next successful withdraw.
    function parkingPausedUntil() external view returns (uint48);

    /// @notice How long a reverting wsMUSD withdraw pauses parking.
    function PARK_PAUSE() external view returns (uint256);

    /// @notice wsMUSD, where idle MUSD is parked.
    function WSMUSD() external view returns (address);

    /// @notice The M1 oracle (Skip BTC/USD over the clamped MUSD leg, at Morpho's 1e36 scale).
    function ORACLE() external view returns (address);

    /// @notice The only address allowed to call `buyCollateral`.
    function LIQUIDATOR() external view returns (address);

    /// @notice May pause and unpause deposits, nothing else.
    function SENTINEL() external view returns (address);

    /// @notice Discount to the oracle price paid in `buyCollateral`, in WAD: half of M1's liquidation incentive.
    function DISCOUNT() external view returns (uint256);

    /// @notice Largest BTC amount one `sellInventory` call may sell.
    function MAX_KEEPER_SALE() external view returns (uint256);

    /// @notice Vesting period of gains.
    function VESTING() external view returns (uint256);

    /// @notice Delay between `requestRedeem` and `claimRedeem`.
    function REDEEM_DELAY() external view returns (uint256);

    /// @notice NAV mark of BTC inventory as a fraction of the oracle price, in WAD (0.95).
    function INVENTORY_MARK() external view returns (uint256);

    /// @notice Dutch-auction length.
    function AUCTION_DURATION() external view returns (uint256);

    /// @notice Auction price factor at the end of `AUCTION_DURATION`, in WAD (0.95).
    function AUCTION_FLOOR() external view returns (uint256);

    /// @notice Inventory below this (BTC wei; 0.00001 BTC, about 1 MUSD) counts as 0 in NAV, so it needs no oracle.
    function DUST_INVENTORY() external view returns (uint256);
}
