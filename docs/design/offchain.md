# Baserate off-chain plan: Wave 1 slice (testnet, due 2026-10-26 15:00 UTC), then Wave 2 full product

## 0. Corrections to the spec (found while verifying)

1. **wagmi's latest release is 3.7.9, but RainbowKit 2.2.11 needs `wagmi ^2.9.0`.** ConnectKit 1.9.2 needs wagmi 2.x and React ≤18. An unpinned `pnpm add wagmi` will break the wallet kit. Pin wagmi to **2.19.5**.
2. **TypeScript's latest is 7.0.2 (the Go-native compiler).** Pin **5.9.3** so @wagmi/cli, tsup's d.ts build and the editor tooling keep working.
3. **viem 2.57.11's built-in `mezo` chain still points at the dead `https://rpc.mezo.org` and has no multicall3 entry.** Override both. Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` exists on mainnet, created at block **351,760**.
4. **Wave 1 needs a MUSD top-up, not just Wave 2.** A judge who borrows X MUSD owes X plus interest, plus the 0.10% fee if it is charged at open. So `repayAndWithdraw` always needs a little extra MUSD. Ship a small dispenser (or a swap button) in Wave 1, or judges cannot complete the exit.
5. **The testnet yield simulator costs about 78 MUSD a day at mainnet's 3.2%.** `receiveProtocolYield` spreads a donation across all **886,092** testnet sMUSD, not just wsMUSD's share. That is about 2.3k MUSD a month and breaks the 3–5k test-MUSD budget. Run it at a labelled ~1% APR (≈24 MUSD/day) with a daily budget cap, and only while judges are watching.
6. **x402 is paid by whoever signs, so the payer must be an EOA that holds MUSD.** Payment is a permit2 + EIP-2612 signature. A BorrowAccount clone cannot pay x402 itself. The credit line's locked recipient must therefore be the agent's EOA, which draws just in time and keeps no float. Revoking stops future draws but cannot claw back MUSD already drawn.
7. **The testnet sMUSD implementation is different code from mainnet's.** Testnet `0x92D12f0a60906b39d81acD9bf8977b6c824cD98C` and mainnet `0xB33C3f97BF3B7df59417D114c694353E42929e87` have different codehashes, although their ABIs match. Fork-test each one separately. The upgrade watcher must pin a different implementation per chain.
8. **Testnet funding is the critical path.** The faucet gives 0.001 BTC **and** 100 MEZO per IP per token per 24 h. On the testnet MUSD/BTC pool, 0.0001 BTC buys 7.865 MUSD, so one drip is about 78.6 MUSD. There is no MEZO/MUSD basic pool on testnet, and the Router has no WETH path, so a swap needs an exact-amount approve on the BTC precompile. Wave 1 needs about 250 test MUSD: an M1 seed of about 200 plus about 30 for the dispenser. Ask DevRel and Discord #testnet at hour 0, and take one drip per network you actually use.
9. **`eth_getLogs` caps the range at `toBlock − fromBlock ≤ 10,000`.** This holds on rpc.test.mezo.org, boar.network, and drpc's free plan. That is about 11.6 h of blocks on testnet (4.16 s blocks) and about 10.1 h on mainnet (3.64 s blocks). Blockscout's Etherscan-style `getLogs` accepts any range, paged at 1,000 results.
10. **The Skip precompile has no `description()`; calling it reverts.** Call only `decimals()` and `latestRoundData()`.
11. **`baserate.vercel.app` is taken by an unrelated "Base Rate Capital", and `baserate.xyz` already resolves to Vercel.** `baserate-mezo.vercel.app` is free. The npm names `@baserate/sdk` and `@baserate/abi` are free. The name collision is worth a thought for the brand.
12. **Chainlist's first mainnet RPC (Imperator) is dead.** Wallets that added Mezo from Chainlist may be on a broken RPC. The UI must detect a stale wallet RPC and tell the user how to fix it.
13. **@mezo-org/passport 0.17.2 needs React 18 and pins RainbowKit 2.0.2.** Bitcoin-wallet sign-up is also being sunset. Skip Passport. Support Safe and smart accounts through an approve path, because MUSD's permit accepts plain ECDSA only. An EIP-7702 EOA (code starting `0xef0100`) can still use permit.
14. **Bribe timing: an MUSD bribe posted in epoch N pays epoch-N voters after the next Thursday 00:00 UTC flip.** For "claimable on Nov 19", post between **Thu Nov 12 01:05 UTC and Wed Nov 18 23:00 UTC**. Verified on testnet: `epochStart(now)` = 1792627200 (Thu Oct 22 00:00 UTC) and `epochVoteEnd` = start + 7 d − 1 h. Enclave A's veBTC #6114 also unlocks on Nov 12, so the watchers must be on that day.
15. **Wave 1 has no vMUSD, so the team seeds M1 itself with `Morpho.supply`.** The UI must say "liquidity supplied by the Baserate team (vMUSD in Wave 2)".

## 1. What I verified, and how

| Fact | Value | How |
|---|---|---|
| Working RPCs (all CORS `*`) | testnet `https://rpc.test.mezo.org` (0x7b7b); mainnet `https://mezo-mainnet.boar.network`, `https://rpc-internal.mezo.org`, `https://mainnet.mezo.public.validationcloud.io`, `https://jsonrpc-mezo.boar.network`, `https://mezo.drpc.org` (0x7b7c). `rpc.mezo.org` gave no response. JSON-RPC batching works on all of them. | curl `eth_chainId`/`eth_blockNumber` and an OPTIONS preflight |
| Explorers and APIs | `explorer(.test).mezo.org`; `api.explorer(.test).mezo.org/api/v2` serves decoded transactions and logs with CORS `*` | curl |
| Fees | EIP-1559 is active. Testnet base fee 130 wei. Mainnet base fee 1.3e6 wei plus a 1.6e5 tip. Block gas limit 10M. | `eth_feeHistory`-style batch call |
| Oracle feeds | Skip testnet $80,649, `updatedAt` equal to the current block. Pyth testnet `0x933a…1315` BTC 73 s old, MUSD 0.98944. Mainnet Pyth `0x5D28…7167` fresh. | cast `latestRoundData` / `getPriceUnsafe` |
| Testnet Morpho `0xCe1d…5a73` | LLTV 0.77 enabled, 0.86 not; IRM `0x0c97…7441` enabled. Morpho, IRM and VaultV2Factory (`0x25eB…b239`; mainnet `0xA64f…40A6`) are verified on Blockscout. | cast and the Blockscout API |
| Testnet MUSD `eip712Domain` | ("Mezo USD", "1", 31611, `0x1189…c503`) | cast |
| sMUSD ABI (both networks) | `receiveProtocolYield`, `yieldIndex`, `supplyYieldIndex`, `claimableYield`, `pendingYield`, `AmountTooSmall`. Testnet `pcv()` = 0, `totalSupply` 886,092.5. | Blockscout verified ABI and cast |
| Trove queue reads | `SortedTroves.getLast`, `TroveManager.getCurrentICR`, `getNominalICR` all work. Testnet has 307 troves, lowest ICR 109.1%. Mainnet has 1 trove. `PriceFeed.lastGoodPrice()` does not exist. | cast |
| Testnet bribe target | Gauge `0x72D88B0795373437E86792DEd8362D66dC43Cd2c` is alive; bribe `0x75b6B35Fc78826A0B7E1f9c08bb7d84bd70D0ee1`; its pool is `0xd16A…6aA9`; MUSD is whitelisted; `tokenRewardsPerEpoch` exists. | cast |
| x402 | `facilitator.vativ.io/supported`: x402 v2, `exact`, both chains, MUSD and BTC via permit2, extension `eip2612GasSponsoring`. `@x402/evm` 2.28.0 lists Mezo in DEFAULT_STABLECOINS. `declareEip2612GasSponsoringExtension` exists. The client signs an EIP-2612 permit only if the server declares that extension. | curl, the unpkg dist, Mezo docs (`index.mdx`, `x402-quickstart.mdx`), and `vativ/mezo-hack` client.ts |
| Goldsky | Subgraphs are supported on Mezo mainnet and testnet. Turbo slugs are `mezo` and `mezo_testnet`. The subgraph `network:` slug is not documented. | docs.goldsky.com `.md` pages |
| Sourcify | Supports 31611 and 31612 | `sourcify.dev/server/chains` |
| Faucet | Cloudflare Turnstile; key `rate-limiter:${ip}:${token}`; 86,400 s delay | mezod `infrastructure/cloudflare/faucet` source |
| Tooling | Vercel CLI (oojae) and Railway CLI (OoJae) are logged in. gh is logged in as OoJae; `OoJae/baserate` is free. Node 26.0.0, pnpm 11.1.2, forge 1.8.3. Goldsky CLI is not installed. | local read-only commands |

## 2. Monorepo layout and pinned stack

```
baserate/                      (public: github.com/OoJae/baserate)
  contracts/                   Foundry (contracts track). Not a pnpm package.
  packages/abi/                @baserate/abi: wagmi-cli output plus deployments/<chainId>.json (generated, committed)
  packages/sdk/                @baserate/sdk: chains, addresses, math, reads, actions, permit, logs
  packages/subgraph/           Goldsky subgraph (Wave 2)
  apps/web/                    Vite SPA on Vercel
  apps/keeper/                 Wave 2: two entrypoints, src/worker.ts and src/api.ts (two Railway services)
  docs/                        JUDGES.md, BUILT_VS_PLANNED.md, evidence/, ops/, audit/
  scripts/                     dev-fork.sh, check-bundle.mjs, export-deployments.ts
  biome.json  tsconfig.base.json  pnpm-workspace.yaml  .nvmrc (24)  .gitleaks.toml
```

**Pinned versions (verified on npm today):**

| Area | Version |
|---|---|
| UI framework | react / react-dom 19.3.1, vite 8.3.5, @vitejs/plugin-react 6.1.2 |
| Wallet | wagmi **2.19.5**, viem 2.57.11, @rainbow-me/rainbowkit 2.2.11, @tanstack/react-query 5.104.5 |
| Routing and styling | @tanstack/react-router 1.170.46 (code-based routes, no plugin), tailwindcss and @tailwindcss/vite 4.3.3, recharts 3.10.1 (Wave 2) |
| Turnstile | @marsidev/react-turnstile 1.6.3 (Wave 2) |
| Build and test | typescript **5.9.3**, @wagmi/cli 2.10.0, tsup 9.0.0, vitest 5.0.5, @biomejs/biome 2.6.2, zod 4.6.7, tsx 4.23.15 |
| Server (Wave 2) | hono 4.13.13, @hono/node-server 2.1.5, pino 10.4.0, croner 10.0.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, postgres 3.4.9 |
| x402 (Wave 2) | @x402/core, evm, fetch, hono, extensions, paywall all 2.28.0. Mainnet needs ≥2.15. If install fails, override `@solana/kit` to 6.9.0, as the Mezo docs advise. |
| Indexing and release | @graphprotocol/graph-cli 0.98.1, graph-ts 0.38.2, @goldskycom/cli 13.18.0, @changesets/cli 3.0.3 |

**Framework decision: a Vite SPA, not Next.js.**
- The web holds no server logic.
- Everything that needs a secret (dispenser vouchers, x402 server, agent, keeper) lives on Railway, so the Vercel project has **zero secret variables**.

**Other tooling rules:**
- Deploy on Node 24 LTS; local Node 26 is fine.
- Set `"packageManager": "pnpm@11.1.2"`, and run `pnpm approve-builds` for esbuild and similar packages.
- If Vercel's pnpm 11 support misbehaves on the first deploy, fall back to pnpm 10.
- No turborepo; `pnpm -r` / `--filter` is enough.

**Chain config (`packages/sdk/src/chains.ts`).** The exact values are load-bearing:

```ts
import { defineChain, fallback, http } from 'viem'
import { mezo as vMezo, mezoTestnet as vMezoTestnet } from 'viem/chains'
export const mezoTestnet = defineChain({ ...vMezoTestnet,
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } } })   // single public RPC = SPOF; show a banner on failure
export const mezo = defineChain({ ...vMezo,
  rpcUrls: { default: { http: ['https://mezo-mainnet.boar.network', 'https://rpc-internal.mezo.org',
    'https://mainnet.mezo.public.validationcloud.io', 'https://mezo.drpc.org'] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 351_760 } } })
export const transportFor = (c: typeof mezo) =>
  fallback(c.rpcUrls.default.http.map(u => http(u, { batch: true, retryCount: 2 })))
// local dev: mezoTestnet fork on anvil with id 31337 (see §3)
```

**Chain rules for every package:**
- Read BTC balances with `eth_getBalance`, never the BTC ERC-20 precompile.
- Keep at most 15 precompile-touching calls (Skip, `oracle.price()`, BTC/MEZO token reads) per multicall, under the 20-per-transaction limit.
- Set writes to `gas = estimate × 1.3`.
- Gas reserve for "Max" buttons: 0.000001 BTC on testnet, 0.00001 BTC on mainnet.

## 3. Wave 1 (now → Mon 2026-10-26, submit by 12:00 UTC, freeze 10:00 UTC)

**Wave 1 scope by area:**
- **CI:** forge build, unit and fork tests, biome, typecheck, vitest, web build, bundle secret scan, gitleaks.
- **Packages:** `packages/abi` and `packages/sdk` (workspace only; npm publish is optional).
- **apps/web pages:** Borrow, Save and Evidence, plus a "Get test funds" card and a judge checklist. Testnet only.
- **Dispenser:** the contract in open mode.
- **Not in Wave 1:** keeper and subgraph. History comes from the Blockscout API, and evidence actions run from Foundry scripts.
- **Docs:** `docs/JUDGES.md`, `docs/BUILT_VS_PLANNED.md`, `docs/evidence/evidence.json`, and a README with the addresses.

**Sequence.** Hours count from Sat 06:00 UTC. The contracts track runs in parallel.

| When | Off-chain work |
|---|---|
| H0–H1 | Post the DevRel and Discord request (0.05 test BTC or 2–5k test MUSD); take a faucet drip. Create the public repo with gitleaks, `.gitignore` for `.env*` and `.env.example`. Create a Reown projectId with domain allowlist `localhost`, `*.vercel.app`, `baserate-mezo.vercel.app`. Create Vercel project `baserate-mezo` (root `apps/web`) and deploy a placeholder so the live link exists. |
| H1–H4 | Scaffold the workspace. SDK: chains, math (unit-tested), `signMusdPermit`, `getLogsChunked`, error decoding. Web shell: RainbowKit, network guard, header, routes. **Interface first:** hand-write `parseAbi` stubs for factory, BorrowAccount and wsMUSD from the agreed signatures, so the UI is not blocked by the contracts. |
| ~H12–H20 | When contract ABIs exist, `wagmi generate` replaces the stubs. Run `scripts/dev-fork.sh`: an anvil fork of testnet with `--chain-id 31337`, `anvil_setCode` of the contracts track's MockSkip at `0x7b7c…0015`, a forge script deploy, and deployments written to `packages/abi/deployments/31337.json`. |
| H20–H26 | Borrow page (open, position card, repay and withdraw, dispenser top-up) |
| H26–H29 | Save page (wsMUSD deposit, redeem, in-kind redemption) |
| H29–H32 | Evidence page, Built vs Planned, `JUDGES.md`, the judge checklist |
| After testnet deploy | Address book for 31611. Team seeds M1 and funds the dispenser. Run the **real openAndBorrow with BTC as msg.value** and record it in `evidence.json`. Full walk on desktop Chrome + MetaMask and on iOS via WalletConnect / the MetaMask in-app browser. Fix bugs. |
| H52 | Freeze; submit by H54 (Mon 12:00 UTC). |

**Cut order if late:** in-kind redeem button → redemption comparison panel → judge checklist → mobile polish. Never cut Borrow, Repay or Evidence.

**Definition of done:** a fresh wallet with one faucet drip can:
1. borrow about 40 MUSD in one transaction;
2. deposit to and withdraw from wsMUSD;
3. top up from the dispenser;
4. `repayAndWithdraw` and get native BTC back;

and the Evidence page verifies the team's borrow live from Blockscout.

## 4. UI, page by page

**Global (Wave 1):**
- RainbowKit modal; `initialChain` is mezoTestnet. Wave 2 adds a network toggle with a mainnet "Proof mode: caps ≤2k MUSD, real funds" banner.
- **NetworkGuard:** switch chain with `wallet_addEthereumChain`, using our first RPC. Compare the wallet provider's `eth_blockNumber` with our public client; if the wallet is more than 30 blocks behind or errors, explain how to edit the wallet's RPC.
- **Get test funds card:**
  1. Copy address and link to faucet.test.mezo.org (0.001 BTC per IP per day).
  2. Dispenser claim button.
  3. Fallback "Swap 0.00002 BTC → ≈1.6 MUSD" on the testnet pool: exact-amount approve on the BTC precompile, then `Router 0x9a1f…D7E9 swapExactTokensForTokens` with Route `{BTC, MUSD, false, factory 0x4947…Ce1A}`.
  4. Add MUSD to wallet (`wallet_watchAsset`).
- **Judge checklist,** derived from state: has BTC → has position → has wsMUSD → repaid.
- **TxButton:**
  1. Simulate, and show the decoded custom error *before* the wallet opens.
  2. Estimate gas × 1.3, then write.
  3. Toast with the explorer link and wait for the receipt.
  4. Map reverts to plain messages.
- **Mobile:**
  - Single column under 640 px with a bottom tab bar (Borrow, Save, Lend, More) and a sticky primary button.
  - Inputs use `inputMode=decimal`; tooltips become tap popovers.
  - Test MetaMask mobile (in-app browser) and WalletConnect on iOS Safari and Android Chrome.
- **Number formats:** MUSD with 2 decimals (6 when showing a dust shortfall), BTC with 6–8 decimals plus a USD value, ages ticking client-side every second.

**Borrow (Wave 1)**
- **Inputs:** BTC amount (Max = balance − reserve) and a target-LTV slider (default 50%, max = opening ceiling from the contract).
- **Shown before submit:**
  - MUSD out = BTC × oracle price × LTV, then the fee line ("you receive / debt").
  - LTV and health factor = coll × price × LLTV / debt.
  - **Liquidation price** = debt / (coll × LLTV).
  - LLTV and liquidation incentive = min(1.15, 1/(0.3·LLTV + 0.7)) − 1: 7.41% at 0.77, 4.38% at 0.86.
  - Borrow APR = `IRM.borrowRateView` × 31,536,000; APY = e^(rt) − 1.
  - Available M1 liquidity, per-position cap, and the remaining global cap.
- **Oracle panel:**
  - Skip age: green under 30 s, amber 30–60 s, red over 60 s ("borrow would revert").
  - Pyth BTC age and band status (band active ≤3,900 s; |Skip − Pyth| ≤10%).
  - MUSD leg: "Pyth 0.9894 clamped to 1.00".
- **Redemption panel:**
  - "Redemption risk: none: Morpho loans have no redemption queue."
  - Comparison: your NICR-equivalent = coll × 1e20 / debt against `getNominalICR(SortedTroves.getLast())`, giving "a trove at your ratio would / would not be first in line".
  - MUSD at $0.9894 against the ≈$0.9925 floor; the 2,000-MUSD minimum trove (≈0.027 BTC) against your 0.001.
- **States:** disconnected · wrong network · no BTC (faucet card) · quoting · oracle stale or band tripped ("borrowing paused by oracle guard; repay and withdraw still works") · borrow paused (sentinel) · cap hit (show remaining) · M1 liquidity short · signing → pending → confirmed / reverted (decoded) · position exists.
- **Position card:** collateral, debt (`toAssetsUp` of borrow shares), LTV, health factor, liquidation price, accrued interest, incentive, ages.
- **Repay & withdraw:**
  - Shows debt, wallet MUSD and any shortfall, with a one-click dispenser or swap top-up.
  - EOA (or 7702) path: sign permit, then one transaction. Contract account: approve, then the approved variant.
  - Success shows the native BTC returned and the note "works even if the oracle is frozen".

**Save: wsMUSD (Wave 1)**
- **Pool stats:**
  - Share price `convertToAssets(1e18)`, totalAssets, supply, cap and `maxDeposit`.
  - Exact pending yield = `claimableYield(w) + bal × (yieldIndex − supplyYieldIndex(w)) / 1e18`.
  - Unvested amount and vest end; last sync.
  - APY: since inception in Wave 1 (from deploy-block share price, read through Blockscout logs); 7-day in Wave 2 (subgraph).
  - Label: "Testnet yield is simulated by Baserate (receiveProtocolYield at X% APR)".
- **User:** shares, MUSD value, wallet MUSD.
- **Actions:** deposit (permit + one transaction), redeem, redeem in kind (sMUSD plus vested MUSD).
- **Errors:** cap reached, insufficient balance, permit rejected.

**Evidence (Wave 1, extended in Wave 2)**
- Curated `docs/evidence/evidence.json` is bundled at build time: `{chainId, kind, tx, block, summary, proves}`.
- Each row is verified live: `GET /api/v2/transactions/{hash}` (status, method, value) and `/logs` (decoded SupplyCollateral and Borrow).
- Contract table with Blockscout `is_verified` and Sourcify badges.
- Fork-test summary from CI (`forge test --json` turned into `fork-tests.json`, with pinned blocks).
- Built-vs-Planned table and the audit-ledger link.
- Wave 2 adds a keeper status widget and the live keeper action feed from `/v1/evidence`.

**Lend: vMUSD (Wave 2)**
- Deposit and withdraw, with dispenser vouchers of 100 MUSD per address per day.
- Split chart: M1 / wsMUSD / idle.
- M1 supply APY = borrow APY × utilisation × (1 − fee), against wsMUSD 7-day APY.
- Buffer target max(2k, 15% of M1 supply); caps per adapter id (absolute and relative); last allocator move; share price.
- Advanced `forceDeallocate` in-kind exit.
- Note: "cap cuts don't shrink existing loans".

**Liquidate (Wave 2)**
- Positions sorted by health factor (from factory registries); canaries badged.
- Each row shows distance to liquidation: "liquidatable if BTC ≤ $X (−0.2%)".
- `previewLiquidation` (simulate) shows seized BTC, route (Backstop / CL200 / vAMM; testnet uses Backstop or vAMM), price impact against Skip, caller profit and bad debt 0. Then one click on `FlashLiquidator.liquidate`, followed by a profit receipt.

**Credit lines and agent (Wave 2)**
- `approveCredit` form: spender and recipient = demo agent (prefilled and locked), periodLimit 5 MUSD, period 1 day, maxOutstanding, maxLtvBps, expiry. Or sign the EIP-712 version.
- List of lines with outstanding, used this period, remaining, and Revoke.
- Agent console (SSE log) with the run sequence in §10. Shows "credit headroom: X MUSD".

**Come back (Wave 2, mainnet)**
- A mainnet public client, independent of the wallet's chain, reads `CollSurplusPool.getCollateral(addr)` for any address.
- Snapshot list of current holders from Blockscout logs, with truncated addresses.
- EOA: sign ClaimCollateral to the predicted clone address → factory claims, supplies and can borrow.
- Safe: two-step instructions. Testnet and fork runs are labelled.

**RiskLens (Wave 2)**
- MUSD price (Pyth and CL10 TWAP).
- Clean depth: QuoterV2 on CL200 and `Router.getAmountsOut` on the vAMM at 0.01–0.2 BTC.
- Cap derivation (formula, inputs, 24 h minimum).
- Oracle ages, backstop solvency (free MUSD, BTC marked at Skip × 0.95), redemption-queue rank, utilisation and rate at target.
- Charts of depth vs cap over time, from the keeper's depth samples.

## 5. MUSD dispenser (contract plus optional voucher API)

```solidity
// testnet only; contracts track implements, ~60 lines + tests
claim(uint256 amount, uint256 deadline, bytes calldata sig) // sig checked only if signer != 0
perAddressDaily (W1 25e18 → W2 100e18); globalDaily (W1 300e18 → W2 1500e18); day = block.timestamp / 1 days
setLimits / setSigner / pause / sweep : onlyOwner;  event Claimed(address indexed to, uint256 amount, uint256 indexed day)
// EIP-712 Claim(address to,uint256 amount,uint256 deadline): no nonce needed, replay is bounded by on-chain per-day caps
```

- **Wave 1: open mode.** Free Sybil addresses are bounded by the global daily cap.
- **Wave 2: voucher mode.** `POST /v1/dispenser/voucher {address, turnstileToken}` on the Railway API:
  - Cloudflare siteverify with the server-only secret.
  - At most 3 addresses per IP-hash per day.
  - Pre-checks of the per-address and global budget.
  - Returns a signature. The user sends `claim` and pays the trivial gas.
  - The signer key holds no funds; a leak is bounded by `globalDaily`.
- **Recycling:** x402 `payTo` is the dispenser address.
- **Mainnet:** no dispenser; link to a Tigris swap instead.

## 6. SDK (`@baserate/sdk`)

**Packaging:** ESM, tsup, viem as a peer dependency, ABIs from `@baserate/abi`. In Wave 2 publish 0.1.0 to npm with changesets. Not GitHub Packages, because installing from it needs auth even for public packages.

**Modules:**

- `chains`, `addresses`: `deployments[31611|31612|31337]`, giving `{morpho, musd, smusd, wsMusd, oracle, brBtc, factory, canaryFactory?, m1:{id, params}, vMusd?, allocator?, flashLiquidator?, backstop?, feeRouter?, riskLens?, dispenser?, startBlock}`.
- `math`, unit-tested against on-chain values:
  - `toAssetsUp` / `toSharesDown` (virtual shares 1e6, virtual assets 1);
  - `ltv`, `healthFactor`, `liquidationPrice`, `lif`, `rateToApy`, `supplyApy`, `maxBorrow`, `wsPendingYield`.
- `reads`:
  - `getPosition(client, {owner})` (via `predictAccount`), `getMarket`, `getOracleStatus`, `getWsMusdState`, `getRedemptionComparison`;
  - Wave 2: `getVaultState`, `getRiskSnapshot`, `listPositions`.
- `actions` (simulate then write, return the hash), mirroring the contract flows:
  - Wave 1: `openAndBorrow({btcIn, musdOut, maxLtvBps})`, `repayAndWithdraw({deadline})` (permit or approve path chosen automatically), `depositWsMusd`, `redeemWsMusd`, `redeemInKind`, `claimDispenser`.
  - Wave 2: `depositVault`, `withdrawVault`, `liquidate`, `previewLiquidation`, `approveCredit`, `signCreditApproval`, `revokeCredit`, `draw({account, amount})`, `claimCollateralAndOpen`.
- `permit`: `signMusdPermit` with domain `{name:'Mezo USD', version:'1', chainId, verifyingContract: MUSD}` and nonce from `nonces(owner)`.
- `logs`: `getLogsChunked({…, maxRange: 10_000n, concurrency: 3})` with backoff and adaptive range halving.
- `errors`: `decodeBaserateError`.

**`packages/abi`:**
- `@wagmi/cli` foundry plugin generates `as const` ABIs from `contracts/out`.
- `scripts/export-deployments.ts` reads `contracts/broadcast/*/<chainId>/run-latest.json` into `deployments/<chainId>.json`.
- It also exports JSON ABIs for the subgraph.
- Generated files are committed; CI re-generates them and fails on any diff.

## 7. Keeper (Wave 2; `apps/keeper/src/worker.ts` on Railway)

**Core design:**
- One long-running process; croner with `protect: true` so runs never overlap, plus Postgres advisory locks.
- State-based idempotency: re-read on-chain state before every send.
- One sender per key: async mutex, viem `nonceManager`, simulate, gas × 1.3, 90 s receipt timeout, then re-check before any retry.
- Every attempt is written to `actions`.

| Job | Cadence | Networks | Action and condition | Idempotency key | Key |
|---|---|---|---|---|---|
| `yield.sim` | hourly | **testnet only** (chainId guard) | `approve` + `receiveProtocolYield(amt)`, amt = APR × sMUSD supply × dt. Daily budget cap; skip if `amt·1e18/supply` = 0. | `sim:{yyyymmddhh}` | SIM |
| `wsmusd.sync` | hourly (right after sim) | both | `sync()` if pending ≥ 0.01 MUSD or last sync > 6 h | state plus `sync:{chain}:{hour}` | KEEPER |
| `allocator.rebalance` | check every 15 min | both | `rebalance()` if the preview moves ≥ the minimum or the buffer is below its floor | state | KEEPER |
| `liq.scan` | every 12 s | both | Enumerate clones from factory `AccountCreated` logs (chunked; cursor in DB). If health < 1, simulate `FlashLiquidator.liquidate`; send if profitable. Canaries: only after 6 h unclaimed or health < 0.98. | in-flight set per borrower | KEEPER |
| `caps.depth` | sample every 10 min | mainnet (testnet uses fixed labelled caps) | QuoterV2 / Router depth at 4% impact; 24 h rolling minimum. cap = min(2 × free backstop, free backstop + depth), hard ceiling (≤2k in proof mode). If below the current cap, cut instantly with the sentinel role (decrease-only). If above, alert the Safe (48 h timelock). | `capcut:{id}:{cap}` | SENTINEL |
| `canary.maintain` | every 10 min | both | Keep 1–2 canaries at about LLTV − 0.25 pt (`borrowMore` as price rises). Reopen 30 min after a liquidation. | per-canary state | CANARY |
| `smusd.watch` | every 5 min plus `Upgraded` logs | both | Read EIP-1967 slot `0x3608…2bbc`, `strategy`, `pcv`, `vaultGauge` against pinned values (mainnet impl `0xB33C…9e87`, testnet `0x92D1…D98C`). On a change: cut caps and alert. | (field, new value) | SENTINEL |
| `fee.flush` | Thu 01:05 UTC, plus a daily sMUSD donation if ≥ min | both | `FeeRouter.flush()`. Skip if `tokenRewardsPerEpoch(MUSD, epochStart) > 0` on-chain. | `flush:{epochStart}` | KEEPER |
| `health` | every 1 min | both | Skip age > 120 s; Pyth ages; key balances; dispenser balance; facilitator `/supported`. | alert dedupe 30 min | none |

- **Keys:**
  - Separate EOAs per role and per network: KEEPER, SENTINEL (Vault V2 sentinel plus factory decrease-only role, never owner), CANARY, SIM (testnet), DISPENSER_SIGNER (no funds), AGENT.
  - The 2-of-3 Safe stays owner and curator.
  - Keys are generated offline with `cast wallet new` and stored only as Railway sealed variables, never in the repo or Vercel. Rotation is documented in `docs/ops/keys.md`.
  - Mainnet keys hold at most 0.001 BTC. Hourly syncs cost about $0.70/day of gas at 1.46e6 wei.
- **Alerts:** Telegram bot (`TELEGRAM_BOT_TOKEN` and chat id as secrets). Fire on 3 consecutive job failures, an oracle older than 120 s, an upgrade, any cap cut, any liquidation, low key or dispenser balances, or a facilitator outage.
- **Logs feeding the Evidence page:**
  - pino JSON goes to Railway logs.
  - Postgres tables (drizzle): `actions(id, chain_id, job, idem_key unique, tx_hash, status, params, result, error, ts)`, `cursors`, `depth_samples`, `vouchers`, `x402_fallback`, `alerts`.
  - `GET /v1/evidence` and `/v1/status` (last run, last success, next run per job).
  - Before each submission, snapshot to `docs/evidence/`.

## 8. API service (Wave 2; `apps/keeper/src/api.ts`, public Railway domain)

**Endpoints:**
- `/healthz`, `/v1/status`, `/v1/evidence`
- `/v1/dispenser/voucher`
- `/x402/premium` ($2.50) and `/x402/tip` ($0.01) on eip155:31611. Mainnet only if the facilitator's signers hold gas.
- `POST /v1/agent/run`: SSE stream; body signed by the owner over EIP-191 `account | nonce | expiry`; the server checks `owner == BorrowAccount.owner()`.

**Guards:**
- CORS allowlist covering production and the preview pattern.
- Per-IP limit of 30 requests per minute; 3 agent runs per account per hour; 2 agent runs at a time globally.
- The API holds only DISPENSER_SIGNER, AGENT and the Turnstile secret. Keeper keys stay in the worker service.

## 9. x402 agent demo

1. **Server.** Hono with `@x402/hono` `paymentMiddleware`, wired like the Mezo quickstart:
   - `HTTPFacilitatorClient({url:'https://facilitator.vativ.io'})` and `x402ResourceServer(...).register('eip155:31611', new ExactEvmScheme())`.
   - Route `accepts: {scheme:'exact', price, network:'eip155:31611', payTo: dispenser}`.
   - Route extensions include `declareEip2612GasSponsoringExtension()`, so the client signs the MUSD → Permit2 permit. Verify the exact helper signature during implementation.
2. **Agent (server, AGENT EOA).**
   - Bootstrap: `MUSD.approve(PERMIT2, max)` once, as a belt-and-braces measure; hold dust BTC for `draw()` gas.
   - Per request:
     1. Probe the URL and decode the `PAYMENT-REQUIRED` header to get the amount.
     2. `BorrowAccount(account).draw(amount)`, which sends to the locked recipient (the agent EOA); wait for the receipt.
     3. Call through `wrapFetchWithPayment(fetch, new x402Client().register('eip155:*', new ExactEvmScheme(toClientEvmSigner(account, publicClient))))`.
     4. Log the draw transaction plus the settlement transaction from `PAYMENT-RESPONSE`.
3. **Script:**
   - premium $2.50 → paid; premium $2.50 → paid (5.00 used);
   - tip $0.01 → `draw` reverts with the period-limit error, shown as **"refused at 5.01"**;
   - the judge revokes, then runs again → `draw` reverts "revoked", and the agent stops.
4. **Fallback.**
   - Trigger: `/supported` fails within 3 s, or a settle fails.
   - The agent does `draw` + `MUSD.transfer(payTo, amount)` and retries with `X-Baserate-Payment-Tx`.
   - The server checks: the receipt succeeded; a Transfer to payTo for at least the price; age under 10 min; hash unused (DB unique).
   - The UI labels it "direct transfer (x402 facilitator unavailable)".
5. **What we host:** the resource server, the agent runner, and a CLI `pnpm --filter keeper agent --account 0x…` (bring your own key), documented in the README.

## 10. Indexing

- **Wave 1: no subgraph.**
  - Live state comes from RPC.
  - History and evidence come from Blockscout `/api/v2/addresses/{a}/logs` and `/transactions/{h}(/logs)`, called from the browser (CORS `*`, decoded).
  - Keeper-style scans use `getLogsChunked`.
- **Wave 2: Goldsky subgraphs** `baserate-testnet` and `baserate-mainnet`, from one `packages/subgraph` with `networks.json`. `startBlock` = deploy block, or the M1 creation block for Morpho.
- **Data sources:**
  - Morpho: CreateMarket, Supply, Withdraw, SupplyCollateral, WithdrawCollateral, Borrow, Repay, Liquidate, AccrueInterest, SetFee; filtered to M1's id in the mapping.
  - wsMUSD: Deposit, Withdraw, Synced, RedeemInKind, cap events.
  - vMUSD: Deposit, Withdraw, Allocate, Deallocate, ForceDeallocate, cap submit/accept/decrease.
  - Backstop.
  - Factory `AccountCreated` → template BorrowAccount: Opened, Repaid, CreditApproved, Revoked, Drawn.
  - FeeRouter: Flushed, BribePosted. FlashLiquidator: Liquidated. Allocator: Rebalanced.
- **Entities:** Market + MarketDaily, Position, Account, CreditLine, Draw, Liquidation, VaultSnapshot (hourly), WsSharePrice, Bribe, Action.
- **Liquidation safety does not depend on the subgraph;** the keeper reads RPC directly.
- **Envio** is the fallback only if Goldsky blocks us. It runs over RPC with the 10k range cap; backfill is small because our contracts are new.

## 11. Hosting, secrets, CI

- **Vercel** (`baserate-mezo`):
  - Root `apps/web`, Vite preset, Node 24, production branch `main`, a preview deployment per PR. Share only the production alias, since previews may be auth-protected.
  - `vercel.json`: SPA rewrite to `/index.html`; security headers (CSP report-only in Wave 1, enforced in Wave 2 with connect-src set to RPCs, Blockscout APIs, the API host, WalletConnect relays, and challenges.cloudflare.com).
  - Env vars are only `BASERATE_PUBLIC_WC_PROJECT_ID`, `BASERATE_PUBLIC_API_URL`, `BASERATE_PUBLIC_TURNSTILE_SITEKEY`.
- **No secrets in the bundle (the July incident):**
  - Vite `envPrefix: 'BASERATE_PUBLIC_'`; never `define` env and never `loadEnv(mode, cwd, '')`.
  - `scripts/check-bundle.mjs` scans `apps/web/dist` for `0x[0-9a-f]{64}` (minus `bundle-allowlist.txt`: Pyth ids, market ids, typehashes, topics), PEM blocks, `PRIVATE_KEY`, Telegram and Discord token shapes, Turnstile secrets (`0x4AAAAAAA` plus 25 or more characters), and `ghp_` / `sk_`. Any match fails CI.
  - gitleaks on every push.
- **Railway** (project `baserate`):
  - Environments `testnet` and `production` (mainnet), each with its own keys.
  - Services: `worker` (no domain), `api` (domain, healthcheck `/healthz`), `postgres`.
  - Deploy from GitHub `main` with watch paths `apps/keeper/**` and `packages/**`; restart policy on failure.
- **Goldsky:** `goldsky login --token` in CI. Deploys run from a manual workflow.
- **GitHub Actions:**
  - `ci.yml`, with three jobs:
    - Contracts: `foundry-rs/foundry-toolchain@v1` pinned to 1.8.3; fmt check, build, unit tests; fork tests on pinned blocks against public RPCs with `~/.foundry/cache/rpc` cached.
    - TypeScript: pnpm/action-setup, Node 24, `--frozen-lockfile`, biome, `tsc --noEmit`, vitest, build, ABI drift check, bundle scan.
    - gitleaks.
  - Wave 2 adds `slither.yml`, `release.yml` (changesets publishes the SDK) and `subgraph.yml` (build on change, deploy on dispatch).

## 12. Wave 2 off-chain schedule, and what to verify then

**Schedule:**
- **Oct 27–Nov 1:** keeper and API skeleton with Postgres; dispenser voucher mode; subgraph skeleton; publish SDK 0.1.0.
- **Nov 2–5:**
  - Lend page and the vault SDK; jobs `yield.sim`, `wsmusd.sync`, `allocator`.
  - Subgraph v1 (M1, wsMUSD, vMUSD, factory).
- **Nov 6–8:**
  - Mainnet chain toggle, proof-mode banner and address book.
  - Mainnet Railway environment; `caps.depth`, `smusd.watch`, `liq.scan`, canaries; Liquidate page.
- **Nov 9–12:**
  - Credit lines UI, agent and x402 server.
  - Come-back scanner.
  - `fee.flush`, with the **first mainnet bribe at Thu Nov 12 01:05 UTC** (latest Wed Nov 18 23:00 UTC).
- **Nov 13–15:** RiskLens dashboard, the full Evidence page with keeper feed, `JUDGES.md` v2.
- **Nov 16–22:** keeper live with alerts; watch the Nov 19 flip.

**To verify during implementation:**
1. Goldsky: the subgraph `network:` slug (candidates `mezo-testnet`, `mezo_testnet`, `mezo`); free-tier limits; topic-filter support.
2. The `@x402/hono` 2.28 middleware API, `declareEip2612GasSponsoringExtension` arguments, and the `x402Client` hook names. Check the mainnet facilitator signers' BTC balances (`0x5Bd6…5A67`, `0x7B38…CEFA`).
3. Mainnet bribes `0x80cCC053a90fc310150603C0274faf0a998B0e1a` (CL200 gauge `0x21d7AcB0D128fA039064B6aCe8Db88c0aDe0209E`) and `0x94A9A494872BF7231D8378d0Aef7d32BA552E305` (vAMM gauge `0x8Be20a5fF57E381025aE5E3A121B697269569AaF`):
   - The bribe contracts are unverified on Blockscout, so fork-simulate `notifyRewardAmount(address,uint256)`.
   - Check `isAlive` and MUSD whitelisting on PoolsVoter `0x4823…1f03`.
4. The QuoterV2 `0x4e56…5dc7` struct for Slipstream (uses tickSpacing).
5. The Vault V2 sentinel decrease-only functions on factory `0xA64f…`.
6. The BorrowerOperationsSignatures ClaimCollateral typehash and `getNonce` (`0xB57a…df7a`).
7. Railway: Node 24 build, sealed variables, Postgres plan.
8. Vercel with pnpm 11.
9. Whether the RainbowKit / WalletConnect bundle needs `vite-plugin-node-polyfills` 0.28.0 (Buffer / global errors).
10. The testnet WebSocket RPC (unverified; poll over HTTP instead).

## 13. Main risks

- **Test BTC and MUSD supply:** ask DevRel at hour 0; Wave 1 is sized to about 250 MUSD.
- **Single testnet RPC:** show a banner, and the keeper backs off.
- **Facilitator downtime:** the direct-transfer fallback covers it.
- **Canaries not liquidatable when a judge arrives:** keep them within about 0.3% of the line and show the "liquidatable if BTC ≤ $X" hint plus the past-liquidation evidence.
- **Solo bandwidth:** follow the Wave 1 cut order; interface-first ABIs keep the UI unblocked.

### Critical Files for Implementation
- /Users/oluwademilade/Desktop/mezo/packages/sdk/src/chains.ts
- /Users/oluwademilade/Desktop/mezo/packages/sdk/src/actions.ts
- /Users/oluwademilade/Desktop/mezo/apps/web/src/routes/borrow.tsx
- /Users/oluwademilade/Desktop/mezo/apps/keeper/src/worker.ts
- /Users/oluwademilade/Desktop/mezo/.github/workflows/ci.yml
