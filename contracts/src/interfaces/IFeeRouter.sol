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

    /// @notice Why a bribe share stays in the router for a later `distribute()` (it is added to the same gauge's
    /// share next time).
    /// @dev `VoteWindowClosed`: last hour of the epoch, when Mezo's Voter only lets whitelisted veNFTs vote.
    /// `NoVotes`: the bribe contract has no votes (`totalSupply() == 0`); a bribe credited now could never be claimed
    /// if that is still true when the epoch ends.
    enum CarryReason {
        VoteWindowClosed,
        NoVotes
    }

    /// @notice What `distribute()` would do with the current balance.
    /// @param total MUSD balance to split (new fees plus the amounts carried from earlier calls).
    /// @param toSmusd The sMUSD leg: 40% of the new fees plus redirected bribe shares plus the sMUSD carry; donated
    /// only when `smusdAccepts`.
    /// @param smusdAccepts Preview: the donation will be attempted (false when `toSmusd` is 0 or below sMUSD's
    /// `AmountTooSmall` floor). `distribute()`: the whole `toSmusd` was donated.
    /// @param toTreasury 20% of the new fees (rounded down).
    /// @param bribeAmounts Per configured gauge, the amount that would be posted (0 when redirected or carried).
    /// @param gaugeAlive Per configured gauge, the voter's `isAlive` (false when unreadable).
    /// @param epochStart Start of the bribe epoch the bribes would be credited to.
    /// @param bribesCarried Bribe shares kept here for a later call (see `CarryReason`).
    /// @param smusdCarried Part of `toSmusd` kept here for a later call: below sMUSD's dust floor, or sMUSD failed
    /// within its grace period.
    /// @param smusdToTreasury Part of `toSmusd` paid to the treasury because sMUSD has kept failing for
    /// `SMUSD_GRACE_EPOCHS` epochs (always 0 in a preview).
    struct Plan {
        uint256 total;
        uint256 toSmusd;
        bool smusdAccepts;
        uint256 toTreasury;
        uint256[] bribeAmounts;
        bool[] gaugeAlive;
        uint256 epochStart;
        uint256 bribesCarried;
        uint256 smusdCarried;
        uint256 smusdToTreasury;
    }

    /// @notice Emitted once per `distribute()`: `total == toSmusd + toBribes + toTreasury + retained`.
    /// @param toSmusd MUSD donated to sMUSD.
    /// @param toBribes MUSD posted as bribes.
    /// @param toTreasury MUSD paid to the treasury (its 20% plus any sMUSD share redirected after the grace period).
    /// @param retained MUSD left here for the next call (carried bribe shares and the sMUSD carry).
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
    /// @notice A gauge's bribe share stays here and is added to that gauge's share in the next `distribute()`.
    event BribeCarried(address indexed gauge, uint256 amount, CarryReason reason);
    /// @notice MUSD donated to sMUSD through `receiveProtocolYield`.
    event SmusdYieldPosted(uint256 amount);
    /// @notice The sMUSD share was below sMUSD's `AmountTooSmall` floor and stays here for the next distribution.
    event SmusdYieldDeferred(uint256 amount);
    /// @notice The donation to sMUSD failed (reverted, or did not pull the exact amount); `amount` stays here.
    /// @param failingSince Timestamp of the first failure of the current streak.
    event SmusdYieldFailed(uint256 amount, uint256 failingSince);
    /// @notice sMUSD has failed since `failingSince` (at least `SMUSD_GRACE_EPOCHS` epoch boundaries ago): the sMUSD
    /// share was paid to the treasury instead.
    event SmusdShareToTreasury(address indexed treasury, uint256 amount, uint256 failingSince);
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

    /// @notice Splits the MUSD balance: new fees 40/40/20, plus each carried amount on its own leg. Permissionless.
    /// Reverts `NothingToDistribute` on 0. Never reverts because sMUSD, the voter or a bribe misbehaves.
    /// @return plan What was done (same layout as `previewDistribute`, with `bribeAmounts` as actually posted).
    function distribute() external returns (Plan memory plan);

    /// @notice What `distribute()` would do now. Assumes every live gauge's notify and the sMUSD donation succeed.
    function previewDistribute() external view returns (Plan memory plan);

    /// @notice The configured gauges and their bribe contracts.
    function targets() external view returns (BribeTarget[] memory);

    /// @notice Start of the bribe epoch containing `timestamp` (Thursday 00:00 UTC).
    function epochStartOf(uint256 timestamp) external pure returns (uint256);

    /// @notice False in the last `BRIBE_CUTOFF` (1 hour) of an epoch, when bribes are carried instead of posted.
    function bribeWindowOpen(uint256 timestamp) external pure returns (bool);

    /// @notice Bribe MUSD carried for configured gauge `i` (0 for an unconfigured index).
    function bribeCarry(uint256 i) external view returns (uint256);

    /// @notice MUSD carried for the sMUSD leg (dust, or a failed donation within the grace period).
    function smusdCarry() external view returns (uint256);

    /// @notice Timestamp of the first failed sMUSD donation of the current failure streak (0 when sMUSD is healthy).
    function smusdFailingSince() external view returns (uint256);

    function MUSD() external view returns (address);
    function SMUSD() external view returns (address);
    function VOTER() external view returns (address);
    function TREASURY() external view returns (address);
    function GAUGE_COUNT() external view returns (uint256);
}
