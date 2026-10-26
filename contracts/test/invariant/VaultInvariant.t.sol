// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IMorpho, Id, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";

import {IVaultV2} from "vault-v2/interfaces/IVaultV2.sol";

import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {BaserateAllocator} from "../../src/vault/BaserateAllocator.sol";
import {WsMusdLiquidityAdapter} from "../../src/vault/WsMusdLiquidityAdapter.sol";
import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {IWsMusdLiquidityAdapter} from "../../src/interfaces/IWsMusdLiquidityAdapter.sol";
import {IMorphoMarketV1AdapterV2Lite} from "../../src/interfaces/external/IMorphoMarketV1AdapterV2Lite.sol";
import {MockERC20} from "../utils/MockERC20.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {IRealAssets, VaultBase} from "../unit/VaultBase.t.sol";

/// @notice Drives lenders, M1 borrowers, time, wsMUSD yield, force and sentinel deallocations, curator cap cuts,
/// permissionless rebalances and atomic transient-supply and transient-withdraw attackers against vMUSD, recording
/// allocator and adapter rule violations as ghost flags.
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    using MorphoBalancesLib for IMorpho;

    IVaultV2 internal immutable vault;
    WsMusdLiquidityAdapter internal immutable liq;
    IMorphoMarketV1AdapterV2Lite internal immutable mm;
    BaserateAllocator internal immutable allocator;
    MockMUSD internal immutable musd;
    WsMUSD internal immutable ws;
    IMorpho internal immutable morpho;
    MockERC20 internal immutable collateral;
    address internal immutable curator;
    MarketParams internal params;
    bytes32[4] internal ids;
    bytes internal marketIdData;

    address[] internal lenders;
    address internal borrower = makeAddr("inv.borrower");
    address internal stranger = makeAddr("inv.stranger");
    address internal attacker = makeAddr("inv.attacker");

    bool public capViolated;
    bool public bufferBroken;
    bool public bufferNeglected;
    bool public manipulatedMove;
    bool public freeForceDeallocate;
    bool public doubleTopUp;
    bool public idleStuck;
    uint256 public rebalances;
    uint256 public moves;
    uint256 public topUps;
    uint256 internal lastTopUpTimestamp;

    constructor(BaserateAllocator allocator_, address curator_) {
        allocator = allocator_;
        vault = IVaultV2(allocator_.VAULT());
        liq = WsMusdLiquidityAdapter(allocator_.LIQUIDITY_ADAPTER());
        mm = IMorphoMarketV1AdapterV2Lite(allocator_.MARKET_ADAPTER());
        musd = MockMUSD(allocator_.MUSD());
        ws = WsMUSD(allocator_.WSMUSD());
        morpho = IMorpho(allocator_.MORPHO());
        curator = curator_;
        params = allocator_.marketParams();
        collateral = MockERC20(params.collateralToken);
        marketIdData = abi.encode("this/marketParams", address(mm), params);
        ids[0] = mm.adapterId();
        ids[1] = keccak256(abi.encode("collateralToken", params.collateralToken));
        ids[2] = keccak256(marketIdData);
        ids[3] = liq.adapterId();
        for (uint256 i; i < 3; ++i) {
            lenders.push(makeAddr(string.concat("inv.lender", vm.toString(i))));
        }
        collateral.mint(borrower, 1000e18);
        vm.startPrank(borrower);
        collateral.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(params, 1000e18, borrower, "");
        musd.approve(address(morpho), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- lenders

    function deposit(uint256 seed, uint256 amount) external {
        address who = lenders[seed % lenders.length];
        amount = bound(amount, 1e18, 20_000e18);
        musd.mint(who, amount);
        vm.startPrank(who);
        musd.approve(address(vault), amount);
        vault.deposit(amount, who);
        vm.stopPrank();
    }

    function withdrawViaAllocator(uint256 seed, uint256 amount) external {
        address who = lenders[seed % lenders.length];
        uint256 max = vault.previewRedeem(vault.balanceOf(who));
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.startPrank(who);
        vault.approve(address(allocator), type(uint256).max);
        try allocator.withdraw(amount, who) {} catch {} // may lack M1 liquidity (borrowed out)
        vm.stopPrank();
    }

    function redeemDirect(uint256 seed, uint256 fraction) external {
        address who = lenders[seed % lenders.length];
        uint256 shares = vault.balanceOf(who) * bound(fraction, 1, 100) / 100;
        if (shares == 0) return;
        vm.prank(who);
        try vault.redeem(shares, who, who) {} catch {} // reverts when idle + wsMUSD cannot cover it
    }

    function forceDeallocateMarket(uint256 seed, uint256 amount) external {
        address who = lenders[seed % lenders.length];
        uint256 position = mm.expectedSupplyAssets(allocator.MARKET_ID());
        (uint256 supply,, uint256 borrowed,) = morpho.expectedMarketBalances(params);
        uint256 cap = position < supply - borrowed ? position : supply - borrowed;
        uint256 owned = vault.previewRedeem(vault.balanceOf(who)) * 1000 / 1010;
        if (owned < cap) cap = owned;
        if (cap < 1e18) return;
        amount = bound(amount, 1e18, cap);
        vm.prank(who);
        vault.forceDeallocate(address(mm), abi.encode(params), amount, who);
    }

    /// @dev R2X-4: `forceDeallocate` on the liquidity adapter (penalty 0) must revert `ForceDeallocateDisabled` for
    /// holders and strangers alike while it is the vault's liquidity adapter; anything else is a free deallocation.
    function forceDeallocateLiquidity(uint256 seed, uint256 amount) external {
        if (vault.allocation(ids[3]) == 0) return;
        uint256 available = liq.availableLiquidity();
        if (available < 1e18) return;
        amount = bound(amount, 1e18, available);
        address who = seed % 2 == 0 ? stranger : lenders[seed % lenders.length];
        vm.prank(who);
        try vault.forceDeallocate(address(liq), "", amount, who) {
            freeForceDeallocate = true;
        } catch (bytes memory reason) {
            if (bytes4(reason) != IWsMusdLiquidityAdapter.ForceDeallocateDisabled.selector) freeForceDeallocate = true;
        }
    }

    /// @dev A sentinel deallocation from the liquidity adapter: MUSD idle in the vault, which the next `rebalance`
    /// must park again (also during a cooldown).
    function sentinelDeallocateLiquidity(uint256 amount) external {
        if (vault.allocation(ids[3]) == 0) return;
        uint256 available = liq.availableLiquidity();
        if (available < 1e18) return;
        amount = bound(amount, 1e18, available);
        vm.prank(curator);
        vault.deallocate(address(liq), "", amount);
    }

    // ---------------------------------------------------------------- borrowers and yield

    function borrow(uint256 amount) external {
        (uint256 supply,, uint256 borrowed,) = morpho.expectedMarketBalances(params);
        uint256 liquidity = supply - borrowed;
        if (liquidity < 1e18) return;
        amount = bound(amount, 1e18, liquidity);
        vm.prank(borrower);
        morpho.borrow(params, amount, 0, borrower, borrower);
    }

    function repay(uint256 fraction) external {
        fraction = bound(fraction, 1, 100);
        uint256 shares = morpho.position(Id.wrap(allocator.MARKET_ID()), borrower).borrowShares * fraction / 100;
        if (shares == 0) return;
        (,, uint256 borrowed,) = morpho.expectedMarketBalances(params);
        musd.mint(borrower, borrowed + 1e18);
        vm.prank(borrower);
        morpho.repay(params, 0, shares, borrower, "");
    }

    /// @dev Small wsMUSD yield (<= 0.05% of its assets), vesting over 3 days.
    function wsYield(uint256 amount) external {
        uint256 max = ws.totalAssets() / 2000;
        if (max < 1e15) return;
        musd.mint(address(ws), bound(amount, 1e15, max));
        ws.sync();
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1 minutes, 1 days);
        vm.warp(vm.getBlockTimestamp() + secs);
        vm.roll(vm.getBlockNumber() + 1);
        allocator.checkpoint();
    }

    /// @dev Occasional curator cut (1 call in 8), to at least half the current cap.
    function cutMarketCap(uint256 newCap) external {
        if (newCap % 8 != 0) return;
        uint256 current = vault.absoluteCap(ids[2]);
        newCap = bound(newCap, current / 2, current);
        vm.prank(curator);
        vault.decreaseAbsoluteCap(marketIdData, newCap);
    }

    // ---------------------------------------------------------------- attacker

    /// @dev Atomic manipulation (B-1): supply MUSD to M1, call `rebalance()`, withdraw it, in one call. No rate-driven
    /// move may come out of a transient M1 state, and the buffer must still hold once the supply has left.
    function transientSupplyRebalance(uint256 amount) external {
        amount = bound(amount, 1e18, 100_000e18);
        musd.mint(attacker, amount);
        vm.startPrank(attacker);
        musd.approve(address(morpho), amount);
        (, uint256 shares) = morpho.supply(params, amount, 0, attacker, "");
        uint256 vaultM1Before = mm.expectedSupplyAssets(allocator.MARKET_ID());
        _transientRebalance();
        morpho.withdraw(params, 0, shares, attacker, attacker);
        vm.stopPrank();
        if (mm.expectedSupplyAssets(allocator.MARKET_ID()) + 1 < vaultM1Before) manipulatedMove = true;
    }

    /// @dev Atomic manipulation (R2X-3): an outside M1 supplier withdraws what M1 can pay of its standing supply, calls
    /// `rebalance()` and re-supplies, up to three times in one call. No rate-driven move may come out of it, and at
    /// most one buffer top-up may run per block. The first call only opens the standing supply.
    function transientWithdrawLoop(uint256 amount, uint256 rounds) external {
        vm.startPrank(attacker);
        musd.approve(address(morpho), type(uint256).max);
        if (morpho.position(Id.wrap(allocator.MARKET_ID()), attacker).supplyShares == 0) {
            amount = bound(amount, 1e18, 50_000e18);
            musd.mint(attacker, amount);
            morpho.supply(params, amount, 0, attacker, "");
            vm.stopPrank();
            return;
        }
        uint256 vaultM1Before = mm.expectedSupplyAssets(allocator.MARKET_ID());
        rounds = bound(rounds, 1, 3);
        for (uint256 i; i < rounds; ++i) {
            (uint256 supply,, uint256 borrowed,) = morpho.expectedMarketBalances(params);
            uint256 out = morpho.expectedSupplyAssets(params, attacker);
            if (out > supply - borrowed) out = supply - borrowed;
            if (out == 0) break;
            morpho.withdraw(params, out, 0, attacker, attacker);
            _transientRebalance();
            morpho.supply(params, out, 0, attacker, "");
        }
        vm.stopPrank();
        if (mm.expectedSupplyAssets(allocator.MARKET_ID()) + 1 < vaultM1Before) manipulatedMove = true;
    }

    /// @dev `rebalance()` on M1 totals the caller changed earlier in the transaction.
    function _transientRebalance() internal {
        try allocator.rebalance() returns (IBaserateAllocator.Action action, uint256) {
            rebalances++;
            if (action == IBaserateAllocator.Action.TO_MARKET || action == IBaserateAllocator.Action.TO_LIQUIDITY) {
                manipulatedMove = true;
            }
            _recordTopUp(action);
            _checkIdleParked();
        } catch (bytes memory reason) {
            if (bytes4(reason) != IBaserateAllocator.CooldownActive.selector) capViolated = true;
            _checkIdleParked();
        }
    }

    // ---------------------------------------------------------------- allocator

    function rebalance() external {
        uint256[4] memory before;
        for (uint256 i; i < 4; ++i) {
            before[i] = vault.allocation(ids[i]);
        }
        try allocator.rebalance() returns (IBaserateAllocator.Action action, uint256 amount) {
            rebalances++;
            if (action != IBaserateAllocator.Action.NONE) moves++;
            _recordTopUp(action);
            _checkIdleParked();

            // Every id whose allocation grew must be within its caps.
            for (uint256 i; i < 4; ++i) {
                uint256 alloc = vault.allocation(ids[i]);
                if (alloc > before[i] && alloc > vault.absoluteCap(ids[i])) capViolated = true;
            }

            IBaserateAllocator.Snapshot memory s = allocator.snapshot();
            if (action == IBaserateAllocator.Action.TO_LIQUIDITY && s.m1Liquidity < s.bufferTarget) {
                bufferBroken = true;
            }
            // Below target after a move smaller than the per-call bound: nothing more may be possible.
            if (s.m1Liquidity < s.bufferTarget && amount < allocator.MAX_MOVE()) {
                (IBaserateAllocator.Action next,,) = allocator.previewRebalance();
                if (next == IBaserateAllocator.Action.BUFFER_TOP_UP) bufferNeglected = true;
            }
        } catch (bytes memory reason) {
            // Only the cooldown may stop a rebalance, and only with nothing idle to park.
            if (bytes4(reason) != IBaserateAllocator.CooldownActive.selector) capViolated = true;
            _checkIdleParked();
        }
    }

    // ---------------------------------------------------------------- ghost checks

    /// @dev At most one buffer top-up per block (R2X-3).
    function _recordTopUp(IBaserateAllocator.Action action) internal {
        if (action != IBaserateAllocator.Action.BUFFER_TOP_UP) return;
        topUps++;
        if (lastTopUpTimestamp == block.timestamp) doubleTopUp = true;
        lastTopUpTimestamp = block.timestamp;
    }

    /// @dev After a rebalance (or its cooldown revert) no idle vault MUSD the liquidity adapter could take is left
    /// (R2X-4): parkable = min(vault idle, absolute cap - max(allocation, held)); the relative caps are 100%.
    function _checkIdleParked() internal {
        uint256 alloc = vault.allocation(ids[3]);
        uint256 held = liq.heldAssets();
        if (held > alloc) alloc = held;
        uint256 cap = vault.absoluteCap(ids[3]);
        uint256 room = cap > alloc ? cap - alloc : 0;
        uint256 idleAssets = musd.balanceOf(address(vault));
        if ((idleAssets < room ? idleAssets : room) >= allocator.MIN_MOVE()) idleStuck = true;
    }
}

/// @notice vMUSD invariants: accounting (vault total = idle + adapters' real assets, capped by maxRate), the allocator
/// never grows an allocation past its caps, never pulls M1 below the buffer, tops it up whenever it can but at most
/// once per block, and always parks idle MUSD; the liquidity adapter never accepts a free force deallocation.
contract VaultInvariantTest is VaultBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(allocator, curator);
        _deposit(lender, 10_000e18);
        targetContract(address(handler));
    }

    /// @dev `totalAssets = min(idle + sum(realAssets), _totalAssets + _totalAssets * elapsed * maxRate)`.
    function invariant_totalAssetsIsIdlePlusAdapters() public view {
        uint256 real = _realTotal();
        uint256 stored = vault._totalAssets();
        uint256 maxTotal = stored + stored * (block.timestamp - vault.lastUpdate()) * vault.maxRate() / 1e18;
        uint256 expected = real < maxTotal ? real : maxTotal;
        assertEq(vault.totalAssets(), expected, "vault total assets");
        assertLe(vault.totalAssets(), real, "never above what the adapters hold");
    }

    /// @dev Adapter positions are fully backed by tokens and Morpho supply.
    function invariant_adaptersAreBacked() public view {
        assertLe(liq.idle(), musd.balanceOf(address(liq)), "adapter idle is held");
        assertEq(liq.heldAssets(), ws.previewRedeem(ws.balanceOf(address(liq))) + liq.idle(), "held");
        uint256 shares = mm.supplyShares(allocator.MARKET_ID());
        assertEq(morpho.position(Id.wrap(allocator.MARKET_ID()), address(mm)).supplyShares, shares, "M1 shares");
        assertLe(IRealAssets(address(mm)).realAssets(), mm.expectedSupplyAssets(allocator.MARKET_ID()));
    }

    function invariant_allocatorNeverExceedsCaps() public view {
        assertFalse(handler.capViolated(), "allocator grew an allocation past a cap, or reverted unexpectedly");
    }

    function invariant_noRateMoveOnTransientM1State() public view {
        assertFalse(handler.manipulatedMove(), "a transient M1 state drove a rate move or pulled vMUSD out of M1");
    }

    function invariant_bufferKeptWhenPossible() public view {
        assertFalse(handler.bufferBroken(), "allocator pulled M1 below the buffer");
        assertFalse(handler.bufferNeglected(), "allocator left a buffer deficit it could close");
    }

    /// @dev R2X-4: nobody can force-deallocate the liquidity adapter for free. R2X-3: at most one buffer top-up runs per
    /// block, however many times a transaction loops withdraw, rebalance, re-supply.
    function invariant_noFreeForceDeallocateOrDoubleTopUp() public view {
        assertFalse(handler.freeForceDeallocate(), "forceDeallocate on the liquidity adapter did not revert");
        assertFalse(handler.doubleTopUp(), "two buffer top-ups in one block");
    }

    /// @dev R2X-4: `rebalance` parks idle vault MUSD within the liquidity adapter's caps, during a cooldown too.
    function invariant_rebalanceParksIdle() public view {
        assertFalse(handler.idleStuck(), "rebalance left parkable idle MUSD in the vault");
    }

    /// @notice Coverage report for `forge test -vv`: how often the allocator ran, moved funds and topped up.
    function afterInvariant() public {
        emit log_named_uint("rebalances", handler.rebalances());
        emit log_named_uint("moves", handler.moves());
        emit log_named_uint("buffer top-ups", handler.topUps());
    }
}
