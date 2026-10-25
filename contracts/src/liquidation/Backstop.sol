// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {
    LIQUIDATION_CURSOR,
    MAX_LIQUIDATION_INCENTIVE_FACTOR,
    ORACLE_PRICE_SCALE
} from "morpho-blue/libraries/ConstantsLib.sol";

import {IBackstop} from "../interfaces/IBackstop.sol";
import {Venue} from "../interfaces/ILiquidationVenues.sol";
import {TigrisVenues} from "./TigrisVenues.sol";

/// @title Backstop (bMUSD)
/// @notice Immutable ERC-4626 over MUSD that buys M1's seized BTC so liquidations clear even when Tigris depth cannot
/// absorb them, then sells that BTC back to MUSD. Idle MUSD is parked in Baserate's wsMUSD.
/// @dev Pricing ideas follow thUSD's MIT-licensed B.Protocol `BAMM.sol` (an oracle-anchored AMM that buys liquidated
/// collateral at a discount and sells it back near the oracle price); this is a native rewrite for Morpho Blue with
/// none of the Stability Pool plumbing.
///
/// Buying: `buyCollateral` is callable only by the FlashLiquidator (immutable `LIQUIDATOR`, its address predicted
/// at deployment), so the backstop is never a free put for arbitrary BTC. It pays
/// `btc x price x (1 - DISCOUNT)` with `DISCOUNT = (LIF - 1) / 2`, where `price` is the M1 oracle (the same price
/// Morpho just used to size the seizure) and LIF is Morpho's incentive factor for M1's LLTV: 2.19% at 0.86,
/// 3.71% at 0.77. The other half of the incentive is the liquidator's profit. Purchases use free cash only: MUSD
/// reserved for queued exits is never spent on new risk.
///
/// Accounting (all internal, never balance-of for BTC):
/// - gross = cash + inventory x price x 0.95, where cash = idle MUSD + `wsMUSD.previewRedeem(held shares)`;
/// - recognised NAV (`totalAssets`) = min(book + vested, gross). Every increase of gross that is not a deposit (the
///   premium realised when inventory sells above the 0.95 mark, wsMUSD yield, price gains, donations, the forfeited
///   upside of queued exits) is added to `unvested` and vests linearly over 7 days, with a value-weighted end time
///   when more arrives. Every decrease (the mark-down below cost at purchase, a falling BTC price) is recognised
///   instantly: it consumes unvested gains first, then the book.
/// - Consequently no action raises the share price instantly; a just-in-time deposit around a liquidation gets
///   nothing, and a holder cannot exit ahead of a loss.
///
/// Exits: instant `withdraw`/`redeem` are disabled. `requestRedeem` escrows shares and records their NAV; after
/// `REDEEM_DELAY` anyone may `claimRedeem`, which pays min(NAV at request, NAV at claim) and burns the shares. The
/// escrowed shares keep bearing losses during the wait but forfeit gains, which return to the pool as vesting gains.
///
/// Selling: a permissionless Dutch auction (`takeAuction`) sells inventory at oracle x factor, factor decaying from
/// 1.00 to 0.95 over 6 h from `auctionStart` (pulled back pro rata to the new BTC when more arrives, so a dust
/// purchase cannot reset it). `sellInventory` lets anyone sell up to `MAX_KEEPER_SALE` per call on CL200 or the
/// vAMM, at no less than the current auction price, so a keeper sale is never worse for depositors than an
/// auction fill at the same moment.
///
/// Roles: the sentinel can pause deposits and mints, nothing else. Nobody can pause buys, sales, requests or claims.
/// Oracle: every mutation that needs NAV while BTC is held reads the M1 oracle and reverts `OracleUnavailable` if it
/// is down; views never revert and value inventory at 0 while the oracle is down.
/// Precompile cost: 1 Skip read per mutation while inventory > 0 (2 for `deposit`/`mint`, whose ERC-4626 preview
/// reads NAV again), 0 with no inventory; `sellInventory` adds the venue's BTC precompile calls (4 on CL200, 5 on the
/// vAMM, see TigrisVenues).
contract Backstop is IBackstop, ERC4626, TigrisVenues, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @inheritdoc IBackstop
    uint256 public constant VESTING = 7 days;
    /// @inheritdoc IBackstop
    uint256 public constant REDEEM_DELAY = 7 days;
    /// @inheritdoc IBackstop
    uint256 public constant INVENTORY_MARK = 0.95e18;
    /// @inheritdoc IBackstop
    uint256 public constant AUCTION_DURATION = 6 hours;
    /// @inheritdoc IBackstop
    uint256 public constant AUCTION_FLOOR = 0.95e18;

    uint256 internal constant WAD = 1e18;
    /// @dev Idle MUSD below this stays idle instead of being parked in wsMUSD.
    uint256 internal constant MIN_PARK = 1e15;

    /// @inheritdoc IBackstop
    address public immutable WSMUSD;
    /// @inheritdoc IBackstop
    address public immutable ORACLE;
    /// @inheritdoc IBackstop
    address public immutable LIQUIDATOR;
    /// @inheritdoc IBackstop
    address public immutable SENTINEL;
    /// @inheritdoc IBackstop
    uint256 public immutable DISCOUNT;
    /// @inheritdoc IBackstop
    uint256 public immutable MAX_KEEPER_SALE;

    IERC20 internal immutable _MUSD;

    /// @inheritdoc IBackstop
    bool public depositsPaused;
    /// @inheritdoc IBackstop
    uint64 public auctionStart;
    uint64 internal _lastSync;
    uint64 internal _periodEnd;
    uint256 internal _book;
    uint256 internal _unvested;
    /// @inheritdoc IBackstop
    uint256 public inventory;
    /// @inheritdoc IBackstop
    uint256 public reservedAssets;
    /// @inheritdoc IBackstop
    uint256 public nextRequestId;

    mapping(uint256 id => RedeemRequest) internal _requests;

    /// @param p Network wiring and roles (see `BackstopParams`).
    constructor(BackstopParams memory p)
        ERC20("Baserate Backstop MUSD", "bMUSD")
        ERC4626(IERC20(p.musd))
        TigrisVenues(p.musd, p.venues)
    {
        if (
            p.musd == address(0) || p.wsMusd == address(0) || p.oracle == address(0) || p.liquidator == address(0)
                || p.sentinel == address(0)
        ) revert ZeroAddress();
        if (p.lltv == 0 || p.lltv >= WAD) revert InvalidLltv(p.lltv);
        address wsAsset = IERC4626(p.wsMusd).asset();
        if (wsAsset != p.musd) revert AssetMismatch(p.musd, wsAsset);

        _MUSD = IERC20(p.musd);
        WSMUSD = p.wsMusd;
        ORACLE = p.oracle;
        LIQUIDATOR = p.liquidator;
        SENTINEL = p.sentinel;
        MAX_KEEPER_SALE = p.maxKeeperSale;

        // Morpho: LIF = min(1.15, 1 / (1 - 0.3 x (1 - lltv))), rounded down like Morpho's wDivDown/wMulDown.
        uint256 lif =
            Math.min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD * WAD / (WAD - LIQUIDATION_CURSOR * (WAD - p.lltv) / WAD));
        DISCOUNT = (lif - WAD) / 2;

        _lastSync = uint64(block.timestamp);
        _periodEnd = uint64(block.timestamp);
        IERC20(p.musd).forceApprove(p.wsMusd, type(uint256).max);
    }

    /// @notice Accepts native BTC from router refunds and donations. It is not counted as inventory.
    receive() external payable {}

    // ---------------------------------------------------------------- ERC-4626

    /// @notice Recognised NAV: min(book + vested gains, cash + inventory x oracle x 0.95).
    /// @dev Never reverts; values inventory at 0 while the oracle is down (mutations revert instead).
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        (bool ok, uint256 price) = _tryPrice();
        uint256 gross = _gross(ok ? price : 0);
        uint256 recognised = _book + _vestedAmount();
        return gross < recognised ? gross : recognised;
    }

    /// @notice 0 while deposits are paused, otherwise unlimited.
    function maxDeposit(address) public view override(ERC4626, IERC4626) returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    /// @notice 0 while deposits are paused, otherwise unlimited.
    function maxMint(address) public view override(ERC4626, IERC4626) returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    /// @notice Always 0: exits go through `requestRedeem`/`claimRedeem`.
    function maxWithdraw(address) public pure override(ERC4626, IERC4626) returns (uint256) {
        return 0;
    }

    /// @notice Always 0: exits go through `requestRedeem`/`claimRedeem`.
    function maxRedeem(address) public pure override(ERC4626, IERC4626) returns (uint256) {
        return 0;
    }

    /// @inheritdoc IERC4626
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256)
    {
        _checkpoint(_priceIfHolding());
        return super.deposit(assets, receiver);
    }

    /// @inheritdoc IERC4626
    function mint(uint256 shares, address receiver) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
        _checkpoint(_priceIfHolding());
        return super.mint(shares, receiver);
    }

    /// @notice Disabled: use `requestRedeem` then `claimRedeem`.
    function withdraw(uint256, address, address) public pure override(ERC4626, IERC4626) returns (uint256) {
        revert UseRedeemQueue();
    }

    /// @notice Disabled: use `requestRedeem` then `claimRedeem`.
    function redeem(uint256, address, address) public pure override(ERC4626, IERC4626) returns (uint256) {
        revert UseRedeemQueue();
    }

    // ---------------------------------------------------------------- liquidation leg

    /// @inheritdoc IBackstop
    function buyCollateral(uint256 minOut) external payable nonReentrant returns (uint256 musdOut) {
        if (msg.sender != LIQUIDATOR) revert NotLiquidator(msg.sender);
        uint256 btcIn = msg.value;
        if (btcIn == 0) revert ZeroAmount();
        uint256 price = _price();
        // `inventory` is internal, so the incoming value is not yet part of NAV here.
        _checkpoint(price);

        musdOut = _buyQuote(btcIn, price);
        if (musdOut < minOut) revert InsufficientOutput(musdOut, minOut);
        uint256 free = _free(_cash());
        if (musdOut > free) revert InsufficientCash(musdOut, free);

        _addInventory(btcIn);
        _payOut(msg.sender, musdOut);
        // Recognises the mark-down from cost to 0.95 x oracle instantly (or vests a gain if DISCOUNT > 5%).
        _checkpoint(price);
        emit CollateralBought(msg.sender, btcIn, musdOut, price);
    }

    /// @inheritdoc IBackstop
    function quoteBuy(uint256 btcIn) external view returns (uint256 musdOut) {
        (bool ok, uint256 price) = _tryOracle();
        if (!ok || btcIn == 0) return 0;
        musdOut = _buyQuote(btcIn, price);
        if (musdOut > _free(_cash())) return 0;
    }

    // ---------------------------------------------------------------- exits

    /// @inheritdoc IBackstop
    function requestRedeem(uint256 shares, address receiver, address owner) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        _checkpoint(_priceIfHolding());
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);

        uint256 assets = _bookValue(shares);
        _transfer(owner, address(this), shares);
        reservedAssets += assets;

        id = nextRequestId++;
        uint64 claimableAt = uint64(block.timestamp + REDEEM_DELAY);
        _requests[id] = RedeemRequest({
            owner: owner, receiver: receiver, shares: uint128(shares), assets: uint128(assets), claimableAt: claimableAt
        });
        emit RedeemRequested(id, owner, receiver, shares, assets, claimableAt);
    }

    /// @inheritdoc IBackstop
    function claimRedeem(uint256 id) external nonReentrant returns (uint256 assets) {
        RedeemRequest memory r = _requests[id];
        if (r.shares == 0) revert UnknownRequest(id);
        if (block.timestamp < r.claimableAt) revert NotClaimable(id, r.claimableAt);
        uint256 price = _priceIfHolding();
        _checkpoint(price);

        uint256 valueNow = _bookValue(r.shares);
        assets = r.assets < valueNow ? r.assets : valueNow;

        delete _requests[id];
        reservedAssets -= r.assets;
        _burn(address(this), r.shares);
        // The shares leave at full current value; the forfeited upside (valueNow - assets) stays in gross and the
        // next checkpoint vests it for the remaining holders, so a claim never lifts the share price instantly.
        _book -= valueNow;
        _payOut(r.receiver, assets);
        _checkpoint(price);
        emit RedeemClaimed(id, r.receiver, r.shares, assets);
    }

    // ---------------------------------------------------------------- inventory sales

    /// @inheritdoc IBackstop
    function takeAuction(uint256 btcOut, uint256 maxMusdIn, address to) external nonReentrant returns (uint256 musdIn) {
        if (btcOut == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 inv = inventory;
        if (btcOut > inv) revert ExceedsInventory(btcOut, inv);
        uint256 price = _price();
        _checkpoint(price);

        uint256 factor = auctionFactor();
        musdIn = _auctionCost(btcOut, price, factor);
        if (musdIn > maxMusdIn) revert ExcessiveInput(musdIn, maxMusdIn);
        _MUSD.safeTransferFrom(msg.sender, address(this), musdIn);
        inventory = inv - btcOut;
        _park();
        // The sale's gain over the 0.95 mark vests.
        _checkpoint(price);
        emit AuctionTaken(msg.sender, to, btcOut, musdIn, factor);

        (bool ok,) = to.call{value: btcOut}("");
        if (!ok) revert NativeSendFailed(to, btcOut);
    }

    /// @inheritdoc IBackstop
    function sellInventory(uint256 btcIn, Venue venue, uint256 minOut) external nonReentrant returns (uint256 musdOut) {
        if (btcIn == 0) revert ZeroAmount();
        if (btcIn > MAX_KEEPER_SALE) revert ExceedsInventory(btcIn, MAX_KEEPER_SALE);
        uint256 inv = inventory;
        if (btcIn > inv) revert ExceedsInventory(btcIn, inv);
        if (!_dexAvailable(venue)) revert VenueUnavailable(venue);
        uint256 price = _price();
        _checkpoint(price);

        uint256 floor = _auctionCost(btcIn, price, auctionFactor());
        if (minOut > floor) floor = minOut;
        uint256 musdBefore = _MUSD.balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        _sellOnDex(venue, btcIn);
        musdOut = _MUSD.balanceOf(address(this)) - musdBefore;
        if (musdOut < floor) revert InsufficientOutput(musdOut, floor);

        // Count what actually left: a CL partial fill or a router paying from its own stray BTC spends less.
        uint256 nativeAfter = address(this).balance;
        uint256 spent = nativeBefore > nativeAfter ? nativeBefore - nativeAfter : 0;
        inventory = inv - (spent < inv ? spent : inv);
        _park();
        _checkpoint(price);
        emit InventorySold(msg.sender, venue, spent, musdOut);
    }

    // ---------------------------------------------------------------- admin and upkeep

    /// @inheritdoc IBackstop
    function sync() external nonReentrant {
        _checkpoint(_priceIfHolding());
    }

    /// @inheritdoc IBackstop
    function setDepositsPaused(bool paused) external nonReentrant {
        if (msg.sender != SENTINEL) revert NotSentinel(msg.sender);
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBackstop
    function auctionFactor() public view returns (uint256) {
        if (inventory == 0) return WAD;
        uint256 elapsed = block.timestamp - auctionStart;
        if (elapsed >= AUCTION_DURATION) return AUCTION_FLOOR;
        return WAD - (WAD - AUCTION_FLOOR) * elapsed / AUCTION_DURATION;
    }

    /// @inheritdoc IBackstop
    function quoteAuction(uint256 btcOut) external view returns (uint256 musdIn) {
        (bool ok, uint256 price) = _tryOracle();
        if (!ok) return 0;
        return _auctionCost(btcOut, price, auctionFactor());
    }

    /// @inheritdoc IBackstop
    function cash() external view returns (uint256) {
        return _cash();
    }

    /// @inheritdoc IBackstop
    function availableCash() external view returns (uint256) {
        return _free(_cash());
    }

    /// @inheritdoc IBackstop
    function grossAssets() external view returns (uint256) {
        (bool ok, uint256 price) = _tryPrice();
        return _gross(ok ? price : 0);
    }

    /// @inheritdoc IBackstop
    function vestingState() external view returns (uint256 book, uint256 unvested, uint64 lastSync, uint64 periodEnd) {
        return (_book, _unvested, _lastSync, _periodEnd);
    }

    /// @inheritdoc IBackstop
    function redeemRequest(uint256 id) external view returns (RedeemRequest memory) {
        return _requests[id];
    }

    // ---------------------------------------------------------------- internal: accounting

    /// @dev Moves vested gains into the book and reconciles the book with gross value: a shortfall is a loss,
    /// recognised now (unvested gains absorb it first); a surplus is a gain and vests over `VESTING` with a
    /// value-weighted end. Afterwards `totalAssets() == _book` within the block.
    function _checkpoint(uint256 price) internal {
        uint256 gross = _gross(price);
        uint256 vested = _vestedAmount();
        uint256 recognised = _book + vested;
        uint256 stillVesting = _unvested - vested;
        uint256 newBook = gross < recognised ? gross : recognised;
        uint256 newUnvested = gross - newBook;

        uint64 nowTs = uint64(block.timestamp);
        if (newUnvested > stillVesting) {
            uint256 left = _periodEnd > nowTs ? _periodEnd - nowTs : 0;
            uint256 gain = newUnvested - stillVesting;
            _periodEnd = uint64(nowTs + (stillVesting * left + gain * VESTING) / newUnvested);
        }
        _book = newBook;
        _unvested = newUnvested;
        _lastSync = nowTs;
        emit Checkpoint(newBook, newUnvested, _periodEnd, inventory);
    }

    /// @dev Part of `_unvested` vested since the last checkpoint (linear to `_periodEnd`).
    function _vestedAmount() internal view returns (uint256) {
        uint256 unvested = _unvested;
        if (unvested == 0) return 0;
        uint256 end = _periodEnd;
        if (block.timestamp >= end) return unvested;
        uint256 last = _lastSync;
        return unvested * (block.timestamp - last) / (end - last);
    }

    /// @dev Cash plus inventory at `price` x 0.95. `price` may be 0 only when inventory is 0 or for a view whose
    /// oracle read failed (inventory then counts as worthless).
    function _gross(uint256 price) internal view returns (uint256) {
        uint256 inv = inventory;
        uint256 mark = inv == 0 || price == 0 ? 0 : inv.mulDiv(price, ORACLE_PRICE_SCALE).mulDiv(INVENTORY_MARK, WAD);
        return _cash() + mark;
    }

    function _cash() internal view returns (uint256) {
        uint256 wsShares = IERC20(WSMUSD).balanceOf(address(this));
        uint256 parked = wsShares == 0 ? 0 : IERC4626(WSMUSD).previewRedeem(wsShares);
        return _MUSD.balanceOf(address(this)) + parked;
    }

    function _free(uint256 cash_) internal view returns (uint256) {
        uint256 reserved = reservedAssets;
        return cash_ > reserved ? cash_ - reserved : 0;
    }

    /// @dev ERC-4626 share value at the book, valid right after a checkpoint (when `totalAssets() == _book`).
    function _bookValue(uint256 shares) internal view returns (uint256) {
        return shares.mulDiv(_book + 1, totalSupply() + 10 ** _decimalsOffset(), Math.Rounding.Floor);
    }

    function _buyQuote(uint256 btcIn, uint256 price) internal view returns (uint256) {
        return btcIn.mulDiv(price, ORACLE_PRICE_SCALE).mulDiv(WAD - DISCOUNT, WAD);
    }

    function _auctionCost(uint256 btcOut, uint256 price, uint256 factor) internal pure returns (uint256) {
        return btcOut.mulDiv(price, ORACLE_PRICE_SCALE, Math.Rounding.Ceil).mulDiv(factor, WAD, Math.Rounding.Ceil);
    }

    /// @dev Adds BTC and pulls the auction clock back pro rata: elapsed' = min(elapsed, duration) x old / new.
    function _addInventory(uint256 btcIn) internal {
        uint256 oldInv = inventory;
        uint256 newInv = oldInv + btcIn;
        uint256 elapsed;
        if (oldInv != 0) {
            elapsed = Math.min(block.timestamp - auctionStart, AUCTION_DURATION) * oldInv / newInv;
        }
        auctionStart = uint64(block.timestamp - elapsed);
        inventory = newInv;
    }

    // ---------------------------------------------------------------- internal: cash movements

    /// @dev Credits deposits to the book, then parks idle MUSD in wsMUSD.
    function _transferIn(address from, uint256 assets) internal override {
        super._transferIn(from, assets);
        _book += assets;
        _park();
    }

    /// @dev Parks idle MUSD in wsMUSD up to its deposit cap; a failing wsMUSD leaves the MUSD idle.
    function _park() internal {
        uint256 idle = _MUSD.balanceOf(address(this));
        if (idle < MIN_PARK) return;
        uint256 room = IERC4626(WSMUSD).maxDeposit(address(this));
        uint256 amount = idle < room ? idle : room;
        if (amount < MIN_PARK) return;
        try IERC4626(WSMUSD).deposit(amount, address(this)) {} catch {}
    }

    /// @dev Pays `amount` MUSD to `to`, from idle MUSD first and then from wsMUSD.
    function _payOut(address to, uint256 amount) internal {
        uint256 idle = _MUSD.balanceOf(address(this));
        if (idle < amount) {
            uint256 available = _cash();
            if (available < amount) revert InsufficientCash(amount, available);
            IERC4626(WSMUSD).withdraw(amount - idle, address(this), address(this));
        }
        _MUSD.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- internal: oracle

    /// @dev The M1 oracle price; reverts `OracleUnavailable` if the oracle reverts.
    function _price() internal view returns (uint256 price) {
        bool ok;
        (ok, price) = _tryOracle();
        if (!ok) revert OracleUnavailable();
    }

    /// @dev The oracle price when NAV depends on it (inventory > 0), else 0 without reading it.
    function _priceIfHolding() internal view returns (uint256) {
        return inventory == 0 ? 0 : _price();
    }

    /// @dev (true, 0) with no inventory; otherwise the oracle read, never reverting.
    function _tryPrice() internal view returns (bool ok, uint256 price) {
        if (inventory == 0) return (true, 0);
        return _tryOracle();
    }

    function _tryOracle() internal view returns (bool ok, uint256 price) {
        try IOracle(ORACLE).price() returns (uint256 p) {
            return (p != 0, p);
        } catch {
            return (false, 0);
        }
    }
}
