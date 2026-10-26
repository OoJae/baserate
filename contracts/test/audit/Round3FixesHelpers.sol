// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IBackstop} from "../../src/interfaces/IBackstop.sol";
import {Backstop} from "../../src/liquidation/Backstop.sol";

/// @notice Plays the deployment account of `DeployLiquidation`: its CREATE addresses follow from its nonce, exactly as
/// the deployer EOA's do (a contract's first CREATE uses nonce 1).
contract R3FixBackstopDeployer {
    function deploy(IBackstop.BackstopParams memory p) external returns (Backstop) {
        return new Backstop(p);
    }
}
