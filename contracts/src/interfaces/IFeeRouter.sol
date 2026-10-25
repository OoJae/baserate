// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Immutable, ownerless splitter for Baserate's MUSD origination fees: 40% to sMUSD holders as protocol yield,
/// 40% as MUSD bribes on the BTC/MUSD pool gauges (veBTC voters who steer MEZO emissions to the pools that liquidate
/// Baserate collateral), 20% to the treasury.
interface IFeeRouter {
    /// @notice A pool gauge and the BribeVotingReward the voter created for it.
    struct BribeTarget {
        address gauge;
        address bribe;
    }

    /// @notice Why a bribe share went to sMUSD instead.
    enum RedirectReason {
        GaugeDead,
        VoterUnreadable,
        NotifyFailed
    }

    /// @notice What `distribute()` would do with the current balance.
    /// @param total MUSD balance to split.
    /// @param toSmusd 40% plus redirected bribe shares; posted only when `smusdAccepts`.
    /// @param smusdAccepts False when `toSmusd` is 0 or below sMUSD's `AmountTooSmall` floor (it then stays here).
    /// @param toTreasury 20% (rounded down).
    /// @param bribeAmounts Per configured gauge, the amount that would be posted (0 when redirected).
    /// @param gaugeAlive Per configured gauge, the voter's `isAlive` (false when unreadable).
    /// @param epochStart Start of the bribe epoch the bribes would be credited to.
    struct Plan {
        uint256 total;
        uint256 toSmusd;
        bool smusdAccepts;
        uint256 toTreasury;
        uint256[] bribeAmounts;
        bool[] gaugeAlive;
        uint256 epochStart;
    }

    /// @notice Emitted once per `distribute()`. Amounts per destination; `retained` stays here (sMUSD dust floor).
    event Distributed(
        address indexed caller,
        uint256 indexed epochStart,
        uint256 total,
        uint256 toSmusd,
        uint256 toBribes,
        uint256 toTreasury,
        uint256 retained
    );
    /// @notice A bribe was credited to `epochStart` on `bribe`.
    event BribePosted(address indexed gauge, address indexed bribe, uint256 indexed epochStart, uint256 amount);
    /// @notice A gauge's bribe share went to sMUSD instead.
    event BribeRedirected(address indexed gauge, uint256 amount, RedirectReason reason);
    /// @notice MUSD donated to sMUSD through `receiveProtocolYield`.
    event SmusdYieldPosted(uint256 amount);
    /// @notice The sMUSD share was below sMUSD's `AmountTooSmall` floor and stays here for the next distribution.
    event SmusdYieldDeferred(uint256 amount);
    /// @notice MUSD paid to the treasury.
    event TreasuryPaid(address indexed treasury, uint256 amount);

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice Zero or more than `MAX_GAUGES` bribe targets.
    error InvalidTargetCount(uint256 count);
    /// @notice The same gauge was configured twice.
    error DuplicateGauge(address gauge);
    /// @notice The voter does not know `gauge`.
    error NotAGauge(address gauge);
    /// @notice The voter maps `gauge` to a different bribe contract.
    error BribeMismatch(address gauge, address expected, address actual);
    /// @notice `bribe` would reject MUSD (not a reward token and not whitelisted on the voter).
    error MusdNotBribeable(address bribe);
    /// @notice sMUSD's underlying token is not `musd`.
    error SmusdAssetMismatch(address expected, address actual);
    /// @notice The router holds no MUSD.
    error NothingToDistribute();
    /// @notice Not enough gas left to give an external call its full stipend (prevents griefing the split by
    /// starving a call so it fails).
    error InsufficientGas();

    /// @notice Splits the whole MUSD balance 40/40/20. Permissionless. Reverts `NothingToDistribute` on 0.
    /// @return plan What was done (same layout as `previewDistribute`, with `bribeAmounts` as actually posted).
    function distribute() external returns (Plan memory plan);

    /// @notice What `distribute()` would do now. Assumes every live gauge's notify succeeds.
    function previewDistribute() external view returns (Plan memory plan);

    /// @notice The configured gauges and their bribe contracts.
    function targets() external view returns (BribeTarget[] memory);

    /// @notice Start of the bribe epoch containing `timestamp` (Thursday 00:00 UTC).
    function epochStartOf(uint256 timestamp) external pure returns (uint256);

    function MUSD() external view returns (address);
    function SMUSD() external view returns (address);
    function VOTER() external view returns (address);
    function TREASURY() external view returns (address);
    function GAUGE_COUNT() external view returns (uint256);
}
