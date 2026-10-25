// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {CollateralBTC} from "../collateral/CollateralBTC.sol";
import {IBorrowAccount} from "../interfaces/IBorrowAccount.sol";
import {IBorrowAccountFactory, Profile} from "../interfaces/IBorrowAccountFactory.sol";
import {IBorrowerOperationsSignatures} from "../interfaces/external/IBorrowerOperationsSignatures.sol";
import {ICollSurplusPool} from "../interfaces/external/ICollSurplusPool.sol";
import {BorrowAccount} from "./BorrowAccount.sol";

/// @title BorrowAccountFactory
/// @notice Single entry point for Baserate's M1 credit: deploys one deterministic BorrowAccount clone per
/// (owner, profile), registers it for the bcBTC gate, and holds the risk parameters every clone enforces.
/// @dev No proxies and no admin derived from `msg.sender`: the governor, sentinel and fee recipient are passed in,
/// because deployment goes through the Arachnid CREATE2 deployer. The constructor deploys the bcBTC receipt and the
/// BorrowAccount implementation; the M1 market itself is created by the deploy script.
/// Governance follows the Vault V2 pattern: the governor `submit`s the exact calldata of a raising call, and after
/// `TIMELOCK` (and within `EXECUTION_WINDOW`) anyone may execute it by calling the setter with that calldata.
/// Decreases are instant for the governor or the sentinel, and every decrease of a parameter invalidates all queued
/// calls for that same parameter (and consumes its own calldata if it was queued), so a raise queued before an
/// emergency cut can never undo it. Raises are: global cap and limit increases, fee-recipient changes, module
/// approvals and canary-operator grants. Pausing blocks borrowing (including `openAndBorrow` and `openCanary`) and
/// module draws only; collateral-only top-ups, repay, withdraw, unwrap and liquidation are never pausable.
contract BorrowAccountFactory is IBorrowAccountFactory, ReentrancyGuardTransient {
    /// @inheritdoc IBorrowAccountFactory
    uint256 public constant ORIGINATION_FEE_BPS = 10;
    /// @inheritdoc IBorrowAccountFactory
    uint256 public constant TIMELOCK = 48 hours;
    /// @inheritdoc IBorrowAccountFactory
    uint256 public constant EXECUTION_WINDOW = 14 days;

    /// @inheritdoc IBorrowAccountFactory
    address public immutable MORPHO;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable MUSD;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable ORACLE;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable IRM;
    /// @inheritdoc IBorrowAccountFactory
    uint256 public immutable LLTV;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable BOS;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable COLL_SURPLUS_POOL;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable COLLATERAL;
    /// @inheritdoc IBorrowAccountFactory
    address public immutable IMPLEMENTATION;
    /// @inheritdoc IBorrowAccountFactory
    Id public immutable MARKET_ID;
    /// @inheritdoc IBorrowAccountFactory
    uint256 public immutable MAX_CEILING_BPS;

    /// @inheritdoc IBorrowAccountFactory
    address public governor;
    /// @inheritdoc IBorrowAccountFactory
    address public pendingGovernor;
    /// @inheritdoc IBorrowAccountFactory
    address public sentinel;
    /// @inheritdoc IBorrowAccountFactory
    address public feeRecipient;
    /// @inheritdoc IBorrowAccountFactory
    uint256 public globalBorrowCap;
    /// @inheritdoc IBorrowAccountFactory
    bool public borrowPaused;
    /// @inheritdoc IBorrowAccountFactory
    bool public creditPaused;

    /// @inheritdoc IBorrowAccountFactory
    mapping(Profile profile => Limits) public limits;
    /// @inheritdoc IBorrowAccountFactory
    mapping(address account => bool) public isAccount;
    /// @inheritdoc IBorrowAccountFactory
    mapping(address account => Profile) public profileOf;
    /// @inheritdoc IBorrowAccountFactory
    mapping(address module => bool) public isApprovedModule;
    /// @inheritdoc IBorrowAccountFactory
    mapping(address operator => bool) public isCanaryOperator;

    /// @dev Queue slot (see `_slot`: the calldata hash under its parameter's current epoch) => executable-at time.
    mapping(bytes32 slot => uint256) internal _queued;
    /// @dev Parameter key (see `_slot`) => epoch, bumped by every instant decrease of that parameter. Bumping it moves
    /// every call queued earlier for that parameter to slots that are never read again.
    mapping(bytes32 paramKey => uint256) internal _epoch;

    modifier onlyGovernor() {
        if (msg.sender != governor) revert Unauthorized();
        _;
    }

    /// @param p Network wiring, roles and initial risk parameters (see `FactoryParams`).
    constructor(FactoryParams memory p) {
        if (
            p.morpho == address(0) || p.musd == address(0) || p.oracle == address(0) || p.irm == address(0)
                || p.governor == address(0)
        ) revert ZeroAddress();
        // Morpho requires lltv < 1e18; the ceiling cushion needs at least 26 bps of LLTV.
        if (p.lltv >= 1e18 || p.lltv / 1e14 <= 25) revert InvalidLltv(p.lltv);

        MORPHO = p.morpho;
        MUSD = p.musd;
        ORACLE = p.oracle;
        IRM = p.irm;
        LLTV = p.lltv;
        BOS = p.bos;
        COLL_SURPLUS_POOL = p.collSurplusPool;
        uint256 maxCeiling = p.lltv / 1e14 - 25;
        MAX_CEILING_BPS = maxCeiling;

        address collateral_ = address(new CollateralBTC(p.morpho));
        COLLATERAL = collateral_;
        IMPLEMENTATION = address(new BorrowAccount(p.morpho, p.musd, collateral_, p.oracle, p.irm, p.lltv));
        MARKET_ID = MarketParamsLib.id(
            MarketParams({loanToken: p.musd, collateralToken: collateral_, oracle: p.oracle, irm: p.irm, lltv: p.lltv})
        );

        governor = p.governor;
        sentinel = p.sentinel;
        feeRecipient = p.feeRecipient;
        globalBorrowCap = p.globalBorrowCap;
        _setLimits(Profile.STANDARD, p.standard.positionCap, p.standard.ceilingBps, maxCeiling);
        _setLimits(Profile.CANARY, p.canary.positionCap, p.canary.ceilingBps, maxCeiling);

        emit GovernanceTransferred(address(0), p.governor);
        emit SentinelSet(p.sentinel);
        emit FeeRecipientSet(p.feeRecipient);
        emit GlobalBorrowCapSet(msg.sender, p.globalBorrowCap);
    }

    // ---------------------------------------------------------------- user entry points

    /// @inheritdoc IBorrowAccountFactory
    function openAndBorrow(uint256 musdOut, uint256 maxLtvBps) external payable nonReentrant returns (address account) {
        account = _getOrCreate(msg.sender, Profile.STANDARD);
        IBorrowAccount(account).openAndBorrow{value: msg.value}(musdOut, maxLtvBps, msg.sender);
    }

    /// @inheritdoc IBorrowAccountFactory
    function openCanary(uint256 musdOut, uint256 maxLtvBps) external payable nonReentrant returns (address account) {
        if (!isCanaryOperator[msg.sender]) revert NotCanaryOperator(msg.sender);
        account = _getOrCreate(msg.sender, Profile.CANARY);
        IBorrowAccount(account).openAndBorrow{value: msg.value}(musdOut, maxLtvBps, msg.sender);
    }

    /// @inheritdoc IBorrowAccountFactory
    function createAccount(address owner) external nonReentrant returns (address account) {
        if (owner == address(0)) revert ZeroAddress();
        account = _getOrCreate(owner, Profile.STANDARD);
    }

    /// @inheritdoc IBorrowAccountFactory
    /// @dev The claim is bound to `msg.sender` as borrower and to the caller's own clone as recipient, so a leaked
    /// signature can only ever pay the signer's clone. BTC may land on the clone address before it is deployed.
    function comeBack(bytes calldata claimSig, uint256 deadline, uint256 musdOut, uint256 maxLtvBps)
        external
        nonReentrant
        returns (address account, uint256 claimed)
    {
        if (BOS == address(0)) revert ComeBackDisabled();
        (account,) = accountOf(msg.sender, Profile.STANDARD);

        uint256 balanceBefore = account.balance;
        IBorrowerOperationsSignatures(BOS).claimCollateralWithSignature(msg.sender, account, claimSig, deadline);
        claimed = account.balance - balanceBefore;
        if (claimed == 0) revert NothingClaimed();

        _getOrCreate(msg.sender, Profile.STANDARD);
        IBorrowAccount(account).supplyIdle(musdOut, maxLtvBps, msg.sender);
        emit ComeBack(msg.sender, account, claimed);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBorrowAccountFactory
    function accountOf(address owner, Profile profile) public view returns (address account, bool deployed) {
        account = Clones.predictDeterministicAddressWithImmutableArgs(
            IMPLEMENTATION, abi.encodePacked(owner), _salt(owner, profile)
        );
        deployed = isAccount[account];
    }

    /// @inheritdoc IBorrowAccountFactory
    function marketParams() external view returns (MarketParams memory) {
        return MarketParams({loanToken: MUSD, collateralToken: COLLATERAL, oracle: ORACLE, irm: IRM, lltv: LLTV});
    }

    /// @inheritdoc IBorrowAccountFactory
    /// @dev A CANARY clone whose owner (its immutable argument) is no longer a canary operator gets the lower of the
    /// two ceilings: its borrows are refused outright, and its withdrawals must not push LTV past the STANDARD ceiling.
    function riskParams(address account) external view returns (RiskParams memory rp) {
        Profile profile = profileOf[account];
        Limits memory l = limits[profile];
        if (profile == Profile.CANARY && !isCanaryOperator[_cloneOwner(account)]) {
            uint16 standardBps = limits[Profile.STANDARD].ceilingBps;
            if (standardBps < l.ceilingBps) l.ceilingBps = standardBps;
        }
        rp = RiskParams({
            profile: profile,
            positionCap: l.positionCap,
            ceilingBps: l.ceilingBps,
            globalBorrowCap: globalBorrowCap,
            borrowPaused: borrowPaused,
            creditPaused: creditPaused,
            feeRecipient: feeRecipient,
            feeBps: ORIGINATION_FEE_BPS
        });
    }

    /// @inheritdoc IBorrowAccountFactory
    function claimableSurplus(address owner) external view returns (uint256) {
        if (COLL_SURPLUS_POOL == address(0)) return 0;
        return ICollSurplusPool(COLL_SURPLUS_POOL).getCollateral(owner);
    }

    /// @inheritdoc IBorrowAccountFactory
    function executableAt(bytes calldata data) public view returns (uint256 at) {
        if (data.length < 36) return 0; // never queued: `submit` requires an argument word
        at = _queued[_slot(data)];
        if (block.timestamp > at + EXECUTION_WINDOW) at = 0;
    }

    // ---------------------------------------------------------------- governance

    /// @inheritdoc IBorrowAccountFactory
    function submit(bytes calldata data) external onlyGovernor nonReentrant {
        bytes4 selector = _timelockedSelector(data);
        if (executableAt(data) != 0) revert DataAlreadyPending();
        uint256 at = block.timestamp + TIMELOCK;
        _queued[_slot(data)] = at; // overwrites an expired entry for the same calldata
        emit Submitted(selector, data, at);
    }

    /// @inheritdoc IBorrowAccountFactory
    function revoke(bytes calldata data) external nonReentrant {
        _onlyGovernorOrSentinel();
        if (executableAt(data) == 0) revert DataNotTimelocked();
        delete _queued[_slot(data)];
        emit Revoked(msg.sender, bytes4(data[:4]), data);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setGlobalBorrowCap(uint256 newCap) external nonReentrant {
        if (newCap <= globalBorrowCap) _decrease();
        else _consumeTimelock();
        globalBorrowCap = newCap;
        emit GlobalBorrowCapSet(msg.sender, newCap);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setLimits(Profile profile, uint128 positionCap, uint16 ceilingBps) external nonReentrant {
        Limits memory current = limits[profile];
        if (positionCap <= current.positionCap && ceilingBps <= current.ceilingBps) _decrease();
        else _consumeTimelock();
        _setLimits(profile, positionCap, ceilingBps, MAX_CEILING_BPS);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setFeeRecipient(address newFeeRecipient) external nonReentrant {
        _consumeTimelock();
        feeRecipient = newFeeRecipient;
        emit FeeRecipientSet(newFeeRecipient);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setModuleApproval(address module, bool approved) external nonReentrant {
        if (module == address(0)) revert ZeroAddress();
        if (approved) _consumeTimelock();
        else _decrease();
        isApprovedModule[module] = approved;
        emit ModuleApprovalSet(msg.sender, module, approved);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setPaused(bool borrowPaused_, bool creditPaused_) external nonReentrant {
        if (msg.sender != governor) {
            if (msg.sender != sentinel) revert Unauthorized();
            // The sentinel may only pause.
            if ((borrowPaused && !borrowPaused_) || (creditPaused && !creditPaused_)) revert Unauthorized();
        }
        borrowPaused = borrowPaused_;
        creditPaused = creditPaused_;
        emit PausedSet(msg.sender, borrowPaused_, creditPaused_);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setCanaryOperator(address operator, bool enabled) external nonReentrant {
        if (operator == address(0)) revert ZeroAddress();
        // A grant lets the operator borrow at the CANARY ceiling, so it is a timelocked raise like any other.
        if (enabled) _consumeTimelock();
        else _decrease();
        isCanaryOperator[operator] = enabled;
        emit CanaryOperatorSet(operator, enabled);
    }

    /// @inheritdoc IBorrowAccountFactory
    function setSentinel(address newSentinel) external onlyGovernor nonReentrant {
        sentinel = newSentinel;
        emit SentinelSet(newSentinel);
    }

    /// @inheritdoc IBorrowAccountFactory
    function transferGovernance(address newGovernor) external onlyGovernor nonReentrant {
        pendingGovernor = newGovernor;
        emit GovernanceTransferStarted(governor, newGovernor);
    }

    /// @inheritdoc IBorrowAccountFactory
    function acceptGovernance() external nonReentrant {
        if (msg.sender != pendingGovernor) revert Unauthorized();
        emit GovernanceTransferred(governor, msg.sender);
        governor = msg.sender;
        pendingGovernor = address(0);
    }

    // ---------------------------------------------------------------- internal

    function _getOrCreate(address owner, Profile profile) internal returns (address account) {
        bool deployed;
        (account, deployed) = accountOf(owner, profile);
        if (deployed) return account;

        address created =
            Clones.cloneDeterministicWithImmutableArgs(IMPLEMENTATION, abi.encodePacked(owner), _salt(owner, profile));
        assert(created == account);
        isAccount[account] = true;
        profileOf[account] = profile;
        emit AccountCreated(owner, account, profile);
    }

    function _setLimits(Profile profile, uint128 positionCap, uint16 ceilingBps, uint256 maxCeiling) internal {
        if (ceilingBps > maxCeiling) revert CeilingTooHigh(ceilingBps, maxCeiling);
        limits[profile] = Limits({positionCap: positionCap, ceilingBps: ceilingBps});
        emit LimitsSet(msg.sender, profile, positionCap, ceilingBps);
    }

    function _onlyGovernorOrSentinel() internal view {
        if (msg.sender != governor && msg.sender != sentinel) revert Unauthorized();
    }

    /// @dev Consumes the live queued entry for the exact calldata of the current call. Anyone may execute once it is
    /// due and until `EXECUTION_WINDOW` after that.
    function _consumeTimelock() internal {
        uint256 at = executableAt(msg.data);
        if (at == 0) revert DataNotTimelocked();
        if (block.timestamp < at) revert TimelockNotExpired(at);
        delete _queued[_slot(msg.data)];
        emit Accepted(msg.sig, msg.data);
    }

    /// @dev Instant decrease (governor or sentinel). Bumps the parameter's epoch, so every call queued for it before
    /// this decrease, including this exact calldata if it was queued as a raise, is no longer executable.
    function _decrease() internal {
        _onlyGovernorOrSentinel();
        (bytes32 key, bytes32 param) = _paramKey(msg.data);
        ++_epoch[key];
        emit PendingInvalidated(msg.sig, param);
    }

    /// @dev The parameter a timelocked call changes: the selector alone for the global cap, the selector and the
    /// first argument word (profile, module, operator or fee recipient) otherwise. `data` must hold 36 bytes.
    function _paramKey(bytes calldata data) internal pure returns (bytes32 key, bytes32 param) {
        bytes4 selector = bytes4(data[:4]);
        if (selector != IBorrowAccountFactory.setGlobalBorrowCap.selector) param = bytes32(data[4:36]);
        key = keccak256(abi.encodePacked(selector, param));
    }

    /// @dev Where `data` is queued: its hash under the current epoch of the parameter it changes.
    function _slot(bytes calldata data) internal view returns (bytes32) {
        (bytes32 key,) = _paramKey(data);
        return keccak256(abi.encode(_epoch[key], keccak256(data)));
    }

    /// @dev Validates `submit` calldata: a timelocked selector and at least one argument word.
    function _timelockedSelector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) revert InvalidTimelockedCall(bytes4(0));
        selector = bytes4(data[:4]);
        if (
            (selector != IBorrowAccountFactory.setGlobalBorrowCap.selector
                    && selector != IBorrowAccountFactory.setLimits.selector
                    && selector != IBorrowAccountFactory.setFeeRecipient.selector
                    && selector != IBorrowAccountFactory.setModuleApproval.selector
                    && selector != IBorrowAccountFactory.setCanaryOperator.selector) || data.length < 36
        ) revert InvalidTimelockedCall(selector);
    }

    /// @dev The owner of a registered clone: the 20-byte immutable argument after the 45-byte ERC-1167 runtime.
    function _cloneOwner(address account) internal view returns (address owner) {
        assembly ("memory-safe") {
            mstore(0, 0)
            extcodecopy(account, 12, 45, 20)
            owner := mload(0)
        }
    }

    function _salt(address owner, Profile profile) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, profile));
    }
}
