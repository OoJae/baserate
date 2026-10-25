// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice MUSD `SortedTroves` reads. Troves are kept in descending NICR order: `getLast()` is the lowest-NICR trove,
/// i.e. the next redemption target, and `getPrev` walks towards higher NICRs. Verified implementation (solc 0.8.24)
/// 0x19868d388668a8e248784e78b0c644b517febaae behind mainnet proxy 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f.
interface ISortedTroves {
    function getSize() external view returns (uint256);
    function getFirst() external view returns (address);
    function getLast() external view returns (address);
    function getPrev(address id) external view returns (address);
    function getNext(address id) external view returns (address);
}

/// @notice MUSD `TroveManager` reads. Verified implementation (solc 0.8.24) 0xdcfdab0dea52e5efc8400283d46fd0d122a519e9
/// behind mainnet proxy 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193. Redemptions follow NICR = coll / principal (it
/// ignores accrued interest); ICR = coll * price / (principal + interest). `price` is BTC/USD with 18 decimals, as
/// MUSD's PriceFeed reads it from Skip (MUSD's PriceFeed has no `lastGoodPrice`).
interface IMusdTroveManager {
    function getNominalICR(address borrower) external view returns (uint256);
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function getTCR(uint256 price) external view returns (uint256);
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );
}
