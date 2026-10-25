// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

import {BorrowAccountFactory} from "../../src/account/BorrowAccountFactory.sol";
import {IBorrowAccountFactory} from "../../src/interfaces/IBorrowAccountFactory.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";

/// @notice Audit area D helper: the real M1 stack locally (Morpho Blue + AdaptiveCurveIrm from their artifacts, the
/// real BorrowAccountFactory / BorrowAccount / CollateralBTC, a settable Morpho oracle and MockMUSD), with the
/// testnet parameters from `script/Deploy.s.sol` (LLTV 0.77, STANDARD 0.01 BTC / 6200 bps, CANARY 0.002 BTC /
/// 7675 bps, global cap 5,000 MUSD).
abstract contract LocalM1Stack is Test {
    uint256 internal constant LLTV = 0.77e18;
    /// @dev 80,000 MUSD per BTC at Morpho's 1e36 scale (both tokens have 18 decimals).
    uint256 internal constant P0 = 80_000e36;

    MockMUSD internal musd;
    MockMorphoOracle internal oracle;
    IMorpho internal morpho;
    address internal irm;
    BorrowAccountFactory internal factory;
    MarketParams internal params;

    address internal governor = makeAddr("governor");
    address internal sentinel = makeAddr("sentinel");
    address internal feeTo = makeAddr("feeRecipient");
    address internal morphoOwner = makeAddr("morphoOwner");
    address internal lp = makeAddr("lp");

    function _deployM1() internal {
        musd = new MockMUSD();
        oracle = new MockMorphoOracle(P0);
        morpho = IMorpho(_deployArtifact("Morpho.sol", "Morpho", abi.encode(morphoOwner)));
        irm = _deployArtifact("AdaptiveCurveIrm.sol", "AdaptiveCurveIrm", abi.encode(address(morpho)));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        vm.stopPrank();

        factory = new BorrowAccountFactory(
            IBorrowAccountFactory.FactoryParams({
                morpho: address(morpho),
                musd: address(musd),
                oracle: address(oracle),
                irm: irm,
                lltv: LLTV,
                bos: address(0),
                collSurplusPool: address(0),
                governor: governor,
                sentinel: sentinel,
                feeRecipient: feeTo,
                globalBorrowCap: 5000e18,
                standard: IBorrowAccountFactory.Limits({positionCap: 0.01e18, ceilingBps: 6200}),
                canary: IBorrowAccountFactory.Limits({positionCap: 0.002e18, ceilingBps: 7675})
            })
        );
        params = factory.marketParams();
        morpho.createMarket(params);

        musd.mint(lp, 100_000e18);
        vm.startPrank(lp);
        musd.approve(address(morpho), type(uint256).max);
        morpho.supply(params, 100_000e18, 0, lp, "");
        vm.stopPrank();
    }

    /// @dev Deploys a 0.8.19 Morpho artifact. `fs_permissions` only allows reading `./out`, so with an isolated
    /// `FOUNDRY_OUT` the `File.sol:Name` lookup is refused; fall back to the artifact in `./out` (Morpho Blue and the
    /// IRM are pinned dependencies, so their bytecode does not depend on which build produced it).
    function _deployArtifact(string memory file, string memory name, bytes memory args)
        internal
        returns (address deployed)
    {
        bytes memory code;
        try vm.getCode(string.concat(file, ":", name)) returns (bytes memory c) {
            code = c;
        } catch {
            code = vm.getCode(string.concat("out/", file, "/", name, ".json"));
        }
        bytes memory initCode = abi.encodePacked(code, args);
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0), "deploy failed");
    }

    /// @dev `who` opens a STANDARD position through the factory with `btc` collateral and `musdOut` borrowed.
    function _open(address who, uint256 btc, uint256 musdOut, uint256 maxLtvBps) internal returns (address account) {
        vm.deal(who, who.balance + btc);
        vm.prank(who);
        account = factory.openAndBorrow{value: btc}(musdOut, maxLtvBps);
    }
}
