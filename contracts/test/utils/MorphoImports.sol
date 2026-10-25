// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.19;

// Compiles Morpho Blue and the AdaptiveCurveIrm (solc 0.8.19) for the local Vault V2 suites, which deploy them from
// their artifacts with `deployCode`.
// forge-lint: disable-start(unused-import)
import {Morpho} from "morpho-blue/Morpho.sol";
import {AdaptiveCurveIrm} from "morpho-blue-irm/adaptive-curve-irm/AdaptiveCurveIrm.sol";
// forge-lint: disable-end(unused-import)
