# Baserate web

Vite + React 19 SPA for Mezo testnet: **Borrow** (MUSD against BTC on Mezo's Morpho), **Save** (wsMUSD), **Lend**
(vMUSD, a Morpho Vault V2 with BaserateAllocator), **Liquidate** (FlashLiquidator and the bMUSD backstop), **Risk**
(RiskLens), **Fees** (FeeRouter and the timelocked fee switch) and **Evidence** (live Blockscout verification).
Credit lines and Come back are listed in the nav as "Coming in the next release"; they have no screens yet.

Stack: wagmi 2.19.5, viem 2.57.11, RainbowKit 2.2.11, TanStack Query and Router (code-based routes), Tailwind 4.

## Commands (from the repo root)

```sh
pnpm install
pnpm --filter web dev          # http://localhost:5173
pnpm --filter web typecheck
pnpm --filter web build        # apps/web/dist
pnpm check-bundle              # fails on secret-looking strings in apps/web/dist
pnpm lint                      # biome
```

## Configuration

Only `BASERATE_PUBLIC_*` variables reach the bundle (`envPrefix`); see `.env.example`.

| Variable                        | Effect                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `BASERATE_PUBLIC_WC_PROJECT_ID` | Optional Reown project id. Without it, only injected (and EIP-6963) wallets are offered. |
| `BASERATE_PUBLIC_LOCAL_FORK=1`  | Target an anvil fork of testnet on `http://127.0.0.1:8545` with chain id 31337.          |
| `BASERATE_PUBLIC_SUBGRAPH_URL`  | Optional public GraphQL endpoint of the Baserate subgraph (Goldsky). See below.          |

Contract addresses come from `packages/sdk/src/deployments/<chainId>.json`. On a network where a Baserate contract
is a zero-address placeholder, its page says so and its actions stay disabled.

Calls that spend Skip precompile reads (`RiskLens.snapshot`, `FlashLiquidator.previewLiquidation`/`quoteVenues`) go
through `directClient` in `src/wagmi.ts`, a client without multicall batching: Mezo allows 20 precompile calls per
`eth_call`, so they must not be aggregated with other reads.

History (allocator moves, distributions and the fee-switch submission, borrow accounts, backstop exit requests, the
walkthrough's wsMUSD deposit check) comes from the Baserate subgraph (`packages/subgraph`) when
`BASERATE_PUBLIC_SUBGRAPH_URL` is set: one GraphQL request, plus a log read of the blocks the subgraph has not indexed
yet so the newest events still show (`src/lib/subgraph.ts`). When it is unset, on a local fork, or when a query fails,
the same hooks read logs in 10,000-block windows (`src/lib/logs.ts`). Live state (positions, request status) is
always read on-chain.

## End-to-end tests

`pnpm --filter web e2e` runs the judge journey and the Wave 2 pages live on Mezo testnet with a funded test key
(see `playwright.config.ts` for the environment variables). It sends real transactions (borrow, save, repay, a 3 MUSD
vMUSD deposit and withdrawal) and only sends a liquidation if a position is actually liquidatable.

## How transactions work

`TxButton` simulates the call continuously and shows the decoded custom error before the wallet opens. On click it
simulates again, estimates gas × 1.3, sends, toasts the explorer link and waits for the receipt. Permit flows
(repay & withdraw, wsMUSD deposit) pre-simulate with an `eth_call` state override granting the allowance the permit
will create, then sign the MUSD permit (domain `{"Mezo USD", "1", chainId, MUSD}`) and send one transaction.
Contract wallets (Safe) get an approve-then-act path instead, because MUSD permits are ECDSA-only.

## Evidence

`src/evidence.json` (schema: `src/evidence.schema.json`) lists `{chainId, kind, tx, block, summary, proves}`. Each
row is re-verified in the browser against `https://api.explorer.test.mezo.org/api/v2/transactions/{hash}`: it must
exist, have succeeded and sit in the recorded block. Tx hashes listed there are allowlisted by the bundle check.

## Bundle secret scan

`scripts/check-bundle.mjs` scans `dist/` for `0x` + 64 hex (except `bundle-allowlist.txt`, registry bytes32
values and evidence tx hashes), PEM blocks, `PRIVATE_KEY`, Telegram/Discord/GitHub/`sk_` token shapes, AWS keys
and Turnstile secrets. Any match exits 1.
