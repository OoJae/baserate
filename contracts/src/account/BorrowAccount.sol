// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {IIrm} from "morpho-blue/interfaces/IIrm.sol";
import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {ORACLE_PRICE_SCALE} from "morpho-blue/libraries/ConstantsLib.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MathLib} from "morpho-blue/libraries/MathLib.sol";
import {SharesMathLib} from "morpho-blue/libraries/SharesMathLib.sol";

import {IBorrowAccount} from "../interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../interfaces/ICollateralBTC.sol";

/// @title BorrowAccount
/// @notice EIP-1167 clone implementation holding one owner's M1 position: native BTC in (wrapped to bcBTC and
/// supplied to Morpho), MUSD out, with Baserate's limits enforced on every action that can raise risk.
/// @dev Deployed once by the BorrowAccountFactory constructor; clones read the immutables through delegatecall and
/// the owner from their immutable argument, so there is no initializer to front-run.
/// Borrow-path checks (two oracle reads in total, Morpho's plus ours):
/// - post-borrow `debt * 1e4 <= collateralValue * min(maxLtvBps, profile ceiling)`;
/// - position collateral <= profile position cap;
/// - post-borrow M1 `totalBorrowAssets` (Morpho accrues first) <= global borrow cap;
/// - borrows not paused (and, for CANARY accounts, the owner is still a canary operator).
/// Repay and the full exit make no oracle call. The clone ends every call holding 0 MUSD and 0 bcBTC.
/// Each external dependency is reached through a single internal helper to keep the runtime small: the factory
/// deploys this implementation inside its own constructor and must fit Mezo's 10M block gas limit.
contract BorrowAccount is IBorrowAccount, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using MathLib for uint256;
    using SharesMathLib for uint256;

    uint256 internal constant BPS = 10_000;

    /// @inheritdoc IBorrowAccount
    address public immutable FACTORY;
    /// @inheritdoc IBorrowAccount
    address public immutable MORPHO;
    /// @inheritdoc IBorrowAccount
    Id public immutable MARKET_ID;

    address internal immutable _MUSD;
    address internal immutable _COLLATERAL;
    address internal immutable _ORACLE;
    address internal immutable _IRM;
    uint256 internal immutable _LLTV;
    /// @dev The implementation's own address; `owner()` is 0 there so the implementation is inert.
    address private immutable _SELF;

    /// @inheritdoc IBorrowAccount
    mapping(address module => bool enabled) public moduleEnabled;

    modifier onlyOwnerOrFactory() {
        if (msg.sender != owner() && msg.sender != FACTORY) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner()) revert Unauthorized();
        _;
    }

    /// @dev Called by the factory constructor, which validates every argument.
    constructor(address morpho, address musd, address collateral_, address oracle, address irm, uint256 lltv) {
        FACTORY = msg.sender;
        MORPHO = morpho;
        _MUSD = musd;
        _COLLATERAL = collateral_;
        _ORACLE = oracle;
        _IRM = irm;
        _LLTV = lltv;
        MARKET_ID = MarketParamsLib.id(
            MarketParams({loanToken: musd, collateralToken: collateral_, oracle: oracle, irm: irm, lltv: lltv})
        );
        _SELF = address(this);
    }

    /// @notice Accepts native BTC from CollSurplusPool claims (the come-back flow) and other senders.
    receive() external payable {}

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBorrowAccount
    function owner() public view returns (address) {
        if (address(this) == _SELF) return address(0);
        return address(bytes20(Clones.fetchCloneArgs(address(this))));
    }

    /// @inheritdoc IBorrowAccount
    function marketParams() public view returns (MarketParams memory) {
        return MarketParams({loanToken: _MUSD, collateralToken: _COLLATERAL, oracle: _ORACLE, irm: _IRM, lltv: _LLTV});
    }

    /// @inheritdoc IBorrowAccount
    function collateral() external view returns (uint256 coll) {
        (coll,) = _position();
    }

    /// @inheritdoc IBorrowAccount
    /// @dev Same math as `MorphoBalancesLib.expectedBorrowAssets` (borrow side only: the supply-side fee shares it
    /// also computes do not affect borrow assets), inlined to keep the implementation's deploy cost down.
    function debt() external view returns (uint256) {
        (, uint256 shares) = _position();
        if (shares == 0) return 0;
        Market memory m = _market();
        uint256 totalBorrowAssets = m.totalBorrowAssets;
        uint256 elapsed = block.timestamp - m.lastUpdate;
        if (elapsed != 0 && totalBorrowAssets != 0) {
            uint256 rate = IIrm(_IRM).borrowRateView(marketParams(), m);
            totalBorrowAssets += totalBorrowAssets.wMulDown(rate.wTaylorCompounded(elapsed));
        }
        return shares.toAssetsUp(totalBorrowAssets, m.totalBorrowShares);
    }

    // ---------------------------------------------------------------- owner / factory entry points

    /// @inheritdoc IBorrowAccount
    function openAndBorrow(uint256 musdOut, uint256 maxLtvBps, address receiver)
        external
        payable
        nonReentrant
        onlyOwnerOrFactory
    {
        if (msg.value == 0 && musdOut == 0) revert ZeroAmount();
        IBorrowAccountFactory.RiskParams memory rp = _riskParams();
        if (rp.borrowPaused) revert BorrowPaused();
        if (msg.value != 0) _supply(msg.value, rp.positionCap);
        if (musdOut != 0) _borrow(musdOut, maxLtvBps, receiver, rp);
        emit Opened(owner(), msg.value, musdOut);
    }

    /// @inheritdoc IBorrowAccount
    function borrow(uint256 musdOut, uint256 maxLtvBps, address receiver) external nonReentrant onlyOwnerOrFactory {
        if (musdOut == 0) revert ZeroAmount();
        _borrow(musdOut, maxLtvBps, receiver, _riskParams());
    }

    /// @inheritdoc IBorrowAccount
    function addCollateral() external payable nonReentrant onlyOwnerOrFactory {
        if (msg.value == 0) revert ZeroAmount();
        _supply(msg.value, _riskParams().positionCap);
    }

    /// @inheritdoc IBorrowAccount
    function supplyIdle(uint256 musdOut, uint256 maxLtvBps, address receiver)
        external
        nonReentrant
        onlyOwnerOrFactory
        returns (uint256 supplied)
    {
        IBorrowAccountFactory.RiskParams memory rp = _riskParams();
        (uint256 coll,) = _position();
        uint256 room = rp.positionCap > coll ? rp.positionCap - coll : 0;
        uint256 idle = address(this).balance;
        supplied = idle < room ? idle : room;
        if (supplied == 0 && musdOut == 0) revert ZeroAmount();
        if (supplied != 0) _supply(supplied, rp.positionCap);
        if (musdOut != 0) _borrow(musdOut, maxLtvBps, receiver, rp);
    }

    /// @inheritdoc IBorrowAccount
    function repay(uint256 assets) external nonReentrant onlyOwnerOrFactory returns (uint256 repaid) {
        if (assets == 0) revert ZeroAmount();
        MarketParams memory params = marketParams();
        IMorpho(MORPHO).accrueInterest(params);
        (, uint256 shares, uint256 debt_) = _positionAndDebt();
        if (shares == 0) revert NoDebt();

        address owner_ = owner();
        // Covering the debt repays exactly the debt by shares; anything less repays by assets.
        bool full = assets >= debt_;
        repaid = full ? debt_ : assets;
        _repay(params, owner_, repaid, full ? shares : 0);
        (,, uint256 remaining) = _positionAndDebt();
        emit Repaid(owner_, repaid, remaining);
    }

    /// @inheritdoc IBorrowAccount
    function repayAndWithdraw(address btcTo) external nonReentrant onlyOwnerOrFactory {
        _exit(btcTo, type(uint256).max);
    }

    /// @inheritdoc IBorrowAccount
    function repayAndWithdrawWithPermit(
        uint256 maxRepay,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address btcTo
    ) external nonReentrant onlyOwnerOrFactory {
        // A front-run permit consumes the nonce; the allowance it set still lets the exit proceed.
        try IERC20Permit(_MUSD).permit(owner(), address(this), maxRepay, deadline, v, r, s) {} catch {}
        _exit(btcTo, maxRepay);
    }

    /// @inheritdoc IBorrowAccount
    function withdrawCollateral(uint256 amount, address btcTo) external nonReentrant onlyOwnerOrFactory {
        if (amount == 0) revert ZeroAmount();
        _withdrawAndUnwrap(marketParams(), amount, btcTo);
        emit CollateralWithdrawn(owner(), amount, btcTo);
    }

    /// @inheritdoc IBorrowAccount
    function borrowByModule(uint256 musdOut, uint256 maxLtvBps, address receiver) external nonReentrant {
        if (!moduleEnabled[msg.sender] || !IBorrowAccountFactory(FACTORY).isApprovedModule(msg.sender)) {
            revert ModuleNotApproved(msg.sender);
        }
        if (musdOut == 0) revert ZeroAmount();
        IBorrowAccountFactory.RiskParams memory rp = _riskParams();
        if (rp.creditPaused) revert CreditPaused();
        _borrow(musdOut, maxLtvBps, receiver, rp);
    }

    /// @inheritdoc IBorrowAccount
    function setModule(address module, bool enabled) external nonReentrant onlyOwner {
        if (enabled && !IBorrowAccountFactory(FACTORY).isApprovedModule(module)) revert ModuleNotApproved(module);
        moduleEnabled[module] = enabled;
        emit ModuleSet(module, enabled);
    }

    /// @inheritdoc IBorrowAccount
    function rescueNative(address to) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert ZeroAmount();
        emit NativeRescued(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeSendFailed(to, amount);
    }

    // ---------------------------------------------------------------- internal

    /// @dev Wraps `amount` native BTC, supplies it to M1 and enforces the position cap.
    function _supply(uint256 amount, uint256 positionCap) internal {
        ICollateralBTC(_COLLATERAL).wrap{value: amount}();
        IERC20(_COLLATERAL).forceApprove(MORPHO, amount);
        IMorpho(MORPHO).supplyCollateral(marketParams(), amount, address(this), "");

        (uint256 coll,) = _position();
        if (coll > positionCap) revert PositionCapExceeded(coll, positionCap);
        emit CollateralAdded(owner(), amount, coll);
    }

    /// @dev Borrows `musdOut` plus the origination fee to this clone, enforces every borrow-path limit on the
    /// post-borrow state, then forwards `musdOut` to `receiver` and the fee to the fee recipient.
    function _borrow(uint256 musdOut, uint256 maxLtvBps, address receiver, IBorrowAccountFactory.RiskParams memory rp)
        internal
    {
        if (rp.borrowPaused) revert BorrowPaused();
        if (receiver == address(0)) revert ZeroAddress();
        address owner_ = owner();
        if (rp.profile == Profile.CANARY && !IBorrowAccountFactory(FACTORY).isCanaryOperator(owner_)) {
            revert NotCanaryOperator(owner_);
        }

        uint256 fee = rp.feeRecipient == address(0) ? 0 : musdOut.mulDivUp(rp.feeBps, BPS);
        // Morpho accrues interest, then checks its own health (oracle read #1) and liquidity.
        IMorpho(MORPHO).borrow(marketParams(), musdOut + fee, 0, address(this), address(this));

        Market memory m = _market();
        if (m.totalBorrowAssets > rp.globalBorrowCap) {
            revert GlobalCapExceeded(m.totalBorrowAssets, rp.globalBorrowCap);
        }
        (uint256 coll, uint256 shares) = _position();
        if (coll > rp.positionCap) revert PositionCapExceeded(coll, rp.positionCap);
        uint256 debt_ = shares.toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares);
        uint256 ltvBps = _checkLtv(coll, debt_, maxLtvBps < rp.ceilingBps ? maxLtvBps : rp.ceilingBps); // oracle read #2

        IERC20(_MUSD).safeTransfer(receiver, musdOut);
        if (fee != 0) IERC20(_MUSD).safeTransfer(rp.feeRecipient, fee);
        emit Borrowed(owner_, musdOut, fee, debt_, ltvBps);
    }

    /// @dev Full exit without any oracle read: Morpho skips the health check once borrow shares are zero.
    function _exit(address btcTo, uint256 maxRepay) internal {
        MarketParams memory params = marketParams();
        IMorpho(MORPHO).accrueInterest(params);
        (uint256 btcOut, uint256 shares, uint256 repaid) = _positionAndDebt();
        if (shares == 0 && btcOut == 0) revert NoPosition();

        address owner_ = owner();
        if (shares != 0) {
            if (repaid > maxRepay) revert RepayExceedsMax(repaid, maxRepay);
            _repay(params, owner_, repaid, shares);
        }
        if (btcOut != 0) _withdrawAndUnwrap(params, btcOut, btcTo);
        emit Exited(owner_, repaid, btcOut);
    }

    /// @dev Pulls `assets` MUSD from `from`, approves exactly that to Morpho and repays: by `shares` when non-zero
    /// (Morpho then pulls `shares.toAssetsUp`, which the caller passed as `assets`), otherwise by `assets`.
    function _repay(MarketParams memory params, address from, uint256 assets, uint256 shares) internal {
        IERC20(_MUSD).safeTransferFrom(from, address(this), assets);
        IERC20(_MUSD).forceApprove(MORPHO, assets);
        IMorpho(MORPHO).repay(params, shares == 0 ? assets : 0, shares, address(this), "");
    }

    /// @dev Withdraws `amount` bcBTC from M1 to this clone and unwraps it to native BTC at `btcTo`. With debt still
    /// outstanding, the remaining position must respect the profile ceiling (one oracle read) before any BTC leaves;
    /// with no debt, as in the full exit, there is no oracle call.
    function _withdrawAndUnwrap(MarketParams memory params, uint256 amount, address btcTo) internal {
        if (btcTo == address(0)) revert ZeroAddress();
        IMorpho(MORPHO).withdrawCollateral(params, amount, address(this), address(this));
        // Morpho accrued interest inside withdrawCollateral, so the stored totals are current.
        (uint256 coll, uint256 shares, uint256 debt_) = _positionAndDebt();
        if (shares != 0) _checkLtv(coll, debt_, _riskParams().ceilingBps);
        ICollateralBTC(_COLLATERAL).unwrap(amount, btcTo);
    }

    /// @dev Reverts with `LtvTooHigh` unless `debt_ * 1e4 <= value(coll) * limitBps`; returns the LTV rounded up.
    function _checkLtv(uint256 coll, uint256 debt_, uint256 limitBps) internal view returns (uint256 ltvBps) {
        // Same valuation as Morpho's own health check: collateral * price / 1e36, rounded down.
        uint256 collValue = coll.mulDivDown(IOracle(_ORACLE).price(), ORACLE_PRICE_SCALE);
        ltvBps = collValue == 0 ? type(uint256).max : debt_.mulDivUp(BPS, collValue);
        if (debt_ * BPS > collValue * limitBps) revert LtvTooHigh(ltvBps, limitBps);
    }

    /// @dev Collateral, borrow shares and the debt they represent at the stored market totals (rounded up).
    function _positionAndDebt() internal view returns (uint256 coll, uint256 shares, uint256 debt_) {
        (coll, shares) = _position();
        if (shares != 0) {
            Market memory m = _market();
            debt_ = shares.toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares);
        }
    }

    function _position() internal view returns (uint256 coll, uint256 shares) {
        Position memory pos = IMorpho(MORPHO).position(MARKET_ID, address(this));
        (coll, shares) = (pos.collateral, pos.borrowShares);
    }

    function _market() internal view returns (Market memory) {
        return IMorpho(MORPHO).market(MARKET_ID);
    }

    function _riskParams() internal view returns (IBorrowAccountFactory.RiskParams memory) {
        return IBorrowAccountFactory(FACTORY).riskParams(address(this));
    }
}
