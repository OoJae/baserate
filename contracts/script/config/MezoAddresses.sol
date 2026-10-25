// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice External Mezo contracts Baserate integrates with, per network.
/// @dev Addresses verified on-chain on 2026-10-24/25. Docs-listed v1 veBTC/Voter and the docs Pyth address are stale
/// and deliberately absent.
struct MezoNetwork {
    uint256 chainId;
    // MUSD system
    address musd;
    address smusd;
    address pcv;
    address borrowerOperations;
    address borrowerOperationsSignatures;
    address troveManager;
    address sortedTroves;
    address priceFeed;
    address collSurplusPool;
    // Morpho Blue (Mezo's official deployment per network)
    address morpho;
    address irm;
    uint256 lltv;
    // Oracles
    address pyth;
    // Tigris pools (basic Router uses Route[]{from,to,stable,factory})
    address router;
    address poolFactory;
    address btcMusdVolatilePool;
}

library MezoAddresses {
    /// @dev Precompiles live in the Go node: they exist on the live chains but hang in anvil forks, so tests etch mocks.
    address internal constant SKIP_BTC_USD = 0x7b7c000000000000000000000000000000000015;
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    address internal constant MEZO = 0x7B7c000000000000000000000000000000000001;

    bytes32 internal constant PYTH_BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    bytes32 internal constant PYTH_MUSD_USD = 0x0617a9b725011a126a2b9fd53563f4236501f32cf76d877644b943394606c6de;

    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;

    uint256 internal constant TESTNET_CHAIN_ID = 31_611;
    uint256 internal constant MAINNET_CHAIN_ID = 31_612;

    function testnet() internal pure returns (MezoNetwork memory n) {
        n.chainId = TESTNET_CHAIN_ID;
        n.musd = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
        n.smusd = 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16;
        n.pcv = 0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af;
        n.borrowerOperations = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
        n.borrowerOperationsSignatures = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
        n.troveManager = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
        n.sortedTroves = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
        n.priceFeed = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
        n.collSurplusPool = 0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9;
        n.morpho = 0xCe1da828cA15cb1FDAfa84C366A53C8106655a73;
        n.irm = 0x0c97Fe017628636649ff374aD499529F91167441;
        n.lltv = 0.77e18;
        n.pyth = 0x933aDeC2C7624b11E4B2b80ACE15BF9a71a31315;
        n.router = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
        n.poolFactory = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
        n.btcMusdVolatilePool = 0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9;
    }

    function mainnet() internal pure returns (MezoNetwork memory n) {
        n.chainId = MAINNET_CHAIN_ID;
        n.musd = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
        n.smusd = 0xb4D498029af77680cD1eF828b967f010d06C51CC;
        n.pcv = 0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993;
        n.borrowerOperations = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
        n.borrowerOperationsSignatures = 0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a;
        n.troveManager = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
        n.sortedTroves = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;
        n.priceFeed = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;
        n.collSurplusPool = 0xBF51807ACb3394B8550f0554FB9098856Ef5F491;
        n.morpho = 0x565834cE7E40b8987BC20EbF83E2159467bDA311;
        n.irm = 0x3760Ebc636F912a4dB9540fdA4Dec09C25C6C1e7;
        n.lltv = 0.86e18;
        n.pyth = 0x5D289Ad1CE59fCC25b6892e7A303dfFf3a9f7167;
        n.router = 0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706;
        n.poolFactory = 0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248;
        n.btcMusdVolatilePool = 0x52e604c44417233b6CcEDDDc0d640A405Caacefb;
    }

    function forChain(uint256 chainId) internal pure returns (MezoNetwork memory) {
        if (chainId == TESTNET_CHAIN_ID) return testnet();
        if (chainId == MAINNET_CHAIN_ID) return mainnet();
        revert("MezoAddresses: unsupported chain");
    }
}
