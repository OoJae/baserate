// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The subset of Mezo's `BribeVotingReward` (Velodrome V2 fork, solc 0.8.24) that Baserate uses.
/// @dev Verified source at mainnet 0x94A9A494872BF7231D8378d0Aef7d32BA552E305 (vAMM gauge bribe). The CL200 bribe
/// 0x80cCC053a90fc310150603C0274faf0a998B0e1a is unverified but byte-identical to it; the testnet bribe
/// 0x75b6B35Fc78826A0B7E1f9c08bb7d84bd70D0ee1 differs only in the immutables (voter, ve, forwarder) and the metadata
/// hash. `notifyRewardAmount` is `nonReentrant`, reverts `ZeroAmount` on 0, reverts `NotWhitelisted` only when the
/// token is not yet a reward and not whitelisted on the voter, pulls `amount` with `safeTransferFrom` and credits
/// `tokenRewardsPerEpoch[token][epochStart(block.timestamp)]`. It enforces no voting window and no alive check.
interface IBribeVotingReward {
    /// @notice The token is neither a reward yet nor whitelisted on the voter.
    error NotWhitelisted();
    /// @notice `notifyRewardAmount` was called with 0.
    error ZeroAmount();

    /// @notice Pulls `amount` of `token` from the caller and credits it to voters of the current epoch.
    function notifyRewardAmount(address token, uint256 amount) external;

    /// @notice True when `token` is (or has been) a reward token of this contract.
    function isReward(address token) external view returns (bool);

    /// @notice The voter that created this contract.
    function voter() external view returns (address);

    /// @notice Amount of `token` credited to the epoch starting at `epochStart`.
    function tokenRewardsPerEpoch(address token, uint256 epochStart) external view returns (uint256);

    /// @notice Rewards of `token` claimable by veNFT `tokenId` for every fully elapsed epoch since its last claim.
    function earned(address token, uint256 tokenId) external view returns (uint256);

    /// @notice Current vote weight of veNFT `tokenId` in this contract.
    function balanceOf(uint256 tokenId) external view returns (uint256);

    /// @notice Total vote weight in this contract.
    function totalSupply() external view returns (uint256);
}
