// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ICLSwapRouter} from "../../src/interfaces/external/ICLSwapRouter.sol";
import {ITigrisRouter} from "../../src/interfaces/external/ITigrisRouter.sol";
import {MezoAddresses} from "../../script/config/MezoAddresses.sol";
import {BtcPrecompileMock} from "../utils/BtcPrecompileMock.sol";
import {MezoFork} from "../utils/MezoFork.sol";

/// @notice The BTC precompile mock on a mainnet fork: ERC-20 view of native balances, allowance-gated pulls that move
/// native balance without running recipient code, and plain swaps through the real Tigris routers.
contract BtcPrecompileMockForkTest is MezoFork {
    BtcPrecompileMock internal btc;
    address internal user = makeAddr("user");

    function setUp() public {
        _fork(Net.MAINNET);
        btc = _etchBtc();
    }

    function test_balanceMirrorsNative() public {
        vm.deal(user, 1.5 ether);
        assertEq(btc.balanceOf(user), 1.5 ether);
        assertEq(btc.decimals(), 18);
        assertEq(btc.balanceOf(net.btcMusdVolatilePool), net.btcMusdVolatilePool.balance, "pool reserves are native");
    }

    function test_transferAndTransferFromMoveNative() public {
        vm.deal(user, 1 ether);
        address to = net.clBtcMusdPool; // a contract without receive(): no code runs on a precompile transfer
        uint256 before = to.balance;
        vm.prank(user);
        assertTrue(btc.transfer(to, 0.25 ether));
        assertEq(user.balance, 0.75 ether);
        assertEq(to.balance, before + 0.25 ether);

        address spender = makeAddr("spender");
        vm.prank(spender);
        vm.expectRevert(
            abi.encodeWithSelector(BtcPrecompileMock.InsufficientAllowance.selector, user, spender, 0, 0.1 ether)
        );
        btc.transferFrom(user, spender, 0.1 ether);

        vm.prank(user);
        btc.approve(spender, 0.5 ether);
        vm.prank(spender);
        btc.transferFrom(user, spender, 0.5 ether);
        assertEq(spender.balance, 0.5 ether);
        assertEq(btc.allowance(user, spender), 0);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(BtcPrecompileMock.InsufficientBalance.selector, user, 0.25 ether, 1 ether)
        );
        btc.transfer(spender, 1 ether);
    }

    function test_plainSwapsThroughTigrisRouters() public {
        vm.deal(user, 0.02 ether);
        vm.startPrank(user);
        btc.approve(net.clSwapRouter, 0.01 ether);
        uint256 clOut = ICLSwapRouter(net.clSwapRouter)
            .exactInputSingle(
                ICLSwapRouter.ExactInputSingleParams({
                    tokenIn: MezoAddresses.BTC,
                    tokenOut: net.musd,
                    tickSpacing: 200,
                    recipient: user,
                    deadline: block.timestamp,
                    amountIn: 0.01 ether,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        btc.approve(net.router, 0.01 ether);
        ITigrisRouter.Route[] memory routes = new ITigrisRouter.Route[](1);
        routes[0] = ITigrisRouter.Route(MezoAddresses.BTC, net.musd, false, net.poolFactory);
        uint256[] memory amounts =
            ITigrisRouter(net.router).swapExactTokensForTokens(0.01 ether, 0, routes, user, block.timestamp);
        vm.stopPrank();

        assertEq(user.balance, 0, "BTC spent");
        assertEq(IERC20(net.musd).balanceOf(user), clOut + amounts[1], "MUSD received");
        assertGt(clOut, 790e18, "~80.9k MUSD/BTC on CL200");
        assertGt(amounts[1], 790e18, "~79.9k MUSD/BTC on the vAMM");
    }
}
