// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {Id, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {ISlipstreamQuoterV2, ITigrisRouter} from "../../src/interfaces/external/ITigrisDex.sol";

/// @notice Morpho stand-in exposing only `market(Id)`, which is all RiskLens and `expectedMarketBalances` read.
contract MockMorphoMarkets {
    mapping(Id => Market) internal _markets;

    function setMarket(Id id, Market memory m) external {
        _markets[id] = m;
    }

    function market(Id id) external view returns (Market memory) {
        return _markets[id];
    }
}

/// @notice IRM stand-in with a constant per-second borrow rate.
contract MockIrm {
    uint256 public rate;

    constructor(uint256 rate_) {
        rate = rate_;
    }

    function borrowRateView(MarketParams memory, Market memory) external view returns (uint256) {
        return rate;
    }
}

/// @notice ERC-20 with configurable decimals (a USD stablecoin such as mUSDC).
contract MockToken is ERC20 {
    uint8 internal immutable _decimals;

    constructor(string memory symbol_, uint8 decimals_) ERC20(symbol_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Plain ERC-4626 vault, used as wsMUSD and as a vault-shaped backstop.
contract MockVault is ERC4626 {
    constructor(address asset_) ERC20("Vault", "VLT") ERC4626(IERC20(asset_)) {}
}

/// @notice Constant-product BTC -> MUSD curve shared by the quoter and router mocks (no fee).
abstract contract CurveMock {
    uint256 public reserveBtc;
    uint256 public reserveMusd;

    function setReserves(uint256 btc, uint256 musd) external {
        reserveBtc = btc;
        reserveMusd = musd;
    }

    function _out(uint256 btcIn) internal view returns (uint256) {
        return btcIn * reserveMusd / (reserveBtc + btcIn);
    }
}

/// @notice Slipstream QuoterV2 stand-in. Like the real one it is not `view` and needs a CALL context: it writes
/// storage before answering, so a STATICCALL reverts.
contract MockQuoter is CurveMock {
    /// @dev TickMath.MIN_SQRT_RATIO + 1: where a zeroForOne quote without a price limit stops when liquidity ends.
    uint160 internal constant LIMIT = 4_295_128_740;

    uint256 public calls;
    bool public reverting;
    /// @notice Inputs above this exhaust the in-range liquidity (a partial fill, as on mainnet CL200).
    uint256 public exhaustAbove = type(uint256).max;

    function setReverting(bool value) external {
        reverting = value;
    }

    function setExhaustAbove(uint256 amountIn) external {
        exhaustAbove = amountIn;
    }

    function quoteExactInputSingle(ISlipstreamQuoterV2.QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        calls++;
        require(!reverting, "SPL");
        if (params.amountIn > exhaustAbove) return (_out(exhaustAbove), LIMIT, 9, 400_000);
        return (_out(params.amountIn), 2 ** 96, 1, 100_000);
    }
}

/// @notice Tigris Router stand-in: `getAmountsOut` on the configured curve for a BTC -> MUSD route.
contract MockRouter is CurveMock {
    function getAmountsOut(uint256 amountIn, ITigrisRouter.Route[] memory routes)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        amounts[1] = _out(amountIn);
    }
}

/// @notice Slipstream pool stand-in for the MUSD price pool: settable `slot0` price and a constant TWAP tick.
contract MockSlipstreamPool {
    address public token0;
    address public token1;
    uint160 public sqrtPriceX96;
    int24 public avgTick;
    bool public fixedCumulatives;
    int56 public cumulativeOld;
    int56 public cumulativeNow;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function set(uint160 sqrtPriceX96_, int24 avgTick_) external {
        sqrtPriceX96 = sqrtPriceX96_;
        avgTick = avgTick_;
    }

    /// @dev Makes `observe` return exactly (old, now) for a two-point query, to test TWAP rounding.
    function setCumulatives(int56 old, int56 now_) external {
        fixedCumulatives = true;
        cumulativeOld = old;
        cumulativeNow = now_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, bool) {
        return (sqrtPriceX96, avgTick, 0, 1, 1, true);
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cums, uint160[] memory spl) {
        cums = new int56[](secondsAgos.length);
        spl = new uint160[](secondsAgos.length);
        if (fixedCumulatives) {
            (cums[0], cums[1]) = (cumulativeOld, cumulativeNow);
            return (cums, spl);
        }
        for (uint256 i; i < secondsAgos.length; ++i) {
            cums[i] = int56(avgTick) * int56(uint56(block.timestamp - secondsAgos[i]));
        }
    }
}

/// @notice MUSD SortedTroves + TroveManager stand-in. `order` is descending NICR (index 0 = highest NICR), so
/// `getLast()` is the next redemption target, as in Liquity.
contract MockTroves {
    struct T {
        uint256 coll;
        uint256 principal;
        uint256 interest;
    }

    address[] public order;
    mapping(address => T) public troves;
    mapping(address => uint256) internal _index;

    function push(address borrower, uint256 coll, uint256 principal, uint256 interest) external {
        order.push(borrower);
        _index[borrower] = order.length - 1;
        troves[borrower] = T(coll, principal, interest);
    }

    // SortedTroves
    function getSize() external view returns (uint256) {
        return order.length;
    }

    function getLast() external view returns (address) {
        return order.length == 0 ? address(0) : order[order.length - 1];
    }

    function getFirst() external view returns (address) {
        return order.length == 0 ? address(0) : order[0];
    }

    function getPrev(address id) external view returns (address) {
        uint256 i = _index[id];
        return i == 0 ? address(0) : order[i - 1];
    }

    function getNext(address id) external view returns (address) {
        uint256 i = _index[id];
        return i + 1 >= order.length ? address(0) : order[i + 1];
    }

    // TroveManager
    function getNominalICR(address b) external view returns (uint256) {
        T memory t = troves[b];
        return t.principal == 0 ? type(uint256).max : t.coll * 1e20 / t.principal;
    }

    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        T memory t = troves[b];
        return t.coll * price / (t.principal + t.interest);
    }

    function getTCR(uint256 price) external view returns (uint256) {
        uint256 coll;
        uint256 debt;
        for (uint256 i; i < order.length; ++i) {
            T memory t = troves[order[i]];
            coll += t.coll;
            debt += t.principal + t.interest;
        }
        return debt == 0 ? type(uint256).max : coll * price / debt;
    }

    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        T memory t = troves[b];
        return (t.coll, t.principal, t.interest, 0, 0, 0);
    }
}
