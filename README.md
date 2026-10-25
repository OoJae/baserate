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

| Contract | Address | Source |
|---|---|---|
| BorrowAccountFactory | [`0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE`](https://explorer.test.mezo.org/address/0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE) | [Sourcify](https://repo.sourcify.dev/31611/0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE) |
| BorrowAccount (implementation) | [`0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292`](https://explorer.test.mezo.org/address/0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292) | [Sourcify](https://repo.sourcify.dev/31611/0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292) |
| CollateralBTC (bcBTC) | [`0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1`](https://explorer.test.mezo.org/address/0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1) | [Sourcify](https://repo.sourcify.dev/31611/0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1) |
| BtcMusdOracle | [`0x99F948b6955Ac7b579b2d8847178911645Ffe77F`](https://explorer.test.mezo.org/address/0x99F948b6955Ac7b579b2d8847178911645Ffe77F) | [Sourcify](https://repo.sourcify.dev/31611/0x99F948b6955Ac7b579b2d8847178911645Ffe77F) |
| WsMUSD | [`0x92aa0306c3af1e02D776EA05857653A3839DeBEB`](https://explorer.test.mezo.org/address/0x92aa0306c3af1e02D776EA05857653A3839DeBEB) | [Sourcify](https://repo.sourcify.dev/31611/0x92aa0306c3af1e02D776EA05857653A3839DeBEB) |
| MusdDispenser (judge top-ups) | [`0x92F13D33aF38BbAc45a7E880826a787d895654c8`](https://explorer.test.mezo.org/address/0x92F13D33aF38BbAc45a7E880826a787d895654c8) | [Sourcify](https://repo.sourcify.dev/31611/0x92F13D33aF38BbAc45a7E880826a787d895654c8) |
| vMUSD (Morpho Vault V2) | [`0x00890F9e2367acF6aC26CC06d8BF6c4270Da7440`](https://explorer.test.mezo.org/address/0x00890F9e2367acF6aC26CC06d8BF6c4270Da7440) | [Sourcify](https://repo.sourcify.dev/31611/0x00890F9e2367acF6aC26CC06d8BF6c4270Da7440) |
| WsMusdLiquidityAdapter | [`0x75a44270a2Ca424d3cF4A70BdE4d018fc1Adf24F`](https://explorer.test.mezo.org/address/0x75a44270a2Ca424d3cF4A70BdE4d018fc1Adf24F) | [Sourcify](https://repo.sourcify.dev/31611/0x75a44270a2Ca424d3cF4A70BdE4d018fc1Adf24F) |
| BaserateAllocator | [`0x5a28C3f024aecDdC4828F2E5841038f647d8a067`](https://explorer.test.mezo.org/address/0x5a28C3f024aecDdC4828F2E5841038f647d8a067) | [Sourcify](https://repo.sourcify.dev/31611/0x5a28C3f024aecDdC4828F2E5841038f647d8a067) |
| FlashLiquidator | [`0x8259050FF9976C9154042EC9d955dB8fAcE929C8`](https://explorer.test.mezo.org/address/0x8259050FF9976C9154042EC9d955dB8fAcE929C8) | [Sourcify](https://repo.sourcify.dev/31611/0x8259050FF9976C9154042EC9d955dB8fAcE929C8) |
| Backstop (bMUSD) | [`0xc06239D0cB52e51cc0Edcf4b181dA7cCAcD1aC01`](https://explorer.test.mezo.org/address/0xc06239D0cB52e51cc0Edcf4b181dA7cCAcD1aC01) | [Sourcify](https://repo.sourcify.dev/31611/0xc06239D0cB52e51cc0Edcf4b181dA7cCAcD1aC01) |
| FeeRouter | [`0x8266d915fb60ac45998BB919A815C8013b9Bf1bC`](https://explorer.test.mezo.org/address/0x8266d915fb60ac45998BB919A815C8013b9Bf1bC) | [Sourcify](https://repo.sourcify.dev/31611/0x8266d915fb60ac45998BB919A815C8013b9Bf1bC) |
| RiskLens | [`0x78ba4aA497887ECFcAE8468ECAcCe95d2c397d68`](https://explorer.test.mezo.org/address/0x78ba4aA497887ECFcAE8468ECAcCe95d2c397d68) | [Sourcify](https://repo.sourcify.dev/31611/0x78ba4aA497887ECFcAE8468ECAcCe95d2c397d68) |
| MorphoMarketV1AdapterV2 (vMUSD → M1, Morpho's audited adapter) | [`0xffbdbe74f1f118Dde2C2Fe09286f3AA9f448B394`](https://explorer.test.mezo.org/address/0xffbdbe74f1f118Dde2C2Fe09286f3AA9f448B394) | factory-deployed |
| Market M1 on Mezo's Morpho Blue [`0xCe1d…5a73`](https://explorer.test.mezo.org/address/0xCe1da828cA15cb1FDAfa84C366A53C8106655a73) | id `0xadd5f62435744e4fe91c94212024eba66fe93af38824bf264dee64258aebb13b` | |

Key transactions:

- **Borrow:** [market created](https://explorer.test.mezo.org/tx/0x4810d36183cda01097e07258b1b692477ae07ff1449a7abdac134fab03172da5) · [one-transaction borrow](https://explorer.test.mezo.org/tx/0x4b25c6e57ebec23866fdba5f020bd2d1cb40a745f2c07cb83892ccbafaefa5f6) · [one-transaction repay and exit](https://explorer.test.mezo.org/tx/0x98996d663b29140990502713f1bfb582ae3ceac7fe444dfa0d5ea458ec5adae1)
- **Lend:** [vMUSD created](https://explorer.test.mezo.org/tx/0x37d5279dd0501dfbac52cb7cf931d151c276c6aaae2023ebe5111b433ed9deef) · [3,000 MUSD deposit](https://explorer.test.mezo.org/tx/0xd89c582ec4b6d30aba3cc556c07cb5bbd46ef9a2bb78034eb434b7f1d1568ddb) · [first rebalance into M1](https://explorer.test.mezo.org/tx/0x46cb78974ec1c5d8471a02b37604d9b75e0d6abad903cdc27fbdbedaf428aa4d)
- **Liquidations:** [canary opened at ≈76.7% LTV against the 77% LLTV](https://explorer.test.mezo.org/tx/0x3b4bf6885e6d708fcba59ba8b3469e52ab5375f3887e7e3b2ee18d20f8cd1a34)
- **Fees:** [first distribution: 8 MUSD bribe, 8 MUSD to sMUSD, 4 MUSD treasury](https://explorer.test.mezo.org/tx/0x76fe18e5b6df88d0e7c081d9387882788941691a19a91a1f6c0dcf5b5f8b130a) · [fee switch submitted to the 48-hour timelock](https://explorer.test.mezo.org/tx/0xeedbd310e90a95d9c3d6ecf6223c26b870b53d8ca33f7cb347e21b960fc37575)

All 25 recorded transactions are re-checked live on the [Evidence page](https://baserate-mezo.vercel.app/evidence). On testnet the deployer holds the governor and sentinel roles; mainnet uses a 2-of-3 Safe.

## Tests

```bash
cd contracts && forge test -j 1   # 560 tests: unit, fuzz, invariant, Mezo mainnet + testnet forks
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
