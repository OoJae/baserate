// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";

import {DeployLiquidation} from "../../script/DeployLiquidation.s.sol";
import {CollateralBTC} from "../../src/collateral/CollateralBTC.sol";
import {ICLSwapRouter} from "../../src/interfaces/external/ICLSwapRouter.sol";
import {Venue} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {FlashLiquidator} from "../../src/liquidation/FlashLiquidator.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";

/// @notice Minimal stand-in for BorrowAccountFactory as seen by CollateralBTC: it deploys bcBTC (so `FACTORY` is this
/// contract) and answers `isAccount` from a test-controlled allow-list. Lets the audit suite run the real bcBTC gate,
/// the real Morpho Blue and the real FlashLiquidator/Backstop locally, without the factory's MUSD/BOS wiring.
contract AuditAccountRegistry {
    CollateralBTC public immutable collateral;
    mapping(address => bool) public isAccount;

    constructor(address morpho) {
        collateral = new CollateralBTC(morpho);
    }

    function setAccount(address account, bool on) external {
        isAccount[account] = on;
    }
}

/// @notice A liquidation bot contract that, like most MEV/keeper bot contracts, has no `receive`/`fallback`: it only
/// wants the MUSD profit.
contract NoReceiveKeeper {
    function liquidate(FlashLiquidator liq, address borrower, Venue venue) external returns (uint256 profit) {
        (,, profit) = liq.liquidate(borrower, 0, venue, 0);
    }
}

/// @notice Local stand-in for Tigris's CLSwapRouter (BtcPrecompileMock etched at the BTC precompile), reproducing the
/// paths of the verified router that matter to the sellers: `pay()` uses the router's own native BTC when it covers
/// the amount and otherwise pulls the seller's BTC with `transferFrom`; every swap ends with `refundBTC()`, a plain
/// call sending all native BTC the router holds to the caller. `fillBps` makes the pool take only part of the order
/// (a partial fill). The pool pays the full order at the oracle price whatever it takes, so the sellers' floors pass
/// and the tests isolate the native-BTC and allowance handling.
contract MockCLRouter {
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    /// @dev Where the "pool" keeps the BTC it takes.
    address internal constant POOL = address(0xC1200);

    MockMUSD internal immutable MUSD;
    IOracle internal immutable ORACLE;

    /// @notice Share of `amountIn` the pool takes, in bps.
    uint256 public fillBps = 10_000;

    constructor(MockMUSD musd, IOracle oracle) {
        MUSD = musd;
        ORACLE = oracle;
    }

    receive() external payable {}

    function setFillBps(uint256 bps) external {
        fillBps = bps;
    }

    function exactInputSingle(ICLSwapRouter.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        uint256 taken = p.amountIn * fillBps / 10_000;
        if (address(this).balance >= taken) {
            (bool paid,) = POOL.call{value: taken}("");
            require(paid, "pool");
        } else {
            IERC20(BTC).transferFrom(msg.sender, POOL, taken);
        }
        amountOut = p.amountIn * ORACLE.price() / 1e36;
        MUSD.mint(p.recipient, amountOut);
        uint256 refund = address(this).balance;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refundBTC");
        }
    }
}

/// @notice Exposes DeployLiquidation's sentinel selection and its mandatory backstop seed.
contract DeployLiquidationHarness is DeployLiquidation {
    function sentinelFor(address deployer) external view returns (address) {
        return _sentinel(deployer);
    }

    /// @dev The selection rule with the `SENTINEL` env passed in, so tests never have to set (and leak) it.
    function pickSentinel(uint256 chainId, address deployer, bool set, address fromEnv)
        external
        pure
        returns (address)
    {
        return _pickSentinel(chainId, deployer, set, fromEnv);
    }

    function requireSeedFunds(address musd, address deployer) external view {
        _requireSeedFunds(musd, deployer);
    }

    /// @dev Seeds from this contract's own MUSD (it plays the broadcaster).
    function seed(Backstop backstop, address musd) external {
        _seed(backstop, musd);
    }
}
