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
/// @notice Immutable, ownerless splitter for Baserate's 10 bps MUSD origination fee. `distribute()` is permissionless.
/// New fees (the MUSD balance minus what earlier calls carried) are split:
/// - 40% to sMUSD holders through `sMUSD.receiveProtocolYield` (about 72% of it reaches veBTC voters through the
///   sMUSD VaultGauge on mainnet);
/// - 40% as MUSD bribes on the configured BTC/MUSD pool gauges (split equally), credited to the gauges' veBTC voters.
///   A gauge the PoolsVoter reports dead, a voter read that fails, or a bribe that rejects the notify sends that
///   gauge's share to sMUSD instead (Halborn finding 7.4: never bribe a killed gauge);
/// - 20% to the treasury.
/// A carried amount goes back to its own leg in the next call (a gauge's carry to that gauge, the sMUSD carry to
/// sMUSD); it is never split again.
/// @dev Wiring checks (constructor): each bribe must be `PoolsVoter.gaugeToBribe(gauge)` of a gauge the voter
/// created, and must accept MUSD (`isReward(MUSD)` or MUSD whitelisted on the voter).
///
/// Epoch rules (verified source: Voter, BribeVotingReward and ProtocolTimeLibrary, solc 0.8.24):
/// - Epochs are `timestamp - timestamp % 7 days`, i.e. they flip every Thursday 00:00 UTC.
/// - `notifyRewardAmount` credits `tokenRewardsPerEpoch[MUSD][epochStart(now)]`: a bribe posted during epoch N pays
///   the veNFTs whose votes sit in that bribe contract at the end of epoch N, pro rata, and becomes claimable once
///   the epoch flips (`earned` only counts fully elapsed epochs).
/// - BribeVotingReward enforces no voting window, so the router does (audit D-3): in the last hour of an epoch
///   (`timestamp % 7 days > 7 days - 1 hours`, after `ProtocolTimeLibrary.epochVoteEnd`, when `Voter.vote` only
///   accepts whitelisted veNFTs) it posts no bribe and carries each live gauge's share to the next call. It also
///   carries the share of a gauge whose bribe contract has no votes (`totalSupply() == 0`): `earned` divides each
///   epoch's rewards by the end-of-epoch vote supply, so a bribe on a vote-less contract would be unclaimable. A
///   carried share keeps growing until the gauge has votes (it is then posted in full) or is killed (it then goes to
///   sMUSD with the gauge's next share). The first hour (`DistributeWindow`) is not restricted: voters can still
///   react to a bribe for the rest of the epoch.
/// - Votes in epoch N also set MEZO emissions for epoch N+1, so a bribe in epoch N buys emissions in N+1.
///
/// Safety:
/// - Every read of an external contract (voter `isAlive`, bribe `totalSupply`, sMUSD `totalSupply`/`pendingYield`)
///   is a low-level STATICCALL with a fixed gas stipend after a gas check that copies at most one word back; it
///   counts only with at least 32 bytes of return data (and a 0/1 word for a bool). An upgraded or broken contract
///   that reverts, returns nothing or returns garbage cannot brick this immutable router.
/// - Bribe notifies and the sMUSD donation also run with fixed gas stipends after a gas check, so a caller cannot
///   starve a call into failing to divert a share; a genuine failure (rejected token, upgraded voter) redirects the
///   bribe share to sMUSD.
/// - sMUSD is an upgradeable proxy and is never trusted to succeed (audit D-2). The donation approves exactly the
///   amount and counts as done only if the call succeeded and pulled exactly that amount; otherwise the approval is
///   revoked and the sMUSD leg stays here (`smusdCarry`). The treasury and bribe legs are paid either way. Fallback
///   rule: once a failure streak that started at `smusdFailingSince` spans `SMUSD_GRACE_EPOCHS` (2) epoch flips
///   (7 to 14 days), every further failing call pays the whole sMUSD leg (carry included) to the treasury instead.
///   One successful donation ends the streak.
/// - sMUSD's `receiveProtocolYield` reverts `AmountTooSmall` when `(amount + pendingYield) * 1e18 / supply == 0`
///   (7,382,556 wei on mainnet, 886,093 wei on testnet at the time of writing). Such dust is not sent and is carried
///   to the next call; it does not count as a failure.
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
    /// @notice Bribes are carried instead of posted once `timestamp % EPOCH > EPOCH - BRIBE_CUTOFF` (Mezo's Voter
    /// closes voting to non-whitelisted veNFTs one hour before the flip).
    uint256 public constant BRIBE_CUTOFF = 1 hours;
    /// @notice Gas stipend for each `notifyRewardAmount` (a real notify costs about 80k on a cold epoch slot).
    uint256 public constant NOTIFY_GAS = 500_000;
    /// @notice Gas stipend for each view read (`isAlive` through the voter's proxy, a bribe's `totalSupply`, sMUSD's
    /// `totalSupply` and `pendingYield` through its proxy).
    uint256 public constant READ_GAS = 100_000;
    /// @notice Gas stipend for `sMUSD.receiveProtocolYield` (about 63k through its proxy on both networks today; the
    /// margin leaves room for an upgrade that does more work).
    uint256 public constant SMUSD_GAS = 1_000_000;
    /// @notice Epoch flips a sMUSD failure streak must span before the sMUSD leg is paid to the treasury.
    uint256 public constant SMUSD_GRACE_EPOCHS = 2;

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

    /// @inheritdoc IFeeRouter
    uint256 public smusdCarry;
    /// @inheritdoc IFeeRouter
    uint256 public smusdFailingSince;
    /// @dev Bribe MUSD carried per configured gauge.
    uint256[MAX_GAUGES] internal _bribeCarry;

    /// @dev What happens to one gauge's share.
    enum Action {
        None,
        Post,
        Redirect,
        Carry
    }

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
        uint256[] memory shares;
        (plan, shares) = _split(total);
        bool windowOpen = bribeWindowOpen(block.timestamp);

        uint256 toBribes = 0;
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (address gauge, address bribe) = _target(i);
            uint256 share = shares[i];
            (Action action, bool alive, bool readable, CarryReason why) = _classify(gauge, bribe, share, windowOpen);
            plan.gaugeAlive[i] = alive;
            uint256 carry = 0;
            if (action == Action.Post) {
                if (_notify(bribe, share)) {
                    plan.bribeAmounts[i] = share;
                    toBribes += share;
                    emit BribePosted(gauge, bribe, plan.epochStart, share);
                } else {
                    plan.toSmusd += share;
                    emit BribeRedirected(gauge, share, RedirectReason.NotifyFailed);
                }
            } else if (action == Action.Redirect) {
                plan.toSmusd += share;
                emit BribeRedirected(gauge, share, readable ? RedirectReason.GaugeDead : RedirectReason.VoterUnreadable);
            } else if (action == Action.Carry) {
                carry = share;
                plan.bribesCarried += share;
                emit BribeCarried(gauge, share, why);
            }
            if (_bribeCarry[i] != carry) _bribeCarry[i] = carry;
        }

        if (plan.toTreasury != 0) {
            IERC20(MUSD).safeTransfer(TREASURY, plan.toTreasury);
            emit TreasuryPaid(TREASURY, plan.toTreasury);
        }

        uint256 donated = _paySmusd(plan);

        emit Distributed(
            msg.sender,
            plan.epochStart,
            total,
            donated,
            toBribes,
            plan.toTreasury + plan.smusdToTreasury,
            plan.bribesCarried + plan.smusdCarried
        );
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IFeeRouter
    function previewDistribute() external view returns (Plan memory plan) {
        uint256[] memory shares;
        (plan, shares) = _split(IERC20(MUSD).balanceOf(address(this)));
        bool windowOpen = bribeWindowOpen(block.timestamp);
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (address gauge, address bribe) = _target(i);
            (Action action, bool alive,,) = _classify(gauge, bribe, shares[i], windowOpen);
            plan.gaugeAlive[i] = alive;
            if (action == Action.Post) plan.bribeAmounts[i] = shares[i];
            else if (action == Action.Redirect) plan.toSmusd += shares[i];
            else if (action == Action.Carry) plan.bribesCarried += shares[i];
        }
        (bool known, bool accepts) = _smusdFloor(plan.toSmusd);
        plan.smusdAccepts = plan.toSmusd != 0 && (accepts || !known);
        if (!plan.smusdAccepts) plan.smusdCarried = plan.toSmusd;
    }

    /// @inheritdoc IFeeRouter
    function targets() external view returns (BribeTarget[] memory list) {
        list = new BribeTarget[](GAUGE_COUNT);
        for (uint256 i; i < GAUGE_COUNT; ++i) {
            (list[i].gauge, list[i].bribe) = _target(i);
        }
    }

    /// @inheritdoc IFeeRouter
    function bribeCarry(uint256 i) external view returns (uint256) {
        return i < GAUGE_COUNT ? _bribeCarry[i] : 0;
    }

    /// @inheritdoc IFeeRouter
    function epochStartOf(uint256 timestamp) public pure returns (uint256) {
        return timestamp - (timestamp % EPOCH);
    }

    /// @inheritdoc IFeeRouter
    function bribeWindowOpen(uint256 timestamp) public pure returns (bool) {
        return timestamp % EPOCH <= EPOCH - BRIBE_CUTOFF;
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

    /// @dev New fees: 20% treasury and 40% bribes rounded down, sMUSD takes the remainder. Each carried amount is
    /// added back to its own leg (`shares[i]` for gauge `i`, `toSmusd` for sMUSD). Arrays sized for the targets.
    function _split(uint256 total) internal view returns (Plan memory plan, uint256[] memory shares) {
        uint256 n = GAUGE_COUNT;
        plan.total = total;
        plan.bribeAmounts = new uint256[](n);
        plan.gaugeAlive = new bool[](n);
        plan.epochStart = epochStartOf(block.timestamp);
        shares = new uint256[](n);

        uint256 smusdIn = smusdCarry;
        uint256 carried = smusdIn;
        for (uint256 i; i < n; ++i) {
            shares[i] = _bribeCarry[i];
            carried += shares[i];
        }
        // Carried MUSD only leaves through this contract, so `carried <= total`. Should that ever break, the whole
        // balance is treated as new fees (and the carries are rewritten by `distribute`).
        if (carried > total) {
            smusdIn = 0;
            carried = 0;
            for (uint256 i; i < n; ++i) {
                shares[i] = 0;
            }
        }
        uint256 fresh = total - carried;
        plan.toTreasury = fresh * TREASURY_BPS / BPS;
        uint256 bribesFresh = fresh * BRIBES_BPS / BPS;
        plan.toSmusd = fresh - plan.toTreasury - bribesFresh + smusdIn;
        for (uint256 i; i < n; ++i) {
            shares[i] += _gaugeShare(bribesFresh, i);
        }
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

    /// @dev Routing of one gauge's share, in priority order: dead (or unreadable) gauge -> sMUSD; vote window closed
    /// -> carry; bribe without votes -> carry; otherwise post. `alive` is always read (it is reported per gauge).
    function _classify(address gauge, address bribe, uint256 share, bool windowOpen)
        internal
        view
        returns (Action action, bool alive, bool readable, CarryReason why)
    {
        (readable, alive) = _isAlive(gauge);
        if (share == 0) return (Action.None, alive, readable, why);
        if (!alive) return (Action.Redirect, alive, readable, why);
        if (!windowOpen) return (Action.Carry, alive, readable, CarryReason.VoteWindowClosed);
        if (!_hasVotes(bribe)) return (Action.Carry, alive, readable, CarryReason.NoVotes);
        return (Action.Post, alive, readable, why);
    }

    /// @dev `readable` is false when the voter call failed or did not return a bool; the gauge is then treated as dead.
    function _isAlive(address gauge) internal view returns (bool readable, bool alive) {
        (bool ok, uint256 word) = _staticRead(VOTER, abi.encodeCall(IPoolsVoter.isAlive, (gauge)));
        if (!ok || word > 1) return (false, false);
        return (true, word == 1);
    }

    /// @dev False only when the bribe positively reports zero vote supply; an unreadable supply does not block the
    /// bribe (the notify itself then decides).
    function _hasVotes(address bribe) internal view returns (bool) {
        (bool ok, uint256 supply) = _staticRead(bribe, abi.encodeCall(IBribeVotingReward.totalSupply, ()));
        return !ok || supply != 0;
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

    /// @dev Settles the sMUSD leg (`plan.toSmusd`): dust is carried; otherwise the donation is attempted, and a
    /// failure is carried or, after the grace period, paid to the treasury. Fills `smusdAccepts`, `smusdCarried` and
    /// `smusdToTreasury`, updates the carry and the failure streak, and returns the amount donated.
    function _paySmusd(Plan memory plan) internal returns (uint256 donated) {
        uint256 amount = plan.toSmusd;
        uint256 carry = 0;
        if (amount != 0) {
            (bool known, bool accepts) = _smusdFloor(amount);
            if (known && !accepts) {
                carry = amount;
                emit SmusdYieldDeferred(amount);
            } else {
                donated = _donate(amount);
                if (donated == amount) {
                    plan.smusdAccepts = true;
                    if (smusdFailingSince != 0) smusdFailingSince = 0;
                    emit SmusdYieldPosted(amount);
                } else {
                    if (donated != 0) emit SmusdYieldPosted(donated);
                    uint256 rest = amount - donated;
                    uint256 since = smusdFailingSince;
                    if (since == 0) {
                        since = block.timestamp;
                        smusdFailingSince = since;
                    }
                    if (epochStartOf(block.timestamp) >= epochStartOf(since) + SMUSD_GRACE_EPOCHS * EPOCH) {
                        plan.smusdToTreasury = rest;
                        IERC20(MUSD).safeTransfer(TREASURY, rest);
                        emit SmusdShareToTreasury(TREASURY, rest, since);
                    } else {
                        carry = rest;
                        emit SmusdYieldFailed(rest, since);
                    }
                }
            }
        }
        plan.smusdCarried = carry;
        if (smusdCarry != carry) smusdCarry = carry;
    }

    /// @dev Donates `amount` through a low-level call with a fixed stipend; no return data is copied or decoded. The
    /// amount actually donated is measured from this contract's MUSD balance (at most `amount`, the exact approval).
    /// Any shortfall (revert, partial or no pull) revokes the approval.
    function _donate(uint256 amount) internal returns (uint256 donated) {
        IERC20 musd = IERC20(MUSD);
        uint256 balanceBefore = musd.balanceOf(address(this));
        musd.forceApprove(SMUSD, amount);
        bytes memory data = abi.encodeCall(IMUSDSavingsRate.receiveProtocolYield, (amount));
        address target = SMUSD;
        uint256 stipend = SMUSD_GAS;
        _requireGas(stipend);
        assembly ("memory-safe") {
            pop(call(stipend, target, 0, add(data, 0x20), mload(data), 0, 0))
        }
        uint256 balanceAfter = musd.balanceOf(address(this));
        donated = balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0;
        if (donated > amount) donated = amount;
        if (donated != amount) musd.forceApprove(SMUSD, 0);
    }

    /// @dev Mirrors sMUSD's `_receiveYield`: with a non-zero supply it reverts `AmountTooSmall` when
    /// `(amount + pendingYield) * 1e18 / supply == 0`, i.e. when `amount + pendingYield < ceil(supply / 1e18)`; with
    /// zero supply it buffers the amount. `known` is false when either read failed (the donation is then attempted).
    function _smusdFloor(uint256 amount) internal view returns (bool known, bool accepts) {
        if (amount == 0) return (true, false);
        (bool ok, uint256 supply) = _staticRead(SMUSD, abi.encodeCall(IMUSDSavingsRate.totalSupply, ()));
        if (!ok) return (false, true);
        if (supply == 0) return (true, true);
        uint256 pending;
        (ok, pending) = _staticRead(SMUSD, abi.encodeCall(IMUSDSavingsRate.pendingYield, ()));
        if (!ok) return (false, true);
        uint256 need = supply / WAD;
        if (need * WAD != supply) ++need;
        // Overflow-free form of `amount + pending >= need`.
        return (true, amount >= need || pending >= need - amount);
    }

    /// @dev STATICCALL with the `READ_GAS` stipend that copies at most one word back. `ok` requires success and at
    /// least 32 bytes of return data; `word` is the first word (0 unless `ok`).
    function _staticRead(address target, bytes memory data) internal view returns (bool ok, uint256 word) {
        uint256 stipend = READ_GAS;
        _requireGas(stipend);
        assembly ("memory-safe") {
            mstore(0x00, 0)
            let success := staticcall(stipend, target, add(data, 0x20), mload(data), 0x00, 0x20)
            ok := and(success, gt(returndatasize(), 0x1f))
            word := mul(mload(0x00), ok)
        }
    }

    /// @dev Ensures the next call can receive its full stipend (EIP-150 forwards at most 63/64 of the remaining gas).
    function _requireGas(uint256 stipend) internal view {
        if (gasleft() < stipend + stipend / 63 + CALL_OVERHEAD) revert InsufficientGas();
    }
}
