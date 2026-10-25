# Mezo Buildathon — Research, 5 Ideas, Champion (Baserate) & Build Plan

## Context
The user is entering the Mezo Buildathon on AKINDO ("Build with MUSD and MEZO"). The prize is $7k in MEZO: Wave 1 $2k (closes 2026-10-26 15:00 UTC), Wave 2 $5k (build and submit Nov 2–15, judged Nov 16–22, demo day Nov 23).

The goal is the **#1 spot**. Scoring:

| Criterion | Weight |
|---|---|
| Mezo Integration | 30% |
| Product & Business Viability | 30% |
| Technical | 20% |
| UX | 10% |
| Materials | 10% |

Payouts are proportional to points.

How we got here:
1. Verified research: seven researchers plus a critic, with on-chain reads.
2. An ideation tournament: 5 ideators → 8 candidates → 3 persona judges → 2 red teams per leader.
3. A design pass that checked contract and off-chain interfaces against the live chain.

User decisions:
- **Build the complete product, as extensive as it needs to be, and put our best foot forward. Ignore the deadline:** nothing is cut or rushed to make a wave close.
- **Mainnet proof mode with ~$1–3k.**
- **Solo + Claude Code.**

The working directory `/Users/oluwademilade/Desktop/mezo` is empty (greenfield) and becomes the repo root, published as `github.com/OoJae/baserate`.

**Submission timing.** We submit once, with the complete product. The full scope runs past the Wave 1 close (Oct 26), so the first submission lands in the **Wave 2 window (Nov 2–15)**. Nov 15 is the program's last submission date. This gives up the $2k Wave 1 pool and an earlier-wave history, but Wave 2's pool is $5k and new entrants have taken #1 in other AKINDO programs.

## Research summary (verified 2026-10-23/24)
- **Retail MUSD credit collapsed.**
  - Mainnet troves fell 104 → **1**.
  - MUSD trades at **~$0.989**, below the ~$0.9925 redemption floor.
  - That caused 681 redemptions (1.28M MUSD) in 30 days, wiping out every low-ratio trove.
- **MUSD supply is 29.5M:**
  - 14.95M PCV bootstrap loan, 14.17M of it idle in the Stability Pool;
  - 14.5M of permissioned Enclave debt;
  - 14.5k of retail troves.
- **Morpho Blue is live on Mezo but nearly empty.**
  - Mainnet `0x5658…A311` (LLTV 0.86) and testnet `0xCe1d…5a73` (LLTV 0.77) both allow permissionless markets.
  - There is one market (BTC→mUSDC, ~$66k borrowed, 16 borrowers ever).
  - Nothing lends MUSD anywhere.
- **sMUSD is not ERC-4626** (1:1 shares + `claimYield()`).
  - Its realized yield is ~3.2%, but 63% of that came from redemption fees that are running out; steady state is ~1.2%.
  - The 10k MUSD/week veBTC voter payout is backlog-funded, with ~6–9 weeks left.
- **Other facts:**
  - MEZO is down 98% (FDV ~$3M).
  - MUSD exists on Ethereum and Base via NTT, but not on BNB; none of the 40 submissions are on Base or Ethereum.
  - Clean BTC/MUSD liquidation depth is ~0.1 BTC.
- **What judges want:**
  - "Close to a live product on mainnet"; mainnet valued more.
  - Mockups "very hard to win".
  - Loss of funds is fatal.
  - Every feature testable with faucet funds.
  - Engineers verify that the code does what the UI says.
  - Leadership agenda: lending markets, "Aerodrome for Lending", MUSD cross-chain (Base first), MEZO utility, a simpler Earn.
- **Competition:**
  - Saturated categories: payments (13+), trove alerts and protection (7+), looping (5), escrow, x402.
  - Strongest entries: Pylon, mbLP, Mezodot, Lockwatch. Pipeline: Cosign, Thaw, Latch, Keel, Payung.
  - Open whitespace: a BTC→MUSD market on Mezo's Morpho, composable sMUSD, Base/Ethereum, USDC exit liquidity.

Full brief: `/Users/oluwademilade/.claude/projects/-Users-oluwademilade-Desktop-mezo/00ff7d81-7b20-4923-be48-7b725f7b6a59/tool-results/bva1up2zy.txt`

## Five candidate projects
| # | Project | What it is | Score (weighted /10) | Verdict |
|---|---|---|---|---|
| 1 | **Baserate** | Redemption-free BTC→MUSD credit on Mezo's own Morpho. Includes a Vault V2 MUSD lending vault whose idle cash earns sMUSD, an ERC-4626 sMUSD (wsMUSD), zero-capital liquidations plus a backstop, and fees routed to sMUSD and veBTC voters | 8.6 → **~8.0–8.2** after red-team fixes | **Champion** |
| 2 | Lockstep | Borrow MUSD against veBTC; loans settle at lock expiry instead of being liquidated | 7.85 → 7.3–7.4 | Most Mezo-native idea, but only ~24 eligible NFTs (~4 BTC), lender economics don't clear, and Thaw is a near-twin |
| 3 | Portside | MUSD-collateral USDC credit on Base Morpho, priced by a Wormhole-relayed Mezo oracle | 6.65 | Base whitespace, but thin Mezo integration and cross-chain oracle risk. Becomes Baserate's Phase 3 |
| 4 | Sigil | Passkey Safes (P256VERIFY) with gas paid in MUSD, reachable from Base | 6.6 | Best UX and best Track 2 entry, but shallow integration |
| 5 | Tab | Capped, revocable BTC-backed MUSD credit lines for apps and agents | 6.47 | All judges said it should be a module of #1, so it is grafted into Baserate |

Rejected:
- **BoostBook:** both red teams killed it; boost is oversupplied.
- **Par:** depositors would be structurally long a sub-peg MUSD.
- **Ferry:** cross-chain complexity for a ~1–3% yield.

## Champion: Baserate — why it wins
- **Integration (30%)**
  - It composes Mezo's own rails on real contracts:
    - Morpho Blue + Vault V2, on the same template as Mezo's USDC Lending Vault;
    - sMUSD internals;
    - the Skip BTC/USD precompile + Pyth MUSD;
    - native BTC / `msg.value`;
    - Tigris pools + PoolsVoter gauge bribes;
    - BorrowerOperationsSignatures / CollSurplusPool.
  - It produces three ERC-4626 tokens: wsMUSD, vMUSD and bMUSD.
- **Viability (30%)**
  - It fills the two top verified gaps: nothing lends MUSD, and there is no redemption-free BTC credit.
  - It is the roadmap's "broader suite of lending markets".
  - It is pitched as a complement, not a rival: it serves borrowers while MUSD sits below the redemption floor, and hands demand back to 1% troves when the peg heals.
- **Technical (20%)**
  - No new lending engine: it runs on audited Morpho.
  - Immutable core and a guarded oracle.
  - Market-wide limits through the gated collateral receipt, and caps linked to liquidation depth.
  - Pauses never block exits.
  - Fork, fuzz and invariant tests, plus a public AI-audit ledger.
- **Versus the field:**
  - Pylon, mbLP, Keel, Lockwatch and Payung route through troves, which sit first in mainnet's redemption queue.
  - Mezodot is bespoke, unaudited lending.
  - Cosign uses MEZO collateral and an admin oracle on its own testnet Morpho.
- **Honest weaknesses:**
  - Thin demand: Mezo's Morpho has had 16 borrowers ever.
  - Thin liquidation depth, so mainnet caps are small.
  - Indirect MEZO utility.
  - We claim only "the first BTC→MUSD market on Mezo's official Morpho, on mainnet, with a stale-price-rejecting oracle", and we credit prior art.

Full concept (mechanism, Earn integration, judge journey, business case, demo script): `/Users/oluwademilade/.claude/projects/-Users-oluwademilade-Desktop-mezo/00ff7d81-7b20-4923-be48-7b725f7b6a59/tool-results/bbf7winif.txt`

Red-team findings: `/Users/oluwademilade/.claude/projects/-Users-oluwademilade-Desktop-mezo/00ff7d81-7b20-4923-be48-7b725f7b6a59/tool-results/b7sigvbff.txt`

## What we build (the complete product)
The design specs are implementation-ready, with verified ABIs and addresses:
- **Contracts:** `jq -r '.result.plans[] | select(.key=="contracts") | .plan' /private/tmp/claude-501/-Users-oluwademilade-Desktop-mezo/00ff7d81-7b20-4923-be48-7b725f7b6a59/tasks/whswa376r.output`
- **Off-chain:** `/Users/oluwademilade/.claude/projects/-Users-oluwademilade-Desktop-mezo/00ff7d81-7b20-4923-be48-7b725f7b6a59/tool-results/bj0fwq9sd.txt`

The first implementation step copies both into `docs/design/`.

### Contracts (Foundry; solc 0.8.28, evm `cancun`; no proxies, ERC-2771 or `tx.origin`)

**Core credit stack**

- **`BtcMusdOracle`** (immutable Morpho `IOracle`)
  - BTC price comes from Skip `0x7b7c…0015`, rejected if older than 60 s.
  - Pyth BTC acts as a ±10% band, applied only while Pyth is ≤3,900 s old.
  - The MUSD leg is Pyth MUSD clamped to [1.00, 1.02], or 1.00 if stale. This undervalues collateral by ~1.1% at today's peg; we disclose it.
  - `price() = btcUsd·1e36/musdUsd`.
  - `status()` never reverts and feeds the UI and keeper.
  - One precompile call per read.
- **`WsMUSD`** (immutable ERC-4626 over sMUSD)
  - Internal accounting. Harvests via `claimYield` and re-deposits.
  - 3-day linear vesting, previewable, so a same-block sandwich gets nothing. Donations vest with no instant part.
  - Never calls `PCV.distributeMUSD`: sMUSD already does when `pcv` is set, and testnet's `pcv` is 0.
  - No pause. The cap can only be raised (250k, 72 h timelock).
  - `redeemInKind`, and a 1 MUSD dead seed.
- **Collateral receipt** (working name brBTC; choose a non-clashing symbol, since "brBTC" is Bedrock's)
  - Wraps native BTC 1:1.
  - Only factory-registered accounts can mint.
  - Transfers are allowed only account→Morpho or Morpho→anyone. Anyone can unwrap.
  - This makes the router's limits apply to the whole M1 market.
  - Accounting uses `totalSupply` only.
- **`BorrowAccount` clones + `BorrowAccountFactory`**
  - EIP-1167 clones with an immutable owner argument; CREATE2 salt = (owner, profile).
  - Functions:
    - `openAndBorrow{value}`, `borrow`;
    - `addCollateral` (never pausable);
    - `repay`;
    - `repayAndWithdraw[WithPermit]`, an **oracle-free exit**;
    - `withdrawCollateral`.
  - Limits:

    | Profile | Testnet ceiling / cap | Mainnet ceiling / cap |
    |---|---|---|
    | STANDARD | 62% / 0.01 BTC | 71% / 0.02 BTC |
    | CANARY (operator-only) | 76.75% / 0.002 BTC | 85.75% / 0.002 BTC |
    | Global borrow cap | 5k | 2k |

  - 10 bps origination fee, paid to a fee recipient behind a 48 h timelock.
  - Governor and sentinel roles: raises are timelocked 48 h, decreases are instant. A pause never blocks repay, withdraw, unwrap or liquidation.
  - Hooks built in from the start: the credit-line module, `comeBack()` (`claimCollateralWithSignature` into the caller's own clone), `supplyIdle` and `receive()`.
  - Roles are passed explicitly, because under the CREATE2 deployer `msg.sender` is the deployer contract.
- **M1 market** = `{MUSD, receipt, BtcMusdOracle, AdaptiveCurveIrm, LLTV}`
  - Testnet: `0xCe1d…5a73`, IRM `0x0c97…7441`, LLTV 0.77 (7.41% liquidation incentive).
  - Mainnet: `0x5658…A311`, IRM `0x3760…c1e7`, LLTV 0.86 (4.38% incentive).
- **`MusdDispenser`** (testnet only)
  - Starts in open mode: 25 MUSD per address per day, 300 MUSD per day overall.
  - Switches to voucher mode behind Turnstile once the API exists.
  - Judges need it to top up interest before repaying.

**Lending, liquidation and credit layer**

- **`vMUSD`**: a Vault V2 created with VaultV2Factory (mainnet `0xA64f…40A6`, testnet `0x25eB…b239`)
  - Adapters: MorphoMarketV1AdapterV2 → M1, and a `WsMusdLiquidityAdapter` that deposits `min(assets, maxDeposit)`.
  - **Both absolute and relative caps per id.** The relative cap defaults to 0, which blocks every allocation.
  - `maxRate` set at deploy; fees 0; 48 h timelocks.
  - The Safe ends up as owner and curator. 100 MUSD dead seed.
- **`BaserateAllocator`**
  - Keeps an M1 buffer of at least max(2k MUSD, 15% of supply).
  - Moves the excess into M1 only when M1 beats wsMUSD's 7-day APY.
  - At most 1k per call, with a 1 h cooldown.
- **`FlashLiquidator`**: `Morpho.liquidate` → `onMorphoLiquidate` → unwrap → sell through the best of the Backstop, CL200 (tickSpacing 200) or the vAMM (`Route[]`), within a price-impact bound.
- **`Backstop`** (bMUSD)
  - Buys seized BTC at Skip × (1 − incentive/2).
  - 7-day withdrawal queue, paid at the lower of NAV at request and NAV at claim.
  - Premiums vest over 7 days; BTC is marked at Skip × 0.95.
- **`FeeRouter`** (immutable split)
  - 40% to sMUSD via `receiveProtocolYield`.
  - 40% as MUSD bribes on the CL200 gauge `0x21d7…209E` (bribe `0x80cC…0e1a`) and the vAMM gauge `0x8Be2…9AaF` (bribe `0x94A9…E305`). Testnet uses gauge `0x72D8…Cd2c`.
  - 20% to the treasury.
- **`RiskLens`**: read-only views of the oracle, liquidation depth, caps, the backstop and the trove queue.
- **`CreditLineModule`**
  - Terms: `{maxOutstanding, periodLimit, period, maxLtvBps, expiry, recipient}`.
  - Approval by ECDSA or EIP-1271; `draw`; instant `revoke`.
  - Limits: ≤250 MUSD outstanding per account, ≤50 MUSD per day per spender.
  - The recipient is the agent's **EOA**, because x402 payers must sign.
  - Module approval goes through the factory's 48 h timelock.
- **Governance asks** (after the hackathon, each with a fallback):
  - a vMUSD vault gauge;
  - the Morpho fee switch on M1, paid to sMUSD;
  - wsMUSD whitelisting;
  - an sMUSD strategy packet. This is fork-only: it supplies M1 directly and never re-enters sMUSD.

### Off-chain (pnpm monorepo; TypeScript 5.9.3)
- **`apps/web`**: a Vite + React 19 SPA.
  - Stack: wagmi **2.19.5** (RainbowKit 2.2.11 needs wagmi 2), viem 2.57.11, TanStack Router and Query, Tailwind 4.
  - Hosted on Vercel at `baserate-mezo.vercel.app`, with **zero secrets** (env prefix `BASERATE_PUBLIC_`).
  - Mezo chains are defined manually: viem's `rpc.mezo.org` is dead, so mainnet gets fallback RPCs + multicall3, and testnet uses `rpc.test.mezo.org`.
  - EVM wallets only; Safes take an approve path. A NetworkGuard detects stale wallet RPCs.
  - Pages: Borrow, Lend (vMUSD), Save (wsMUSD), Liquidate (canaries), Credit lines + agent console, Come-back scanner, RiskLens dashboard, Evidence. Mobile layout included.
- **`packages/abi`**: `@wagmi/cli` output plus `deployments/<chainId>.json`.
- **`packages/sdk`** (`@baserate/sdk`, published to npm): chains, math, reads, actions, permit, and `getLogsChunked` (works around the 10k-block cap).
- **`apps/keeper`** on Railway: a worker, an API and Postgres.
  - Worker jobs:
    - wsMUSD sync, after `PCV.distributeMUSD` on mainnet;
    - the allocator;
    - a liquidation scan feeding FlashLiquidator;
    - depth-linked cap cuts;
    - canaries;
    - a watcher for sMUSD/Morpho upgrades, pinned per chain (testnet sMUSD `0x92D1…`, mainnet `0xB33C…`);
    - a labelled testnet yield simulator (~1% APR, budget-capped);
    - a FeeRouter flush at Thu 01:05 UTC.
  - Alerts go to Telegram.
  - API endpoints: dispenser vouchers, an x402 resource server (`facilitator.vativ.io`, `@x402/*` 2.28.0 with the gas-sponsoring extension), the agent runner, and `/v1/evidence`.
- **Goldsky subgraph**: Morpho events filtered to M1, plus wsMUSD, vMUSD, Backstop, factory and accounts, and FeeRouter.
- **CI** (GitHub Actions):
  - Foundry: fmt, build, unit tests, fork tests at pinned blocks with a cached RPC.
  - TypeScript: biome, `tsc`, vitest, web build.
  - Guards: ABI drift check, bundle secret scan, gitleaks, Slither.

## Build plan: dependency-ordered phases, each closed by a quality gate
No deadline-driven cuts. A phase starts once its dependencies pass their gate. Independent tracks (contracts, web, keeper and subgraph) run in parallel git worktrees. Rough effort for solo + Claude Code is about 2.5–3 weeks, which puts submission inside the Wave 2 window (aim ~Nov 12–13; it closes Nov 15).

### Phase 0: Setup (≈0.5 day)
**User-only actions:**
1. **Test funds.** Join the Mezo Discord, ask for the Developer role, and request test BTC/MUSD (target 0.05 test BTC or 2–5k test MUSD). Take the faucet drip daily (0.001 BTC ≈ 78.6 MUSD).
2. **Deployer key.** Create a fresh deployer EOA in a Foundry keystore (`cast wallet new` → `cast wallet import baserate-deployer --interactive`). Keep its password file outside the repo (chmod 600) for testnet automation. Mainnet broadcasts happen only with your explicit go-ahead.
3. **2-of-3 Safe signers.** Create three separate keys for the Safe (needed before Phase 7).
4. **Reown projectId.** Create one, allowlisting `localhost` and `*.vercel.app`.
5. **Logins.** Confirm `gh` (OoJae), Vercel (`oojae`) and Railway (`OoJae`).
6. **Mainnet capital.** Have the ~$2–2.8k ready before Phase 7.

**Claude:**
- Scaffold the monorepo and pin dependencies: OZ v5.7.0, morpho-blue `main@9cf6d5b` (GPL), morpho-blue-irm v1.1.0, forge-std v1.17.0, vault-v2 tag `2026-08-13`.
- Set up `foundry.toml` profiles, CI, and gitleaks.
- Deploy a placeholder to Vercel.
- Copy the design specs into the repo.

**Gate:** CI green; a fork smoke test passes with an etched `SkipMock` (Mezo precompiles hang in anvil forks).

### Phase 1: Core credit stack (≈2–3 days)
**Build:** oracle, receipt, `BorrowAccount`/`Factory` (with all hooks), `WsMUSD`, `MusdDispenser`.

**Tests:**
- Unit and fuzz tests.
- Invariant suites (core invariants listed under Verification).
- Mainnet- and testnet-fork suites, with separate sMUSD implementations per chain and Skip mocked at the fork-block price.

**Deploy to testnet:**
1. Oracle.
2. wsMUSD, with its seed.
3. Factory.
4. `createMarket`, asserting the market id.
5. Seed M1.
6. Fund the dispenser.
7. **Real `openAndBorrow` + `repayAndWithdraw` transactions.**
8. Verify on Blockscout and Sourcify, and write `deployments/31611.json`.

**Gate:** all suites green; Slither/Aderyn triaged; live testnet evidence recorded.

### Phase 2: Lending and liquidation layer (≈3–4 days)
**Build and test:** vMUSD and its adapters (full configuration: absolute and relative caps, `maxRate`, then timelocks), allocator, FlashLiquidator (with a `BtcPrecompileMock` for fork tests), Backstop, FeeRouter, RiskLens.

**Tests:** invariant suites for the backstop and allocator.

**On testnet:**
- deposit into vMUSD, then the allocator split;
- **canary liquidation via FlashLiquidator, with lenders made whole**;
- a FeeRouter bribe on the testnet gauge and an sMUSD donation.

**Gate:** all of the above shown live on testnet; suites green.

### Phase 3: Credit lines and come-back (≈1.5–2 days)
**Build:**
- CreditLineModule. Submit its approval to the factory timelock on testnet as soon as the code is final (48 h).
- The x402 agent flow: draw → pay → "refused at 5.01" → revoked, with a direct-transfer fallback.
- The come-back flow (CollSurplusPool scanner → signed claim into the caller's own clone). It is fork-tested, because mainnet holds the real surplus.

**Gate:** the agent demo passes live on testnet, and the come-back fork test passes.

### Phase 4: Off-chain product (≈4–5 days; starts in parallel with Phase 1, using interface-first ABI stubs)
- SDK + ABI packages.
- Every web page.
- Keeper worker and API on Railway, in a testnet environment.
- Dispenser voucher mode.
- Goldsky subgraph.
- Evidence feed.
- Docs: `JUDGES.md` (a path a judge can finish in ≤5 minutes with faucet funds), `SECURITY.md` + threat model, and `EVIDENCE.md`.

**Gate:** a **Playwright E2E of the full judge journey** from a fresh testnet wallet is green in CI; the keeper runs cleanly for 24 h; the subgraph is synced.

### Phase 5: Security hardening (≈2 days)
- Two AI audit rounds with a public findings ledger. All High and Medium findings are fixed, or documented with a rationale.
- Longer invariant campaigns.
- Per-flow checks of the 20-precompile-call budget.
- Bundle secret scan and gitleaks clean.
- A final testnet redeploy if any contract changed, with the Wave-agnostic registry updated.

**Gate:** the audit ledger is closed and every suite is green on the final bytecode.

### Phase 6: Mainnet proof mode (≈1–2 days, plus calendar waits)
**Deploy** on Mezo mainnet, with the factory's fee recipient set to FeeRouter in its constructor:
- oracle, wsMUSD, FeeRouter;
- factory, then M1 at LLTV 0.86;
- vMUSD;
- allocator, Backstop, FlashLiquidator, RiskLens, CreditLineModule. Its approval takes 48 h.

Caps are ≤2k MUSD. The Safe becomes owner and curator.

**Budget (~$2–2.8k):**

| Item | Amount |
|---|---|
| vMUSD seed | ~1,000 MUSD |
| Backstop | ~500–800 MUSD |
| Team borrow | ~0.005 BTC |
| Canary | 0.002 BTC |
| Bribes and donations | ~50–100 MUSD |
| Gas | <0.001 BTC |

**Evidence transactions:**
- borrow and repay;
- allocator move;
- sMUSD donation;
- canary liquidation. This needs a real BTC price move; canaries sit about 0.3% from the line.
- **FeeRouter bribe**, posted between a Thursday 01:05 UTC and the following Wednesday 23:00 UTC, so voters can claim after the next Thursday flip. Aim for a flip during judging, e.g. post Nov 12–18 so it is claimable Nov 19.

**Keeper:** the mainnet environment goes live, with watchers covering Enclave #6114's Nov 12 lock date.

**Gate:** every evidence transaction is recorded and re-checked with `cast`.

### Phase 7: Materials and submission (≈1–2 days)
- **Deck:** problem in numbers → mechanism → architecture → integration map → security → live mainnet evidence → honest sizing and business case → competitors and prior art → roadmap → team.
- **2-minute video:** follows the concept's demo script. Playwright capture of the live flows, HyperFrames title and data cards, voiceover.
- **AKINDO form:**
  - category "BTC lending · stablecoin credit · yield";
  - Track 1 (Track 2 secondary, via credit lines);
  - chain Mezo; status new; readiness: mainnet;
  - milestones: audit + cap growth → vault gauge + fee switch → Base phase;
  - written criterion by criterion, with verifiable links.
- **Gate:** submit in the Wave 2 window.

### Phase 8: During judging and after (Nov 16–23 and beyond)
**During judging:**
- Keeper live with alerts.
- Respond to judge comments.
- Watch the Nov 19 epoch flip.
- Demo day Nov 23.

**Afterwards:**
- Governance asks.
- Third-party audit, then a Mezo Market listing.
- Ignition and Founder grants.
- Cap growth tied to liquidation depth.
- Lending-gauge sidecar.
- Base phase (Portside design).

**Naming:** "Baserate" is a working name. `baserate.vercel.app` and `.xyz` are taken, so we use `baserate-mezo.vercel.app`. Rename at any point before the deck.

## Verification
**Contract tests** (`forge test`):

| Suite | Target |
|---|---|
| Unit | ~130 |
| Fuzz | ~30 |
| Invariant suites | 5: core, wsMUSD, backstop, credit, allocator |
| Fork tests | ~33 across mainnet and testnet |
| Live testnet scripts | 6+ |

- Fork tests use the etched Skip mock, seeded with the fork-block price via `vm.rpc`, plus a `BtcPrecompileMock` that mirrors native balances.
- Key invariants:
  - wsMUSD backing ≥ `totalAssets`, and its share price never falls;
  - a same-block donation doesn't move `totalAssets`;
  - receipt balance ≥ supply, and every M1 collateral holder is a registered account;
  - clones hold 0 MUSD and 0 receipt after every call;
  - LTV after any action ≤ the ceiling, and M1 borrows ≤ the global cap;
  - **`repayAndWithdraw` succeeds even with the oracle reverting**;
  - credit outstanding ≤ allowance;
  - backstop NAV moves only on realized PnL;
  - allocator moves stay within caps.

**Live testnet scripts** (real precompiles):
- an oracle probe (Skip age ≤60 s);
- open and borrow;
- repay and exit with a permit (native BTC returned);
- vMUSD allocation;
- canary liquidation;
- bribe;
- agent draw.

**On-chain checks** with `cast`:
- code exists at every registry address;
- Blockscout and Sourcify show the source verified;
- `idToMarketParams(M1)` matches;
- roles, caps and timelocks are as documented;
- `oracle.status()` is fresh;
- each flow uses ≤20 precompile calls.

**UI checks:**
- Playwright E2E of the judge journey runs in CI;
- the bundle scan and gitleaks report no secrets.

**Mainnet evidence:** transaction hashes for borrow, repay, allocator move, canary liquidation, FeeRouter bribe and sMUSD donation. Each is re-checked with `cast receipt` and state reads, and listed in `docs/evidence/` and the Evidence tab.

## Main risks
| Risk | Mitigation |
|---|---|
| Test-fund shortage | DevRel ask in Phase 0; faucet drips daily; dispenser |
| The single testnet RPC fails | UI banner; keeper backoff |
| Oracle freeze (up to ~65 min on divergence; a Skip outage is unbounded) | Disclosed; the oracle-free exit always works |
| An sMUSD proxy upgrade | `redeemInKind` makes no sMUSD state calls; the watcher cuts caps |
| Competitors submit (Cosign, Thaw, Latch) | Narrow claims; mainnet evidence; breadth and depth of the full stack |
| Thin demand or liquidation depth | Honest sizing; caps tied to depth; complement framing |
| Calendar-bound steps (48 h timelocks, Thursday epochs, canary price moves) | Submit timelocked operations as soon as code is final; schedule the bribe window; keep canaries near the line |
| A long build for a solo builder | Phase gates; parallel worktrees; the Nov 15 program end is the only hard stop |
