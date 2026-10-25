// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IFeeRouter} from "../interfaces/IFeeRouter.sol";
import {IBribeVotingReward} from "../interfaces/external/IBribeVotingReward.sol";
import {IMUSDSavingsRate} from "../interfaces/external/IMUSDSavingsRate.sol";
import {IPoolsVoter} from "../interfaces/external/IPoolsVoter.sol";

/// @title FeeRouter
/// @notice Immutable, ownerless splitter for Baserate's 10 bps MUSD origination fee. `distribute()` is permissionless
/// and splits the router's whole MUSD balance:
/// - 40% to sMUSD holders through `sMUSD.receiveProtocolYield` (about 72% of it reaches veBTC voters through the
///   sMUSD VaultGauge on mainnet);
/// - 40% as MUSD bribes on the configured BTC/MUSD pool gauges (split equally), credited to the gauges' veBTC voters.
///   A gauge the PoolsVoter reports dead, a voter read that fails, or a bribe that rejects the notify sends that
///   gauge's share to sMUSD instead (Halborn finding 7.4: never bribe a killed gauge);
/// - 20% to the treasury.
/// @dev Wiring checks (constructor): each bribe must be `PoolsVoter.gaugeToBribe(gauge)` of a gauge the voter
/// created, and must accept MUSD (`isReward(MUSD)` or MUSD whitelisted on the voter).
///
/// Epoch rules (verified source: Voter, BribeVotingReward and ProtocolTimeLibrary, solc 0.8.24):
/// - Epochs are `timestamp - timestamp % 7 days`, i.e. they flip every Thursday 00:00 UTC.
/// - `notifyRewardAmount` credits `tokenRewardsPerEpoch[MUSD][epochStart(now)]`: a bribe posted during epoch N pays
///   the veNFTs whose votes sit in that bribe contract at the end of epoch N, pro rata, and becomes claimable once
///   the epoch flips (`earned` only counts fully elapsed epochs).
/// - BribeVotingReward enforces no voting window: bribes can be posted at any time, including Mezo's first hour
///   (when `Voter.vote/reset/poke` revert `DistributeWindow`) and last hour (when only whitelisted veNFTs may vote).
///   A bribe posted in the last hour of epoch N still pays epoch N's voters, who can no longer react to it; keepers
///   should distribute early in the epoch so voters can steer towards the bribed pools.
/// - Votes in epoch N also set MEZO emissions for epoch N+1, so a bribe in epoch N buys emissions in N+1.
///
/// Safety:
/// - Bribe notifies and voter reads run with fixed gas stipends after a gas check, so a caller cannot starve a call
///   into failing to divert a share; a genuine failure (rejected token, upgraded voter) redirects to sMUSD instead of
///   bricking this immutable router.
/// - sMUSD's `receiveProtocolYield` reverts `AmountTooSmall` when `(amount + pendingYield) * 1e18 / supply == 0`
///   (7,382,556 wei on mainnet, 886,093 wei on testnet at the time of writing). Such dust is not sent and stays here
///   for the next call, where it is split again (an immaterial distortion). Any other sMUSD failure reverts the whole
///   call so the split stays exact; nothing is lost.
/// - No precompile calls (MUSD, sMUSD, the voter and the bribes are ordinary contracts).
contract FeeRouter is IFeeRouter, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Basis-point denominator.
    uint256 public constant BPS = 10_000;
    /// @notice Share donated to sMUSD holders.
    uint256 public constant SMUSD_BPS = 4000;
    /// @notice Share posted as MUSD bribes on the configured gauges.
    uint256 public constant BRIBES_BPS = 4000;
    /// @notice Share paid to the treasury.
    uint256 public constant TREASURY_BPS = 2000;
    /// @notice Maximum number of (gauge, bribe) targets.
    uint256 public constant MAX_GAUGES = 2;
    /// @notice Bribe epoch length (Mezo's ProtocolTimeLibrary.WEEK).
    uint256 public constant EPOCH = 7 days;
    /// @notice Gas stipend for each `notifyRewardAmount` (a real notify costs about 80k on a cold epoch slot).
    uint256 public constant NOTIFY_GAS = 500_000;
    /// @notice Gas stipend for each `PoolsVoter.isAlive` read (through its transparent proxy).
    uint256 public constant READ_GAS = 100_000;

    /// @inheritdoc IFeeRouter
    address public immutable MUSD;
    /// @inheritdoc IFeeRouter
    address public immutable SMUSD;
    /// @inheritdoc IFeeRouter
    address public immutable VOTER;
    /// @inheritdoc IFeeRouter
    address public immutable TREASURY;
    /// @inheritdoc IFeeRouter
    uint256 public immutable GAUGE_COUNT;

    address internal immutable GAUGE_0;
    address internal immutable BRIBE_0;
    address internal immutable GAUGE_1;
    address internal immutable BRIBE_1;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant CALL_OVERHEAD = 10_000;

    /// @param musd MUSD (mainnet 0xdD46...F186, testnet 0x1189...c503).
    /// @param smusd sMUSD / MUSDSavingsRate (mainnet 0xb4D4...51CC, testnet 0x6f46...8e16).
    /// @param voter Mezo PoolsVoter (mainnet 0x4823...1f03, testnet 0x263F...0D).
    /// @param treasury Receiver of the 20% treasury share (a Safe on mainnet).
    /// @param bribeTargets One or two (gauge, bribe) pairs; bribe shares are split equally between them.
    constructor(address musd, address smusd, address voter, address treasury, BribeTarget[] memory bribeTargets) {
        if (musd == address(0) || smusd == address(0) || voter == address(0) || treasury == address(0)) {
            revert ZeroAddress();
        }
        uint256 n = bribeTargets.length;
        if (n == 0 || n > MAX_GAUGES) revert InvalidTargetCount(n);
        address asset = IMUSDSavingsRate(smusd).musdToken();
        if (asset != musd) revert SmusdAssetMismatch(musd, asset);

        for (uint256 i; i < n; ++i) {
            _validateTarget(voter, musd, bribeTargets[i]);
        }
        if (n == 2 && bribeTargets[0].gauge == bribeTargets[1].gauge) revert DuplicateGauge(bribeTargets[1].gauge);

        MUSD = musd;
        SMUSD = smusd;
        VOTER = voter;
        TREASURY = treasury;
        GAUGE_COUNT = n;
        GAUGE_0 = bribeTargets[0].gauge;
        BRIBE_0 = bribeTargets[0].bribe;
        GAUGE_1 = n == 2 ? bribeTargets[1].gauge : address(0);
        BRIBE_1 = n == 2 ? bribeTargets[1].bribe : address(0);
    }

    // ---------------------------------------------------------------- distribution

    /// @inheritdoc IFeeRouter
    function distribute() external nonReentrant returns (Plan memory plan) {
        uint256 total = IERC20(MUSD).balanceOf(address(this));
        if (total == 0) revert NothingToDistribute();
        uint256 bribesTotal;
        (plan, bribesTotal) = _split(total);

        uint256 toBribes = 0;
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (address gauge, address bribe) = _target(i);
            uint256 share = _gaugeShare(bribesTotal, i);
            (bool readable, bool alive) = _isAlive(gauge);
            plan.gaugeAlive[i] = alive;
            if (share == 0) continue;
            if (!alive) {
                plan.toSmusd += share;
                emit BribeRedirected(gauge, share, readable ? RedirectReason.GaugeDead : RedirectReason.VoterUnreadable);
            } else if (_notify(bribe, share)) {
                plan.bribeAmounts[i] = share;
                toBribes += share;
                emit BribePosted(gauge, bribe, plan.epochStart, share);
            } else {
                plan.toSmusd += share;
                emit BribeRedirected(gauge, share, RedirectReason.NotifyFailed);
            }
        }

        if (plan.toTreasury != 0) {
            IERC20(MUSD).safeTransfer(TREASURY, plan.toTreasury);
            emit TreasuryPaid(TREASURY, plan.toTreasury);
        }

        uint256 retained = 0;
        plan.smusdAccepts = _smusdAccepts(plan.toSmusd);
        if (plan.smusdAccepts) {
            IERC20(MUSD).forceApprove(SMUSD, plan.toSmusd);
            IMUSDSavingsRate(SMUSD).receiveProtocolYield(plan.toSmusd);
            emit SmusdYieldPosted(plan.toSmusd);
        } else if (plan.toSmusd != 0) {
            retained = plan.toSmusd;
            emit SmusdYieldDeferred(retained);
        }

        emit Distributed(
            msg.sender, plan.epochStart, total, plan.toSmusd - retained, toBribes, plan.toTreasury, retained
        );
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IFeeRouter
    function previewDistribute() external view returns (Plan memory plan) {
        uint256 bribesTotal;
        (plan, bribesTotal) = _split(IERC20(MUSD).balanceOf(address(this)));
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (address gauge,) = _target(i);
            uint256 share = _gaugeShare(bribesTotal, i);
            (, bool alive) = _isAlive(gauge);
            plan.gaugeAlive[i] = alive;
            if (alive) plan.bribeAmounts[i] = share;
            else plan.toSmusd += share;
        }
        plan.smusdAccepts = _smusdAccepts(plan.toSmusd);
    }

    /// @inheritdoc IFeeRouter
    function targets() external view returns (BribeTarget[] memory list) {
        list = new BribeTarget[](GAUGE_COUNT);
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (list[i].gauge, list[i].bribe) = _target(i);
        }
    }

    /// @inheritdoc IFeeRouter
    function epochStartOf(uint256 timestamp) public pure returns (uint256) {
        return timestamp - (timestamp % EPOCH);
    }

    // ---------------------------------------------------------------- internals

    /// @dev Constructor check: the voter created `t.gauge` with `t.bribe`, and the bribe accepts MUSD.
    function _validateTarget(address voter, address musd, BribeTarget memory t) internal view {
        if (t.gauge == address(0) || t.bribe == address(0)) revert ZeroAddress();
        if (!IPoolsVoter(voter).isGauge(t.gauge)) revert NotAGauge(t.gauge);
        address mapped = IPoolsVoter(voter).gaugeToBribe(t.gauge);
        if (mapped != t.bribe) revert BribeMismatch(t.gauge, t.bribe, mapped);
        if (!IBribeVotingReward(t.bribe).isReward(musd) && !IPoolsVoter(voter).isWhitelistedToken(musd)) {
            revert MusdNotBribeable(t.bribe);
        }
    }

    /// @dev 20% treasury and 40% bribes rounded down; sMUSD takes the remainder. Arrays sized for the targets.
    function _split(uint256 total) internal view returns (Plan memory plan, uint256 bribesTotal) {
        plan.total = total;
        plan.toTreasury = total * TREASURY_BPS / BPS;
        bribesTotal = total * BRIBES_BPS / BPS;
        plan.toSmusd = total - plan.toTreasury - bribesTotal;
        plan.bribeAmounts = new uint256[](GAUGE_COUNT);
        plan.gaugeAlive = new bool[](GAUGE_COUNT);
        plan.epochStart = epochStartOf(block.timestamp);
    }

    /// @dev Equal split; the last gauge takes the rounding remainder.
    function _gaugeShare(uint256 bribesTotal, uint256 i) internal view returns (uint256) {
        uint256 base = bribesTotal / GAUGE_COUNT;
        // forge-lint: disable-next-line(divide-before-multiply) intended: the last gauge takes the remainder.
        return i == GAUGE_COUNT - 1 ? bribesTotal - base * (GAUGE_COUNT - 1) : base;
    }

    function _target(uint256 i) internal view returns (address gauge, address bribe) {
        return i == 0 ? (GAUGE_0, BRIBE_0) : (GAUGE_1, BRIBE_1);
    }

    /// @dev `readable` is false when the voter call failed; the gauge is then treated as dead.
    function _isAlive(address gauge) internal view returns (bool readable, bool alive) {
        _requireGas(READ_GAS);
        try IPoolsVoter(VOTER).isAlive{gas: READ_GAS}(gauge) returns (bool a) {
            return (true, a);
        } catch {
            return (false, false);
        }
    }

    /// @dev Approves exactly `amount`, posts it, and clears the approval if the bribe rejected it.
    function _notify(address bribe, uint256 amount) internal returns (bool ok) {
        _requireGas(NOTIFY_GAS);
        IERC20(MUSD).forceApprove(bribe, amount);
        try IBribeVotingReward(bribe).notifyRewardAmount{gas: NOTIFY_GAS}(MUSD, amount) {
            ok = true;
        } catch {
            IERC20(MUSD).forceApprove(bribe, 0);
        }
    }

    /// @dev Mirrors sMUSD's `_receiveYield`: with a non-zero supply it reverts `AmountTooSmall` when
    /// `(amount + pendingYield) * 1e18 / supply == 0`; with zero supply it buffers the amount.
    function _smusdAccepts(uint256 amount) internal view returns (bool) {
        if (amount == 0) return false;
        uint256 supply = IMUSDSavingsRate(SMUSD).totalSupply();
        if (supply == 0) return true;
        return (amount + IMUSDSavingsRate(SMUSD).pendingYield()) * WAD / supply != 0;
    }

    /// @dev Ensures the next call can receive its full stipend (EIP-150 forwards at most 63/64 of the remaining gas).
    function _requireGas(uint256 stipend) internal view {
        if (gasleft() < stipend + stipend / 63 + CALL_OVERHEAD) revert InsufficientGas();
    }
}
