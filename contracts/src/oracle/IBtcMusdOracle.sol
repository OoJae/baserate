// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";

/// @title IBtcMusdOracle
/// @notice Morpho Blue oracle pricing Baserate Collateral BTC in MUSD, plus the non-reverting `status()` view used by
/// the app, the keeper and RiskLens.
interface IBtcMusdOracle is IOracle {
    /// @notice Snapshot of every input the oracle uses. All prices are USD with 18 decimals unless noted.
    /// @param price What `price()` returns (Morpho 1e36 scale, MUSD per BTC), or 0 when `price()` would revert.
    /// @param ok True exactly when `price()` would succeed.
    /// @param skipPrice Skip BTC/USD answer, or 0 when Skip reverted, returned malformed data or a non-positive answer.
    /// @param skipAge Seconds since Skip's `updatedAt` (0 when `updatedAt` is in the future), or `type(uint256).max`
    /// when Skip could not be read.
    /// @param pythBtcPrice Pyth BTC/USD, or 0 when the Pyth read failed validation.
    /// @param pythBtcAge Seconds since Pyth BTC's `publishTime` (0 when in the future), or `type(uint256).max` when the
    /// read failed validation.
    /// @param pythBtcFresh True when Pyth BTC is valid and at most `PYTH_BTC_BAND_MAX_AGE` (600 s) old, i.e. the
    /// deviation band is on.
    /// @param musdPrice Raw Pyth MUSD/USD before clamping, or 0 when the read failed validation. The leg actually used by
    /// `price()` is `musdUsd()`.
    /// @param musdAge Seconds since Pyth MUSD's `publishTime` (0 when in the future), or `type(uint256).max` when the read
    /// failed validation.
    /// @param musdFresh True when Pyth MUSD is valid and at most `PYTH_MAX_AGE` (3,900 s) old (otherwise the leg is
    /// 1.00).
    /// @param deviationBps |skip - pythBtc| in bps of pythBtc, rounded up, whenever both are readable (even if Pyth is
    /// stale); 0 otherwise. The band trips when `pythBtcFresh && deviationBps > MAX_DEV_BPS`.
    struct Status {
        uint256 price;
        bool ok;
        uint256 skipPrice;
        uint256 skipAge;
        uint256 pythBtcPrice;
        uint256 pythBtcAge;
        bool pythBtcFresh;
        uint256 musdPrice;
        uint256 musdAge;
        bool musdFresh;
        uint256 deviationBps;
    }

    /// @notice The Skip precompile reverted or returned fewer than 160 bytes.
    error SkipUnavailable();
    /// @notice Skip returned a non-positive answer, or one too large for Morpho's 1e36 price scale.
    error SkipInvalidAnswer(int256 answer);
    /// @notice Skip's last update is older than `SKIP_MAX_AGE`.
    error SkipStale(uint256 age);
    /// @notice Skip and a Pyth BTC price at most `PYTH_BTC_BAND_MAX_AGE` old differ by more than `MAX_DEV_BPS` of the
    /// Pyth price.
    error PythDeviation(uint256 skipPrice, uint256 pythPrice);
    /// @notice A constructor address argument was zero.
    error ZeroAddress();
    /// @notice A constructor feed id was zero.
    error ZeroFeed();

    /// @notice Validated Skip BTC/USD price. Reverts like `price()` on a Skip failure; ignores Pyth.
    /// @return px18 BTC/USD with 18 decimals.
    /// @return updatedAt Skip's `updatedAt` (block time of the last x/oracle update).
    function btcUsd() external view returns (uint256 px18, uint256 updatedAt);

    /// @notice Pyth BTC/USD scaled to 18 decimals. Never reverts.
    /// @return px18 The Pyth price, or 0 when the read failed validation.
    /// @return fresh True when valid and at most `PYTH_BTC_BAND_MAX_AGE` old (the deviation band is then enforced).
    function pythBtc() external view returns (uint256 px18, bool fresh);

    /// @notice The MUSD/USD leg used by `price()`. Never reverts.
    /// @return px18 Pyth MUSD clamped to [`MUSD_MIN`, `MUSD_MAX`] when fresh, else `MUSD_MIN` (1.00).
    /// @return fresh True when Pyth MUSD is valid and at most `PYTH_MAX_AGE` old.
    function musdUsd() external view returns (uint256 px18, bool fresh);

    /// @notice Every oracle input plus whether `price()` would succeed. Never reverts; one Skip precompile call.
    /// @return s See `Status`.
    function status() external view returns (Status memory s);

    /// @notice The Skip BTC/USD precompile.
    function SKIP() external view returns (address);

    /// @notice The Pyth contract (EIP-1967 PythUpgradable on Mezo).
    function PYTH() external view returns (address);

    /// @notice Pyth BTC/USD feed id.
    function BTC_FEED() external view returns (bytes32);

    /// @notice Pyth MUSD/USD feed id.
    function MUSD_FEED() external view returns (bytes32);
}
