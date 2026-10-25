// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

// Compiles the pinned morpho-org/vault-v2 contracts (tag 2026-08-13) so scripts and tests can deploy them from their
// artifacts with `vm.getCode`, without our own sources having to be built with via-IR.
// forge-lint: disable-start(unused-import)
import {VaultV2Factory} from "vault-v2/VaultV2Factory.sol";
import {VaultV2} from "vault-v2/VaultV2.sol";
import {MorphoMarketV1AdapterV2} from "vault-v2/adapters/MorphoMarketV1AdapterV2.sol";
// forge-lint: disable-end(unused-import)
