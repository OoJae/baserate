# Baserate

**Borrow MUSD against your BTC without the redemption queue, on Mezo's own Morpho Blue.**

[Live app](https://baserate-mezo.vercel.app) · [On-chain evidence](https://baserate-mezo.vercel.app/evidence) · [Judge guide](docs/JUDGES.md) · [Security](docs/SECURITY.md) · [Built vs planned](docs/BUILT_VS_PLANNED.md)

Baserate is a lending layer for MUSD. You post BTC and borrow MUSD in one transaction from a market on Mezo's official Morpho Blue deployment. Morpho loans have no redemption queue, no 2,000-MUSD minimum and no capacity lock. Idle MUSD can be saved in **wsMUSD**, the first ERC-4626 wrapper over Mezo's claim-based sMUSD.

## Why it matters

| | Today | With Baserate |
|---|---|---|
| Retail MUSD borrowers | Mainnet troves fell from **104 to 1** as MUSD traded at ~$0.989, below the ~$0.9925 redemption floor. Every new trove is first in line to be redeemed | Loans sit in a Morpho market. Nobody can repay your debt at par and take your BTC |
| Smallest loan | 2,000 MUSD (≈0.027 BTC) | Any size; one faucet drip (0.001 BTC) borrows ~30 MUSD |
| Lending MUSD | Nothing lends MUSD on Mezo; Morpho holds 0 MUSD | A BTC→MUSD market on Mezo's own Morpho (lending vault next release) |
| sMUSD | Not ERC-4626, so nothing can use it as collateral or a vault floor | wsMUSD: ERC-4626, auto-harvesting, sandwich-resistant |

## How it works

```
judge wallet ── openAndBorrow{value: BTC} ──▶ BorrowAccountFactory
                                               └─ BorrowAccount (EIP-1167 clone, owner-only)
                                                    ├─ wraps BTC 1:1 → bcBTC (gated receipt)
                                                    ├─ Morpho.supplyCollateral(M1)
                                                    └─ Morpho.borrow(M1) → MUSD to the owner
M1 = Morpho Blue market { loan: MUSD, collateral: bcBTC, oracle: BtcMusdOracle, irm: AdaptiveCurveIrm, lltv: 0.77 }
BtcMusdOracle = Skip BTC/USD precompile (≤60 s) + Pyth ±10% band + MUSD leg clamped to [1.00, 1.02]
```

- **Market-wide limits.** All collateral must enter as bcBTC, which only registered accounts can mint, so per-position caps, LTV ceilings and the global cap bind the whole market, not just our UI.
- **Oracle-free exit.** `repayAndWithdraw` repays exact debt by shares and withdraws collateral without reading the oracle. It works even if the oracle is down.
- **Exits never pause.** The sentinel can stop new borrowing, never repay, withdraw, top-up, unwrap or liquidation.

## Live on Mezo testnet (chain 31611)

| Contract | Address | Source |
|---|---|---|
| BorrowAccountFactory | [`0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE`](https://explorer.test.mezo.org/address/0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE) | [Sourcify](https://repo.sourcify.dev/31611/0xa3a03CD439B4cCB7292Ef21a23bb6BB36a4b86fE) |
| BorrowAccount (implementation) | [`0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292`](https://explorer.test.mezo.org/address/0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292) | [Sourcify](https://repo.sourcify.dev/31611/0xEF8D999248Dfa1aEDBd9B38b633D565f5751b292) |
| CollateralBTC (bcBTC) | [`0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1`](https://explorer.test.mezo.org/address/0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1) | [Sourcify](https://repo.sourcify.dev/31611/0xd53B0Bf00d8e1b7F06E85cD6f11921fda9Bc27d1) |
| BtcMusdOracle | [`0x99F948b6955Ac7b579b2d8847178911645Ffe77F`](https://explorer.test.mezo.org/address/0x99F948b6955Ac7b579b2d8847178911645Ffe77F) | [Sourcify](https://repo.sourcify.dev/31611/0x99F948b6955Ac7b579b2d8847178911645Ffe77F) |
| WsMUSD | [`0x92aa0306c3af1e02D776EA05857653A3839DeBEB`](https://explorer.test.mezo.org/address/0x92aa0306c3af1e02D776EA05857653A3839DeBEB) | [Sourcify](https://repo.sourcify.dev/31611/0x92aa0306c3af1e02D776EA05857653A3839DeBEB) |
| MusdDispenser (judge top-ups) | [`0x92F13D33aF38BbAc45a7E880826a787d895654c8`](https://explorer.test.mezo.org/address/0x92F13D33aF38BbAc45a7E880826a787d895654c8) | [Sourcify](https://repo.sourcify.dev/31611/0x92F13D33aF38BbAc45a7E880826a787d895654c8) |
| Market M1 on Mezo's Morpho Blue [`0xCe1d…5a73`](https://explorer.test.mezo.org/address/0xCe1da828cA15cb1FDAfa84C366A53C8106655a73) | id `0xadd5f62435744e4fe91c94212024eba66fe93af38824bf264dee64258aebb13b` | |

Key transactions: [market created](https://explorer.test.mezo.org/tx/0x4810d36183cda01097e07258b1b692477ae07ff1449a7abdac134fab03172da5) · [one-transaction borrow](https://explorer.test.mezo.org/tx/0x4b25c6e57ebec23866fdba5f020bd2d1cb40a745f2c07cb83892ccbafaefa5f6) · [one-transaction repay and exit](https://explorer.test.mezo.org/tx/0x98996d663b29140990502713f1bfb582ae3ceac7fe444dfa0d5ea458ec5adae1). On testnet the deployer holds the governor and sentinel roles; mainnet uses a 2-of-3 Safe.

## Tests

```bash
cd contracts && forge test        # 349 tests: unit, fuzz, invariant, Mezo mainnet + testnet forks
pnpm install && pnpm test         # SDK unit tests
pnpm --filter web build && pnpm check-bundle
```

Mezo's precompiles (Skip BTC/USD, BTC, MEZO) run inside the Go node, so they hang in anvil forks. Fork tests etch a `SkipMock` seeded with the real price at the pinned block and run everything else against the real MUSD, sMUSD, Pyth, Morpho Blue and AdaptiveCurveIrm.

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry project: `src/oracle`, `src/savings`, `src/collateral`, `src/account`, `src/periphery`; tests in `test/{unit,fuzz,invariant,fork}`; `script/Deploy.s.sol` |
| `apps/web/` | Vite + React app (Borrow, Save, Evidence) |
| `packages/sdk/` | `@baserate/sdk`: chains, ABIs generated from the contracts, Morpho math, MUSD permit |
| `docs/` | Plan, design specs, research, security, judge guide |

## Credits and prior art

Built on [Morpho Blue](https://github.com/morpho-org/morpho-blue) (GPL-2.0-or-later) and [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT). Prior MUSD lending experiments we learned from: dormant MUSD markets on a separate EOA-owned Morpho deployment (wound down in June 2026), Mezodot (a custom money market on testnet) and Cosign (MEZO-collateral markets on its own testnet Morpho).

Licensed under GPL-2.0-or-later.
