// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Local stand-in for Mezo's MUSD: OZ v5 ERC20Permit with the live EIP-712 domain {"Mezo USD", "1"}.
/// @dev Like the live token, transfers to the token contract itself revert (transfers to zero revert in OZ).
contract MockMUSD is ERC20Permit {
    error InvalidRecipient(address recipient);

    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    /// @notice Test faucet.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Test burn helper.
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (to == address(this)) revert InvalidRecipient(to);
        super._update(from, to, value);
    }
}
