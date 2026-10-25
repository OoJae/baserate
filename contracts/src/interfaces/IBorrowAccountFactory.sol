// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

/// @notice Risk profile of a BorrowAccount. CANARY accounts run near the LLTV so a liquidation can always be
/// demonstrated; only canary operators can open them.
enum Profile {
    STANDARD,
    CANARY
}

/// @notice Deploys and registers per-owner BorrowAccount clones on the M1 market (MUSD loan, bcBTC collateral) and
/// holds the risk parameters they enforce.
/// @dev Governance: increases are 48 h timelocked (`submit` then call the setter; anyone may execute), decreases are
/// instant by the governor or the sentinel, and pausing never blocks top-ups, repay, withdraw, unwrap or liquidation.
interface IBorrowAccountFactory {
    /// @notice Per-profile limits.
    /// @param positionCap Maximum collateral per position, in bcBTC wei (18 decimals).
    /// @param ceilingBps Maximum post-action LTV in basis points; always <= LLTV - 25 bps.
    struct Limits {
        uint128 positionCap;
        uint16 ceilingBps;
    }

    /// @notice Constructor parameters, grouped to avoid stack-too-deep.
    /// @dev Roles are explicit because the factory is deployed through the CREATE2 deployer.
    struct FactoryParams {
        address morpho;
        address musd;
        address oracle;
        address irm;
        uint256 lltv;
        address bos;
        address collSurplusPool;
        address governor;
        address sentinel;
        address feeRecipient;
        uint256 globalBorrowCap;
        Limits standard;
        Limits canary;
    }

    /// @notice Everything an account needs for its checks, returned in one call.
    struct RiskParams {
        Profile profile;
        uint128 positionCap;
        uint16 ceilingBps;
        uint256 globalBorrowCap;
        bool borrowPaused;
        bool creditPaused;
        address feeRecipient;
        uint256 feeBps;
    }

    /// @notice Emitted when a clone is deployed for `owner`.
    event AccountCreated(address indexed owner, address indexed account, Profile profile);
    /// @notice Emitted when `comeBack` claims redeemed-trove surplus BTC into the caller's clone.
    event ComeBack(address indexed owner, address indexed account, uint256 claimed);
    /// @notice Emitted when the governor queues a timelocked call.
    event Submitted(bytes4 indexed selector, bytes data, uint256 executableAt);
    /// @notice Emitted when a queued call is revoked.
    event Revoked(address indexed caller, bytes4 indexed selector, bytes data);
    /// @notice Emitted when a queued call is executed.
    event Accepted(bytes4 indexed selector, bytes data);
    /// @notice Emitted when the global borrow cap changes.
    event GlobalBorrowCapSet(address indexed caller, uint256 globalBorrowCap);
    /// @notice Emitted when a profile's limits change.
    event LimitsSet(address indexed caller, Profile indexed profile, uint128 positionCap, uint16 ceilingBps);
    /// @notice Emitted when the origination-fee recipient changes.
    event FeeRecipientSet(address indexed feeRecipient);
    /// @notice Emitted when a module's approval changes.
    event ModuleApprovalSet(address indexed caller, address indexed module, bool approved);
    /// @notice Emitted when the pause flags change.
    event PausedSet(address indexed caller, bool borrowPaused, bool creditPaused);
    /// @notice Emitted when a canary operator is added or removed.
    event CanaryOperatorSet(address indexed operator, bool enabled);
    /// @notice Emitted when the sentinel changes.
    event SentinelSet(address indexed sentinel);
    /// @notice Emitted when the governor starts a two-step transfer.
    event GovernanceTransferStarted(address indexed governor, address indexed pendingGovernor);
    /// @notice Emitted when the pending governor accepts.
    event GovernanceTransferred(address indexed previousGovernor, address indexed newGovernor);

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice The LLTV is zero or not below 1e18.
    error InvalidLltv(uint256 lltv);
    /// @notice A ceiling above `MAX_CEILING_BPS` (LLTV - 25 bps).
    error CeilingTooHigh(uint256 ceilingBps, uint256 maxCeilingBps);
    /// @notice The caller lacks the required role.
    error Unauthorized();
    /// @notice Only canary operators can open CANARY accounts.
    error NotCanaryOperator(address caller);
    /// @notice The call is already queued.
    error DataAlreadyPending();
    /// @notice The call was not queued (or was revoked or already executed).
    error DataNotTimelocked();
    /// @notice The 48 h timelock has not elapsed.
    error TimelockNotExpired(uint256 executableAt);
    /// @notice `submit` was given a selector that is not timelocked.
    error InvalidTimelockedCall(bytes4 selector);
    /// @notice `comeBack` is disabled because no BorrowerOperationsSignatures address was configured.
    error ComeBackDisabled();
    /// @notice The signed claim delivered no BTC to the caller's clone.
    error NothingClaimed();

    // ---------------------------------------------------------------- user entry points

    /// @notice Deploys the caller's STANDARD clone if needed, supplies `msg.value` BTC and borrows `musdOut` MUSD to
    /// the caller.
    /// @param musdOut MUSD sent to the caller; the debt also carries the 10 bps origination fee.
    /// @param maxLtvBps Caller's slippage guard: post-borrow LTV must be <= min(maxLtvBps, profile ceiling).
    /// @return account The caller's STANDARD clone.
    function openAndBorrow(uint256 musdOut, uint256 maxLtvBps) external payable returns (address account);

    /// @notice Same as `openAndBorrow` on the caller's CANARY clone. Canary operators only.
    /// @return account The caller's CANARY clone.
    function openCanary(uint256 musdOut, uint256 maxLtvBps) external payable returns (address account);

    /// @notice Deploys `owner`'s STANDARD clone if it does not exist yet. Permissionless and idempotent.
    /// @return account The STANDARD clone of `owner`.
    function createAccount(address owner) external returns (address account);

    /// @notice Claims the caller's MUSD CollSurplusPool BTC straight into the caller's STANDARD clone (deploying it
    /// if needed), supplies it as collateral and optionally borrows.
    /// @param claimSig The caller's EIP-712 `ClaimCollateral` signature naming the clone as recipient.
    /// @param deadline The signature deadline.
    /// @param musdOut MUSD to borrow to the caller (0 for none).
    /// @param maxLtvBps LTV guard for the optional borrow.
    /// @return account The caller's STANDARD clone.
    /// @return claimed BTC delivered to the clone by the claim.
    function comeBack(bytes calldata claimSig, uint256 deadline, uint256 musdOut, uint256 maxLtvBps)
        external
        returns (address account, uint256 claimed);

    // ---------------------------------------------------------------- views

    /// @notice The CREATE2 address of `owner`'s clone for `profile`, and whether it is deployed.
    function accountOf(address owner, Profile profile) external view returns (address account, bool deployed);

    /// @notice True for clones deployed by this factory.
    function isAccount(address account) external view returns (bool);

    /// @notice The profile a clone was created with.
    function profileOf(address account) external view returns (Profile);

    /// @notice The M1 market parameters.
    function marketParams() external view returns (MarketParams memory);

    /// @notice The M1 market id.
    function MARKET_ID() external view returns (Id);

    /// @notice The bcBTC receipt token deployed by this factory.
    function COLLATERAL() external view returns (address);

    /// @notice The BorrowAccount implementation behind every clone.
    function IMPLEMENTATION() external view returns (address);

    /// @notice Morpho Blue.
    function MORPHO() external view returns (address);

    /// @notice The MUSD loan token.
    function MUSD() external view returns (address);

    /// @notice The M1 market oracle.
    function ORACLE() external view returns (address);

    /// @notice The M1 interest-rate model.
    function IRM() external view returns (address);

    /// @notice The M1 LLTV (WAD).
    function LLTV() external view returns (uint256);

    /// @notice BorrowerOperationsSignatures (0 disables `comeBack`).
    function BOS() external view returns (address);

    /// @notice MUSD's CollSurplusPool (read-only, for `claimableSurplus`).
    function COLL_SURPLUS_POOL() external view returns (address);

    /// @notice Origination fee in basis points (constant 10).
    function ORIGINATION_FEE_BPS() external view returns (uint256);

    /// @notice Timelock applied to increases (48 h).
    function TIMELOCK() external view returns (uint256);

    /// @notice Highest ceiling any profile may have: LLTV in bps minus 25.
    function MAX_CEILING_BPS() external view returns (uint256);

    /// @notice Cap on M1 `totalBorrowAssets` enforced after every account borrow.
    function globalBorrowCap() external view returns (uint256);

    /// @notice Limits for `profile`.
    function limits(Profile profile) external view returns (uint128 positionCap, uint16 ceilingBps);

    /// @notice True while new positions and borrows are paused.
    function borrowPaused() external view returns (bool);

    /// @notice True while module (credit-line) draws are paused.
    function creditPaused() external view returns (bool);

    /// @notice Recipient of the origination fee (0 charges no fee).
    function feeRecipient() external view returns (address);

    /// @notice Current governor.
    function governor() external view returns (address);

    /// @notice Governor-elect awaiting `acceptGovernance`.
    function pendingGovernor() external view returns (address);

    /// @notice Sentinel: may pause, cut caps and limits, remove modules and revoke queued calls.
    function sentinel() external view returns (address);

    /// @notice True for modules approved to call `BorrowAccount.borrowByModule`.
    function isApprovedModule(address module) external view returns (bool);

    /// @notice True for addresses allowed to open CANARY accounts.
    function isCanaryOperator(address operator) external view returns (bool);

    /// @notice Timestamp at which queued `data` becomes executable (0 if not queued).
    function executableAt(bytes calldata data) external view returns (uint256);

    /// @notice One-call bundle of the parameters `account` enforces.
    function riskParams(address account) external view returns (RiskParams memory);

    /// @notice BTC claimable by `owner` in MUSD's CollSurplusPool (0 if the pool is not configured).
    function claimableSurplus(address owner) external view returns (uint256);

    // ---------------------------------------------------------------- governance

    /// @notice Queues a timelocked call (governor only). `data` is the full calldata of the setter.
    function submit(bytes calldata data) external;

    /// @notice Drops a queued call (governor or sentinel).
    function revoke(bytes calldata data) external;

    /// @notice Sets the global borrow cap. Decreases: governor or sentinel, instant. Increases: timelocked.
    function setGlobalBorrowCap(uint256 newCap) external;

    /// @notice Sets a profile's limits. Decreases of both fields: governor or sentinel, instant. Otherwise
    /// timelocked. The ceiling must stay <= `MAX_CEILING_BPS`.
    function setLimits(Profile profile, uint128 positionCap, uint16 ceilingBps) external;

    /// @notice Sets the origination-fee recipient. Always timelocked.
    function setFeeRecipient(address newFeeRecipient) external;

    /// @notice Approves (timelocked) or removes (governor or sentinel, instant) a borrow module.
    function setModuleApproval(address module, bool approved) external;

    /// @notice Sets the pause flags. Pausing: governor or sentinel. Unpausing: governor only.
    function setPaused(bool borrowPaused_, bool creditPaused_) external;

    /// @notice Adds or removes a canary operator (governor only).
    function setCanaryOperator(address operator, bool enabled) external;

    /// @notice Replaces the sentinel (governor only; 0 removes it).
    function setSentinel(address newSentinel) external;

    /// @notice Starts a two-step governor transfer (governor only).
    function transferGovernance(address newGovernor) external;

    /// @notice Completes a governor transfer (pending governor only).
    function acceptGovernance() external;
}
