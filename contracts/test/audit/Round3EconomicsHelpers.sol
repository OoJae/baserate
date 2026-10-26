// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";

/// @notice Keeps the allocator's recorded M1 external liquidity pinned. In one transaction it touches M1 with the
/// permissionless `Morpho.accrueInterest` (no capital, no position) and then calls the permissionless
/// `allocator.checkpoint()`: the checkpoint sees M1 as touched earlier in the block and carries the previous checkpoint's
/// `m1ExternalLiquidity` forward unchanged, with a fresh timestamp. Sent once per `CHECKPOINT_INTERVAL`, in the first
/// block where a checkpoint is due, it keeps whatever external liquidity was last recorded untouched inside the 24 h
/// `LIQUIDITY_WINDOW` for as long as it is repeated.
contract R3EconCheckpointPinner {
    IMorpho internal immutable MORPHO;
    IBaserateAllocator internal immutable ALLOCATOR;
    MarketParams internal params;

    constructor(IMorpho morpho, IBaserateAllocator allocator, MarketParams memory params_) {
        MORPHO = morpho;
        ALLOCATOR = allocator;
        params = params_;
    }

    /// @return recorded Whether the allocator recorded a (carried-forward) checkpoint.
    function pin() external returns (bool recorded) {
        MORPHO.accrueInterest(params);
        recorded = ALLOCATOR.checkpoint();
    }
}
