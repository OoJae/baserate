// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The subset of Mezo's pool-gauge `Voter` ("PoolsVoter") that Baserate reads.
/// @dev Verified implementation source (Velodrome V2 fork, solc 0.8.24) behind TransparentUpgradeableProxy
/// mainnet 0x48233cCC97B87Ba93bCA212cbEe48e3210211f03 (impl 0xa62060d57e04d6c799b58188dc654b85addd1465) and testnet
/// 0x263F1Fd5fB7F866881e1B6cD7d5d6c40Fd985F0D (impl 0x3a0bef4ae17389db5e25068cab65209326bd9813); both
/// implementations are source-identical. `gaugeToBribe` is set once at gauge creation and never changes;
/// `isAlive` is flipped by the emergency council through `killGauge`/`reviveGauge`.
interface IPoolsVoter {
    /// @notice False once the emergency council has killed `gauge` (and for addresses that are not gauges).
    function isAlive(address gauge) external view returns (bool);

    /// @notice True for every gauge this voter created.
    function isGauge(address gauge) external view returns (bool);

    /// @notice The BribeVotingReward contract created together with `gauge`.
    function gaugeToBribe(address gauge) external view returns (address);

    /// @notice The pool (or vault) `gauge` incentivises.
    function poolForGauge(address gauge) external view returns (address);

    /// @notice True when `token` may be added as a new bribe reward token.
    function isWhitelistedToken(address token) external view returns (bool);

    /// @notice The only address that can kill or revive gauges.
    function emergencyCouncil() external view returns (address);

    /// @notice Kills `gauge` (emergency council only). Used by fork tests to exercise the dead-gauge fallback.
    function killGauge(address gauge) external;

    /// @notice Start of the epoch containing `timestamp`: `timestamp - timestamp % 7 days` (Thursday 00:00 UTC).
    function epochStart(uint256 timestamp) external pure returns (uint256);
}
