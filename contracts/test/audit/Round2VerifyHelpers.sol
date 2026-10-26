// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";

/// @notice An M1 borrower with spare collateral that, in one transaction, borrows, records an allocator checkpoint
/// while the borrow is outstanding, and repays. Only the transient M1 state is recorded.
contract CheckpointPoisoner {
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

    function postCollateral() external {
        MORPHO.supplyCollateral(params, IERC20(params.collateralToken).balanceOf(address(this)), address(this), "");
    }

    /// @return recorded Whether the allocator recorded a checkpoint.
    function poison(uint256 transientBorrow) external returns (bool recorded) {
        (, uint256 shares) = MORPHO.borrow(params, transientBorrow, 0, address(this), address(this));
        recorded = ALLOCATOR.checkpoint();
        MORPHO.repay(params, 0, shares, address(this), "");
    }
}
