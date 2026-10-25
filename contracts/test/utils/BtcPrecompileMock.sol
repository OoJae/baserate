// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @notice Stand-in for Mezo's BTC ERC-20 precompile, etched at 0x7b7C...0000 in fork and unit tests.
/// @dev On Mezo, native BTC and this ERC-20 view share one balance: `balanceOf(a)` is `a.balance`, and a precompile
/// `transfer`/`transferFrom` moves native balance without running the recipient's code. The live precompile is
/// implemented in the Go node, so under a local fork its stub bytecode recurses and reverts (docs/design/contracts.md
/// section 0.3); this mock reproduces the semantics with the `vm.deal` cheatcode. Allowances live in the mock's own
/// storage at the precompile address.
/// Cheatcodes are reachable from any contract, but on a fork Foundry only lets accounts it considers local call them,
/// so the fork harness calls `vm.allowCheatcodes(BTC)` after etching (see `MezoFork._etchBtc`).
/// Caveat (verified): `vm.deal` is not journaled, so if a call that moved BTC through this mock later reverts, the
/// moved balances stay moved. Tests that expect such a revert and then continue wrap it in
/// `vm.snapshotState()` / `vm.revertToState()`.
/// `callCount` counts every state-changing call (transfer, transferFrom, approve) so tests can double-check the
/// precompile budget; reads are counted through state-diff recording instead, because they are static calls.
contract BtcPrecompileMock {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance(address from, uint256 balance, uint256 needed);
    error InsufficientAllowance(address owner, address spender, uint256 allowance, uint256 needed);

    mapping(address owner => mapping(address spender => uint256)) public allowance;
    uint256 public callCount;

    function name() external pure returns (string memory) {
        return "Bitcoin";
    }

    function symbol() external pure returns (string memory) {
        return "BTC";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalSupply() external pure returns (uint256) {
        return 21_000_000e18;
    }

    function balanceOf(address account) external view returns (uint256) {
        return account.balance;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        callCount++;
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        callCount++;
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        callCount++;
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    /// @dev Moves native balance like the Go precompile: no code runs at `to`.
    function _move(address from, address to, uint256 amount) internal {
        uint256 fromBalance = from.balance;
        if (fromBalance < amount) revert InsufficientBalance(from, fromBalance, amount);
        if (from != to && amount != 0) {
            VM.deal(from, fromBalance - amount);
            VM.deal(to, to.balance + amount);
        }
        emit Transfer(from, to, amount);
    }
}
