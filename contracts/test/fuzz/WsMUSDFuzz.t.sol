// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IWsMUSD} from "../../src/interfaces/IWsMUSD.sol";
import {WsMUSDBase} from "../unit/WsMUSDBase.t.sol";

/// @notice Fuzzes wsMUSD rounding across deposit/mint/withdraw/redeem/in-kind and the vesting schedule, from
/// arbitrary states mixing vesting harvests, pending yield with an instant part, and unabsorbed donations.
contract WsMUSDFuzzTest is WsMUSDBase {
    struct Scenario {
        uint256 principal;
        uint256 yield1;
        uint256 dt1;
        uint256 yield2;
        uint256 dt2;
        uint256 donation;
    }

    /// @dev Drives the vault into an arbitrary mid-life state.
    function _scenario(Scenario memory s) internal {
        _deposit(alice, bound(s.principal, 1e18, 100_000e18));
        uint256 y1 = bound(s.yield1, 0, 5000e18);
        if (y1 != 0) _yieldForVault(y1);
        skip(bound(s.dt1, 0, 5 days));
        ws.sync();
        skip(bound(s.dt2, 0, 5 days));
        uint256 y2 = bound(s.yield2, 0, 5000e18);
        if (y2 != 0) _yieldForVault(y2);
        uint256 donation = bound(s.donation, 0, 5000e18);
        if (donation != 0) musd.mint(address(ws), donation);
    }

    function _price() internal view returns (uint256 ta, uint256 ts) {
        return (ws.totalAssets(), ws.totalSupply());
    }

    /// @dev (ta1+1)/(ts1+1) >= (ta0+1)/(ts0+1), cross-multiplied (OZ virtual share/asset of 1).
    function _assertPriceNotDown(uint256 ta0, uint256 ts0, uint256 ta1, uint256 ts1) internal pure {
        assertGe((ta1 + 1) * (ts0 + 1), (ta0 + 1) * (ts1 + 1), "share price decreased");
    }

    // ----- previews equal execution -----

    function testFuzz_previewDeposit_matchesExecution(Scenario memory s, uint256 assets) public {
        _scenario(s);
        assets = bound(assets, 0, ws.maxDeposit(bob));
        uint256 expected = ws.previewDeposit(assets);
        (uint256 ta0, uint256 ts0) = _price();
        _fund(bob, assets);
        vm.prank(bob);
        assertEq(ws.deposit(assets, bob), expected);
        (uint256 ta1, uint256 ts1) = _price();
        _assertPriceNotDown(ta0, ts0, ta1, ts1);
    }

    function testFuzz_previewMint_matchesExecution(Scenario memory s, uint256 shares) public {
        _scenario(s);
        shares = bound(shares, 0, ws.maxMint(bob));
        uint256 expected = ws.previewMint(shares);
        (uint256 ta0, uint256 ts0) = _price();
        _fund(bob, expected);
        vm.prank(bob);
        assertEq(ws.mint(shares, bob), expected);
        assertEq(ws.balanceOf(bob), shares);
        (uint256 ta1, uint256 ts1) = _price();
        _assertPriceNotDown(ta0, ts0, ta1, ts1);
    }

    function testFuzz_previewWithdraw_matchesExecution(Scenario memory s, uint256 assets) public {
        _scenario(s);
        assets = bound(assets, 0, ws.maxWithdraw(alice));
        uint256 expected = ws.previewWithdraw(assets);
        (uint256 ta0, uint256 ts0) = _price();
        vm.prank(alice);
        assertEq(ws.withdraw(assets, alice, alice), expected);
        assertEq(musd.balanceOf(alice), assets);
        (uint256 ta1, uint256 ts1) = _price();
        _assertPriceNotDown(ta0, ts0, ta1, ts1);
        assertGe(_held(), _accounted());
    }

    function testFuzz_previewRedeem_matchesExecution(Scenario memory s, uint256 shares) public {
        _scenario(s);
        shares = bound(shares, 0, ws.maxRedeem(alice));
        uint256 expected = ws.previewRedeem(shares);
        (uint256 ta0, uint256 ts0) = _price();
        vm.prank(alice);
        assertEq(ws.redeem(shares, alice, alice), expected);
        assertEq(musd.balanceOf(alice), expected);
        (uint256 ta1, uint256 ts1) = _price();
        _assertPriceNotDown(ta0, ts0, ta1, ts1);
        assertGe(_held(), _accounted());
    }

    function testFuzz_redeemInKind_matchesPreviewAndNeverBeatsRedeem(Scenario memory s, uint256 shares) public {
        _scenario(s);
        shares = bound(shares, 0, ws.maxRedeem(alice));
        (uint256 sPreview, uint256 mPreview) = ws.previewRedeemInKind(shares);
        uint256 redeemValue = ws.previewRedeem(shares);
        (uint256 ta0, uint256 ts0) = _price();

        vm.prank(alice);
        (uint256 sOut, uint256 mOut) = ws.redeemInKind(shares, alice, alice);
        assertEq(sOut, sPreview);
        assertEq(mOut, mPreview);
        assertLe(sOut + mOut, redeemValue, "in-kind never pays more than redeem");
        assertEq(smusd.balanceOf(alice), sOut);
        assertEq(musd.balanceOf(alice), mOut);
        (uint256 ta1, uint256 ts1) = _price();
        _assertPriceNotDown(ta0, ts0, ta1, ts1);
        assertGe(_held(), _accounted());
    }

    // ----- no free value -----

    function testFuzz_sameBlockRoundTrip_neverProfits(Scenario memory s, uint256 assets, bool viaMint) public {
        _scenario(s);
        assets = bound(assets, 1, ws.maxDeposit(bob));
        _fund(bob, assets);
        vm.startPrank(bob);
        uint256 shares;
        uint256 spent = assets;
        if (viaMint) {
            shares = ws.convertToShares(assets);
            spent = ws.mint(shares, bob);
        } else {
            shares = ws.deposit(assets, bob);
        }
        uint256 out = ws.redeem(shares, bob, bob);
        vm.stopPrank();
        assertLe(out, spent);
    }

    function testFuzz_sandwich_yieldLandingInSameBlockIsNotCaptured(
        Scenario memory s,
        uint256 assets,
        uint256 lump,
        bool backRun
    ) public {
        _scenario(s);
        lump = bound(lump, 1e18, 10_000_000e18);
        if (backRun) _protocolYield(lump);
        // Its instant part may lift totalAssets toward the cap, so size the deposit afterwards.
        uint256 room = ws.maxDeposit(attacker);
        vm.assume(room >= 1e18);
        assets = bound(assets, 1e18, room);
        uint256 shares = _deposit(attacker, assets);
        if (!backRun) _protocolYield(lump);
        vm.prank(attacker);
        uint256 out = ws.redeem(shares, attacker, attacker);
        assertLe(out, assets);
    }

    // ----- vesting schedule -----

    function testFuzz_harvestVestsLinearly(uint256 yieldTarget, uint256 dt) public {
        _deposit(alice, 10_000e18);
        _yieldForVault(bound(yieldTarget, 1e16, 5000e18));
        uint256 harvested = ws.sync(); // same block as the last harvest: everything vests
        uint256 base = ws.totalAssets();
        assertEq(base, 10_001e18);
        assertEq(_unvested(), harvested);

        dt = bound(dt, 0, 10 days);
        skip(dt);
        assertEq(ws.totalAssets(), base + Math.mulDiv(harvested, Math.min(dt, 3 days), 3 days));
    }

    function testFuzz_instantPart_followsTimeSinceLastHarvest(uint256 yieldTarget, uint256 elapsed) public {
        _deposit(alice, 10_000e18);
        elapsed = bound(elapsed, 0, 10 days);
        skip(elapsed);
        _yieldForVault(bound(yieldTarget, 1e16, 5000e18));
        uint256 pending = ws.pendingYield();
        uint256 instant = Math.mulDiv(pending, Math.min(elapsed, 3 days), 3 days);
        assertEq(ws.totalAssets(), 10_001e18 + instant);

        ws.sync();
        assertEq(ws.totalAssets(), 10_001e18 + instant);
        assertEq(_unvested(), pending - instant);
    }

    function testFuzz_sync_realizesExactlyThePreview(Scenario memory s, uint256 dt) public {
        _scenario(s);
        skip(bound(dt, 0, 4 days));
        uint256 ta = ws.totalAssets();
        ws.sync();
        assertEq(ws.totalAssets(), ta);
        assertEq(_stored(), ta);
        assertGe(_held(), _accounted());
        // Within the same block a second sync is a no-op.
        ws.sync();
        assertEq(ws.totalAssets(), ta);
    }

    function testFuzz_donation_neverMovesTotalAssetsInSameBlock(Scenario memory s, uint256 amount, bool asSMUSD)
        public
    {
        _scenario(s);
        uint256 ta = ws.totalAssets();
        amount = bound(amount, 1, 100_000e18);
        if (asSMUSD) {
            vm.prank(whale);
            smusd.transfer(address(ws), amount);
        } else {
            musd.mint(address(ws), amount);
        }
        assertEq(ws.totalAssets(), ta);
        ws.sync();
        assertEq(ws.totalAssets(), ta);
    }

    function testFuzz_totalAssetsNeverDecreasesOverTime(Scenario memory s, uint256 dtA, uint256 dtB) public {
        _scenario(s);
        uint256 ta0 = ws.totalAssets();
        skip(bound(dtA, 0, 2 days));
        uint256 ta1 = ws.totalAssets();
        skip(bound(dtB, 0, 2 days));
        uint256 ta2 = ws.totalAssets();
        assertGe(ta1, ta0);
        assertGe(ta2, ta1);
        assertGe(_held() + ws.pendingYield(), ta2, "backing covers totalAssets");
    }

    // ----- cap timelock -----

    function testFuzz_capRaise_onlyAfterTimelock(uint256 newCap, uint256 wait) public {
        newCap = bound(newCap, CAP + 1, type(uint128).max);
        wait = bound(wait, 0, 10 days);
        vm.prank(capAdmin);
        ws.submitCapRaise(newCap);
        skip(wait);
        if (wait < 72 hours) {
            vm.expectRevert(
                abi.encodeWithSelector(IWsMUSD.CapRaiseTimelocked.selector, uint64(block.timestamp - wait + 72 hours))
            );
            ws.acceptCapRaise();
            assertEq(ws.depositCap(), CAP);
        } else {
            ws.acceptCapRaise();
            assertEq(ws.depositCap(), newCap);
        }
    }
}
