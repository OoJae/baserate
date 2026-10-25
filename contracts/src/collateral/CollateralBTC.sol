// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IBorrowAccountFactory} from "../interfaces/IBorrowAccountFactory.sol";
import {ICollateralBTC} from "../interfaces/ICollateralBTC.sol";

/// @title CollateralBTC (bcBTC)
/// @notice Immutable, gated 1:1 receipt for native BTC used as M1 collateral. Only factory-registered BorrowAccount
/// clones can mint it, it can only move clone -> Morpho and Morpho -> anyone, and any holder can unwrap it.
/// @dev Deployed inside the BorrowAccountFactory constructor, so `FACTORY = msg.sender`.
/// Consequences of the gate:
/// - all M1 collateral entered through clones, so clone limits are market-wide;
/// - a Morpho `flashLoan` of bcBTC always reverts (the return leg is not from an account);
/// - liquidators receive bcBTC from Morpho and can only unwrap it.
/// On Mezo native BTC and the BTC precompile share one balance, so accounting uses `totalSupply` only and this
/// contract never calls or approves the precompile: `address(this).balance >= totalSupply()` always holds, and any
/// surplus pushed in through the precompile is unrecoverable. There is no `receive` or fallback.
contract CollateralBTC is ERC20, ReentrancyGuardTransient, ICollateralBTC {
    /// @inheritdoc ICollateralBTC
    address public immutable FACTORY;
    /// @inheritdoc ICollateralBTC
    address public immutable MORPHO;

    /// @param morpho The Morpho Blue singleton.
    constructor(address morpho) ERC20("Baserate Collateral BTC", "bcBTC") {
        if (morpho == address(0)) revert ZeroAddress();
        FACTORY = msg.sender;
        MORPHO = morpho;
    }

    /// @inheritdoc ICollateralBTC
    function wrap() external payable nonReentrant returns (uint256 minted) {
        if (msg.value == 0) revert ZeroAmount();
        if (!IBorrowAccountFactory(FACTORY).isAccount(msg.sender)) revert NotAccount(msg.sender);
        minted = msg.value;
        _mint(msg.sender, minted);
        emit Wrapped(msg.sender, minted);
    }

    /// @inheritdoc ICollateralBTC
    function unwrap(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        _burn(msg.sender, amount);
        emit Unwrapped(msg.sender, to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeSendFailed(to, amount);
    }

    /// @dev Transfer gate. Mints happen only in `wrap` and burns only in `unwrap`; every other movement must either
    /// leave Morpho or go into Morpho from a registered account.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && from != MORPHO) {
            if (to != MORPHO || !IBorrowAccountFactory(FACTORY).isAccount(from)) revert TransferRestricted(from, to);
        }
        super._update(from, to, value);
    }
}
