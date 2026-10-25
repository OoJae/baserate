// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";

/// @notice Atomic "transient supply" manipulation of BaserateAllocator: supply MUSD to M1, call the permissionless
/// `rebalance()`, and take the supply back out, all in one transaction. The supplied MUSD can come from any flash
/// source or the attacker's own balance; it is fully returned (minus at most 1 wei of Morpho share rounding).
contract FlashSupplyAttacker {
    IMorpho internal immutable MORPHO;
    IBaserateAllocator internal immutable ALLOCATOR;
    IERC20 internal immutable MUSD;
    MarketParams internal params;

    constructor(IMorpho morpho, IBaserateAllocator allocator, IERC20 musd, MarketParams memory params_) {
        MORPHO = morpho;
        ALLOCATOR = allocator;
        MUSD = musd;
        params = params_;
        musd.approve(address(morpho), type(uint256).max);
    }

    function attack(uint256 transientSupply) external returns (IBaserateAllocator.Action action, uint256 amount) {
        (, uint256 shares) = MORPHO.supply(params, transientSupply, 0, address(this), "");
        (action, amount) = ALLOCATOR.rebalance();
        MORPHO.withdraw(params, 0, shares, address(this), address(this));
    }
}

/// @notice Atomic "transient repay" by an M1 borrower: repay the whole debt, call `rebalance()`, borrow it back, all in
/// one transaction (M1 utilization and the borrow total look lower, and liquidity higher, only inside it).
contract TransientRepayBorrower {
    using MarketParamsLib for MarketParams;

    IMorpho internal immutable MORPHO;
    IBaserateAllocator internal immutable ALLOCATOR;
    MarketParams internal params;

    constructor(IMorpho morpho, IBaserateAllocator allocator, MarketParams memory params_) {
        MORPHO = morpho;
        ALLOCATOR = allocator;
        params = params_;
        IERC20(params_.loanToken).approve(address(morpho), type(uint256).max);
        IERC20(params_.collateralToken).approve(address(morpho), type(uint256).max);
    }

    /// @dev Posts all held collateral and borrows `assets` MUSD (kept here for the repay).
    function open(uint256 assets) external {
        MORPHO.supplyCollateral(params, IERC20(params.collateralToken).balanceOf(address(this)), address(this), "");
        MORPHO.borrow(params, assets, 0, address(this), address(this));
    }

    function attack() external returns (IBaserateAllocator.Action action, uint256 amount) {
        uint256 shares = MORPHO.position(params.id(), address(this)).borrowShares;
        (uint256 repaid,) = MORPHO.repay(params, 0, shares, address(this), "");
        (action, amount) = ALLOCATOR.rebalance();
        MORPHO.borrow(params, repaid, 0, address(this), address(this));
    }

    function borrowShares() external view returns (uint256) {
        return MORPHO.position(params.id(), address(this)).borrowShares;
    }
}
