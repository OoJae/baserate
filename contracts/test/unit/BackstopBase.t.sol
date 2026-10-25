// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {ILiquidationVenues} from "../../src/interfaces/ILiquidationVenues.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";
import {WsMUSD} from "../../src/savings/WsMUSD.sol";
import {MockMorphoOracle} from "../utils/MockMorphoOracle.sol";
import {MockMUSD} from "../utils/MockMUSD.sol";
import {SMUSDMock} from "../utils/SMUSDMock.sol";

/// @notice Local stack for the Backstop unit and invariant suites: MockMUSD, SMUSDMock, a real wsMUSD, a settable M1
/// oracle and a Backstop at LLTV 0.86 with no DEX venues (DEX sales are covered on the mainnet fork). The test
/// contract plays the FlashLiquidator through `liquidator`.
abstract contract BackstopBase is Test {
    uint256 internal constant LLTV = 0.86e18;
    uint256 internal constant SEED = 1e18;
    uint256 internal constant PRICE = 80_000e18 * 1e18; // 80,000 MUSD per BTC at Morpho's 1e36 scale
    uint256 internal constant WAD = 1e18;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockMUSD internal musd;
    SMUSDMock internal smusd;
    WsMUSD internal ws;
    MockMorphoOracle internal oracle;
    Backstop internal backstop;

    address internal liquidator = makeAddr("liquidator");
    address internal sentinel = makeAddr("sentinel");
    address internal capAdmin = makeAddr("capAdmin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");
    address internal taker = makeAddr("taker");

    function setUp() public virtual {
        vm.warp(1_792_942_983);
        musd = new MockMUSD();
        smusd = new SMUSDMock(address(musd));
        ws = new WsMUSD(address(musd), address(smusd), capAdmin, 250_000e18);
        oracle = new MockMorphoOracle(PRICE);
        backstop = new Backstop(_params(LLTV));
        vm.label(address(backstop), "Backstop");
        vm.label(address(ws), "wsMUSD");
        // Deploy-script seed: dead shares.
        _deposit(makeAddr("seeder"), SEED, DEAD);
    }

    function _params(uint256 lltv) internal view returns (IBackstop.BackstopParams memory) {
        return IBackstop.BackstopParams({
            musd: address(musd),
            wsMusd: address(ws),
            oracle: address(oracle),
            lltv: lltv,
            liquidator: liquidator,
            sentinel: sentinel,
            maxKeeperSale: 0.05e18,
            venues: ILiquidationVenues.VenueConfig(address(0), address(0), address(0), address(0))
        });
    }

    // ---------------------------------------------------------------- helpers

    function _deposit(address who, uint256 assets, address receiver) internal returns (uint256 shares) {
        musd.mint(who, assets);
        vm.startPrank(who);
        musd.approve(address(backstop), assets);
        shares = backstop.deposit(assets, receiver);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 assets) internal returns (uint256) {
        return _deposit(who, assets, who);
    }

    /// @dev The liquidator sells `btc` to the backstop.
    function _buy(uint256 btc) internal returns (uint256 paid) {
        vm.deal(liquidator, liquidator.balance + btc);
        vm.prank(liquidator);
        paid = backstop.buyCollateral{value: btc}(0);
    }

    function _take(uint256 btc) internal returns (uint256 paid) {
        uint256 cost = backstop.quoteAuction(btc);
        musd.mint(taker, cost);
        vm.startPrank(taker);
        musd.approve(address(backstop), cost);
        paid = backstop.takeAuction(btc, cost, taker);
        vm.stopPrank();
    }

    function _request(address who, uint256 shares) internal returns (uint256 id) {
        vm.prank(who);
        id = backstop.requestRedeem(shares, who, who);
    }

    function _pps() internal view returns (uint256) {
        return backstop.convertToAssets(1e18);
    }

    function _setPrice(uint256 price) internal {
        oracle.setPrice(price);
    }

    function _book() internal view returns (uint256 book) {
        (book,,,) = backstop.vestingState();
    }

    function _unvested() internal view returns (uint256 unvested) {
        (, unvested,,) = backstop.vestingState();
    }
}
