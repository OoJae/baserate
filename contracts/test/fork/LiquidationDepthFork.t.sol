// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";

import {IFlashLiquidator} from "../../src/interfaces/IFlashLiquidator.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {LiquidationForkBase} from "./LiquidationForkBase.t.sol";

/// @notice Measures liquidation depth on the mainnet fork (pinned block 12,758,000): for CL200 and the vAMM, the
/// largest BTC sale whose proceeds stay within a given shortfall of the M1 oracle value (QuoterV2 and
/// Router.getAmountsOut through `FlashLiquidator.quoteVenues`). Then checks the boundary with real liquidations: a
/// slice at the measured size clears, a slice 25% larger reverts `ImpactTooHigh`, and the backstop absorbs it.
contract LiquidationDepthMainnetForkTest is LiquidationForkBase {
    uint256 internal constant RES = 1e14; // 0.0001 BTC search resolution
    uint256 internal constant HI = 0.5e18;

    function setUp() public {
        _setUpLiquidation(Net.MAINNET, 1e18);
    }

    /// @dev Largest size in (0, hi] whose venue proceeds are >= oracle value x (1 - bps).
    function _cleanSize(Venue venue, uint256 bps, uint256 hi) internal returns (uint256 lo) {
        while (hi - lo > RES) {
            uint256 mid = (lo + hi) / 2;
            (uint256 value, uint256[3] memory out) = liq.quoteVenues(mid);
            if (out[uint256(venue)] * BPS >= value * (BPS - bps)) lo = mid;
            else hi = mid;
        }
    }

    function _report(Venue venue, string memory name) internal returns (uint256 atIncentive) {
        uint256[5] memory thresholds = [uint256(0), 100, 219, maxImpactBps, 438];
        console2.log(name);
        for (uint256 i; i < thresholds.length; ++i) {
            uint256 size = _cleanSize(venue, thresholds[i], HI);
            (uint256 value,) = liq.quoteVenues(size);
            console2.log("  max shortfall (bps)", thresholds[i]);
            console2.log("    clean size (BTC wei)", size);
            console2.log("    oracle value (MUSD wei)", value);
            if (i == 4) atIncentive = size;
        }
    }

    function test_mainnet_depthReport() public {
        console2.log("oracle price (MUSD per BTC, 1e18)", oracle.price() / 1e18);
        uint256 cl = _report(Venue.CL200, "CL200 (QuoterV2)");
        uint256 vamm = _report(Venue.VAMM, "vAMM (Router.getAmountsOut)");
        // Within the 4.38% incentive at this block: CL200 ~0.09 BTC, vAMM ~0.05 BTC.
        assertGt(cl, 0.05e18, "CL200 clean depth");
        assertLt(cl, 0.15e18, "CL200 clean depth (pool exhausts near 0.1 BTC)");
        assertGt(vamm, 0.02e18, "vAMM clean depth");
        assertLt(vamm, cl, "vAMM shallower than CL200 here");
    }

    function _boundary(Venue venue) internal {
        address account = _openCanary(0.3e18);
        skip(1 hours);
        _dropSkip(50);
        IFlashLiquidator.LiquidationPreview memory p = liq.previewLiquidation(account);
        assertTrue(p.liquidatable, "liquidatable");

        uint256 clean = _cleanSize(venue, maxImpactBps, p.seizable);
        assertGt(clean, 0, "some depth");
        console2.log("venue", uint256(venue));
        console2.log("  measured clean slice at MAX_IMPACT (BTC wei)", clean);

        // The measured slice clears and repays lenders at break-even or better.
        uint256 snap = vm.snapshotState();
        Outcome memory o = _liquidate(account, clean, venue, 0);
        assertEq(o.seized, clean, "slice seized");
        console2.log("  slice repaid (MUSD wei)", o.repaid);
        console2.log("  slice profit (MUSD wei)", o.profit);
        console2.log("  gas", o.gas);
        vm.revertToState(snap);

        // 25% more breaches the impact floor...
        uint256 big = clean * 125 / 100;
        snap = vm.snapshotState();
        vm.prank(keeper);
        vm.expectPartialRevert(IFlashLiquidator.ImpactTooHigh.selector);
        liq.liquidate(account, big, venue, 0);
        vm.revertToState(snap);

        // ...but the backstop takes it at the oracle price less half the incentive.
        _depositBackstop(makeAddr("bigDepositor"), 30_000e18);
        Outcome memory b = _liquidate(account, big, Venue.BACKSTOP, 1);
        assertEq(b.seized, big, "backstop absorbed the oversize slice");
        assertGt(b.profit, 0, "and the caller still profits");
    }

    function test_mainnet_depthBoundary_cl200() public {
        _boundary(Venue.CL200);
    }

    function test_mainnet_depthBoundary_vamm() public {
        _boundary(Venue.VAMM);
    }
}
