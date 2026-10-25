// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The signed-claim entry point of Mezo's MUSD BorrowerOperationsSignatures.
/// @dev EIP-712 typehash `ClaimCollateral(address borrower,address recipient,uint256 nonce,uint256 deadline)`.
/// ECDSA only (no EIP-1271). The recipient may not be ActivePool or CollSurplusPool.
interface IBorrowerOperationsSignatures {
    function claimCollateralWithSignature(
        address borrower,
        address recipient,
        bytes calldata signature,
        uint256 deadline
    ) external;
    function getNonce(address borrower) external view returns (uint256);
}
