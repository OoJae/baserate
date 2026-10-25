// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The subset of vault-v2's `MorphoMarketV1AdapterV2` (tag 2026-08-13) that Baserate reads.
/// @dev Declared locally so our sources do not import vault-v2's nested copy of the Morpho Blue types.
interface IMorphoMarketV1AdapterV2Lite {
    /// @notice The Vault V2 the adapter serves.
    function parentVault() external view returns (address);

    /// @notice The Morpho Blue singleton.
    function morpho() external view returns (address);

    /// @notice The AdaptiveCurveIrm every market of the adapter must use.
    function adaptiveCurveIrm() external view returns (address);

    /// @notice `keccak256(abi.encode("this", adapter))`.
    function adapterId() external view returns (bytes32);

    /// @notice The adapter's supply in `marketId`, with interest accrued to now, rounded down.
    function expectedSupplyAssets(bytes32 marketId) external view returns (uint256);

    /// @notice Supply shares the adapter holds in `marketId`.
    function supplyShares(bytes32 marketId) external view returns (uint256);

    /// @notice Queues a timelocked call (vault curator only).
    function submit(bytes memory data) external;

    /// @notice Timelock duration of `selector`.
    function timelock(bytes4 selector) external view returns (uint256);

    /// @notice Raises the timelock of `selector` (itself timelocked).
    function increaseTimelock(bytes4 selector, uint256 newDuration) external;

    /// @notice Sets the skim recipient (timelocked).
    function setSkimRecipient(address newSkimRecipient) external;

    /// @notice Writes off the adapter's shares of `marketId` (timelocked).
    function burnShares(bytes32 marketId) external;

    /// @notice Permanently disables a timelocked function (timelocked).
    function abdicate(bytes4 selector) external;
}
