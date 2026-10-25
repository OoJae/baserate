// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice Minimal Pyth reader. `getPriceUnsafe` returns the last pushed price without a staleness check, so
/// callers must validate `publishTime` themselves.
interface IPythLite {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
}
