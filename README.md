# Baserate

**Borrow MUSD against your BTC without the redemption queue, on Mezo's own Morpho Blue.**

[Live app](https://baserate-mezo.vercel.app) · [On-chain evidence](https://baserate-mezo.vercel.app/evidence) · [Judge guide](docs/JUDGES.md) · [Security](docs/SECURITY.md) · [Built vs planned](docs/BUILT_VS_PLANNED.md)

Baserate is a lending layer for MUSD. You post BTC and borrow MUSD in one transaction from a market on Mezo's official Morpho Blue deployment. Morpho loans have no redemption queue, no 2,000-MUSD minimum and no capacity lock. Around that market:

- **wsMUSD** is the first ERC-4626 wrapper over Mezo's claim-based sMUSD.
- **vMUSD** is a Morpho Vault V2 (created through Mezo's own VaultV2Factory) that lends MUSD into the market and parks the rest in wsMUSD.
- **FlashLiquidator** and the **Backstop** (bMUSD) liquidate unhealthy loans with no capital up front.
- **FeeRouter** sends protocol fees to sMUSD holders and to veBTC voters as gauge bribes.
- **RiskLens** puts the whole risk picture in one call.
- A **keeper** on Railway runs the permissionless upkeep.

## Why it matters

| | Today | With Baserate |
|---|---|---|
| Retail MUSD borrowers | Mainnet troves fell from **104 to 1** as MUSD traded at ~$0.989, below the ~$0.9925 redemption floor. Every new trove is first in line to be redeemed | Loans sit in a Morpho market. Nobody can repay your debt at par and take your BTC |
| Smallest loan | 2,000 MUSD (≈0.027 BTC) | Any size; one faucet drip (0.001 BTC) borrows ~30 MUSD |
| Lending MUSD | Nothing lends MUSD on Mezo; Morpho holds 0 MUSD | vMUSD lends into the BTC→MUSD market and earns sMUSD yield on the idle part |
| sMUSD | Not ERC-4626, so nothing can use it as collateral or a vault floor | wsMUSD: ERC-4626, auto-harvesting, sandwich-resistant |
| Fees | Mezo Earn's voter payout is funded from a shrinking backlog | 40% of Baserate fees to sMUSD yield, 40% as MUSD bribes for veBTC voters, 20% treasury |

## How it works

```
judge wallet ── openAndBorrow{value: BTC} ──▶ BorrowAccountFactory
                                               └─ BorrowAccount (EIP-1167 clone, owner-only)
                                                    ├─ wraps BTC 1:1 → bcBTC (gated receipt)
                                                    ├─ Morpho.supplyCollateral(M1)
                                                    └─ Morpho.borrow(M1) → MUSD to the owner
M1 = Morpho Blue market { loan: MUSD, collateral: bcBTC, oracle: BtcMusdOracle, irm: AdaptiveCurveIrm, lltv: 0.77 }
BtcMusdOracle = Skip BTC/USD precompile (≤60 s) + Pyth ±10% band + MUSD leg clamped to [1.00, 1.02]

lender ── deposit MUSD ──▶ vMUSD (Morpho Vault V2)
                            ├─ WsMusdLiquidityAdapter → wsMUSD → sMUSD   (idle cash earns Mezo Earn yield)
                            └─ MorphoMarketV1AdapterV2 → M1               (BaserateAllocator keeps a ≥2,000 MUSD buffer)

keeper / anyone ── FlashLiquidator.liquidate ──▶ Morpho.liquidate(M1) → unwrap bcBTC → sell BTC
                                                                         ├─ Tigris vAMM (Route[])
                                                                         └─ Backstop (bMUSD) at oracle × (1 − incentive/2)

origination fees ──▶ FeeRouter.distribute ──▶ 40% sMUSD.receiveProtocolYield · 40% bribe on the BTC/MUSD gauge · 20% treasury
```

- **Market-wide limits.** All collateral must enter as bcBTC, which only registered accounts can mint, so per-position caps, LTV ceilings and the global cap bind the whole market, not just our UI.
- **Oracle-free exit.** `repayAndWithdraw` repays exact debt by shares and withdraws collateral without reading the oracle. It works even if the oracle is down.
- **Exits never pause.** The sentinel can stop new borrowing, never repay, withdraw, top-up, unwrap or liquidation.
- **Permissionless upkeep.** Rebalancing, liquidation and fee distribution can be called by anyone. Our keeper does it on a schedule; [its status is public](https://keeper-production-be8a.up.railway.app/status).

## Live on Mezo testnet (chain 31611)

The audited stack (v2: every round-1 and round-2 fix in [`docs/audit/FINDINGS.md`](docs/audit/FINDINGS.md)) went live on 26 Oct 2026. All 14 contracts are verified on Sourcify (exact match).

| Contract | Address | Source |
|---|---|---|
| BorrowAccountFactory | [`0x0EF62F97130fe4D1D22DE4ACc4163154F82890b1`](https://explorer.test.mezo.org/address/0x0EF62F97130fe4D1D22DE4ACc4163154F82890b1) | [Sourcify](https://repo.sourcify.dev/31611/0x0EF62F97130fe4D1D22DE4ACc4163154F82890b1) |
| BorrowAccount (implementation) | [`0x9C2E498b1FC0dD332eC6A26E4B00d2e713f3D7d0`](https://explorer.test.mezo.org/address/0x9C2E498b1FC0dD332eC6A26E4B00d2e713f3D7d0) | [Sourcify](https://repo.sourcify.dev/31611/0x9C2E498b1FC0dD332eC6A26E4B00d2e713f3D7d0) |
| CollateralBTC (bcBTC) | [`0x55407a4522338F035f4CE3895c826143501c8a7E`](https://explorer.test.mezo.org/address/0x55407a4522338F035f4CE3895c826143501c8a7E) | [Sourcify](https://repo.sourcify.dev/31611/0x55407a4522338F035f4CE3895c826143501c8a7E) |
| BtcMusdOracle | [`0x83d21Ee5F5eC7D5Ba4b212Ed313244dDaa9608aF`](https://explorer.test.mezo.org/address/0x83d21Ee5F5eC7D5Ba4b212Ed313244dDaa9608aF) | [Sourcify](https://repo.sourcify.dev/31611/0x83d21Ee5F5eC7D5Ba4b212Ed313244dDaa9608aF) |
| WsMUSD | [`0xDAfcB2cD3E722f6FeE7F70150be612F1d7af8124`](https://explorer.test.mezo.org/address/0xDAfcB2cD3E722f6FeE7F70150be612F1d7af8124) | [Sourcify](https://repo.sourcify.dev/31611/0xDAfcB2cD3E722f6FeE7F70150be612F1d7af8124) |
| MusdDispenser (judge top-ups) | [`0x08d7e3158D8c687f73c06B250AACe773d800CE69`](https://explorer.test.mezo.org/address/0x08d7e3158D8c687f73c06B250AACe773d800CE69) | [Sourcify](https://repo.sourcify.dev/31611/0x08d7e3158D8c687f73c06B250AACe773d800CE69) |
| vMUSD (Morpho Vault V2) | [`0x76A62fFEFb0b9A5980750Fb106Df05cEff6b941a`](https://explorer.test.mezo.org/address/0x76A62fFEFb0b9A5980750Fb106Df05cEff6b941a) | [Sourcify](https://repo.sourcify.dev/31611/0x76A62fFEFb0b9A5980750Fb106Df05cEff6b941a) |
| WsMusdLiquidityAdapter | [`0x9897b43c83B3DCC6f574b19ce39Ef85aBf1Dfc29`](https://explorer.test.mezo.org/address/0x9897b43c83B3DCC6f574b19ce39Ef85aBf1Dfc29) | [Sourcify](https://repo.sourcify.dev/31611/0x9897b43c83B3DCC6f574b19ce39Ef85aBf1Dfc29) |
| BaserateAllocator | [`0x8B1314D983973342DA53A6E30CD5586d5D92d20f`](https://explorer.test.mezo.org/address/0x8B1314D983973342DA53A6E30CD5586d5D92d20f) | [Sourcify](https://repo.sourcify.dev/31611/0x8B1314D983973342DA53A6E30CD5586d5D92d20f) |
| FlashLiquidator | [`0x291868F26639bc619BaC1e87B7a19EE84988E973`](https://explorer.test.mezo.org/address/0x291868F26639bc619BaC1e87B7a19EE84988E973) | [Sourcify](https://repo.sourcify.dev/31611/0x291868F26639bc619BaC1e87B7a19EE84988E973) |
| Backstop (bMUSD) | [`0x64fE4CC966E55A0081913A8Bf72A22b007946C2B`](https://explorer.test.mezo.org/address/0x64fE4CC966E55A0081913A8Bf72A22b007946C2B) | [Sourcify](https://repo.sourcify.dev/31611/0x64fE4CC966E55A0081913A8Bf72A22b007946C2B) |
| FeeRouter | [`0x2de420D13d808aEBA11AB743abe630D0dD48C13B`](https://explorer.test.mezo.org/address/0x2de420D13d808aEBA11AB743abe630D0dD48C13B) | [Sourcify](https://repo.sourcify.dev/31611/0x2de420D13d808aEBA11AB743abe630D0dD48C13B) |
| RiskLens | [`0x21aEB70C84E69c69b7F154CE6B06DdF6744266FF`](https://explorer.test.mezo.org/address/0x21aEB70C84E69c69b7F154CE6B06DdF6744266FF) | [Sourcify](https://repo.sourcify.dev/31611/0x21aEB70C84E69c69b7F154CE6B06DdF6744266FF) |
| MorphoMarketV1AdapterV2 (vMUSD → M1, Morpho's audited adapter) | [`0xD0E612460e35C646F7617A24ABEB84a842BEb61B`](https://explorer.test.mezo.org/address/0xD0E612460e35C646F7617A24ABEB84a842BEb61B) | [Sourcify](https://repo.sourcify.dev/31611/0xD0E612460e35C646F7617A24ABEB84a842BEb61B) |
| Market M1 on Mezo's Morpho Blue [`0xCe1d…5a73`](https://explorer.test.mezo.org/address/0xCe1da828cA15cb1FDAfa84C366A53C8106655a73) | id `0xa8c1e3b34cb6f3b84f0b20e69af435f315330f47a06422fb7593e4422467bb74` | |

Key transactions:

- **Borrow:** [market created](https://explorer.test.mezo.org/tx/0xb6f354953c43a957fc342c28b46cc0a6478c45a526f52945f85968b969dcdd2d) · [M1 seeded with 1,000 MUSD](https://explorer.test.mezo.org/tx/0x5103582f9c36f6b67b03e28a3064bf993bd3710bdb50b39e09bd1287ed7c8600) · judge journey on the audited contracts: [one-transaction borrow](https://explorer.test.mezo.org/tx/0x9c1c879d7edf748e0a25444739a44451a3412dba7a9f937df362c7a28dae4057) · [one-transaction repay and exit](https://explorer.test.mezo.org/tx/0x2d6d2323ac85a428734d03b9edf76981699d6bd4975ee2f3905e04234b5f2804)
- **Lend:** [vMUSD created](https://explorer.test.mezo.org/tx/0xcc1e00cc6f5dc8bb83532c5d8099073afac6938b842375c481ef1a077caa3354) · [3,000 MUSD deposit](https://explorer.test.mezo.org/tx/0x75deb40f3d7fbb14704ef3674c7e1b5ce0b4a066d201a8d2cf6536ed734e1519) · [keeper's first rebalance into M1](https://explorer.test.mezo.org/tx/0xd72f5453e0c5dacaeac45f7ce6aefd0551bf878b8d885b875408448850ef71f4)
- **Liquidations:** [keeper liquidated its canary unattended at 77.26% LTV](https://explorer.test.mezo.org/tx/0x44fc007ad4cfca3c8d2bd6d2c1c721d3a9ca54f75f5d68aadc96e3b935a6f43a) and [re-armed it four minutes later](https://explorer.test.mezo.org/tx/0xe0e6c572e5cc9d923009f57bdf50b7d010cd5e5a4b6b21b2ee9674d5108f42ca) (v1 stack; the v2 canary grant matures on 28 Oct)
- **Fees:** [fee switch to FeeRouter v2 submitted to the 48-hour timelock](https://explorer.test.mezo.org/tx/0x12b3245a344a595fd223ced435e7b51e883266feed59b4dd6a764e1b653d86f9) · on v1, [the first distribution: 8 MUSD bribe, 8 MUSD to sMUSD, 4 MUSD treasury](https://explorer.test.mezo.org/tx/0x76fe18e5b6df88d0e7c081d9387882788941691a19a91a1f6c0dcf5b5f8b130a)

All 58 recorded transactions are re-checked live on the [Evidence page](https://baserate-mezo.vercel.app/evidence), with the first deployment's history under "v1 (pre-audit)". On testnet the deployer EOA is governor and the keeper's sentinel key is sentinel; mainnet uses a 2-of-3 Safe.

## Tests

```bash
cd contracts && forge test -j 1   # 754 tests: unit, fuzz, invariant, audit PoCs, Mezo mainnet + testnet forks
pnpm install && pnpm test         # SDK unit tests
pnpm --filter web build && pnpm check-bundle
pnpm --filter web e2e             # Playwright: the full judge journey with a real signing wallet
```

Mezo's precompiles (Skip BTC/USD, BTC, MEZO) run inside the Go node, so they hang in anvil forks. Fork tests etch a `SkipMock` seeded with the real price at the pinned block (and a `BtcPrecompileMock` for flows that move native BTC) and run everything else against the real MUSD, sMUSD, Pyth, Morpho Blue, Vault V2, AdaptiveCurveIrm, Tigris pools and gauges.

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry project: `src/{oracle,savings,collateral,account,periphery,vault,liquidation,fees,lens}`; tests in `test/{unit,fuzz,invariant,fork}`; deploy scripts in `script/` |
| `apps/web/` | Vite + React app: Borrow, Save, Lend, Liquidate, Risk, Fees, Evidence; Playwright e2e in `e2e/` |
| `apps/keeper/` | Keeper on Railway: allocator upkeep, liquidation scan, fee distribution; `/status` endpoint |
| `packages/sdk/` | `@baserate/sdk`: chains, ABIs generated from the contracts, Morpho math, MUSD permit |
| `packages/subgraph/` | `@baserate/subgraph`: The Graph subgraph (Goldsky, `mezo-testnet`) for accounts, M1 positions and liquidations, vault flows, allocator moves, backstop exits and fee distributions |
| `docs/` | Plan, design specs, research, security, judge guide |

## Credits and prior art

Built on [Morpho Blue](https://github.com/morpho-org/morpho-blue) (GPL-2.0-or-later) and [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT). Prior MUSD lending experiments we learned from: dormant MUSD markets on a separate EOA-owned Morpho deployment (wound down in June 2026), Mezodot (a custom money market on testnet) and Cosign (MEZO-collateral markets on its own testnet Morpho).

Licensed under GPL-2.0-or-later.
