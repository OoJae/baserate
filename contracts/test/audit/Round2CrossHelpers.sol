// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IMorpho, Id, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {IBaserateAllocator} from "../../src/interfaces/IBaserateAllocator.sol";
import {ICLSwapRouter} from "../../src/interfaces/external/ICLSwapRouter.sol";
import {ICLQuoterV2} from "../../src/interfaces/external/ICLQuoterV2.sol";
import {ITigrisRouter} from "../../src/interfaces/external/ITigrisRouter.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";

address constant BTC_PRECOMPILE = 0x7b7C000000000000000000000000000000000000;

/// @notice Tigris basic volatile pool (Velodrome V2 `Pool`) stand-in with token0 = the BTC precompile and token1 =
/// MUSD. It reproduces the token calls of the verified `swap` that matter for Mezo's precompile budget: outputs are
/// transferred first, then `balanceOf` of both tokens, then the input-side fee is moved to PoolFees with a token
/// `transfer`, then `balanceOf` again. With BTC in, that is 3 BTC-precompile calls inside the pool (2 reads, 1
/// transfer); the router's `transferFrom` and the seller's `approve` make 5. Constant product, 30 bps fee.
contract VammPoolMock {
    IERC20 internal immutable MUSD;
    address public immutable poolFees = address(0xFEE5);
    uint256 public reserve0; // BTC
    uint256 public reserve1; // MUSD
    uint256 public constant FEE_BPS = 30;

    constructor(address musd) {
        MUSD = IERC20(musd);
    }

    receive() external payable {}

    function sync() external {
        reserve0 = address(this).balance;
        reserve1 = MUSD.balanceOf(address(this));
    }

    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256) {
        uint256 net = amountIn - amountIn * FEE_BPS / 10_000;
        (uint256 rIn, uint256 rOut) = tokenIn == BTC_PRECOMPILE ? (reserve0, reserve1) : (reserve1, reserve0);
        return net * rOut / (rIn + net);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        if (amount0Out > 0) IERC20(BTC_PRECOMPILE).transfer(to, amount0Out);
        if (amount1Out > 0) MUSD.transfer(to, amount1Out);
        uint256 b0 = IERC20(BTC_PRECOMPILE).balanceOf(address(this));
        uint256 b1 = MUSD.balanceOf(address(this));
        uint256 in0 = b0 > reserve0 - amount0Out ? b0 - (reserve0 - amount0Out) : 0;
        uint256 in1 = b1 > reserve1 - amount1Out ? b1 - (reserve1 - amount1Out) : 0;
        require(in0 > 0 || in1 > 0, "IIA");
        if (in0 > 0) IERC20(BTC_PRECOMPILE).transfer(poolFees, in0 * FEE_BPS / 10_000);
        if (in1 > 0) MUSD.transfer(poolFees, in1 * FEE_BPS / 10_000);
        b0 = IERC20(BTC_PRECOMPILE).balanceOf(address(this));
        b1 = MUSD.balanceOf(address(this));
        // K check (fees already removed), with 1 wei of slack per side for rounding.
        require((b0 + 1) * (b1 + 1) >= reserve0 * reserve1, "K");
        reserve0 = b0;
        reserve1 = b1;
    }
}

/// @notice Tigris basic Router stand-in: `getAmountsOut` prices from stored reserves (no token calls); the swap pulls
/// `amountIn` from the caller straight into the pool with `transferFrom` (a BTC-precompile call when selling BTC).
contract VammRouterMock {
    VammPoolMock public immutable pool;

    constructor(VammPoolMock pool_) {
        pool = pool_;
    }

    function getAmountsOut(uint256 amountIn, ITigrisRouter.Route[] memory routes)
        public
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = pool.getAmountOut(amountIn, routes[0].from);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        ITigrisRouter.Route[] calldata routes,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        amounts = getAmountsOut(amountIn, routes);
        require(amounts[1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(routes[0].from).transferFrom(msg.sender, address(pool), amountIn);
        if (routes[0].from == BTC_PRECOMPILE) pool.swap(0, amounts[1], to, "");
        else pool.swap(amounts[1], 0, to, "");
    }
}

interface ICLCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @notice Slipstream CL200 pool stand-in (token0 = BTC precompile, token1 = MUSD), BTC -> MUSD only. Like the
/// verified `CLPool.swap`: pays the output first, reads `balance0()` (BTC precompile), calls the swap callback, then
/// checks `balance0()` again (BTC precompile). `rangeBtc` is the BTC the active range can still absorb: a larger order
/// is filled partially, exactly as when the in-range liquidity runs out at the price limit.
contract CLPoolMock {
    IERC20 internal immutable MUSD;
    uint256 public virtualBtc;
    uint256 public virtualMusd;
    uint256 public rangeBtc = type(uint256).max;

    constructor(address musd) {
        MUSD = IERC20(musd);
    }

    receive() external payable {}

    function set(uint256 vBtc, uint256 vMusd) external {
        virtualBtc = vBtc;
        virtualMusd = vMusd;
    }

    function setRange(uint256 btc) external {
        rangeBtc = btc;
    }

    function quote(uint256 amountIn) public view returns (uint256 taken, uint256 out) {
        taken = amountIn < rangeBtc ? amountIn : rangeBtc;
        uint256 net = taken - taken / 2000; // 5 bps
        out = net * virtualMusd / (virtualBtc + net);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(zeroForOne && amountSpecified > 0, "only exact BTC in");
        (uint256 taken, uint256 out) = quote(uint256(amountSpecified));
        MUSD.transfer(recipient, out);
        uint256 before = IERC20(BTC_PRECOMPILE).balanceOf(address(this));
        ICLCallback(msg.sender).uniswapV3SwapCallback(int256(taken), -int256(out), data);
        require(before + taken <= IERC20(BTC_PRECOMPILE).balanceOf(address(this)), "IIA");
        virtualBtc += taken;
        virtualMusd -= out;
        if (rangeBtc != type(uint256).max) rangeBtc -= taken;
        return (int256(taken), -int256(out));
    }
}

/// @notice CLSwapRouter stand-in: `pay()` uses the router's own native BTC when it covers the amount, else pulls the
/// payer's BTC with `transferFrom` (BTC precompile); every swap ends with `refundBTC()` to the caller.
contract CLRouterMock is ICLCallback {
    CLPoolMock public immutable pool;

    constructor(CLPoolMock pool_) {
        pool = pool_;
    }

    receive() external payable {}

    function exactInputSingle(ICLSwapRouter.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        (, int256 amount1) =
            pool.swap(p.recipient, true, int256(p.amountIn), p.sqrtPriceLimitX96, abi.encode(msg.sender));
        amountOut = uint256(-amount1);
        require(amountOut >= p.amountOutMinimum, "Too little received");
        uint256 refund = address(this).balance;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refundBTC");
        }
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256, bytes calldata data) external {
        require(msg.sender == address(pool), "pool");
        address payer = abi.decode(data, (address));
        uint256 amount = uint256(amount0Delta);
        if (address(this).balance >= amount) {
            (bool ok,) = address(pool).call{value: amount}("");
            require(ok, "pay");
        } else {
            IERC20(BTC_PRECOMPILE).transferFrom(payer, address(pool), amount);
        }
    }
}

/// @notice Slipstream QuoterV2 stand-in: runs the pool's `swap` and decodes the amounts from its own callback's
/// revert, so each quote makes the pool's one `balance0()` BTC-precompile read inside a reverted frame, like the real
/// quoter. Not `view`.
contract CLQuoterMock is ICLCallback {
    CLPoolMock public immutable pool;

    error Quoted(uint256 out);

    constructor(CLPoolMock pool_) {
        pool = pool_;
    }

    function quoteExactInputSingle(ICLQuoterV2.QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        try pool.swap(address(this), true, int256(params.amountIn), 0, "") {}
        catch (bytes memory reason) {
            if (reason.length == 36 && bytes4(reason) == Quoted.selector) {
                assembly ("memory-safe") {
                    amountOut := mload(add(reason, 36))
                }
            }
        }
        require(amountOut != 0, "quote failed");
        return (amountOut, 2 ** 96, 1, 100_000);
    }

    function uniswapV3SwapCallback(int256, int256 amount1Delta, bytes calldata) external pure {
        revert Quoted(uint256(-amount1Delta));
    }
}

/// @notice CollSurplusPool + BorrowerOperationsSignatures stand-in for `comeBack`: pays the borrower's surplus to the
/// recipient with a plain `call{value}` (as the verified CollSurplusPool does).
contract MockBosSurplus {
    mapping(address borrower => uint256) public surplus;

    receive() external payable {}

    function setSurplus(address borrower, uint256 amount) external {
        surplus[borrower] = amount;
    }

    function claimCollateralWithSignature(address borrower, address recipient, bytes calldata, uint256) external {
        uint256 amount = surplus[borrower];
        surplus[borrower] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "send");
    }

    function getCollateral(address borrower) external view returns (uint256) {
        return surplus[borrower];
    }
}

/// @notice A direct M1 supplier that, inside one transaction, repeatedly withdraws its own M1 supply, calls the
/// permissionless `rebalance()` (which sees a buffer deficit and tops M1 up from vMUSD's wsMUSD leg, ignoring the
/// same-block guard and the cooldown) and supplies the MUSD back. Nothing is borrowed and nothing is paid.
contract TransientWithdrawLooper {
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

    function supply(uint256 assets) external {
        MORPHO.supply(params, assets, 0, address(this), "");
    }

    /// @return moved MUSD vMUSD moved into M1 across all rounds.
    /// @return calls Number of buffer top-ups triggered.
    function attack(uint256 rounds) external returns (uint256 moved, uint256 calls) {
        for (uint256 i; i < rounds; ++i) {
            uint256 out = _withdrawAll();
            (IBaserateAllocator.Action planned,,) = ALLOCATOR.previewRebalance();
            if (planned != IBaserateAllocator.Action.BUFFER_TOP_UP) {
                MORPHO.supply(params, out, 0, address(this), "");
                break;
            }
            (, uint256 amount) = ALLOCATOR.rebalance();
            MORPHO.supply(params, out, 0, address(this), "");
            moved += amount;
            ++calls;
        }
    }

    /// @notice Withdraws its supply, records an allocator checkpoint on the depressed M1 liquidity, re-supplies.
    function poisonCheckpoint() external returns (bool recorded) {
        uint256 out = _withdrawAll();
        recorded = ALLOCATOR.checkpoint();
        MORPHO.supply(params, out, 0, address(this), "");
    }

    /// @dev Withdraws as much of its own supply as M1's liquidity allows.
    function _withdrawAll() internal returns (uint256 out) {
        MORPHO.accrueInterest(params);
        Id id = Id.wrap(keccak256(abi.encode(params)));
        Market memory m = MORPHO.market(id);
        uint256 shares = MORPHO.position(id, address(this)).supplyShares;
        uint256 mine = shares * (uint256(m.totalSupplyAssets) + 1) / (uint256(m.totalSupplyShares) + 1e6);
        uint256 liquidity = m.totalSupplyAssets - m.totalBorrowAssets;
        if (mine <= liquidity) (out,) = MORPHO.withdraw(params, 0, shares, address(this), address(this));
        else (out,) = MORPHO.withdraw(params, liquidity, 0, address(this), address(this));
    }

    function positionAssets() external view returns (uint256) {
        Id id = Id.wrap(keccak256(abi.encode(params)));
        Market memory m = MORPHO.market(id);
        uint256 shares = MORPHO.position(id, address(this)).supplyShares;
        return shares * (uint256(m.totalSupplyAssets) + 1) / (uint256(m.totalSupplyShares) + 1e6);
    }
}

/// @notice Flash-loan sandwich of the permissionless `FeeRouter.distribute()`: borrow MUSD from Morpho (free flash
/// loan), deposit it in sMUSD, trigger the 40% sMUSD donation, withdraw (sMUSD auto-claims the yield), repay.
contract FeeSandwich {
    address internal immutable MORPHO;
    address internal immutable SMUSD;
    address internal immutable ROUTER;
    IERC20 internal immutable MUSD;

    constructor(address morpho, address smusd, address router, address musd) {
        MORPHO = morpho;
        SMUSD = smusd;
        ROUTER = router;
        MUSD = IERC20(musd);
    }

    function attack(uint256 amount) external returns (uint256 profit) {
        IMorphoFlash(MORPHO).flashLoan(address(MUSD), amount, "");
        profit = MUSD.balanceOf(address(this));
        MUSD.transfer(msg.sender, profit);
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata) external {
        require(msg.sender == MORPHO, "morpho");
        MUSD.approve(SMUSD, assets);
        ISMUSDLike(SMUSD).deposit(assets);
        IFeeRouterLike(ROUTER).distribute();
        ISMUSDLike(SMUSD).withdraw(assets);
        MUSD.approve(MORPHO, assets);
    }
}

interface IMorphoFlash {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

interface ISMUSDLike {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
}

interface IFeeRouterLike {
    function distribute() external;
}
