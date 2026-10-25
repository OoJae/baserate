// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {PCVMock, SMUSDMock} from "../utils/SMUSDMock.sol";
import {WsMUSDBase} from "../unit/WsMUSDBase.t.sol";

/// @notice Drives wsMUSD through every user path plus the sMUSD-side events that move its backing: protocol yield,
/// PCV distributions inside sMUSD deposit/withdraw (with auto-claim), direct MUSD and sMUSD donations, outside sMUSD
/// holders entering and leaving, and time. Properties that need a before/after view are recorded as ghost flags,
/// because handler reverts are discarded (fail_on_revert = false).
contract WsMUSDHandler is Test {
    WsMUSD internal immutable ws;
    MockMUSD internal immutable musd;
    SMUSDMock internal immutable smusd;
    PCVMock internal immutable pcv;
    address internal immutable outsider;

    address[] internal actors;

    // Ghost flags (must stay false).
    bool public priceDecreased;
    bool public previewMismatch;
    bool public donationMovedAssets;
    bool public sameBlockYieldMovedAssets;
    bool public totalAssetsFellOverTime;

    uint256 internal lastTa;
    uint256 internal lastTs;

    mapping(bytes32 => uint256) public calls;

    constructor(WsMUSD ws_, MockMUSD musd_, SMUSDMock smusd_, PCVMock pcv_, address[] memory actors_) {
        ws = ws_;
        musd = musd_;
        smusd = smusd_;
        pcv = pcv_;
        actors = actors_;
        outsider = makeAddr("outsider");
        vm.prank(outsider);
        musd.approve(address(smusd), type(uint256).max);
        for (uint256 i; i < actors_.length; ++i) {
            vm.prank(actors_[i]);
            musd.approve(address(ws), type(uint256).max);
        }
        lastTa = ws.totalAssets();
        lastTs = ws.totalSupply();
    }

    modifier checked(bytes32 name) {
        calls[name]++;
        _;
        _checkPrice();
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    // ----- user paths -----

    function deposit(uint256 actorSeed, uint256 assets) external checked("deposit") {
        address actor = _actor(actorSeed);
        uint256 max = ws.maxDeposit(actor);
        if (max == 0) return;
        assets = bound(assets, 0, _min(max, 100_000e18));
        uint256 expected = ws.previewDeposit(assets);
        musd.mint(actor, assets);
        vm.prank(actor);
        if (ws.deposit(assets, actor) != expected) previewMismatch = true;
    }

    function mint(uint256 actorSeed, uint256 shares) external checked("mint") {
        address actor = _actor(actorSeed);
        uint256 max = ws.maxMint(actor);
        if (max == 0) return;
        shares = bound(shares, 0, _min(max, 100_000e18));
        uint256 expected = ws.previewMint(shares);
        musd.mint(actor, expected);
        vm.prank(actor);
        if (ws.mint(shares, actor) != expected) previewMismatch = true;
    }

    function withdraw(uint256 actorSeed, uint256 assets) external checked("withdraw") {
        address actor = _actor(actorSeed);
        assets = bound(assets, 0, ws.maxWithdraw(actor));
        uint256 expected = ws.previewWithdraw(assets);
        uint256 before = musd.balanceOf(actor);
        vm.prank(actor);
        if (ws.withdraw(assets, actor, actor) != expected) previewMismatch = true;
        if (musd.balanceOf(actor) - before != assets) previewMismatch = true;
    }

    function redeem(uint256 actorSeed, uint256 shares) external checked("redeem") {
        address actor = _actor(actorSeed);
        shares = bound(shares, 0, ws.maxRedeem(actor));
        uint256 expected = ws.previewRedeem(shares);
        uint256 before = musd.balanceOf(actor);
        vm.prank(actor);
        if (ws.redeem(shares, actor, actor) != expected) previewMismatch = true;
        if (musd.balanceOf(actor) - before != expected) previewMismatch = true;
    }

    function redeemInKind(uint256 actorSeed, uint256 shares) external checked("redeemInKind") {
        address actor = _actor(actorSeed);
        shares = bound(shares, 0, ws.maxRedeem(actor));
        (uint256 sPreview, uint256 mPreview) = ws.previewRedeemInKind(shares);
        vm.prank(actor);
        (uint256 sOut, uint256 mOut) = ws.redeemInKind(shares, actor, actor);
        if (sOut != sPreview || mOut != mPreview) previewMismatch = true;
    }

    function sync() external checked("sync") {
        uint256 ta = ws.totalAssets();
        ws.sync();
        if (ws.totalAssets() != ta) previewMismatch = true;
    }

    // ----- sMUSD-side and adversarial events -----

    function donateMUSD(uint256 amount) external checked("donateMUSD") {
        amount = bound(amount, 1, 50_000e18);
        uint256 ta = ws.totalAssets();
        musd.mint(address(ws), amount);
        if (ws.totalAssets() != ta) donationMovedAssets = true;
    }

    function donateSMUSD(uint256 amount) external checked("donateSMUSD") {
        uint256 bal = smusd.balanceOf(outsider);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        uint256 ta = ws.totalAssets();
        vm.prank(outsider);
        smusd.transfer(address(ws), amount);
        if (ws.totalAssets() != ta) donationMovedAssets = true;
    }

    function protocolYield(uint256 amount) external checked("protocolYield") {
        uint256 supply = smusd.totalSupply();
        if (supply == 0) return;
        amount = bound(amount, supply / 1e18 + 1, 200_000e18);
        uint256 ta = ws.totalAssets();
        bool sameBlockAsHarvest = ws.lastHarvest() == block.timestamp;
        musd.mint(address(this), amount);
        musd.approve(address(smusd), amount);
        smusd.receiveProtocolYield(amount);
        if (sameBlockAsHarvest && ws.totalAssets() != ta) sameBlockYieldMovedAssets = true;
    }

    /// @dev Queues MUSD that the PCV pushes into sMUSD on the next sMUSD deposit or withdraw (ours or anyone's).
    function queuePcv(uint256 amount) external checked("queuePcv") {
        amount = bound(amount, 0, 50_000e18);
        uint256 supply = smusd.totalSupply();
        if (amount != 0 && amount * 1e18 / (supply == 0 ? 1 : supply) == 0) amount = 0;
        musd.mint(address(pcv), amount);
        pcv.queue(amount);
    }

    function outsiderMoves(uint256 amount, bool enter) external checked("outsiderMoves") {
        if (enter) {
            amount = bound(amount, 1, 500_000e18);
            musd.mint(outsider, amount);
            vm.prank(outsider);
            smusd.deposit(amount);
        } else {
            uint256 bal = smusd.balanceOf(outsider);
            if (bal == 0) return;
            amount = bound(amount, 1, bal);
            vm.prank(outsider);
            smusd.withdraw(amount);
        }
    }

    function warp(uint256 dt) external checked("warp") {
        dt = bound(dt, 1, 2 days);
        uint256 ta = ws.totalAssets();
        skip(dt);
        vm.roll(block.number + 1);
        if (ws.totalAssets() < ta) totalAssetsFellOverTime = true;
    }

    // ----- internals -----

    function _checkPrice() internal {
        uint256 ta = ws.totalAssets();
        uint256 ts = ws.totalSupply();
        if ((ta + 1) * (lastTs + 1) < (lastTa + 1) * (ts + 1)) priceDecreased = true;
        lastTa = ta;
        lastTs = ts;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

/// @notice wsMUSD invariants (contracts.md §6, 1-4) on the local stack with a live-like PCV wired into sMUSD.
contract WsMUSDInvariantTest is WsMUSDBase {
    WsMUSDHandler internal handler;

    function setUp() public override {
        super.setUp();
        smusd.setPcv(address(pcv));

        address[] memory actors = new address[](4);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = attacker;
        actors[3] = makeAddr("carol");
        handler = new WsMUSDHandler(ws, musd, smusd, pcv, actors);
        _deposit(alice, 10_000e18);

        targetContract(address(handler));
        excludeSender(address(ws));
        excludeSender(address(smusd));
        excludeSender(address(musd));
    }

    /// @dev Invariant 1: the vault can always pay out totalAssets (holdings plus unclaimed sMUSD yield).
    function invariant_backingCoversTotalAssets() public view {
        assertGe(_held() + ws.pendingYield(), ws.totalAssets());
    }

    /// @dev Invariant 1 (strict form): accounted assets are always held as sMUSD or MUSD.
    function invariant_accountedAssetsAreHeld() public view {
        assertGe(_held(), _accounted());
    }

    /// @dev Invariant 2: the share price never decreases, across every handler action and every warp.
    function invariant_sharePriceNeverDecreases() public view {
        assertFalse(handler.priceDecreased());
        assertFalse(handler.totalAssetsFellOverTime());
    }

    /// @dev Invariant 3: previews equal executed amounts; a sync realizes exactly the previewed totalAssets.
    function invariant_previewsMatchExecution() public view {
        assertFalse(handler.previewMismatch());
    }

    /// @dev Invariant 4: a same-block donation (MUSD, sMUSD, or protocol yield right after a harvest) does not
    /// change totalAssets.
    function invariant_sameBlockDonationDoesNotMoveTotalAssets() public view {
        assertFalse(handler.donationMovedAssets());
        assertFalse(handler.sameBlockYieldMovedAssets());
    }

    /// @dev Shares are fully owned by the actors and the dead seed.
    function invariant_supplyMatchesHolders() public view {
        uint256 sum = ws.balanceOf(DEAD);
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += ws.balanceOf(handler.actorAt(i));
        }
        assertEq(sum, ws.totalSupply());
    }

    /// @dev The dead seed keeps the vault from ever emptying, and the cap is never exceeded by deposits.
    function invariant_seedSharesPersist() public view {
        assertGe(ws.totalSupply(), SEED);
        assertGe(ws.totalAssets(), SEED);
    }
}
