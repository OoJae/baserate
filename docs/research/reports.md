# Research report: research:judges-priorities

# Mezo Buildathon: what the judges will reward and what Mezo leadership wants built

*Research cut-off: 2026-10-23. Every claim has a source. **[V]** means verified directly from an API, an on-chain read or a primary page. **[I]** means inference. No browser tools were used.*

## 0. TL;DR

- **No one holds the AKINDO "judge" role yet.** The Judges tab filters community members on `role === "judge"`, and all 4 members of the Mezo community are `admin`. So the tab renders "No judges yet". The front-end code lets admins score (`canScore = isAdmin || isJudge`). The four people with scoring rights are:
  - `illshin`, the AKINDO founder
  - `notmartin`, on the AKINDO side
  - `duygu_kam`, a Mezo-only account
  - `civ_defi_mezo`, a Mezo-only account

  [V: `api.akindo.io/public/communities/xKmmnkwV7ImEV1rjZ/members`; the AKINDO `_app` bundle role enum `W0={admin,judge,product-reviewer}`; the judges component in chunk `1325-8d84c498298d1213.js`.]
- **The only explicit judge guidance so far** comes from `civ_defi_mezo` on 2026-10-19: *"it works as expected; users can fully test all features; no clear security flaws"*. On whether builders must use existing MUSD contracts, the reply was *"Feel free to build :)"*. [V: `api.akindo.io/public/threads?type=waveHack&parentId=OVOO0gdrVU8379D10`]
- **AKINDO ships an "AI Review Editor" for WaveHacks.** It drafts a 0–10 rating per criterion (weighted by the criteria weights), a Recommendation, a Confidence level, a GitHub "analyzed / not analyzed" flag, Strengths, Concerns, Required Follow-ups and an "AI Rank Score". Judges then type in an integer **Point** score, which sets each project's share of the pool, plus a comment of up to 1,000 characters. The editor labels its drafts: "AI-generated placeholder scores and comments. Please edit as needed." [V: bundle `pages/wave-hacks/[waveHackId]/ai-review/[waveId]-06b0cbe4d6b2c6f1.js`] Whether Mezo's judges use it is unconfirmed [I].
- **Leadership's 2026 agenda** has six threads:
  - make MUSD liquid and usable where DeFi users already are;
  - deepen MEZO utility (MEZO Gauges were called the "first step");
  - simplify Earn;
  - expand lending markets (CEO Matt Luongo's "Aerodrome for Lending", where emission votes underwrite lending markets);
  - payment rails for AI agents;
  - since the 2026-10-05 veBTC exploit, cut the attack surface (the incident report's term is "risk surface").
- **The economic backdrop** shapes what "business viability" means:
  - MUSD has traded about 1% below peg for at least 30 days.
  - Mezo's on-chain mUSDC/MUSD concentrated-liquidity pool holds about 5.33M MUSD against about 8.5k mUSDC.
  - MEZO is down about 98% from its all-time high (market cap about $1.5M).
  - Projects that add MUSD demand or exit liquidity, or real MEZO utility, without adding risk speak directly to the leadership's problems [I].
- **The competitive bar is already high.** In Track 1:
  - mbLP has 78 tests plus invariant and fork tests, no admin keys, and documents every transaction.
  - Pylon and Coil do flash leverage on real troves.
  - MezoRoute runs a verified, capped executor on mainnet.

## 1. Who judges: identities and roles

| AKINDO slug | Role in API | Who (evidence) | Confidence |
|---|---|---|---|
| `illshin` | admin | Shinichiro Kinjo; profile reads "Founder of AKINDO"; GitHub `shinichirokinjo`. Posts the official program messages in the thread. | High [V] |
| `notmartin` | admin | X `@Damiclone`, GitHub `mandatedisrael`, profile "i build stuffs". Listed skills include Solidity, DeFi and Security Auditing. Member of 9 AKINDO communities (Linera, Filecoin, Polygon, 0G, Midnight, Moca, etc.), so most likely AKINDO DevRel doing the Stage-1 screening. | Medium [I] |
| `duygu_kam` | admin | Account belongs only to the Mezo community; empty profile. Probably Mezo or Supernormal staff, but the identity is unverified. | Low [I] |
| `civ_defi_mezo` | admin | Mezo-only account; the handle suggests the Mezo DeFi team. Gave the judging-priority answer quoted above. | Medium [I] |

The program page says Stage 1 is AKINDO DevRel screening and Stage 2 is "Mezo's core team" allocating points ([AKINDO API](https://api.akindo.io/public/wave-hacks/OVOO0gdrVU8379D10)).

Mezo people tied to the program:
- **Andre Coutinho** led kickoff session 1. He is the byline on the Supernormal Foundation's 2026 Roadmap, the H1 review and the Buildathon post; his exact title is unverified.
- **Dymitr Paremski** led the technical session. On GitHub he is `dimpar` with company `mezo-org`. He has 44 commits to `mezo-org/musd` and 28 to the docs (Pyth feeds, the MUSD bridge, validator gauges), and helped ship cross-chain MEZO to Robinhood Chain (mezod PR #740).
- **Matt Luongo** is founder and CEO.

Engineers likely in the "core team" pool (their roles are verified; whether they judge is not):
- Antonio Salazar Cardozo, Thesis CTO, author of the security posts.
- Piotr Dyraga, author of the October incident report.
- Ryan Watts (`rwatts07`), top MUSD contributor, bio "DeFi Tech Lead | Protocol Engineering, Lending & Mechanism Design".
- William Pyke, author of the MEZO Gauges post, owner of the docs and the community-projects page.

## 2. How the scoring works

- **Weights** ([AKINDO API](https://api.akindo.io/public/wave-hacks/OVOO0gdrVU8379D10) and the [Terms of Participation](https://docs.google.com/document/d/1oY1hzzub2l_jHdovmsAaE3YBuRJh0_UQXxL1Zd2g3pE/export?format=txt)): Mezo Integration 30%, Product & Business Viability 30%, Technical 20%, UX 10%, Materials 10%.
- **The weights shifted from Hackathon 1.** In September 2025 they were Integration 30, Technical 30, Business 20, UX 10, Presentation 10 ([blog](https://mezo.org/blog/the-mezo-hackathon-build-bitcoin-finance-in-4-weeks/)). This Buildathon moved 10 points from Technical to Business Viability. **[I]** Fit with the ecosystem and real utility now weigh as much as integration depth.
- **Timeline:**
  - Wave 1: submissions due 2026-10-26 15:00 UTC, judging until 2026-11-01, pool $2,000.
  - Wave 2: build Nov 2–15, judging Nov 16–22, pool $5,000.
  - Demo day: Nov 23.
  - 40 submissions so far.
  - Payout is proportional to points, paid in MEZO at the 14-day TWAP after KYB.

  [V: AKINDO API `activeWave`]
- **Chain discrepancy.** The Terms list "Mezo, Ethereum, Base, BSC, **or Robinhood**". The AKINDO page lists only the first four. MEZO was deployed to Robinhood Chain (chainId 4663) on 2026-10-12 ([mezod PR #740](https://github.com/mezo-org/mezod/pull/740)).
- **How concentrated rewards get in AKINDO point mode varies by program.**
  - SoSoValue: points spread across about 26 or more projects, top score 15 points ≈ $226 in that wave.
  - Midnight: top two scored 30 and 23 points.

  [V: AKINDO `product-summaries` API]

## 3. What Mezo has rewarded before

**Hackathon 1** ([Encode, Oct–Nov 2025](https://mezo.org/blog/mezo-hackathon-winners/)): about 400 participants, 37,500 MUSD across 9 winners.
- The Advanced DeFi track was framed as *"treat Mezo as proper market infrastructure: keeper systems, liquidation tooling, structured risk, and yield mechanisms on top of MUSD."*
  - 1st: **TrovePilot**, permissionless keeper automation for batch liquidations and hinted redemptions.
  - 2nd: **BTCShield**, option-style rescue of unhealthy positions.
  - Community award: StratumFi, self-repaying loans.
- Other tracks: KhipuVault, BitSpend, CreatorBank, Invoiced, BountyPay, MezoLotto.

**Hackathon 2** ([Apr–Jun 2026](https://mezo.org/blog/announcing-mezo-hackathon-2-winners/)): 64 projects from 81 builders.
- *"the engineering team scoring submissions on working demo quality, code, testnet deployment, and protocol integration."*
- Winners by track:
  - Bitcoin Banking: Cermin (auto-managed trove), TreasuryOS, AdaptiveGuard.
  - Supernormal dApp: Cark (savings circles backed by BTC), MezoPay, SuperPage (x402).
  - MEZO Utilization: Mezoir (intent agent for the ve-economy), BynD (pooled veMEZO routing boost), Fractals (fractionalized ve positions).
- 41 of 64 projects used MUSD, and 45% were payments.

**Pattern [I]:** first places went to products that sit on MUSD's core mechanics (troves, redemptions, ve-boost), automate something users would otherwise do by hand, and had a working testnet deployment. Payments are saturated. This Buildathon also says standalone apps are "not prioritized".

## 4. What leadership says it wants (2026)

### 4.1 The 2026 Roadmap
Source: [Andre Coutinho / Supernormal Foundation, 2026-03-24](https://mezo.org/blog/mezo-2026-roadmap/). It has six pillars:

1. **Scale MUSD.**
   - Cross-chain: *"making MUSD available wherever DeFi users already operate — as collateral, as a trading pair, and as a spending asset… Each integration gives MUSD a path into external lending markets, DEXs, structured products, and payment flows."*
   - A home for BTC wrappers.
   - *"More Vaults and Yield Strategies"* across risk profiles.
   - Card integrations for MUSD spending.
2. **MEZO utility and usable governance.**
   - *"A Simpler Earn Experience… for users who do not want to master gauge voting and boost mechanics on day one"*.
   - A voting UI for the Earn splitter.
   - A veNFT marketplace.
   - Delegation and a Grant Committee.
3. **Institutional access** through Anchorage.
4. **Chain upgrade.** Done: Mezo now runs the Osaka EVM spec ([H1 review](https://mezo.org/blog/mezo-h1-2026/)). The pillar also covers *"AI-Ready Infrastructure… payment rails, agent-compatible endpoints"*.
5. **Ecosystem:** the Founder Program, more hackathons, the accelerator, and *"expand bounty programs for community-built features, tools, and integrations."*

### 4.2 H1 2026 review
Source: [2026-08-04](https://mezo.org/blog/mezo-h1-2026/).
- USDC borrowing is *"the first in a broader suite of lending markets intended to expand the assets available against BTC collateral."*
- *"Base is the first stop in a broader cross-chain plan."*
- *"Projects in development include Matchbox, Telegram bots, and additional agent-payment applications settling in MUSD."*
- *"Mezo is x402-ready."*

### 4.3 Matt Luongo, "Aerodrome for Lending"
Source: [2026-04-28](https://mezo.org/blog/aerodrome-for-lending/).
- *"Mezo brings ve(3,3) to lending, where votes for emissions become a signal of creditworthiness."*
- *"On Mezo, a market that wants supply can post incentives to attract veBTC votes… emissions are less of a subsidy and more of a risk-pricing signal."*
- *"Instead of lobbying governance and waiting, a project can try to earn supply by convincing long-duration holders that the market is worth backing."*
- He closes: *"The mechanism that turns those votes into a verdict on creditworthiness is the subject of a future post."* That post has not appeared; the [Ghost API listing](https://mezo.ghost.io/blog/ghost/api/content/posts/) shows only 3 Luongo posts.
- The USDC Lending Vault already has a gauge: share-token stakers earn MEZO and the interest is redirected to veBTC voters ([docs](https://github.com/mezo-org/documentation/blob/main/src/content/docs/docs/users/mezo-earn/vaults/usdc-lending-vault.md)).
- Other Luongo quotes:
  - *"Aerodrome's community wrote the playbook for sustainable DeFi yield through vote-escrow economics"* ([bitcoin.com, 2026-03-26](https://news.bitcoin.com/bitcoin-lending-layer-mezo-selects-aerodrome-as-primary-liquidity-hub/)).
  - On the Bullish listing (2026-04-21): *"That matters more than volume numbers."*

### 4.4 MEZO utility in practice
- [Introducing MEZO Gauges](https://mezo.org/blog/introducing-mezo-gauges/) (William Pyke, 2026-09-11):
  - *"MUSD is only useful if it's liquid where people already are. Thin pools on other chains mean MUSD can't be entered or exited at size, limiting MUSD debt book, and putting pressure on the stablecoin's peg."*
  - About 200k MEZO per epoch now goes by veMEZO vote to Curve, Uniswap and Aerodrome MUSD pools.
  - *"This is the first step to increase MEZO's utility, with more to come."*
- The Aerodrome pools moved to **Aero** on 2026-10-22 ([post](https://mezo.org/blog/mezo-gauges-on-aero/)).
- [Mezo Academy](https://mezo.org/blog/mezo-academy/) (2026-06-04): *"Institutional veBTC… often arrives without proportional veMEZO. To realize its full weight, institutional capital must source veMEZO from the holders who already command it."*
- On 2026-03-30 the blog said: *"No automated strategies exist yet for veMEZO — you vote each epoch manually"* ([post](https://mezo.org/blog/aerodrome-x-mezo-2-25-of-token-supply-rewards/)).
- Design caution: the [Earn whitepaper](https://github.com/mezo-org/documentation/blob/main/public/docs/Mezo_Earn_Whitepaper.pdf) lists *"Complexity that invites external aggregation layers"* as a failure mode the design targets (Convex-style capture). It also names "Protocols" as first-class actors, and says non-staking ecosystem gauges "might direct MEZO to a partner protocol".

### 4.5 Security posture and focus (shaped heavily by 2026 incidents)
- **Feb 2026, Velar PerpDEX on Mezo drained** (~$401k). Mezo's postmortem notes:
  - the contracts lacked oracle price-timestamp checks;
  - Velar had *"no pause or slowdown system"*;
  - the pools were *"not… monitoring"* for two weeks.

  ([post](https://mezo.org/blog/velars-perpdex-exploited-on-mezo/))
- **Mar 2026, AssetsBridge precompile bug** reported by a whitehat; $50k bounty paid ([post](https://mezo.org/blog/keeping-funds-safe-on-mezo/)).
- **Jul 2026, app database exfiltrated** through a Cloudflare token leaked by Vite inlining build env vars into front-end JS ([post](https://mezo.org/blog/incident-report-july-1-2026/)).
- **2026-10-05, veBTC `VotingEscrow` exploited** (5.52 BTC): the meta-transaction forwarder's appended sender was dropped across external-library calls ([post](https://mezo.org/blog/incident-report-october-5-2026/)). From that report:
  - *"we have been reviewing all changes with frontier AI security models"*
  - *"removing or limiting lesser-used features that expand our risk surface; this includes an upcoming sunsetting of native BTC wallet sign-up and native BTC wallet bridge-ins"*
  - *"This was a real vulnerability that two audits and our own reviews missed."*
- **Pruning to focus on "higher-usage services and products"** ([cryptobriefing](https://cryptobriefing.com/mezo-october-13-swbtc-usde-bridge-out/); [docs commits](https://github.com/mezo-org/documentation/commits/main)):
  - native BTC bridge-in closed 2026-10-13;
  - swBTC and USDe bridge-out deadline 2026-10-13;
  - SolvBTC and xSolvBTC support ends 2026-10-29;
  - BTC Vault winds down 2026-10-28;
  - the Stablecoin Vault was wound down 2026-07-31.
- **Bug bounty:** Cantina, Critical up to $150k paid in MEZO ([page](https://cantina.xyz/bounties/82d15510-9264-4ce0-9bee-ee0cb5c53742)).

## 5. State of the economy (why "business viability" is concrete)

- **MUSD supply:** 29.48M on Mezo (`cast call 0xdD46…F186 totalSupply()`, rpc-http.mezo.boar.network). DefiLlama shows 29.15M (Mezo 28.55M, Ethereum 0.60M).
- **MUSD price:** 0.9885–0.9907 every day from 2026-09-24 to 2026-10-23 (`coins.llama.fi/chart/coingecko:mezo-usd`).
- **Mezo's mUSDC/MUSD CL pool** `0xCC37…7aC1a`: implied price $0.9896, holding 5,333,831 MUSD against 8,454 mUSDC.
- **The basic stable pool** `0xEd81…c356` returns 963.6 mUSDC for 1,000 MUSD.
- The redemption fee is 0.75% ([docs](https://github.com/mezo-org/documentation/blob/main/src/content/docs/docs/users/borrow/fees.md)), and the discount exceeds it. **[I]** Arbitrage is held back by exit-liquidity friction.
- **MEZO:** $0.00296, market cap $1.47M, FDV $2.95M, ATH $0.1485 on 2026-04-13, so about −98% (CoinGecko API). On-chain supply is 1.1385B.
  - **[I]** The grant caps (25k or 50k MEZO) are worth about $74 or $148 at this price.
  - **[I]** MEZO as collateral needs very conservative, liquidity-aware risk parameters.
- **TVL:** DefiLlama shows Mezo at $72.2M. Mezo reports $110.5M TVL, 912.6 BTC in veBTC and 50,032 users (as of 2026-07-31).
- **Mainnet vaults remaining:**
  - sMUSD;
  - the USDC Lending Vault, which is Morpho Vault V2 on Mezo with only about 81.9k mUSDC (`totalAssets()` read);
  - Ditto dMUSD at about 3.6% APY.

## 6. Grants and programs (life after the hackathon)

- **[Ignition](https://www.supernormal.foundation/initiative/mezo-ignition-program):**
  - Up to 25k MEZO, released on testnet and then mainnet milestones.
  - Focus areas: DeFi primitives, consumer apps, and infrastructure (AI integrations, developer tooling, indexers, oracles, bridges, SDKs, analytics, testnet utilities). The page also invites "Any new project the Mezo ecosystem lacks".
- **[Founder Program](https://www.supernormal.foundation/initiative/mezo-founder-program):**
  - Up to 50k MEZO, with 40% unlocked at deployment.
  - Requirements: on mainnet, MUSD as a medium of exchange, audited or audit-ready, and a roadmap of at least 3 months.
- **BitcoinFi Accelerator:** Draper Associates, Draper Dragon and Boost VC; more than $3M deployed over two cycles.
- **Developer Bounties:** a [Coda doc by William Pyke](https://coda.io/d/Mezo-Community-Resources_d7Ee5YHYoEI/Devezoper-Bounties_su3zAeuq); its content is not machine-readable.
- **Featuring on Mezo Market / Explore** requires MUSD integration, a third-party audit submitted to the Supernormal Foundation, and a live mainnet deployment ([docs](https://github.com/mezo-org/documentation/blob/main/src/content/docs/docs/developers/getting-started/dapp-requirements.md)).
- The Buildathon post says top projects can apply to Ignition and Founder ([post](https://mezo.org/blog/mezo-buildathon-is-underway/)).

## 7. How Mezo positions itself against other Bitcoin L2s and BTCfi

- **Framing changed.** In 2024 Mezo was a "Bitcoin L2 / economic layer". It now calls itself "the Bitcoin finance app" and "decentralized Bitcoin lending platform" ([homepage](https://mezo.org/); [roadmap](https://mezo.org/blog/mezo-2026-roadmap/)).
- **Claims:**
  - fixed-rate BTC loans at 1%, up to 90% LTV, versus 8–20% at CeFi lenders ([rates post](https://mezo.org/blog/every-bitcoin-loan-rate-compared/)); the docs now say "1–5% APR fixed at open";
  - "real BTC yield" from fees rather than emissions ([post](https://mezo.org/blog/most-bitcoin-yield-is-fake/));
  - *"In a Bitcoin-native system, Bitcoin should be king"* ([ve(3,3) post](https://mezo.org/blog/mezo-earn-a-ve-3-3-system-for-bitcoin-lending/));
  - an institutional path through Anchorage and Bullish.
- **DefiLlama chain TVL** (2026-10-23):

  | Chain | TVL |
  |---|---|
  | Rootstock | $76.7M |
  | Mezo | $72.2M |
  | Stacks | $66.3M |
  | BOB | $10.1M |
  | Citrea | $9.2M |
  | Merlin | $6.9M |
  | Core | $4.0M |
  | Hemi | $1.2M |

## 8. Kickoff workshop (2026-10-13)

- [YouTube eAiaQpzvVE0](https://www.youtube.com/watch?v=eAiaQpzvVE0) on AKINDO's channel: "Mezo Buildathon Kickoff Workshop | Build with MUSD and MEZO", streamed 2026-10-13, 196 views.
- The description lists: overview, rules and judging; the ecosystem and the two tracks; a technical session on MUSD and MEZO; Q&A. It has no chapters.
- Sessions: Andre Coutinho (ecosystem, why the tracks matter) and Dymitr Paremski (developer environment, core primitives, integration patterns).
- **The transcript could not be retrieved.** YouTube showed a "confirm you're not a bot" wall, Invidious returned empty captions, and the third-party transcript services were blocked. No recap was found. Someone needs to watch it.

## 9. Ranked judge preferences

1. **It works end-to-end, and a judge can test every feature unaided on a supported network.** Evidence:
   - the civ_defi_mezo quote;
   - "working deployment" is a hard requirement checked at Stage 1;
   - Hackathon 2 engineers scored "working demo quality… testnet deployment";
   - the AI review flags whether GitHub was analyzed.
2. **No clear security flaws.** Evidence:
   - the civ_defi_mezo quote;
   - four incidents in 2026;
   - Technical Implementation explicitly includes "security";
   - Mezo reviews its own code changes with frontier AI security models, so expect scrutiny.
3. **Deep integration with MUSD and MEZO primitives** (troves, redemptions and hints, Stability Pool, sMUSD, gauges, veBTC/veMEZO, MEZO Gauges, NTT) rather than ERC-20 transfers. Evidence: "Depth… matters more than surface-level usage" (30%); the first places of both earlier hackathons.
4. **Extends existing Mezo products and composes with lending markets, DEXs and vote-escrow systems.** Evidence: the stated priorities, Luongo's lending-gauge thesis, MEZO Gauges, and the whitepaper's "Protocols" actor.
5. **Directly addresses Mezo's current pain points**: MUSD liquidity and peg, MEZO utility, Earn complexity, the lending suite. Evidence: Business Viability rose to 30%; the roadmap; the Pyke quote; the market data.
6. **Long-term commitment and a credible plan.** Evidence: the registration question on continuing; Founder and Ignition; *"the start of a relationship that outlasts the prize"*; Wave 2 requires "meaningful new progress".
7. **UX that hides gauge, boost and CDP complexity.** Evidence: the roadmap's "Simpler Earn"; Cermin and Mezoir won by automating.
8. **Clear materials.** Evidence: the 2-minute video and deck; the AI-review legibility [I].

## 10. Red flags that would sink a submission

- **The demo doesn't work in a judge's hands.** Examples: it only runs locally, the faucet path is broken, there are "coming soon" stubs, or it uses mock MUSD instead of testnet MUSD `0x1189…c503`.
- **Classic DeFi security gaps:**
  - no oracle staleness or deviation checks (the Velar root cause);
  - no pause or circuit breaker;
  - no caps;
  - unsafe approvals;
  - reentrancy;
  - unchecked low-level calls;
  - admin keys without a timelock;
  - upgradeable contracts without safeguards.
- **Meta-transaction or forwarder patterns** using `_msgSender()` across libraries (the veBTC root cause; Mezo has disabled meta-txs).
- **Secrets committed or inlined in front-end builds** (the July incident).
- **MEZO accepted as collateral at aggressive LTVs** without liquidity-aware caps (MEZO market cap about $1.5M) [I].
- **Building on deprecated surfaces:** native BTC bridge-in or BTC-wallet sign-up (being sunset), swBTC, USDe, SolvBTC, xSolvBTC, the BTC Vault, the Stablecoin Vault, or meta-transactions.
- **Surface integration**, such as "accepts MUSD" payment links or checkout. This space is saturated: PayLink ×2, MUSD Pay Links, SettleTag, MUSD Subs, MezoGig, TradeOS.
- **Rebuilding what already exists without a clear edge:** Matchbox, Vezo, Aurove, Range, Mezo Tools, Boar, Ditto, the sMUSD vault, or the trove alert bots (Vigil, Trove Guardian, Lockwatch, Lifeline, MUSD Pulse).
- **Governance-concentrating aggregators** that work against the whitepaper's intent [I; medium-low].
- **No Wave 2 delta**, unverifiable claims, or uncredited reused code (against the rules).

## 11. What a "blown-away" reaction would concretely take

- **Functionality.** One flow that composes two or more Mezo primitives on real contracts (testnet at minimum; ideally also mainnet with caps, as MezoRoute does with its 1,000 MUSD per entry). It needs entry, core action, safe exit or unwind, and an emergency path. The output should be a composable token (ERC-4626 or ERC-20) that can itself be LP'd, used as collateral or staked in a gauge. It should also hook into Mezo Earn: pool gauges through `PoolsVoter.createPoolGauge`, MEZO Gauge incentives through Matchbox, or a lending-gauge design.
- **Depth.** Use the real mechanics: PriceFeed reads, recovery-mode handling, redemption-order awareness (SortedTroves and HintHelpers), the BTC ERC-20 precompile `0x7b7c…0000`, EIP-712 trove operations through `BorrowerOperationsSignatures`, and flash-swap hooks on Pools. The last two are drawn from competitors' READMEs.
- **Security evidence:**
  - fork tests against live Mezo contracts;
  - fuzz and invariant tests;
  - static analysis;
  - no admin keys, or a pause-only guardian;
  - oracle staleness and deviation guards;
  - per-transaction and TVL caps;
  - a written threat model;
  - verified source on the explorer;
  - CI badges.
- **Proof.** An evidence page listing every transaction hash (mbLP sets this bar), deployed addresses in the README, and a dashboard reading on-chain state.
- **Business case.** Quantify the Mezo problem with on-chain data (the peg, pool depth, veBTC versus LP BTC). Show the fee flow to veBTC voters and the MUSD or MEZO demand created. Lay out a go-to-market plan and a milestone roadmap that matches Ignition and Founder (testnet, then mainnet, then audit).
- **UX.** A judge with only faucet funds completes everything in under 5 minutes. Show CR, liquidation price and redemption rank. Default to EVM wallets.
- **Demo.** A 2-minute video with live transactions on the explorer, including a demonstration of a failure mode (pause or guard). The deck should map to each criterion. Write the AKINDO "Updates in this Wave" field as evidence-rich prose for the AI reviewer [I].

# Research report: research:competitor-scan

# Mezo Buildathon (AKINDO WaveHack `OVOO0gdrVU8379D10`): who is competing, and what wins

Snapshot taken 2026-10-23, about 22:50 UTC. Wave 1 closes 2026-10-26 15:00 UTC, about 64 hours later.

**Sources:**
- AKINDO's public JSON API, found by reading the page's JS bundle: `https://api.akindo.io/public/...`. No browser was needed for the listings.
- GitHub (`gh api`).
- Mezo RPCs via `cast`: testnet `https://rpc.test.mezo.org`, mainnet `https://mezo-mainnet.boar.network`.
- Blockscout APIs: `api.explorer.test.mezo.org`, `api.explorer.mezo.org`.
- Mezo blog winner posts.
- The kickoff workshop transcript (YouTube `eAiaQpzvVE0`), read via Playwright.

---

## 0. Key findings

1. **There are 40 submissions in Wave 1, and 173 builders are registered.** Expect more before the deadline; my estimate of the final count is low-confidence.
   - 7 entries are empty placeholders or spam: kept, TAWFIK ×3, Origame, MEZO-LOCK, and MezoLens, which is concept only.
   - The other 33 are real.
   - Sources: `GET /public/wave-hacks/OVOO0gdrVU8379D10/waves/Ql9ePKmoDCBNoQ9n/submissions` and `/builders`.
2. **Two "known" competitors have not submitted.**
   - **Assumable** (user "Annie") and **Mezo Auth Dev** (user "rohithr8484") were only announced in the buildathon's comment threads (`/public/threads?type=waveHack&parentId=OVOO0gdrVU8379D10`).
   - A separate, unsubmitted, private AKINDO product called **Keel** (GitHub Oladayo-Ahmod/keel) already implements the Assumable idea well: a trove owned by a per-position vault, represented as an ERC-721.
   - There are two different "PayLink" entries. The one in your list (MUSD checkout for digital goods) is **PayLink — Digital Products** by Fouad.
3. **Only two submissions have contracts on Mezo mainnet: Pylon and MezoRoute.** I checked with `cast code` against `mezo-mainnet.boar.network`. Everything else is testnet only. Remitsheet's "same CREATE2 address on mainnet" has no code there.
4. **The top tier is deep, AI-assisted and evidence-heavy.** Pylon, mbLP, Mezodot and Lockwatch all have:
   - fork tests against the live MUSD contracts;
   - contracts verified on Sourcify or the explorer;
   - published lists of live transactions;
   - audit or security docs.

   That level of evidence is now the baseline for a top score.
5. **Payments and invoicing is badly oversaturated (13+ entries).** Others: trove alerts and protection (7+), leverage/looping (5), escrow (4), Stability Pool wrappers (4), x402/agents (6).
6. **Nobody has deployed anything on Base, Ethereum or BNB.** Track 1 explicitly lists "MUSD/MEZO liquidity pools and DEX integrations on other chains" and "lending protocols … cross-chain". At kickoff, Mezo named Aerodrome on Base as MUSD's main liquidity venue outside Mezo.
7. **Across AKINDO, iterators collect 80% of later-wave payouts.** That is the share of all wave-2-and-later payouts that went to products that had also submitted in an earlier wave (11 programs, computed from the API). Wave 2 here pays $5,000, against $2,000 for Wave 1.
8. **Mezo's stated bar:**
   - "close to a live product on mainnet";
   - "if you just have … a mockup or prototype … it will be very hard for you to win";
   - judges use the site and read code to check it "does what the UI tells us";
   - non-technical testers walk the user journey;
   - loss of funds is the red flag;
   - testnet is OK but mainnet is "valued more";
   - automated audits (for example Claude) are accepted.
9. **AKINDO has an "AI judging run" feature that gives judges a "shared baseline".** It is in the bundle as `startAiJudgingRun` / `ai-judging-runs`, available in point mode. Write the submission criterion by criterion, with evidence links, and be honest about what is and is not built.

---

## 1. How the program works (verified)

**Endpoints**
- `GET https://api.akindo.io/public/wave-hacks/OVOO0gdrVU8379D10`: rules and criteria.
- `/waves`: there is one wave so far, id `Ql9ePKmoDCBNoQ9n`.
- `/waves/{id}/submissions`: all 40 entries in a single call.
- `/products?page=` and `/product-summaries?limit≤50`.
- `/builders`: 173 registered.
- `/ideas`.
- `/public/threads?type=waveHack&parentId=…`: the comments tab.
- `/public/communities/xKmmnkwV7ImEV1rjZ`: Mezo community admins are illshin (AKINDO founder), duygu_kam, civ_defi_mezo and notmartin. Nobody has the judge role yet.

**Timeline and money**

| Wave | Build | Judging | Pool | Mode |
|---|---|---|---|---|
| Wave 1 | Oct 16–26 (deadline 2026-10-26 15:00 UTC) | to Nov 1 15:00 UTC | $2,000 | point |
| Wave 2 | Nov 2–15 | Nov 16–22 | $5,000 | — |

- Winners are announced at a demo on Nov 23.
- Rewards are paid in MEZO at a 14-day TWAP after KYB.
- Rewards are proportional to points, with no fixed number of winners.

**Judging process**
- AKINDO DevRel screens first: is there a MUSD/MEZO integration, a working deployment, and all materials? Materials are a live link, a public GitHub repo, a deck and a 2-minute video.
- The Mezo core team then scores against the stated criteria.

**Criteria**

| Criterion | Weight |
|---|---|
| Mezo Integration | 30 |
| Product & Business Viability | 30 |
| Technical | 20 |
| UX | 10 |
| Submission materials | 10 |

**Transparency after judging.** In past programs the API exposes, for each product:
- per-criterion totals (`product-summaries[].criteria[].totalValue`);
- each judge's `point`, `criterionRatings` and a written `comment` in `submissions[].votes`.

So by about Nov 1 we can read every Wave 1 competitor's per-criterion score and judge comments before Wave 2.

**Form details**
- The "Updates in this Wave" field appears capped at 3,000 characters, per a builder's pasted form in the comments.
- One builder reported the form has no track selector, which conflicts with the official FAQ (see open questions).

---

## 2. Census of the 40 submissions

| # | Name (team) | What it is | Mezo integration depth | Deploy | Threat |
|---|---|---|---|---|---|
| 38 | **Pylon** (kiter99 / PhiBao) | Flash loop, unwind and exit for troves, a redemption shield reserve, a redemption-queue radar, a Rust engine and an x402 endpoint | BorrowerOperationsSignatures (EIP-712), SortedTroves indexed in full, Tigris flash venue plus swap venue, MUSD reserve | **Mainnet + testnet** | **High** |
| 32 | **mbLP** (GuTS805) | Deposit BTC; the vault opens a shared trove at a 300% target, borrows MUSD, adds BTC/MUSD LP, stakes it in the gauge, and posts part of the fee as an incentive to attract veBTC votes | BorrowerOps, HintHelpers, SortedTroves, Router, Gauge, IncentiveRouter (`notifyRewardAmount`), PriceFeed, Passport | Testnet (v1–v3) | **High** |
| 33 | **Mezodot** (mdlog123) | Omnichain money market: ERC-4626 pMUSD and pMEZO, borrowing against BTC, pTokens or Sepolia collateral via Wormhole, a flash-loan loop and a BTC long, plus an MCP agent | MUSD and MEZO as pool assets, Tigris flash swap, Pyth and Supra, Wormhole | Testnet hub + Sepolia spokes | **High** |
| 1 | **Lockwatch** (ChrisGold / AshThunder) | veBTC/veMEZO expiry guard with auto-return, re-lock or open-trove at expiry; auto-extend; claims bribes and fees; redemption radar; loan rescue; Telegram bot | veBTC and veMEZO, Voter, BorrowerOperationsSignatures, sMUSD, TroveManager | Testnet | **High** |
| 12 | **MezoRoute** (hms1499) | Compares the MUSD/BTC LP and Stability Pool routes by BTC risk; one-transaction Borrow & Deploy into the Tigris pool | Tigris pool and router, BorrowerOperationsSignatures, SP data, Passport | **Mainnet executor** + testnet | Medium |
| 14 | **Coil** (Wilivms) | One-signature leveraged trove: flash swap from the MUSD/BTC pool plus `openTroveWithSignature`; a pre-signed stop-loss "Guard" | Pool flash swap, the `*TroveWithSignature` functions, PriceFeed | Testnet (router has 50+ txs) | Medium |
| 28 | **Lifeline** (XachP) | Per-user vault that is the trove's borrower of record; anyone can call `protect()` to restore the collateral ratio or the redemption buffer, for a capped tip | BorrowerOperations, SortedTroves walked on-chain, Recovery Mode handling | Testnet | Medium |
| 2 | **Vigil** (nftking) | Telegram alerts for liquidation and redemption, plus a pre-signed rescue via `repayMUSDWithSignature` from a MUSD reserve | BorrowerOperationsSignatures, SortedTroves, PriceFeed staleness check | Testnet | Medium |
| 21 | **Mezher** (darko) | Checkout that pays from MUSD balance and borrows the remainder from the payer's trove straight to the merchant, with a gasless relay | `withdrawMUSDWithSignature`, permit, TroveManager and PriceFeed 150% floor | Testnet (final contract has 0 recorded txs) | Medium |
| 22 | **Mezo Agent Toolkit** (Kylne) | MezoLens read contract, plus x402 pay-per-call at 0.001 MUSD, plus an MCP server | Reads TroveManager, SortedTroves, PriceFeed, pool router, veBTC and veMEZO; x402 via Permit2 | Testnet | Medium |
| 24 | **LeekStonks + LeekWallet** (0xoucan) | Synthetic crypto index settled in MUSD; sMEZO staking that shares fees; signed on a DIY hardware wallet | MUSD minted by BorrowerOperations, MEZO precompile staking, own oracle | Testnet (8 contracts) | Medium |
| 26 | PayLink (raherizo) | Dollar invoices paid in MUSD for Madagascar; built on the team's existing PayLink v2; shows the smallest loan that covers an invoice | MUSD permit; reads BorrowerOps, PriceFeed and TroveManager | Testnet | Low |
| 3 | Remitsheet (zemis) | Pays a whole spreadsheet in MUSD, MEZO or BTC with one signature and one transaction; shows trove LTV | Permit (including the MEZO precompile permit); reads trove data | Testnet | Low |
| 39 | Wasit (swaat) | Trade-finance escrow: MUSD balance held until inspector and carrier sign, plus a BTC advance bond | MUSD escrow, BTC bond priced by Skip, conversion via Mezo Router | Testnet (no public repo linked) | Low |
| 11 | MUSD Yield Vault (anpratama) | ERC-4626 vault with a Stability Pool strategy | `provideToSP` / `withdrawFromSP` | Testnet, 500 MUSD | Low |
| 30 | Morbit (bruh_codes) | Borrow UI plus a Stability Pool share vault | BorrowerOps with hints, Stability Pool | Testnet | Low |
| 20 | Coil (0xprabal) | Per-user clone loop with a keeper that can only call `deleverTo` | BorrowerOps, Mezo Pools swap | Testnet | Low |
| 16 | MezoGig (dsh_agent) | Milestone escrow, MCP server and Lean proofs | Plain MUSD plus permit (contract `gigCount 0`) | Testnet | Low |
| 0 | Liqvera (dimkox) | x402-paid BTC order-book reports | Plain MUSD via x402 | Testnet | Low |
| 34 | TrustieWork (renegade) | AI-verified freelance escrow; employers can lock BTC, which opens a trove | BorrowerOps (fund-by-trove) | Testnet | Low |

The remaining entries are all low threat and mostly plain MUSD transfers or front-ends:
- MUSD Books, MUSD Subs, MUSD Pay Links, MUSD Pocket, Pocket, PayLink — Digital Products, SettleTag, Runway;
- Kudi (Nigerian borrow front-end), Trove Guardian and MUSD Pulse (read-only), Mezo TradeOS, Mezo Flow;
- the 7 placeholders.

**Counts**
- Tracks stated in the text: T1 in about 6 entries (MUSD Subs, Coil-W, mbLP, Mezodot, Mezher, LeekStonks); T2 in about 9.
- About 20 of 40 include a YouTube video link.
- **No submission deploys on Base, Ethereum or BNB.**

---

## 3. The strongest competitors, verified

**Pylon** (`PhiBao/pylon-mezo`)
- Code: about 195 KB of Solidity, including a 50 KB test file, and about 177 KB of Rust in the engine.
- `docs/AUDIT.md` is an agent-performed audit. It reports 35 findings (5 High), 32 fixed, with regression tests.
- Mainnet contracts:
  - `PylonFlashEngine` `0x8DEa475605ac7a99ad28F0DD3537A93b2aCf655D` (19.1 KB of code).
  - `PylonReserve` `0x81175AaAC5Fa0873e64480502566Fe993bB88e62`, which holds **10.14 MUSD** (`cast call MUSD balanceOf`).
- Testnet loop, unwind, exit and shield transactions all succeeded (`cast receipt 0x7933c853…`, `0xe7e02053…`, `0xfd3e382f…`, `0x0e3b6710…`).
- **Weak spot:** the README's "MUSD/BTC 102.98M depth" claim conflicts with mainnet reserves of 0.47 BTC and 39.3k MUSD in pool `0x52e6…` (`cast call getReserves`).

**mbLP** (`GuTS805/Akindo`)
- Code: 34 KB `BtcLpVault`, plus `IncentiveRouter` (posts bribes to the gauge incentive contract and falls back to the treasury if refused).
- Tests: 12 files covering invariant, manipulation, recovery and mainnet-fork cases.
- `docs/evidence.md` has full live-transaction tables.
- Verified on-chain:
  - v1 deposit `0x2f8336f3…` succeeded with 27 logs.
  - A Passport (Unisat) smart-account deposit `0x30219b76…` succeeded.
  - A keeper calls `harvest` on v1 about twice a day (Blockscout transaction list).
- **Best fit for "Composability wins"**: it touches the CDP, DEX, gauges and incentives together.

**Mezodot** (`mdlog/mezodot`, not linked from the AKINDO product)
- Code: about 111 KB of Solidity source and 253 KB of tests, including invariant and cross-chain handlers.
- Testnet: VaultManager `0x7a2e…54F7` has code; pMUSD `totalAssets` is 1,739 MUSD and pMEZO is 401 MEZO.
- It is the only "lending market for MUSD/MEZO", which is Track 1's first example.
- **Risk:** large surface area, testnet only.

**Lockwatch** (`AshThunder/lockwatch`)
- Code: 34 KB source and 99 KB of tests, with fork tests against testnet veBTC and veMEZO.
- Data-led problem statement: 286 of 379 testnet veBTC locks are expired and unclaimed.
- Live `protectBatch` transaction `0x70012f…` returned 0.004 BTC to a lock owner.
- It is the only buildathon entry that integrates the vote-escrow system itself.

**MezoRoute**
- Mainnet executor `0x0464…0d9E` has real enter and exit transactions on Oct 15, 20 and 21 (`api.explorer.mezo.org`).
- Narrower product, but real mainnet use.

**Coil (Wilivms)**
- The router has 50+ testnet calls.
- It has a fork test and an EIP-712 compatibility test.
- It overlaps directly with Pylon, which also has mainnet.

**Lifeline and Vigil**
- Both are solid CDP-protection designs with live rescues: Vigil's reserve `rescue` call succeeded after two reverts.
- Both sit in the most crowded DeFi niche.

---

## 4. Pipeline threats that have not submitted yet

| Entry | Status and evidence | Threat |
|---|---|---|
| **Keel** (Oladayo-Ahmod) | Testnet `PositionFactory` `0xCDf7…7405` is Sourcify-verified. Tests use the real MUSD contracts pinned at a commit, with invariant, fuzz and reentrancy suites and a threat model. Private AKINDO product `lrk4eNpjMU03JK8gO`. | High if submitted |
| **Assumable** ("Annie") | Same NFT-owned trove-account idea; announced 2026-10-13. | Unknown |
| **Payung** (PugarHuda) | Liquidation cover. Borrowers buy 1–4 weeks of cover in MUSD that expires at the Thursday epoch boundary. Underwriters deposit MUSD into an ERC-4626 `pyMUSD` vault, which is a new MUSD yield source. Live on testnet; README says it is "Built for the Mezo Buildathon, Track 1". | Medium-high |
| **Mezo Auth Dev** (rohithr8484) | x402 services marketplace, announced 2026-10-18. No repo found. | Low |
| Others | Tripwire (jj199-lab; Telegram and API, read-only), Keel (Im-2; Telegram dollar account with a guardian), Mezora (business cash flow), and the `livastic-vm*` AI-agent farm of read-only mainnet MUSD "lenses". | Low |

---

## 5. What wins: the evidence

**5.1 Cross-program AKINDO data**

I pulled payouts for 13 programs from `/waves/{id}/submissions` (`earnedAmount`). The iteration figure uses 11 of them; Fhenix and Midnight are left out.

- **Iteration:** 80% of all payouts in waves 2 and later went to products that had also submitted in an earlier wave. By program:
  - Citrea W2–5: 81%, 86%, 88%, 100%.
  - Aleo W2–5: 100%, 95%, 90%, 90%.
  - Linera W3 and W7: 100%.
  - Exceptions exist where a new entrant took #1: Moca W2 (Credo), Massa W2/W3/W5, and a tie in Polygon W6.
- **Concentration:** across 49 point-mode waves, the top entry took a median of about **14%** of the pool (range 3–41%), and the top 3 took 9–82%.
  - Programs with few paid entries (Aleo, Moca, Midnight; 5–10 paid) give the top entry about 30–40%.
  - Programs with many paid entries (0G, SoSoValue, Polygon) give about 3–8%.
- **Ties at the top are common**, so points look coarse. Examples: Citrea W1 Factra and Nocturne at 258 each; three-way ties in Polygon W6, Linera W6, 0G W1 and SoSoValue W1. "#1" may be shared.
- **Screening removes most entries** in some programs:
  - Fhenix W1: 186 submitted, 10 paid.
  - Midnight W1: 159 submitted, 7 paid.
  - Aleo W1: 146 submitted, 8 paid.
- **Cumulative winners are steady finance products that kept shipping.** Citrea is the closest analog, a Bitcoin L2:
  - Factra (tokenized invoices): $1,476 over 5 waves.
  - Grove (savings circles): $1,227.
  - Metrik (invoice lending): $886.

**5.2 What judges write** (`submissions[].votes[].comment`)

- They use the app and report bugs. Citrea: "There is a bug on create invoice page"; "it sends 2 transactions … creates same invoice twice".
- They reward iteration: "thanks for building since the first wave"; "Thank you for listening to feedback".
- They praise production readiness: "could essentially be on mainnet".
- They penalise over-claiming. Aleo: "LBP and Quadratic are claimed … but are empty scaffolds — the submission should clearly state '4 implemented, 2 planned'".
- They reward ecosystem tooling. Aleo, on NullPay: "the CLI, MCP server, and Node SDK are unique".

**5.3 What Mezo itself says** (kickoff transcript, YouTube `eAiaQpzvVE0`)

- Andre (Mezo/Supernormal):
  - **8:45** "to win … building a close to a live product on mainnet".
  - **9:39** "if you just have … a mockup or prototype … very hard … to win".
  - **1:09:44** "we will go to your site and we will test your product … [the technical team will] see if it's just pretty UI or if the code actually does what the UI tells us … non-technical people going through your projects … focus on the user journey and UI" (over the deck).
  - **1:18:22** "doing only test net is okay even though we will of course value more teams that have been deployed on mainet".
  - **1:02:08** An off-ramp that only swaps to USDC "doesn't really do anything"; one-click to a bank account is "really good".
  - **1:06:24** For marketplaces, the hard part is getting sellers.
- Dmitri (Mezo integration engineer):
  - **56:21–57:13** An audit is expected for mainnet code; "auto audits from Claude or other projects are accepted".
  - **1:11:05** The common fatal mistake is "loss of funds in smart contracts".
- **1:22:04** (host, in the closing tips) Do security reviews at the midpoint and at the end.
- civ_defi_mezo in the AKINDO comments (2026-10-19): "it works as expected; users can fully test all features; no clear security flaws."
- Ecosystem pointers from Andre (**14:30–27:00**):
  - Aerodrome on Base is MUSD's main liquidity outside Mezo and the largest MEZO DEX pool.
  - Uniswap and Curve on Ethereum.
  - PancakeSwap MUSD pairs on BNB.
  - Mellow vaults and Morpho are deployed on Mezo.
  - Merkl and StakeDAO incentives.
  - Wormhole NTT for MUSD and MEZO.
  - Boar Finance (veBTC auto-vote relayer), Matchbox, Vezo, Aurove.
  - Ditto (cross-chain MUSD vault).
  - Taskify (bounties).
  - x402.

**5.4 Earlier Mezo hackathons (Encode Club)**

- **Hackathon 1** (Nov 2025, 37,500 MUSD; mezo.org/blog/mezo-hackathon-winners):
  - Advanced DeFi: TrovePilot (keepers for liquidations and redemptions), BTCShield (outsiders add collateral in exchange for an option to take over the position), StratumFi.
  - Financial Access: KhipuVault (Latin American savings), BitSpend, CreatorBank.
  - Daily apps: Invoiced, BountyPay, MezoLotto.
- **Hackathon 2** (published Jun 9 2026; $30k in veMEZO prizes plus $30k in grants; judged on "working demo quality, code, testnet deployment, and protocol integration"):
  - Bitcoin Banking: Cermin (auto-managed loan), Mezo TreasuryOS, AdaptiveGuard.
  - Supernormal dApps: Cark (savings circles backed by BTC), MezoPay, SuperPage (x402).
  - MEZO Utilization: Mezoir (ve intent agent), BynD (pooled veMEZO boost), Fractals (fractional ve positions).
- **Implication:** protection, savings, payments and ve-wrappers have already won before. Repeating them needs a clearly new angle.

---

## 6. Crowded spaces

See the `crowded_spaces` list. In short: payments, invoicing and payroll; trove alerts and protection; leverage and looping; escrow; Stability Pool and Savings Vault wrappers; x402 and MCP agents; read-only dashboards; ve-wrappers; transferable troves.

## 7. Whitespace

See the `whitespace` list. The strongest candidates are:
1. A **MUSD/MEZO product on Base, Ethereum or BNB mainnet** that plugs into Aerodrome, Curve, Uniswap, Morpho or Merkl. Nobody is doing this.
2. **Using MUSD/MEZO in an existing lending market** (Morpho on Mezo, or Morpho Blue elsewhere), rather than writing a new money market.
3. **Credit against veBTC/veMEZO NFTs.**
4. **Peg-defense / redemption-arbitrage vaults.**
5. For Track 2: **WhatsApp** access and a **one-click off-ramp**.

## 8. Constraints any idea must meet

- **Submit something real in Wave 1** before 2026-10-26 15:00 UTC, so Wave 2 counts as iteration.
- **Show depth on at least two Mezo systems at once** (CDP plus DEX/gauge, or ve plus MUSD) and an external protocol. mbLP is the template to beat.
- **Ship to mainnet with a small cap**, as Pylon and MezoRoute did. Include an AUDIT.md (an AI audit is accepted), fork tests against the live MUSD contracts, verified contracts and an evidence table of transactions.
- **Every feature must be testable by a non-technical judge** with faucet funds.
- **Write the submission criterion by criterion**, keeping what is implemented separate from what is planned, because of the AI baseline and the over-claiming penalty.
- **After Nov 1, pull every competitor's per-criterion scores and judge comments** from the API to calibrate Wave 2.

## 9. Caveats

- Blockscout transaction counters on testnet are unreliable. mbLP v3 shows 0 transactions despite evidence of use, so I verified key claims with `cast receipt` and `cast code`.
- Submissions can still be edited until the deadline.
- **Side effect:** the Playwright MCP automatically wrote two files under `/Users/oluwademilade/Desktop/mezo/.playwright-mcp/` (a console log and a page snapshot `.yml`) when I opened the YouTube transcript. I did not delete them, because of the no-delete rule. I hid YouTube's cookie-consent overlay locally in the DOM instead of answering it.

# Research report: research:musd-protocol

# MUSD protocol mechanics: contract-level research

All on-chain reads were taken on 2026-10-23/24 with read-only `cast` calls and `eth_call` simulations. Testnet RPC: `https://rpc.test.mezo.org` (chainId 31611). Mainnet RPC: `https://mezo-mainnet.boar.network` (chainId 31612, listed in docs `developers/getting-started/configure-environment.md`). Code is from mezo-org/musd `main`. The latest logic upgrades were v1.1.0 (Dec 2025: BorrowerOperations, TroveManager, BorrowerOperationsSignatures) and v1.1.1 (May 2026: PCV). The proxy implementation slots on both networks match `solidity/artifacts/deployments/{mainnet,matsnet}/*.json`.

## 0. Headline findings
1. **The public CDP on mainnet is almost empty.** The TroveManager holds **1 active trove**: 16.59 BTC of collateral against 14,488 MUSD of debt (`getTroveOwnersCount()` returns 1). Historical `--block` reads show the decline: 104 troves / 6.03M debt (2025-11-30), 55 / 3.77M (2026-02-21), 29 / 1.64M (2026-08-09), 13 / 0.56M (2026-09-21), 1 / 14.5k (2026-10-20).
2. **MUSD has stayed below the redemption floor.** CoinGecko daily prices sat between $0.9885 and $0.9911 for the last 60 days (today $0.9887). That is below the ~$0.9925 floor set by the 0.75% redemption fee. On-chain spot prices agree: the mUSDC/MUSD CL pool gives ≈$0.9896, and the MUSD/BTC pool implies ≈$0.979. In the last ~30 days there were **681 redemptions totalling 1,276,615 MUSD**, found by scanning `Redemption` logs on TroveManager 0x94Af…c193.
3. **Most MUSD now comes from a permissioned minter.** Since 2026-04-28 the **EnclaveDebtManager** (0x2c5e…389a) has been on the MUSD mint list. It mints MUSD against veBTC NFTs pledged by 2 allowlisted Enclaves. Outstanding principal is 14.5M, which equals its mint cap, at 1% interest. It has no redemption or liquidation path, so this MUSD cannot be redeemed for BTC.
4. **sMUSD (the MUSD Savings Vault) is not ERC-4626.** The verified source `contracts/vaults/MUSDSavingsRate.sol` mints sMUSD 1:1 and pays yield through a separate `yieldIndex` and `claimYield()`. The user docs say yield builds up in an exchange rate; the code does not work that way.
5. **Signature delegation works only for EOAs.** BorrowerOperationsSignatures uses `ECDSA.recover` only, with no EIP-1271. BTC-wallet users on Mezo hold OrangeKit smart accounts, so they cannot delegate through signatures.
6. **Morpho Blue is live on Mezo mainnet** at 0x5658…A311. It offers fee-free `flashLoan` and permissionless market creation, with AdaptiveCurveIrm 0x3760…c1e7 and LLTV 86% enabled.

## 1. Core addresses (all proxies except the MUSD token)
| Contract | Mainnet | Testnet |
|---|---|---|
| BorrowerOperations | 0x44b1bac67dDA612a41a58AAf779143B181dEe031 | 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 |
| BorrowerOperationsSignatures | 0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a | 0xD757e3646AF370b15f32EB557F0F8380Df7D639e |
| TroveManager | 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193 | 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 |
| StabilityPool | 0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32 | 0x1CCA7E410eE41739792eA0A24e00349Dd247680e |
| PCV | 0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993 | 0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af |
| InterestRateManager | 0x4a453700d157717Fe02fB62E7700ED7845048285 | 0xD4D6c36A592A2c5e86035A6bca1d57747a567f37 |
| PriceFeed | 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88 | 0x86bCF0841622a5dAC14A313a15f96A95421b9366 |
| SortedTroves / HintHelpers | 0x8C5D…749f / 0xD267…7DC3 | 0x722E…68fA / 0x4e4c…CF6 |
| ActivePool / DefaultPool | 0x3012…4876 / 0xE4B5…7c8B | 0x143A…FF51 / 0x5985…3300 |
| CollSurplusPool / GasPool | 0xBF51…F491 / 0x3EB4…1Bc1 | 0xB4C3…6fa9 / 0x8fa3…66C0 |
| GovernableVariables | 0x560AC4Ea44Fb7EB2D4d3c00608CB1CAb2613d389 | 0x6552059B6eFc6aA4AE3ea45f28ED4D92acE020cD |
| MUSD (not a proxy) | 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 | 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 |
| sMUSD (MUSDSavingsRate) | 0xb4D498029af77680cD1eF828b967f010d06C51CC | 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16 (the testnet PCV `feeRecipient`) |

Sources: `solidity/artifacts/deployments/*`, `docs/CHANGELOG.md` (matsnet table), and `cast storage <proxy> 0x3608…bbc`. The redemptions doc says "All addresses are proxy contracts", but the MUSD token has no EIP-1967 implementation slot on either network.

## 2. Borrowing mechanics
- **Collateral.** Native BTC only, 18 decimals, sent as `msg.value`. The same balance is exposed as an ERC-20 precompile, 0x7b7C…0000 ("BTC", 18 decimals). PCV's native balance and its ERC-20 `balanceOf` matched exactly. Collateral is sent out with `call{value:}` (`SendCollateral.sol`), so a contract that owns a trove needs a `receive()` function.
- **Ratios** (`dependencies/LiquityBase.sol`): MCR 110% (1.1e18), CCR 150% (1.5e18), `MUSD_GAS_COMPENSATION` 200e18, `PERCENT_DIVISOR` 200 (0.5% collateral gas compensation). Verified on testnet with `cast call <TM> 'MCR()(uint256)'`.
- **Minimum debt.** `minNetDebt` = 1800e18 on both networks. The 200 MUSD gas reserve brings the minimum total debt to 2000. It is governable, with a floor of 50 MUSD and a 7-day propose/approve delay. Partial repayments and partial redemptions cannot take net debt below it.
- **Fees.** `borrowingRate` is 1e15 (0.1%), minted to PCV and added to debt. It is waived in Recovery Mode and for `GovernableVariables.isAccountFeeExempt(addr)`; 4 accounts were added through `FeeExemptAccountAdded` events. `redemptionRate` is 7.5e15 (0.75%), taken in BTC from the redeemer. `refinancingFeePercentage` is 20, so the refinance fee is 0.02% of net debt. Same values on both networks.
- **Interest** (`InterestRateManager.sol`, `InterestRateMath.sol`). Simple, non-compounding interest on principal. The rate is stored per trove as `uint16` bps and is set from the global `interestRate()` when the trove opens. The global rate is **100 bps on both networks and has not changed since May 2025** (`proposedInterestRateTime` = 1747066648 on mainnet). Changes need `proposeInterestRate` and then `approveInterestRate` after `MIN_DELAY` (7 days), called by `pcv.council()`. **PCV council and treasury are 0x0 on mainnet**, so nobody can change the rate or the BorrowerOperations fees until the PCV owner (multisig 0x98D8…7C7a) sets those roles, which has a 2-hour delay. Interest is minted to PCV as it accrues (`updateSystemInterest` → `musd.mint(pcv, interest)`). Repayments pay interest first, then principal. Extra borrowing accrues at the trove's existing rate: `increaseTroveDebt` uses `Troves[_borrower].interestRate`. The fees doc says new credit is added at the current rate, which is wrong.
- **Refinance.** `refinance(address _upperHint, address _lowerHint)`. It moves the trove to the current global rate and charges `borrowingRate × 20% × netDebt`, added to debt. It is blocked in Recovery Mode and must leave ICR ≥ MCR and TCR ≥ CCR. Calling it repeatedly is allowed. It also resets `maxBorrowingCapacity`.
- **Borrowing-capacity lock.** At open and at refinance, `maxBorrowingCapacity = coll × price / 1.1`. Any debt increase must satisfy `capacity ≥ debt + change`. Adding collateral or a rising BTC price does **not** raise the cap; only refinance does. Withdrawing collateral lowers it to `min(old, new)` (Cantina finding 3.3.2 fix). Example on testnet: trove 0x66f9…bc89 has cap 2,655 MUSD and debt 2,436 MUSD (`getTroveMaxBorrowingCapacity`).
- **Recovery Mode** (TCR < 150%). New troves need ICR ≥ 150%. Collateral withdrawals are blocked. A debt increase needs ICR ≥ 150% and must not lower ICR. `closeTrove` and `refinance` are blocked. No borrowing fee is charged. The liquidation threshold stays at 110%; there are no Recovery Mode–specific liquidations. In Normal Mode, every operation must keep TCR ≥ 150%.
- **Ownership.** One trove per address (`_requireTroveisNotActive`), and troves cannot be transferred. There is no EOA check, so contracts can own and operate troves. Live example: the verified **SafetyBuffer** contract 0xb0c9…0100 on mainnet. The last trove in the system cannot be closed, liquidated, or fully redeemed (`_requireMoreThanOneTroveInSystem`, `TroveOwners.length <= 1`).
- **Entrypoints.** `openTrove(uint256 debt, address upper, address lower) payable`, `addColl(upper, lower) payable`, `withdrawColl(uint256, upper, lower)`, `withdrawMUSD(uint256, upper, lower)`, `repayMUSD(uint256, upper, lower)`, `adjustTrove(uint256 collWithdrawal, uint256 debtChange, bool isDebtIncrease, upper, lower) payable`, `closeTrove()` (needs debt − 200 MUSD), `claimCollateral()`. All selectors were confirmed in the mainnet implementation bytecode.

## 3. Delegated operations: BorrowerOperationsSignatures
EIP-712 domain: name "BorrowerOperationsSignatures", version "1", the chainId, and the proxy as `verifyingContract` (read with `eip712Domain()` on both networks). Type strings below; all 9 typehashes are embedded in the mainnet implementation 0xa60A…26A9:
- `OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)`
- `AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)`
- `WithdrawColl(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)`
- `RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)`
- `WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)`
- `AdjustTrove(uint256 collWithdrawal,uint256 debtChange,bool isDebtIncrease,uint256 assetAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)`
- `CloseTrove(address borrower,address recipient,uint256 nonce,uint256 deadline)`
- `Refinance(address borrower,uint16 interestRate,uint256 nonce,uint256 deadline)`, which binds the signature to the current global rate
- `ClaimCollateral(address borrower,address recipient,uint256 nonce,uint256 deadline)`

The matching functions are `*WithSignature(...)`, with hints passed outside the signed data (for example `closeTroveWithSignature(address borrower, address recipient, bytes sig, uint256 deadline)`).

How signatures are checked:
- `require(block.timestamp <= deadline)`.
- Digest = `_hashTypedDataV4(keccak256(abi.encodePacked(typehash, abi.encode(fields), nonces[borrower], deadline)))`, then `ECDSA.recover == borrower`, then `nonces[borrower]++`.
- There is **one sequential nonce per borrower**, read with `getNonce(address)`. Only one authorization can be outstanding at a time. There is no cancel function; a signature dies only when its nonce is used or its deadline passes.
- There is **no EIP-1271**: the `isValidSignature` selector is absent from the implementation bytecode on both networks.

Who pays: the **caller** (`msg.sender`) supplies `msg.value` for open, addColl and adjust, and has MUSD burned for repay and close. Withdrawn collateral and MUSD go to the signed `recipient`; pool addresses are blocked as recipients.

Implications:
- Third-party relayers can perform one-click close or deleverage: pay the debt from their own liquidity and receive the BTC at a recipient the user signed. Conditions (price triggers, minimum outputs) must be enforced by the relayer contract, because the signature carries none.
- `addColl` from a third party always needs a signature (`_adjustTrove` asserts `msg.sender == borrower`, BorrowerOperationsSignatures, or the Stability Pool).

## 4. Redemptions
`redeemCollateral(uint256 amount, address firstHint, address upperPartialHint, address lowerPartialHint, uint256 partialNICR, uint256 maxIterations)`.
- **Precondition:** TCR ≥ MCR.
- **Order:** starts at `SortedTroves.getLast()` and skips troves with ICR < 110%. The list is sorted by **NICR = coll×1e20 / principal, which excludes accrued interest**. Redemption order is therefore not strictly ICR order; adjacent testnet troves showed ICR 1.2139 ranked ahead of 1.2091.
- **Per trove:** interest is redeemed first, then principal. BTC drawn = lot / price. A full redemption closes the trove (`Status` 4 = closedByRedemption), burns the 200 MUSD gas reserve, and sends the surplus BTC to CollSurplusPool, claimable with `claimCollateral()`. A partial redemption must leave net debt ≥ 1800 and a NICR hint within a 10-minute interest tolerance; otherwise that step is cancelled and the unused MUSD stays with the redeemer.
- **Fee:** 0.75% of the BTC drawn goes to PCV.
- **Hints:** `HintHelpers.getRedemptionHints(amount, price, maxIter)` returns `(firstHint, partialNICR, truncatedAmount)`.
- **Mainnet now:** redemption bots are active, through unverified contracts 0x153C…cE2d and 0x5620…9a6e and some EOAs. A Mezo-side **SafetyBuffer** (owner 0x1cBb…a7F7; target CR 115%; more than 1,000 `Rebuy` events) keeps reopening a low-CR trove that absorbs redemptions, then buys BTC back through the MUSD/BTC pool. Its trove status is now 4 (closed by redemption). Remaining redemption capacity is about 12.5k MUSD against the single trove that is left.

## 5. Liquidations and the Stability Pool
- **Liquidation.** `liquidate(address)` and `batchLiquidateTroves(address[])` are permissionless; Liquity's `liquidateTroves(uint)` is not present. The caller receives 200 MUSD from the GasPool plus 0.5% of the collateral. The SP offsets the debt and receives the remaining 99.5% of collateral; any shortfall is redistributed through the DefaultPool (`L_Collateral`, `L_Principal`, `L_Interest`).
- **SP functions.** `provideToSP(uint256)`, `withdrawFromSP(uint256)`, and `withdrawCollateralGainToTrove(upper, lower)`. Calling `withdrawFromSP(0)` claims BTC gains only. Non-zero withdrawals revert while any trove has ICR < 110%.
- **SP rewards** are BTC liquidation gains only; there is no token incentive.
- **Mainnet SP:** 14,172,052 MUSD, of which PCV holds 14,172,032, so third-party deposits are about **20 MUSD**. `P` = 0.945.
- **Testnet SP:** 86.23M MUSD, of which third parties hold about 1.2k MUSD.
- **Testnet keepers:** trove 0xDA04…aAaa sits at ICR 109.4%, and there have been 0 liquidations and 0 redemptions in the last 200k blocks (≈262 hours). Keepers are not running on testnet.

## 6. Where interest and fees go
- Interest, borrowing fees and refinance fees are minted as MUSD to **PCV**. EnclaveDebtManager interest also goes to PCV, through permissionless `accrueInterest()`.
- `PCV.distributeMUSD()` is **permissionless** (confirmed with an eth_call from a random address). It sends `feeSplitPercentage` (currently **50** on both networks) to `feeRecipient` = sMUSD through `receiveProtocolYield(amount)`. The rest burns down the bootstrap loan; `debtToPay` is **14.95M** on mainnet, out of the original `BOOTSTRAP_LOAN` of 100M. Once the loan is repaid, the rest is deposited into the SP instead.
- Redemption-fee BTC sits in PCV until `distributeBTC()`, which only the distributor, owner, council or treasury can call (other callers revert with "caller not authorized"). It goes to `btcRecipient` = **YieldConverter** 0x5acC…d1c5. YieldConverter swaps the BTC for MUSD through the Tigris BTC/MUSD pool and calls sMUSD `receiveProtocolYield`. 100% of BTC fees reach sMUSD.
- PCV's SP liquidation gains are withdrawn by governance to whitelisted recipients for rebalancing.

## 7. MUSD token
- Built on OZ `ERC20Permit`: **EIP-2612 permit is supported**, with domain "Mezo USD", version "1", chainId 31611 or 31612.
- **No ERC-3156:** `maxFlashLoan` and `flashFee` revert on both networks.
- Transfers to the zero address or to the token contract itself revert.
- Minting and burning are gated by `mintList` and `burnList`, which the owner (multisig 0x98D8…7C7a) changes immediately with no timelock.
  - Mainnet mint list: BorrowerOperations, InterestRateManager, and **EnclaveDebtManager** (added at block 8,550,826).
  - Mainnet burn list: TroveManager, StabilityPool, BorrowerOperations, EnclaveDebtManager.
- Supply: 29.48M MUSD on Mezo. Bridged supply: 608.8k on Ethereum and 1.018M on Base, at the same address. The NTT managers there hold mint and burn rights. The Mezo NTT manager locks 1.63M MUSD.

## 8. Oracle
- `PriceFeed.fetchPrice()` is a view function. It reads one Chainlink-style aggregator, the Skip Connect precompile at **0x7b7c…0015** (`decimals()` = 18; updated every block on mainnet), scales to 1e18, and **reverts if the price is more than 60 seconds old**. There is no fallback source.
- Third parties can call `PriceFeed.fetchPrice()` or `latestRoundData()` on the precompile.
- **Pyth push feeds on Mezo are stale.** Contract 0x2880…7B43, MUSD/USD feed `0x0617…c6de`: the last mainnet publish was 2026-07-17 (MUSD 1.0078, BTC $63,104, MEZO $0.011); the testnet MUSD feed last published on 2026-07-27. Integrators must push Hermes updates themselves.

## 9. Savings and yield products
### sMUSD (MUSDSavingsRate)
Functions:
- `deposit(uint256)`: mints sMUSD 1:1 and first tries `pcv.distributeMUSD()`.
- `withdraw(uint256)`: burns 1:1 and claims yield automatically.
- `claimYield()`.
- `receiveProtocolYield(uint256)`: **anyone can donate yield**.
- `yieldIndex`, `supplyYieldIndex(addr)`, `claimableYield(addr)`.

Pending yield = `claimable + bal × (yieldIndex − supplyYieldIndex) / 1e18`.

Other properties:
- ERC-2771 meta-transactions through **MezoForwarder** 0xE6F9…7085.
- The strategy is IdleStrategy, which earns nothing extra.
- There is no deposit cap. The VaultGauge 0x6778…a401 can claim at most 10,000 MUSD per claim.
- The mainnet and testnet implementations have identical source (md5 match).

Mainnet state:
- Supply 7.38M sMUSD; the gauge holds 5.31M (72%), staked for MEZO emissions.
- **Realized yield:** 19,150 MUSD over the last 30 days, about **3.16% APR**, from summing `ProtocolYieldReceived` events.
- Gauge `rewardRate` is 0.4425 MEZO/s. At CoinGecko's MEZO price of $0.0029 that is roughly 0.77% APR for stakers. This estimate is low confidence.

Testnet state: supply 886,082 sMUSD; the vault holds 1.94M MUSD of unclaimed yield; `pcv` and `vaultGauge` are not set.

### Ditto dMUSD vault (0x9171…14F8)
- Operated by Ditto Network; the implementation source is not verified.
- Exposes ERC-4626 plus ERC-7540-style `requestRedeem`, `pendingRedeemRequest` and `claimableRedeemRequest` selectors.
- `totalAssets` is 105,128 MUSD; `convertToAssets(1e18)` returns 0.981.
- The docs give the APY as ~3.60% (as of 2026-09-29) through Spark Savings, with asynchronous exits.

### USDC Lending Vault
- Morpho Vault V2 0x0629…a8B ("Morpho BTC-mUSDC Vault"); curator and owner is the Mezo multisig.
- `totalAssets` ≈ 81.9k mUSDC.
- It supplies the Morpho Blue BTC/mUSDC market: id 0x6f88…33db, LLTV 86%, AdaptiveCurveIrm, MorphoPriceOracle; about 81% utilized.

## 10. Audit notes (Cantina, 2025-04-15)
- 29 issues found and 26 fixed. The critical one was refinance spamming.
- 3.3.2 (borrow capacity can be gamed): fixed by lowering the cap when collateral is withdrawn.
- 3.4.3 and 3.4.4 (refinance rate and open collateral not bound by the signature): fixed by signing `interestRate` and `assetAmount`.
- 3.4.5: hints were removed from the signed data.
- Acknowledged and left open: 3.4.7 (PCV economics). The SP is a passive PCV position, rational depositors can exit before unprofitable liquidations, and the system is unbacked until the bootstrap loan is repaid. A QA note also says liquidations can be unprofitable to the SP, marked "won't fix".
- The repo's SECURITY.md points to a Cantina bug bounty.

## 11. Events for indexing
- `TroveUpdated(address indexed borrower, uint256 principal, uint256 interest, uint256 coll, uint256 stake, uint16 interestRate, uint256 lastInterestUpdateTime, uint8 operation)` is emitted by both BorrowerOperations (0 open, 1 close, 2 adjust, 3 refinance) and TroveManager (0 applyPendingRewards, 1 liquidate, 2 redeem). The operation codes overlap, so an indexer must key on the emitting contract.
- BorrowerOperations: `TroveCreated`, `BorrowingFeePaid`, `RefinancingFeePaid`.
- TroveManager: `Liquidation(principal, interest, coll, collGasComp, musdGasComp)`, `Redemption(attempted, actual, collSent, collFee)` (no actor address; use the transaction's `from`), `TroveLiquidated`, `LTermsUpdated`.
- StabilityPool: `UserDepositChanged`, `CollateralGainWithdrawn`.
- CollSurplusPool: `CollBalanceUpdated`.
- PCV: `PCVDistribution`, `PCVDistributionBTC`.
- InterestRateManager: `InterestRateUpdated`.
- sMUSD: `Deposit`, `Withdraw`, `ProtocolYieldReceived`, `YieldClaimed`.


# Research report: research:chain-infra-crosschain

# Mezo chain infra, dev tooling, and cross-chain MUSD/MEZO: research brief (as of 2026-10-23)

All on-chain reads were taken 2026-10-23 between 22:00 and 23:00 UTC with `cast`/`curl` against mainnet `https://mezo-mainnet.boar.network` (31612), testnet `https://rpc.test.mezo.org` (31611), and public Ethereum, Base, BSC and Robinhood RPCs. Docs paths are relative to `mezo-org/documentation/src/content/docs/docs/`. Anything inferred rather than verified is labelled as inference.

## 0. Facts that should shape the project choice

1. **Native BTC bridge-in is closed.** It ended on **2026-10-13**. Bitcoin-wallet deposits are no longer accepted, and BTC now enters Mezo only as tBTC from Ethereum. Bridge-out to Bitcoin L1 still works. Sources: `users/mainnet/bridges.mdx`, `users/getting-started/deposit-assets.mdx`.
2. **The Pyth address in Mezo's docs is dead.** `0x2880aB15…7B43` ("Pyth Core") was last updated on 2026-07-17 (mainnet) and 2026-07-27 (testnet). The live "Pyth Core Compatible" contracts are mainnet `0x5D289Ad1CE59fCC25b6892e7A303dfFf3a9f7167` and testnet `0x933aDeC2C7624b11E4B2b80ACE15BF9a71a31315`. Mezo's updater `0x2585…2DfD` was still pushing to them on 2026-10-23. Pyth's own address page agrees.
3. **Morpho Blue already runs on Mezo but hosts only one market.** The core is `0x565834cE7E40b8987BC20EbF83E2159467bDA311` (owner: Mezo multisig). The one market is BTC collateral / mUSDC loan at 86% LLTV, with ~81.9K supplied and ~66.3K borrowed. **No market lends MUSD on Mezo.** The MUSD markets on Ethereum's Morpho hold under $100.
4. **MUSD trades below its peg, and liquidity off Mezo is thin and lopsided.** Prices: CoinGecko $0.9887, Pyth 0.9894. Base's Aerodrome pool and Ethereum's Curve pool each hold about 80% MUSD.
5. **MUSD does not exist on BNB Chain.** It also isn't on Solana or Robinhood Chain. MEZO is on BSC, but only ~19K tokens and no pools were found.
6. **A transaction can make at most 20 precompile calls, reads included.** This covers the BTC token, the MEZO token and the price oracle. I confirmed it with a Multicall3 `eth_call`: 20 BTC `balanceOf` reads succeed and 21 revert.
7. **The testnet faucet cannot fund a MUSD loan.** It drips 0.001 BTC or 100 MEZO per IP every 24h. The smallest MUSD loan is 2,000 MUSD debt at 110% collateral, which needs about 0.027 BTC. Judges cannot borrow MUSD from faucet funds without a workaround.
8. **No third-party keepers, bundlers, paymasters or VRF exist on Mezo.** EntryPoint v0.7 is deployed but has 0 transactions. Mezo runs its own in-house bots instead.
9. **EIP-7702 has been live since mezod v11.0.** It activated at mainnet block 9,275,000 and testnet block 13,206,900. Both networks run Mezod 13.0.1.
10. **x402 on Mezo works but is barely used.** The facilitator settles MUSD *and* BTC and pays the gas. Its mainnet signer had sent only 22 transactions.

## 1. Network parameters

| | Testnet | Mainnet |
|---|---|---|
| chainId | 31611 (`0x7b7b`) | 31612 (`0x7b7c`) |
| Working HTTPS RPC | `https://rpc.test.mezo.org` | `https://mezo-mainnet.boar.network`, `https://jsonrpc-mezo.boar.network`, `https://mainnet.mezo.public.validationcloud.io`, `https://mezo.drpc.org`, `https://rpc-internal.mezo.org` (used by the explorer and OrangeKit) |
| WebSocket | `wss://rpc-ws.test.mezo.org` | `wss://mezo-mainnet.boar.network`, `wss://mainnet.mezo.public.validationcloud.io`, `wss://mezo.drpc.org` |
| Broken endpoints (tested) | `testnet-rpc.mezo.org` (no response) | `rpc.mezo.org` (no response; this is **viem's built-in `mezo` chain default**). Imperator `rpc_evm-mezo.imperator.co` returns HTTP 405 |
| Explorer | explorer.test.mezo.org (Blockscout); API `api.explorer.test.mezo.org/api/v2` and `/api` | explorer.mezo.org; API `api.explorer.mezo.org/api/v2` and `/api` |
| Faucet | faucet.test.mezo.org: BTC **or** MEZO, Cloudflare Turnstile, 0.001 BTC or 100 MEZO, 24h delay (`mezod/infrastructure/cloudflare/faucet/wrangler.toml`) | none |
| Gas token | BTC, 18 decimals | BTC, 18 decimals |
| Client and height | Mezod/13.0.1, block ~16.33M | Mezod/13.0.1, block ~12.72M |

Other observed chain details:
- **Gas:** mainnet gas price ~1.46e6 wei, with a minimum of 1.3e6 from the Maintenance precompile. Testnet gas price is ~146 wei. Block gas limit is 10,000,000.
- **EVM features:** Shanghai, Cancun, Prague and Osaka are active (`mezod/docs/evm-compatibility.md`, `docs/upgrades.md`). That includes PUSH0, transient storage, MCOPY, BLS12-381, P256VERIFY at `0x100`, the EIP-7623 calldata floor and EIP-7702.
- **EVM features that are missing:**
  - PREVRANDAO always returns 0, so there is no on-chain randomness.
  - Blob transactions are not supported.
  - The EIP-2935 block-hash history contract is not deployed.
  - `eth_config` is not available.
  - Self-destruct has been disabled since v13.
- **Stale config advice:** the docs still recommend `evmVersion: "london"`. That works but is outdated.
- **BTC is also an ERC-20.** The precompile at `0x7b7c000000000000000000000000000000000000` (symbol BTC, 18 decimals, EIP-2612 permit) reports the same balance as `eth_getBalance` (verified). Both views move one balance, so contract accounting must not count native and ERC-20 BTC separately.

## 2. Custom precompiles

Source: `mezod/x/evm/types/precompile.go` and `mezod/docs/precompile.md`. ABIs live in `precompile/<name>/abi.json` and `I*.sol`, with Hardhat tasks in `precompile/hardhat/tasks`.

| Address | Precompile (version) | Notes |
|---|---|---|
| `0x7b7c…0000` | BTC token (v1) | ERC-20 with `permit` (returns bool), `nonces`, `DOMAIN_SEPARATOR`. x402's EIP-712 domain for it is "BTC" v1 |
| `0x7b7c…0001` | MEZO token (v2) | ERC-20 with permit, plus `mint` by a single minter (`getMinter()` = `0x66Bff681611553b3204A226b2019ec621F39ffc3`) |
| `0x7b7c…0011` | ValidatorPool (v1) | PoA validator management |
| `0x7b7c…0012` | AssetsBridge (v6) | `bridgeOut(token, amount, chain 0=Ethereum / 1=Bitcoin, recipient)`; `getOutflowLimit`/`getOutflowCapacity` (BTC: 4 BTC per 25,000 blocks); `getMinBridgeOutAmountForBitcoinChain` = 0.01 BTC; ERC-20 mappings; triparty bridging for enclaves |
| `0x7b7c…0013` | Maintenance (v6) | Emergency team, bridge/transaction/chain lockdowns, min gas price, `getMaxPrecompilesCallsPerExecution()` = **20** |
| `0x7b7c…0014` | Upgrade (v1) | x/upgrade plans |
| `0x7b7c…0015` | PriceOracle (v1) | Chainlink `AggregatorV3` interface: `decimals()` = 18, `latestRoundData()`. Hardcoded to **BTC/USD only** (`priceoracle/rounds.go`) |
| `0x7b7c1…0000` | TestBed | Test use only |

The call counter in `x/evm/statedb/statedb.go` (`RegisterCachedCtxCheckpoint`) counts **every** precompile execution, reads included. Two consequences:
- Frontends must split Multicall batches of BTC/MEZO/oracle reads into chunks of 20 or fewer.
- Vaults and payout loops should keep precompile calls per transaction low. Native `msg.value` transfers likely don't count (inference, not tested).

## 3. Mezo Passport, accounts and Mezo ID

**Package.** `@mezo-org/passport` latest is 0.17.2 (published 2026-01-27; a 0.17.3-dev.4 dev build appeared 2026-02-06). It is a RainbowKit wrapper.
- Peer dependencies: `react ^18.2.0`, `wagmi ^2.5.12`, `viem ^2.22.8`, RainbowKit `^2.0.2` (pinned to 2.0.2 internally), react-query 5. There is no React 19 peer range.
- Bitcoin wallets: UniSat, OKX, Xverse. EVM wallets connect through WalletConnect and injected providers.
- Exported hooks include `useBitcoinAccount`, `useSendBitcoin`, `useSendTransaction`, `useGetAccountByMezoId`, `useValidateMezoId`, `useTokensBalances` and `useSignInWithWallet`. Source: the npm tarball's `dist/src/hooks/index.js`.

**How a Bitcoin wallet gets an EVM account.**
- Through `@mezo-org/orangekit` 1.0.0-beta.40, which uses `orangekit-smart-account` 1.0.0-beta.24.
- Each Bitcoin wallet controls a **Safe-based smart account**. That account validates the Bitcoin wallet's signatures (it is built on `@safe-global/protocol-kit`).
- Transactions are relayed by Mezo's relayer at `https://mezo.org/api/v2/relay/transactions` (testnet: `https://test.mezo.org/api/v2/relay/transactions`).
- The relayer only relays `Safe.execTransaction` calls that **refund the relayer in BTC**. The mainnet refund receiver is `0xf35c1a20303ddcA464Ebf5b3b023588Cf3181c8a`. Source: `MezoTransactionSender.js`.

**What this means for dApp UX.**
- For Bitcoin-wallet users, `msg.sender` is a Safe contract, so `tx.origin == msg.sender` checks break.
- MUSD's permit is OpenZeppelin's `ERC20Permit` (ecrecover only), so gasless permit flows, including x402's EIP-2612 sponsorship, only work for EOAs. The Safe must also hold BTC to repay the relayer.
- Since 2026-10-13 the docs steer Bitcoin-wallet users to move their funds to an EVM wallet. Passport's Bitcoin-wallet path now mainly serves existing accounts.

**Mezo ID.**
- IDs look like `name.mezo` and are 15 characters or fewer (`utils/mezoId.js`).
- Resolution endpoint: `GET https://api.mezo.org/accounts/{mezoIdOrAddress}` (testnet: `api.test.mezo.org`). It returns `{mezoId, linkedAccounts:[{type:"wallet", btcAddress?, evmAddress}]}`.
- It works server-side with no Origin header. Browser CORS is allowed only for mezo.org.
- The endpoint is undocumented, so treat it as unstable.

## 4. Account abstraction

**Present on both networks** (checked with `cast codesize`):
- Safe v1.3.0 and v1.4.1 canonical singletons and factories
- Safe4337Module v0.3.0 `0x75cf…c226`
- **EntryPoint v0.7** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Multicall3
- Arachnid CREATE2 deployer and the Safe singleton factory

**Absent:** EntryPoint v0.6 and v0.8, CreateX, the ERC-6551 registry, and the stock Simple7702Account and MetaMask 7702 delegators.

**No bundler activity.** The Blockscout counter for EntryPoint v0.7 shows `transactions_count: 0` on both networks. No bundler or paymaster provider for Mezo turned up in searches.

**EIP-7702** type-4 transactions are accepted (`mezod/docs/spec/eip7702-set-code.md`). One Mezo-specific rule: authorizations that point at any precompile are silently skipped. I did not exercise 7702 on-chain, because signing was out of scope.

**Safe.** The Safe UI at safe.mezo.org is run by Onchain Den. Safe's official config and transaction service does **not** list 31611 or 31612 (HTTP 404), so Safe API Kit with the default service will not work.

**Gasless paths Mezo already offers:**
- **Get Gas:** permit plus execute signatures, relayed. It swaps MUSD or MEZO into exactly 0.0001 BTC.
- The x402 facilitator's gas sponsorship.

## 5. Oracles

**Skip Connect (native).** Precompile `0x7b7c…0015` serves BTC/USD with 18 decimals, updated every block. Reads returned about $81.2K. MUSD's `PriceFeed` uses it on both networks:
- mainnet `PriceFeed` `0xc5aC5A88…cA88`
- testnet `PriceFeed` `0x86bCF084…9366`
- staleness bound `MAX_PRICE_DELAY` = 60s

Connect's x/oracle also tracks ETH/USD and USDT/USD, but only through node REST (`http://mezo-node-0.test.mezo.org:1317/connect/oracle/v2/get_price?currency_pair=ETH/USD`), not through the EVM.

**Pyth.** Read it with the standard `IPyth` calls `getPriceNoOlderThan(id, maxAge)` and `updatePriceFeeds`. The update fee is 0.

| Contract | Mainnet | Testnet |
|---|---|---|
| Pyth Core Compatible (live) | `0x5D28…f7167` | `0x933a…1315` |
| Pyth Pro | `0x00Aa49132AF596DE135C840E85E4bF6871dB4Eb8` | `0x768dbf6a56b2C16b68C561a1A3395e2e86542D97` |
| Pyth Core (legacy, stale) | `0x2880…7B43` | `0x2880…7B43` |

- **Fresh feeds on the live contract:** BTC, MUSD (0.98939), MEZO (0.0028775), USDC, USDT, cbBTC, T.
- **Not usable:** SolvBTC returns `PriceFeedNotFound`. The equity feeds (NVDA and others) are stale because the pusher dropped them in v12.
- **Mezo pusher thresholds:** MUSD 1% deviation or 3600s; BTC and MEZO 2% or 7200s (`mezod/infrastructure/kubernetes/common/pyth-pusher-mezo/configmap.yaml`).
- **Ethereum:** Pyth `0x4305FB66…69C6` carries MUSD/USD, updated every 6h or on a 1% move.

**Stork.** Testnet only. The proxy `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` exists and is an `UpgradeableStork`, but it has seen only admin transactions, no feed pushes. Stork's own address list no longer includes Mezo.

**Supra DORA (pull).** Testnet only: pull contract `0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702`, storage contract `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`.

**Chainlink, RedStone, Gelato VRF:** I found no deployments or announcements for Mezo (medium confidence).

## 6. Indexing and data

- **Goldsky:** supports subgraphs and Turbo on both networks. Mezo's docs give the testnet slug `mezo-testnet`.
- **No public Mezo-maintained subgraph.** The `mezo-org/subgraphs` repo the docs link to returns 404.
- **Envio:** HyperIndex over RPC. HyperSync is available only on request.
- **Blockscout REST v2** plus an Etherscan-style `/api`, on both explorers.
- **Contract verification:** Sourcify supports 31611 and 31612.
- **Dashboards:** Dune ("MUSD on Mezo", "Chain overview"), DefiLlama (Mezo TVL $72.2M, $65.4M of it in Mezo Earn) and GeckoTerminal (network id `mezo`).
- **Coverage gaps:**
  - DexScreener does not list Mezo-native MUSD pools.
  - DefiLlama's stablecoin data does not track MUSD on Base.
  - Morpho's API rejects chainId 31612.

## 7. Keepers, automation and relayers

No Gelato Relay or Automate contracts and no Chainlink Automation registry exist on Mezo (checked at their canonical addresses). Mezo operates its own bots, listed in `mezod/infrastructure/kubernetes/mezo-production/monitoring/balance-exporter/configmap.yaml`:

| Bot | Address |
|---|---|
| liquidation-bot | `0x1c22CF6bf3D95ece1e37097b2f10F29f9262a849` |
| safety-buffer-keeper | `0x1cBbC5f210031fF947F4a17D87fcFbBe02A7a8f7` (active on 2026-10-23) |
| earn-bot (Mezo, Ethereum, Base) | `0xf8176Df5B9FbCf0Ed38c06970371ba89B7701bBb` |
| pyth-updater | `0x2585618FD0b5656C72918CC7b92207e5B6022DfD` |
| passport relayer | `0xf35c1a20…1c8a` |

The x402 docs warn that gas estimation on Mezo needs headroom. Any keeper should pad its gas estimates.

## 8. x402 on Mezo

- **Facilitator:** `https://facilitator.vativ.io`. Its `/supported` endpoint reports x402 v2, scheme `exact`, networks `eip155:31611` and `eip155:31612`.
- **Accepted assets:** MUSD (EIP-712 domain "Mezo USD" v1) and **BTC** (`0x7b7C…0000`, domain "BTC" v1).
- **How payment moves:** transfer method `permit2`, with the extension `eip2612GasSponsoring`. Signer addresses are `0x5Bd6…5A67` and `0x7B38…CEFA`.
- **Settlement proxy:** `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, present on both networks.
- **SDK versions:** Mezo testnet needs `@x402/evm` ≥2.10.0 and mainnet needs ≥2.15.0. The quickstart pins 2.16.0.
- **Gas:** the facilitator pays BTC gas on both sides.
- **Usage so far:** the mainnet signer has nonce 22 and holds 0.00015 BTC; the testnet signer has nonce 126.

## 9. Bridges and cross-chain presence

**Native bridge (Ethereum side).** `MezoBridge` proxy `0xF6680EA3b480cA2b72D96ea13cCAF2cFd8e6908c`; Sepolia `0x3a3BaE13…497C`.
- Deposit functions: `bridgeTBTC(amount, recipient)` (minimum 0.0001 tBTC), `bridgeTBTCWithPermit`, `bridgeERC20(token, amount, recipient)`.
- It holds ~117 tBTC, and its sequence counter is at 35,714.

**Withdrawing from Mezo** goes through the AssetsBridge precompile.
- To Ethereum: ~$3 flat fee, minimum 0.0002 BTC, typically 30–60 minutes.
- To Bitcoin L1: minimum 0.01 BTC, plus 0.000027 BTC and 0.2% tBTC fees.
- Release needs attestation from at least 2/3 of the bridge validators.

**Wormhole NTT.** Verified with `cast` and the `deployment.json` files in the four `ntt-bridge-*` repos. Wormhole chain IDs: Mezo 50, Ethereum 2, Base 30, BSC 4, Solana 1, Robinhood 72. Rate-limit window is 24h. Owner is the Mezo multisig `0x98D8899c3030741925BE630C710A98B57F397C7a`.

| Token / network | Chains (mode) | Managers and tokens | Inbound limit per day |
|---|---|---|---|
| MUSD mainnet (NTT v1.1.0) | Mezo (locking), Ethereum and Base (burning) | Mezo manager `0x7efb…e0bD`; Ethereum manager `0x5293…477E`; Base manager `0x3EB4…1Bc1`; token `0xdD468A1D…F186` on all three | 10M MUSD per peer |
| MUSD testnet (NTT v2.0.0) | Mezo testnet, Sepolia, Base Sepolia | Mezo testnet manager `0x2088…15be` (token `0x1189…c503`); Sepolia token `0xeB5a…bB8E`; Base Sepolia token `0x5609…AEA5` | — |
| MEZO mainnet (NTT v1.3.1) | Mezo (locking); Ethereum, Base, BSC, Robinhood (chainId 4663, added ~2026-10-05), Solana | Mezo manager `0x5E66…9591`; EVM token `0x8e4cbBcc…848b`; Solana mint `8niMFW…Crw6` | 50M MEZO |
| MEZO testnet | Mezo testnet, Sepolia, Base Sepolia, Solana devnet | Mezo testnet manager `0xde40…904F`; EVM token `0x8e4c…848b`; Solana devnet mint `2GcWG5…y26V` | — |

There is **no BSC or BSC-testnet peer for MUSD.** The docs list outdated MUSD transceivers for Mezo and Ethereum; on-chain they are `0x62DE…1C83` and `0x1473…D786`. The MUSD transceiver on Mezo has Wormhole's Standard Relayer `0x27428DD2…4911` configured; the MEZO transceiver does not.

**Supplies on 2026-10-23.**
- MUSD: total on Mezo 29.48M, of which 1.635M is locked in NTT. Ethereum 608.8K, Base 1.018M. None on BSC, Robinhood or Solana.
- MEZO: on Mezo 1.1385B, of which 307.6M is locked. Base 285.2M, Ethereum 21.66M, BSC 19.0K, Robinhood 42.
- Testnet MUSD: Sepolia 141.7M, Base Sepolia 4.5K.

**Liquidity outside Mezo.**
- **Base:**
  - Aerodrome Slipstream MUSD/USDC pool `0xb02FdA98…2Ea5`: 928.6K MUSD and 226.5K USDC (~$1.15M). It has a gauge (`0x310E…8fb8`) but pays zero emissions.
  - Aerodrome MEZO/MUSD pool: ~$5K.
  - A few dust pools on PancakeSwap (Base) and Uniswap v4.
- **Ethereum:**
  - Curve MUSD/crv2pool `0xB5571E76…955f`: 527K MUSD and 126K crv2pool, around 12.8% APY from CRV, with Stake DAO and Convex wrappers.
  - Curve MUSD/sUSDe `0x765C…285E`: about 15 MUSD.
  - Uniswap v4 MUSD/USDC: ~$35–68K.
  - Morpho MUSD markets (cbBTC and tBTC collateral at 86%, USDT against MUSD at 91.5%): about $0 each.
  - The aMUSD vault `0x5231…6aBc` holds about 83 MUSD.
- **BNB Chain:** no MUSD, and no MEZO pools found.

**Liquidity on Mezo itself.**
- The basic pools are tiny: MUSD/mUSDC ~$11.6K, MUSD/mUSDT ~$13K, BTC/MUSD ~$78K. A 1,000 MUSD swap into mUSDC quotes 963.6.
- Tigris CL (Mezo V3) holds $5.35M per DefiLlama.
- **Testnet:** the MUSD/BTC basic pool `0xd16A…6aA9` holds 102.6M MUSD and 1,303 BTC.

## 10. Listing requirements and dev tooling

**Mezo Market listing** (`developers/getting-started/dapp-requirements.md`) requires three things:
1. MUSD integration.
2. A third-party audit report submitted to the Supernormal Foundation.
3. A fully working Mainnet deployment.

The Founder Program separately requires an MVP live on testnet.

**Packages and tools:**
- `@mezo-org/musd-contracts` 1.1.0 and `@mezo-org/mezod-contracts` 1.0.0: ABIs and deployment addresses.
- `@mezo-org/chains` (viem chain definitions; the README calls it `@mezo/chains`).
- viem's built-in `mezo` and `mezoTestnet` chains. Mainnet needs an RPC override because the default is dead.
- `mezo` CLI 0.1.0-alpha.3 via brew. The source repo is private, so what it does is unknown.
- The Wormhole TS SDK knows the "Mezo" chain (`mezo-org/demo-ntt-ts-sdk` shows manual redeem).
- An external agent skill for Mezo exists (openagents).

## 11. Documentation errors (all verified)

- The Pyth address given (`0x2880…`) is stale, as are the SolvBTC, equity and old MEZO feed entries.
- The MUSD NTT transceivers listed for Mezo and Ethereum are outdated.
- `chains/index.md` and `mezod.mdx` list dead RPCs (`rpc.mezo.org`, `testnet-rpc.mezo.org`) and invalid chain ids ("mezo-mainnet").
- Stork is presented as available on testnet, but its contract shows no feed pushes and Stork no longer lists Mezo.
- The Imperator RPC returns 405.
- Robinhood is missing from the MEZO bridge docs.
- The release notes stop at v9.
- The bridges page says in one place that MUSD can only go to Ethereum, contradicting its own Base support.

## 12. Opportunities and constraints for builders

**What is missing or weak:**
- No MUSD lending market on Mezo, although Morpho Blue is already deployed and supports permissionless market creation. On mainnet only the 86% LLTV and AdaptiveCurveIrm `0x3760…C1e7` are enabled. On testnet, Morpho `0xCe1da828cA15cb1FDAfa84C366A53C8106655a73` has only 77% enabled.
- No oracle router: only BTC/USD is native, and every other price needs Pyth Core Compatible plus your own staleness checks.
- No keepers, no 4337 bundler or paymaster, no VRF.
- No indexed MUSD subgraph.
- Cross-chain MUSD is skewed toward sellers. Mezo's sMUSD vault yields 4.24%, while Base's Aerodrome pool yields about 1%. With redemption fees at 0.75% and MUSD at ~0.989, a cross-chain peg or yield router has a real if thin margin.

**Testnet limits to design around:**
- Faucet funding cannot open a trove. Either swap the BTC drip on the testnet MUSD/BTC pool (0.001 BTC buys about 78 MUSD) or ship a prefunded MUSD dispenser for judges.
- Testnet has no Bitcoin L1 deposit flow, and mainnet's Bitcoin deposit is closed too.
- No randomness: PREVRANDAO returns 0.
- At most 20 precompile calls per transaction.
- Base Sepolia MUSD is thin, and NTT testnet transfers need SDK relaying.
- BNB Chain has no MUSD at all.


# Research report: research:ecosystem-gaps

# The live Mezo ecosystem: size, ownership, and gaps
*Snapshot taken at Mezo mainnet block ≈12,716,469 (2026‑10‑23, about 22:30 UTC). Mezo's oracle BTC price at that block was **$81,230** (`cast call 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88 'fetchPrice()(uint256)'`). Unless noted otherwise, on-chain figures come from `cast` against `R=https://mezo-mainnet.boar.network` (the RPC listed in `developers/getting-started/configure-environment.md`). Historical figures use `--block N` on the same archive RPC.*

---
## 1. Executive summary

1. **Two institutional accounts account for most of Mezo's size.** DefiLlama shows $72.2M chain TVL and MUSD supply is 29.48M, but most of both comes from the protocol and from **two Mezo Prime "Enclaves"** (Anchorage custody, Bullish as anchor client). Together they control:
   - **1,000.2 of the 1,117 BTC on Mezo (89.5%)**;
   - **750.2 of the 804.5 BTC locked as veBTC (93%)**;
   - **14.52M MUSD of debt.**
   
   Another **14.95M MUSD is the PCV bootstrap loan**, and **14.17M** of it sits idle in the Stability Pool. Organic retail MUSD float is probably about $1–3M (inference; see §3).
2. **Retail MUSD borrowing (troves) has nearly disappeared.** Active troves fell from 104 to **1** between 2025‑11‑30 and 2026‑10‑23. Trove debt fell from 6.03M to **14.5K MUSD**, and trove collateral from 324 to **16.6 BTC** (§4).
3. **MUSD has traded below peg for most of the year.** Today it is about $0.989 on every venue. Only ~14K MUSD of redeemable trove debt is left, so **the redemption floor has effectively gone**. USDC exit liquidity across Mezo, Base and Ethereum totals about **$0.38M** (§6).
4. **MEZO is at an all-time low:** $0.0029, FDV about $3M, down 98% from the 2026‑04‑13 high. About 2M MEZO is emitted per epoch, now worth roughly **$6K/week**. Yield that comes only from emissions is close to zero in USD terms (§8).
5. **Lending on Mezo is a single Morpho Blue market** (BTC collateral, mUSDC loans) with $82K supplied. No venue on any chain lends MUSD, or accepts MUSD, sMUSD or veBTC as collateral, at meaningful size. Retail users cannot borrow against veBTC; only allowlisted institutions can. Looping, yield tokenization and options do not exist. Perps exist only on paper (§10).
6. **Chain activity is low.** The 30-day average is about 946 tx/day, against 62.8K total addresses (§9).

---
## 2. Headline metrics

| Metric | Value | Source / confidence |
|---|---|---|
| DefiLlama Mezo chain TVL | $72.20M (10‑23). History: $1.0M (2025‑10‑01), $34.0M (2026‑01‑21), $69.3M (05‑27), $75.0M (10‑14) | api.llama.fi/v2/chains; /v2/historicalChainTvl/Mezo (high) |
| BTC on Mezo (native ERC‑20 0x7b7C…0000) | 1,117.1 BTC (~$90.7M) | `cast call 0x7b7C…0000 totalSupply()` (high) |
| veBTC locked (live contract 0x3D4b…f279) | 804.53 BTC; 6,161 NFTs ever minted | `supply()`, `tokenId()` (high) |
| MUSD total supply | 29,482,017 | `cast call 0xdD46…F186 totalSupply()`; explorer shows 29,236 holders (high) |
| MUSD on Ethereum / Base / BSC | 608,809 / 1,017,944 / not deployed | `totalSupply()` on publicnode RPCs (high) |
| Active troves | **1** (14,488.6 MUSD debt, 16.589 BTC) | TroveManager `getTroveOwnersCount()`, `getEntireSystemDebt/Coll()` (high) |
| Enclave (institutional) MUSD debt | 14.52M, at the 14.5M mint cap | EnclaveDebtManager `getTotalOutstandingDebt()` (high) |
| Stability Pool | 14,172,052 MUSD, of which 99.9999% is the PCV's deposit; 6 transactions ever | SP `getTotalMUSDDeposits()`; explorer counters (high) |
| sMUSD (MUSD Savings Vault) | 7.38M supply, 448 holders. 5.31M is staked in the gauge, 5.25M of that by Enclave A | explorer + `VaultGauge.balanceOf` (high) |
| MUSD price | $0.9887 (DefiLlama/CoinGecko); $0.9896 (Mezo CL tick, Base Aero); ≈$0.990 (Curve) | §6 (high) |
| MEZO price / FDV | $0.002947 / $2.95M (CG, 1B basis). On-chain supply is 1.1385B, which gives ≈$3.36M | CoinGecko API (high) |
| Mezo DEX volume / chain fees | $2.45M per 30d (Tigris V3) / $28.3K per 30d | api.llama.fi overview/dexs & fees (medium) |
| Activity | 62,802 addresses; 1.116M total txs; ~946 tx/day (30d) | api.explorer.mezo.org/api/v2/stats (high) |

---
## 3. MUSD supply: composition and trend

**Composition today (sums to ≈29.48M):**
- **PCV bootstrap loan, 14.95M.** PCV `debtToPay()` is 14,950,866 (`BOOTSTRAP_LOAN` was 100M). The PCV holds a **14.172M** deposit in the Stability Pool.
- **Enclave debt, 14.52M**, across two positions at 1% interest with 0% originator fee:
  - Enclave A `0x4da9…fB99`: 10.5M principal against veBTC #6114 (500.07 BTC, lock ends 2026‑11‑12). CR ≈387%.
  - Enclave B `0x1473…D786`: 4.0M principal against veBTC #6033 (250.15 BTC, permanent lock). CR ≈508%.
  
  Source: `EnclaveDebtManager.getPosition()` on proxy `0x2C5e…389a`. It was added to the MUSD mint and burn lists on 2026‑04‑28 (`MintListAddressAdded` log, block 8,550,826). `mintCap` = `totalPrincipal` = 14.5M and `maxRate` = 500 bps.
- **Retail troves, 14.5K.**

**Where the MUSD sits** (explorer `/tokens/MUSD/holders`):

| Holder | MUSD |
|---|---|
| Stability Pool | 14.17M |
| sMUSD strategy (IdleStrategy `0x0C09…a295`) | 7.38M |
| mUSDC/MUSD CL pool `0xCC37…aC1a` | 5.33M |
| NTT lockbox (bridged to Ethereum/Base) | 1.63M |
| Safe `0xf365…8BC4` | 0.235M |
| SafetyBuffer | 0.199M |

Enclave A alone accounts for 5.25M of the staked sMUSD and ~5.26M of the CL liquidity (NFT #3340).

**Inference:** after removing protocol-owned and enclave-deployed MUSD, organic retail MUSD on Mezo is only about $1–3M (medium confidence).

**Trend.** Using DefiLlama minted-on-Mezo figures, supply went:
- 21.6M (2025‑10) → 18.6M (2026‑03 low) → **31.1M peak (2026‑08)** → 29.48M now.

All of the growth since April comes from enclave minting: 10.5M by 2026‑05‑16 (cap 11M), then 14.5M by 07‑19 (EDM `totalPrincipal` at `--block 9000000/10500000`). Bridged MUSD on Ethereum fell from a 4.5M peak (2025‑11) to 0.61M (stablecoins.llama.fi/stablecoin/303).

A naming risk: DefiLlama and CoinGecko also list **MetaMask "mUSD"** ($32M) under the same ticker.

---
## 4. Borrowing: the retail CDP has nearly emptied while institutional borrowing grew

TroveManager `0x94Af…c193` at historical blocks:

| Date (block) | Active troves | Trove debt | Trove BTC | MUSD supply |
|---|---|---|---|---|
| 2025‑11‑30 (5.0M) | 104 | 6.03M | 324.0 | 21.03M |
| 2026‑02‑21 (7.0M) | 55 | 3.77M | 284.0 | 18.77M |
| 2026‑04‑26 (8.5M) | 54 | 5.40M | 298.6 | 20.39M |
| 2026‑06‑06 (9.5M) | 54 | 3.91M | 99.8 | 29.39M |
| 2026‑07‑19 (10.5M) | 33 | 1.92M | 62.6 | 31.40M |
| 2026‑09‑30 (12.2M) | 14 | 0.80M | 39.1 | 30.27M |
| 2026‑10‑23 (12.716M) | **1** | **0.0145M** | **16.6** | 29.48M |

DefiLlama "Mezo Borrow" TVL tells the same story: $29.2M (Jan) → $24.0M (May 5) → $1.35M (Oct 23).

**Why (inference, medium confidence).** MUSD has sat persistently at a 0.7–1.2% discount. That makes it profitable to redeem against the lowest-CR troves (0.75% redemption fee). The explorer shows `redeemCollateral` calls on 10‑19 and 10‑22, most failing. A "SafetyBuffer" contract opened a trove on 10‑21 as a redemption buffer and was `closedByRedemption` (status 4) within about a day. Borrowers also lose about 1% when they sell freshly minted MUSD at the discount. **5.70 BTC of unclaimed surplus sits in CollSurplusPool `0xBF51…F491`.**

**Lifetime figures:** more than 2,000 loans and over $550M lifetime MUSD volume (mezo.org/blog/mezo-and-musd-are-live-on-bullish-exchange, 2026‑04‑21). Global MUSD rate is **1%** fixed (`InterestRateManager.interestRate()`=100). Fees are 0.1% issuance, 0.75% redemption, and a 200 MUSD gas deposit (`users/borrow/fees.md`).

**Institutional path: Mezo Prime and Enclaves.**
- Anchorage clients get segregated Safe-based Enclaves. BTC arrives through the "Triparty Bridge" (mezod v8/v9, Mar/Apr 2026).
- MUSD is minted against **pledged veBTC NFTs** through EnclaveDebtManager. This path is governance-gated (`ENCLAVE_ROLE` with 2 members) and has no redemptions.
- Bullish is the anchor client (introducing-mezo-prime post; H1 review says 1,000 BTC).
- On-chain: Enclave A holds 500.07 BTC as veBTC plus 250.01 BTC liquid. Enclave B holds 250.15 BTC as veBTC.
- **The way Enclave A uses its borrowed MUSD:** 5.25M goes into sMUSD staked in the MEZO gauge. The other ~5.26M sits as a single-sided MUSD range in mUSDC/MUSD CL (ticks 276300–276410, roughly MUSD $0.992–$1.003), also staked. In effect this is a sell wall just above market.

**USDC borrowing.** USDC against BTC launched 2026‑07‑13. It runs on Morpho Blue `0x5658…A311` and is the only market on that deployment (`CreateMarket` logs): BTC collateral, mUSDC loan, LLTV 86%. It has 81.9K supplied and 66.3K borrowed (≈81% utilization), and 1.154 BTC of collateral. It is fed by Morpho Vault V2 `0x0629…a8B` (totalAssets 81.9K mUSDC). Total mUSDC on Mezo is only **122K**, which caps this product.

---
## 5. Stability Pool, PCV and savings products

- **Stability Pool.** Deposits are permissionless (`provideToSP` has no gate; `musd/solidity/contracts/StabilityPool.sol`). In practice it is 100% PCV: 6 transactions ever. With one trove there are no liquidations, so the pool earns nothing.
  - The PCV can move MUSD out of the pool to governance-whitelisted recipients (`PCV.withdrawFromStabilityPool`, `recipientsWhitelist`). So 14.17M of idle MUSD could be redeployed by governance.
- **sMUSD (MUSDSavingsRate `0xb4D4…51CC`)** pays yield from 50% of MUSD protocol fees. The other 50% repays the bootstrap loan (`PCV.feeSplitPercentage()`=50; feeRecipient = sMUSD).
  - DefiLlama yields: unstaked **4.24% APY** ($2.07M); staked in the gauge for MEZO **0.73%** ($5.29M).
  - **It is not ERC‑4626.** The ABI is `deposit(uint256)` and `withdraw(uint256)` at 1:1, with yield accrued through `yieldIndex`/`claimYield()`. The docs claim yield sits in the exchange rate; the verified source (impl `0xB33C…9e87`) says otherwise. It also implements ERC‑2771 `isTrustedForwarder`.
- **Other vaults (`users/mezo-earn/vaults/*`):**

| Vault | Mechanism | Size / status | Source |
|---|---|---|---|
| Ditto dMUSD | MUSD → Spark Savings on Ethereum, async redemptions | ~3.60% APY (09‑29); 107K dMUSD, 7 holders | explorer |
| August/Upshift upMUSD | MUSD vault | 48K supply, 5,260 holders | explorer |
| Boar Finance BTC vault | managed veBTC | $184K, 13.7% APY, 28-day unstake | DefiLlama yields |
| Mellow/Sense BTC Vault | — | winding down; withdraw requests by **2026‑10‑28** | docs |
| Lhava Stablecoin Vault | — | wound down 07‑31 | docs |

---
## 6. Peg and DEX liquidity

**Peg history** (CoinGecko `coins/mezo-usd/market_chart`, daily):
- 0.983–0.994 from 2025‑10 to 2026‑03;
- 0.998–1.011 from April to mid-June 2026 (around the MEZO TGE and listings);
- **0.9885–0.9926 from July to October**;
- **0.9887** on 10‑23.

Coinbase's page shows an "ATH $1.29 on 2026‑10‑05", which looks like a thin-book artifact (low confidence).

**Mezo pools:**
- **mUSDC/MUSD CL (ts10):** 8,390 mUSDC vs 5,333,897 MUSD. The tick (276429) implies 1.0106 MUSD per USDC, i.e. **MUSD ≈ $0.9896**. There is almost no USDC on the bid side.
- **BTC/MUSD CL (ts200):** 0.394 BTC + 15.7K MUSD. Implied price is 82,660 MUSD/BTC against the $81,230 oracle, i.e. MUSD ≈ $0.983.
- **v2 pools:** 33 in total. Notable ones: BTC/MUSD vAMM (0.475 BTC + 39.3K MUSD), mUSDC/MUSD sAMM ($11.6K), MUSD/mUSDT ($13.2K), **MUSD/sUSDat ≈$62** (despite the July STRC-yield blog post), plus dust pools for tokenized stocks (NVDA/TSLA/COIN/MSTR…) and REKT.
- **MEZO/MUSD CL:** 1.27M MEZO vs 1.4K MUSD.
- DefiLlama: Tigris Mezo V3 $5.34M (essentially the enclave's MUSD), V2 $113K.

**Off-Mezo:**
- **Base, Aero USDC/MUSD** `0xb02F…2Ea5`: 928.8K MUSD + 226.4K USDC (~$1.15M, price 0.9896). That is 91% of Base MUSD. Aero is the Aerodrome+Velodrome merger, live 2026‑10‑22; LPs had to migrate (mezo.org/blog/mezo-gauges-on-aero).
- **Ethereum, Curve MUSD/crv2pool** `0xB557…955f`: 527K MUSD vs 126K 2pool-LP. `get_dy` shows that selling 100K MUSD costs about **4% slippage**. Uniswap v4 USDC/MUSD holds about $35K. Curve MUSD/sUSDe is dead (14.6 MUSD).

**Bottom line:** about $0.38M of USDC-side exit liquidity backs 29.5M MUSD, and redemption capacity is ~14K MUSD.

---
## 7. BTC TVL and Mezo Earn (veBTC/veMEZO)

- **veBTC:** 804.5 BTC; enclaves hold 750.2 of it and retail ~54.3 BTC (~$4.4M).
  - Path: 563.7 BTC (2026‑05‑16) → 825.2 (07‑19) → 804.5 today. The H1 review cited a 912.6 BTC peak and 2,513 active positions.
  - Locks run 1–28 days and decay; permanent locks exist (`users/mezo-earn/lock/vebtc/index.md`).
  - DefiLlama yields put veBTC APY at 2.91%.
- **veMEZO** (`0xb90f…0122`): 280.69M MEZO locked (24.6% of supply), 2,904 NFTs, locks up to 4 years. DefiLlama shows APY 36.5% paid in MEZO.
- **Voter** (`0x4823…1f03`, ve = live veBTC): **28 gauges**. Weight shares:

| Gauge | Share |
|---|---|
| BTC/MUSD CL | 26% |
| mUSDC/MUSD CL | 19% |
| BTC/MUSD vAMM | 16% |
| sMUSD | 15% |
| MEZO/MUSD CL | 6.5% |
| mUSDC/BTC CL | 6.5% |
| USDC Lending Vault | 6.5% |

  - **`createPoolGauge` is permissionless** when both tokens are whitelisted; MUSD, BTC, MEZO and mUSDC are, sMUSD is not.
  - The CLFactory owner and the Voter governor are both the Mezo multisig `0x98D8…7C7a`.
- **MEZO Gauges** (live 2026‑09): veMEZO votes direct about 8% of emissions (~200K MEZO/epoch) to external MUSD pools: Curve and Uniswap on Ethereum via Merkl (paid as 3-month veMEZO), and Aerodrome/Aero on Base as bribes (`users/mezo-earn/vote/mezo-gauges/*`). Matchbox lets anyone post incentives on these "Remote MEZO Gauges".
- **Stale addresses in the docs.** `developers/features/mezo-pools.md` lists VeBTC `0x7D80…5914` and Voter `0x3A4a…2C1b`. Both are a stale deployment (0.00096 BTC, 22 NFTs, 0 gauges). **Use `0x3D4b…f279` / `0x4823…1f03`.**
- **Security:**
  - On 2026‑10‑05 a veBTC exploit (ERC‑2771 forwarder combined with external libraries) took 5.52 BTC from 37 positions.
  - Meta-transactions were disabled, native BTC bridge-ins closed (2026‑10‑13), and "lesser-used features" are being limited (mezo.org/blog/incident-report-october-5-2026).

---
## 8. MEZO token

- **Price (CoinGecko, 10‑23 22:34 UTC):** $0.002947. Mcap $1.47M on 500M circulating; FDV $2.95M; 24h volume $206K.
- **Extremes:** ATH $0.1485 on 2026‑04‑13; **ATL $0.00265 on 2026‑10‑23**; −35.8% over 30 days. CMC shows $0.0029, FDV $2.9M, rank #2643, circulating 86M.
- **Supply:** emissions began 2026‑01‑26 (week‑0: 4.81M MEZO); spot trading began 2026‑04‑01 (KuCoin GemPool). On-chain supply is now 1,138.5M; the next large unlock (team and investors, 50%) is 2027‑04‑01.
- **Venues:** Coinbase, Gate, KuCoin and Kraken appear in CoinGecko tickers. The H1 review adds Bitget, MEXC, LBank and Bullish. DEX venues are Tigris V3 and Aerodrome on Base.
- **Bridged supply:** 306.96M MEZO is locked in NTT. Base holds 285.27M, Ethereum 21.66M, BSC 19K; Solana is also connected, and Robinhood chain was added 2026‑10.
- **Value accrual:** none for MEZO holders. Fees go to veBTC, and there are no buybacks (mezo.org/blog/introducing-mezo).
- **Exit pressure:** a third-party VeMezoPool buys veMEZO for 50% of its locked amount (`saleBps`=5000, verified source `0xaDCa…0742`).

---
## 9. Live protocol map (excluding core Mezo contracts)

- **DEX:** Tigris v2 (Solidly) + CL (Slipstream fork); UniversalRouter `0xd975…679B`. ~$82K/day volume, dominated by arbitrage bots.
- **Lending:**
  - Morpho Blue + Vault V2 (Mezo-curated; BTC/mUSDC only).
  - "Blend" (BToken; `bBTCupMUSD` total supply 28.6, 11 holders): negligible.
  - BitFire ($11): dead.
- **Vaults:** sMUSD, Ditto dMUSD, Upshift/August upMUSD, Boar BTC and MEZO vaults (Boar also runs a relayer), Mellow (winding down), Range (CL rebalancer, mainnet; TVL not disclosed).
- **ve layer:**
  - Matchbox (matching market, Remote MEZO Gauges incentives);
  - Vezo (veNFT marketplace);
  - Aurove (avBTCm/avMEZOm). avBTCm supply is 0.0084, and its docs say creating a managed position "currently reverts";
  - VeMezoPool;
  - veBoost calculator.
- **Perps:** Velar ($595 TVL on Mezo).
- **Yield assets:** Saturn sUSDat (STRC exposure; 5.5K on Mezo). Tokenized stocks with dust liquidity.
- **Payments/access:** Mezo Market (Bitrefill gift cards), Lolli sats→Mezo (MUSD withdrawals "coming soon"), x402 MUSD payments (facilitator.vativ.io; imgnAI Katana since July), Mezo ID usernames, Safe (safe.mezo.org via Den), Mezo Passport (RainbowKit).
- **Infrastructure:** Skip Connect native oracle, Pyth `0x2880…7B43`, Stork, Supra, Goldsky, Dune (raw and decoded tables), Wormhole NTT, Merkl.
- **Analytics:** Mezo Tools (mezotools.cc), Antwyr, scoffie's Dune dashboards.

---
## 10. Which DeFi primitives exist

| Primitive | Status on Mezo |
|---|---|
| CDP stablecoin (MUSD) | Live, but retail is near zero (1 trove); institutional path is gated |
| Money market lending **MUSD** | **Missing.** The only Morpho market lends mUSDC. Ethereum Morpho MUSD markets hold about $100 (Morpho API); the aMUSD vault holds 83 MUSD |
| MUSD / sMUSD as collateral | **Missing** (no market; sMUSD isn't ERC‑4626) |
| Looping / leverage | **Missing** (no router). The hackathon post asks for "a clearer borrowing or looping interface" |
| Liquid veBTC / borrow vs veBTC | Institutional only (EnclaveDebtManager). Retail wrappers are broken or tiny |
| Fixed-rate / term loans | MUSD's 1% is fixed-rate but open-ended. Term credit is only a design essay (Morpho Midnight, mezo.org/blog/how-to-build-a-bitcoin-backed-credit-market) |
| Yield tokenization, options, structured products | **None found** |
| Perps | Nominal (Velar) |
| Cross-chain MUSD yield | Ditto (→Spark) and LP + MEZO-Gauge incentives on Curve/Uniswap/Aero. No lending on Base or Ethereum |
| Payments / cards | Bitrefill gift cards and x402. Card integrations are on the roadmap (mezo.org/blog/mezo-2026-roadmap) |

**Builder note:** on mainnet Morpho, only LLTV 0.86 and IRM `0x3760…c1e7` are enabled, and the owner is the Mezo multisig. The testnet Morpho is at a **different address** (`0xCe1d…5a73`) with **LLTV 0.77** and IRM `0x0c97…7441`. Testnet also holds "Mezo Morpho COIN/BTDR Vault" tokens, a sign that equity-collateral markets are being tested.

---
## 11. Where MUSD can be used off Mezo

- **Ethereum:**
  - Curve MUSD/USDC/USDT (also through Convex/StakeDAO wrappers, about 12–15% APR from Merkl veMEZO rewards);
  - Uniswap v4 USDC/MUSD;
  - Bullish exchange listing (Ethereum L1);
  - empty Morpho MUSD markets and the empty aMUSD vault.
- **Base:** Aero USDC/MUSD (~$1.15M) and MEZO/MUSD (~$5K); tiny PancakeSwap and Uniswap pools; no lending.
- **BNB:** **no MUSD contract.** MUSD NTT covers only Mezo, Ethereum and Base (`ntt-bridge-musd-mainnet/deployment.json`). Only MEZO is on BSC.

---
## 12. Roadmap signals relevant to "extend, don't detour"

- **H2 2026** (mezo.org/blog/mezo-h1-2026): more BTC-collateral lending markets, institutional lending, Base-first cross-chain MUSD, dApp redesign. Community wish-list: Matchbox, **Telegram bots**, **MUSD agent-payment apps**.
- **2026 roadmap:** Mezo plans its **own veNFT marketplace**, voting delegation, card integrations and AI-agent infrastructure. That makes veNFT markets and generic payments riskier choices for builders.
- **Buildathon** (mezo.org/blog/mezo-buildathon-is-underway): 10‑16 to 11‑15; $7K paid in MEZO; Wave 1 due 10‑26; winners 11‑23.
- **Hackathon 2 winners** (2026‑06‑09): Cermin, TreasuryOS, AdaptiveGuard, Cark, MezoPay, SuperPage (x402), Mezoir, BynD (veMEZO pooling), Fractals (ve fractions). 45% of submissions were payments or commerce.

---
## 13. Ranked gaps

The ranking is by how much each gap could grow MUSD or MEZO utility, weighted by feasibility at hackathon scale.

**Demand-side (users want this and cannot get it):**
1. **Earn on MUSD, and exit it, at or near par.** MUSD holders' only sinks are sMUSD (4.2%, not composable) and LP positions; exit costs about 1–4%. A lending market for MUSD plus a buy-side for discounted MUSD would turn idle MUSD into demand. Idle MUSD available: 14.17M in the SP and 5.33M in a one-sided LP.
2. **Borrow against BTC without redemption risk.** The CDP has emptied; the USDC market is capped by 122K mUSDC. A Morpho BTC→MUSD isolated market (no redemptions, variable rate) is the most direct way back to retail borrowing.
3. **Liquidity for ve positions.** Users want to borrow against or exit veBTC/veMEZO: VeMezoPool pays 50%, Aurove doesn't work, and the enclave design proves the model only for institutions.
4. **One-click leverage/looping** on BTC→MUSD (or mUSDC)→BTC, plus unwind and refinance flows. Thin BTC/MUSD liquidity (~$125K two-sided) caps position size.
5. **Productive MUSD on Base/Ethereum** beyond LPing; there is no lending venue there.
6. **Spending:** only gift cards exist. This space is already crowded with payments projects.

**Supply-side (missing infrastructure):**
1. **MUSD money market**, curated as a Vault V2 that can get a gauge.
2. **Standard ERC‑4626 wrappers / auto-compounders** for sMUSD and for gauge rewards, which collateral integrations require.
3. **Peg-defense tooling:** a redemption-capacity buffer or keeper/arbitrage vault, since roughly half of supply is non-redeemable enclave debt.
4. **Oracles for derivative collateral** (sMUSD, veBTC/veMEZO, LP NFTs).
5. **A working liquid veBTC with auto-relock** (the 28-day maximum lock is the obstacle).
6. **MUSD on BNB:** needs governance-level NTT work, so it is out of scope for builders.
7. **Monitoring and security bots**, given the October exploit.

**Caveats for any build:**
- MEZO-emission incentives are worth very little in USD; yield has to come from organic fees or interest.
- MEZO liquidity (≈$10K across DEXes) makes MEZO unsafe as lending collateral.
- Do not depend on ERC‑2771 meta-transactions.
- Use the live veBTC and Voter addresses, not the ones in the docs.
- Morpho addresses and enabled LLTVs differ between testnet and mainnet.


# Research report: research:analogues-playbooks

# Proven patterns → MUSD/MEZO: transferability, metrics, forkable code
*Research cut-off 2026-10-23/24. Mezo numbers were read on-chain (mainnet block ≈12,716,4xx, RPC `https://mezo.drpc.org`/`https://mezo-mainnet.boar.network`; testnet `https://rpc.test.mezo.org`). External metrics come from DefiLlama API pulls on 2026-10-23. Anything marked **[inference]** is my judgement, not a verified fact.*

## 0. Bottom line
1. **Mezo's live MUSD economy is not what the docs suggest.** Total MUSD supply is ≈29.48M (`cast call 0xdD46…F186 "totalSupply()"`). Of that, ≈14.17M is the PCV bootstrap loan parked in the Stability Pool (SP). Another ≈14.52M is institutional *Enclave* debt minted by `EnclaveDebtManager` (0x2c5e…389a) against pledged veBTC at 1%. The retail trove book is **one trove**: 14,489 MUSD of debt on 16.59 BTC (`getTroveOwnersCount()=1`, `SortedTroves.getSize()=1`). Deposits in the SP from anyone other than the PCV total ≈20 MUSD.
2. **The peg is soft and redemption capacity is exhausted.** There have been 1,155 `Redemption` events burning 5.86M MUSD since May 2025, 1.95M of it in Sep–Oct 2026. Mezo's main mUSDC/MUSD CL pool (0xCC37…7aC1a, tick spacing 10) holds 5.33M MUSD against only 8,455 mUSDC, at a price of 0.9896. DefiLlama prices MUSD at $0.9887. With a single trove left, the redemption floor has almost nothing to redeem against.
3. **Mezo's capital is veBTC.** 804.5 BTC is locked, and about 93% of it sits in two Enclave-pledged NFTs: #6033 (250.15 BTC, permanent lock) and #6114 (500.07 BTC). veMEZO is worth only about $0.8M: 280.7M MEZO locked at ≈$0.0029.
4. **The composable rails exist but are empty.**
   - Morpho Blue is live on Mezo (0x5658…A311) with permissionless `createMarket`, but it holds one $82k mUSDC/BTC market. Only AdaptiveCurveIrm and an 86% LLTV are enabled.
   - **sMUSD is not ERC-4626.** It holds principal 1:1 and pays yield through a claimable MUSD index (`claimYield`, `yieldIndex`). 72% of it is staked in the gauge, earning 0.72% APY, against 4.23% when unstaked.
5. **The best-fitting patterns are on the MUSD demand side and in SP/PCV automation** [inference]: composable savings, MUSD money markets, and peg/exit liquidity. Borrower tooling fits poorly because there is one live trove and at least 10 competing entries.

## 1. Mezo facts that decide whether a pattern transfers
| Fact | Value | Source |
|---|---|---|
| MUSD params | MCR 110%, CCR 150%, minNetDebt 1,800, gas comp 200, issuance 0.1%, redemption 0.75%, refinance 20% of issuance, new-loan rate 1% (100 bps) | `cast call BorrowerOperations 0x44b1…e031 MCR()/CCR()/minNetDebt()/...`; `InterestRateManager.interestRate()=100` |
| Redemption order | Lowest ICR ≥110% first (Liquity v1 style). Fixed simple interest; Recovery Mode blocks `closeTrove`/`refinance` | musd `BorrowerOperations.sol`, docs liquidation-mechanics.md |
| Signed ops | `BorrowerOperationsSignatures`: EIP-712, **ECDSA only (no ERC-1271)**, sequential per-borrower nonce. `closeTroveWithSignature` burns the *relayer's* MUSD and sends BTC to a signed recipient | musd `BorrowerOperationsSignatures.sol`, `_closeTrove` |
| SP | `provideToSP`/`withdrawFromSP` are public. Gains are paid in native BTC, with no interest share. 28 liquidations ever | explorer getLogs `TroveLiquidated` |
| PCV rebalancing | Manual, governance-run: withdraw BTC → swap on DEX → `pcv.depositToStabilityPool` (callable by anyone) | musd docs/rebalancing.md |
| sMUSD | MUSDSavingsRate (MIT, 0.8.33). `receiveProtocolYield` is permissionless. Strategy = IdleStrategy (7.38M MUSD); VaultGauge holds 5.31M sMUSD | verified source impl 0xB33C…9e87 |
| veBTC | Max lock 28d, weekly epochs. Permanent locks exist (283.4 BTC). Average boost ≈2.75× (1,756.7 vs 639.1 voting power) | `cast call 0x3D4b…f279 supply()/permanentLockBalance()/totalVotingPower()` |
| Managed veNFTs (Relay-style) | Code present, but `allowedManager()=0x0` on both veBTC and veMEZO, so the feature is disabled. Aurove's managed deposits fail for this reason | `cast`; Aurove docs |
| Voter | `createPoolGauge` is permissionless if both tokens are whitelisted. `createVaultGauge`/`createNoFeesGauge` are governor-only. `vote` needs `isApprovedOrOwner` | verified Voter source 0xA620…1465 |
| veBTC transfer | Allowed even while voted. `withdraw`/`unlockPermanent`/`merge`/`split` revert if voted. `split` is gated by `canSplit` | verified VeBTC source |
| Oracles | Skip BTC/USD at 0x7b7c…0015 is Chainlink-compatible (18 decimals) and used by the MUSD PriceFeed. Pyth MUSD/USD on Mezo was last updated 2026-07-17 (stale) | `latestRoundData()`, `getPriceUnsafe(0x0617…c6de)` |
| DEX depth | BTC/MUSD CL200: 0.39 BTC + 15.7k MUSD. Basic BTC/MUSD: 0.47 BTC + 39.3k MUSD. MEZO/MUSD CL200: 1.27M MEZO + 1.4k MUSD | `balanceOf`/`getReserves` |
| Testnet | 304 troves; SP holds 86.2M MUSD. Morpho 0xCe1d…5a73 has AdaptiveCurveIrm and a 77% LLTV. sMUSD testnet has pcv=0 and no gauge, so yield must be simulated with `receiveProtocolYield` | `cast` on rpc.test.mezo.org |

## 2. Liquity v1/v2 ecosystem
**2.1 Automation (DeFi Saver, Summer.fi): stop-loss, take-profit, auto-repay, boost.**
- *Problem solved:* managing a CDP 24/7.
- *Metrics:* DeFi Saver has $384M TVL. Summer.fi Pro has $16.4M, and its newer "Lazy Summer" vaults ≈$1.3k (DefiLlama).
- *Features:* DeFi Saver's Liquity V2 automations are leverage management, stop loss, take profit, boost/repay on price, and SP liquidation protection. All require a Smart Wallet ([help.defisaver.com](https://help.defisaver.com/protocols/liquity-v2/compatibility-and-automations)). Summer.fi offers Auto-Buy/Sell and (trailing) stop-loss.
- *Transfer to Mezo:* it works mechanically. Troves can be owned by contract wallets because the borrower is `msg.sender`, and Safe is available on Mezo. Signed ops allow "pre-signed exits".
- *Constraints:*
  - `maxBorrowingCapacity` is fixed at issuance, so a boost needs a refinance (RFC-1).
  - The mainnet market is one trove.
  - The space is contested: Lifeline, Pylon, Ballast, Tripwire, Payung, Lockwatch, AgentVault, MezoShield, TrovePilot, plus prior winner Cermin.
- *Code:* defisaver-v3-contracts is **MIT** (StrategyExecutor, SubStorage, `SafeModuleAuth` for Safe modules). OasisDEX automation-smartcontracts is **AGPL-3.0**.

**2.2 SP wrappers (B.Protocol B.AMM; yBOLD/sBOLD).**
- *Problem solved:* SP depositors accrue collateral and must sell it by hand. B.AMM keeps the pool liquid by selling liquidation collateral back for the stablecoin through an oracle-anchored AMM ([Liquity blog](https://www.liquity.org/blog/how-to-earn-stability-pool-rewards-using-b-protocol-v2)).
- *Metrics:*
  - B.Protocol: $0.83M TVL today.
  - yBOLD: $7.6M at 5.24% (Yearn).
  - BOLD SPs: wstETH $9.5M, ETH $8.1M, rETH $4.5M.
  - ysyBOLD is accepted as collateral on Inverse FiRM ($1.35M).
  - sBOLD is K3's ERC-4626 SP vault, audited by ChainSecurity.
  - Liquity v2 routes **75% of interest to SP depositors** ([docs](https://docs.liquity.org/v2-faq/bold-and-earn)).
- *Transfer to Mezo:* very direct. `mezo-org/thUSD` already contains `packages/contracts/contracts/B.Protocol/BAMM.sol` (**MIT**, ^0.8.17), wired to thUSD's SP. That SP interface matches MUSD's (`provideToSP`, `withdrawFromSP`, `getDepositorCollateralGain`; `getCompoundedTHUSDDeposit` becomes `getCompoundedMUSDDeposit`). It takes a Chainlink `AggregatorV3Interface`, which the Skip oracle satisfies as a drop-in. It also automates exactly the manual PCV procedure in rebalancing.md.
- *Weaknesses:*
  - The MUSD SP receives no interest share (fees split 50/50 between bootstrap repayment and sMUSD).
  - Liquidation flow is close to zero today, so yield is too [inference].
  - Testnet uses the real Skip price, so deterministic liquidation demos need Foundry fork tests (Lifeline does this).
- *Code:* B.Protocol `backstop-protocol/dev` is a GPL-3.0 repo. BAMM.sol and PriceFormula.sol are MIT; `crop.sol` is AGPL-3.0-or-later.

**2.3 Chicken Bonds.**
- *Problem solved:* bootstrapping protocol-owned liquidity and amplified SP yield.
- *Metrics:* ≈70M LUSD bonded by end of 2022. It peaked in early January 2023 and declined through Q1 2023 ([Liquity Q4'22](https://liquity.org/blog/liquity-q4-report-2022), [Q1'23](https://www.liquity.org/blog/liquity-q1-report)). DefiLlama shows $1.50M today, and DeFi Saver lists it as "no longer available".
- *Transfer to Mezo:* it could fund depth for MUSD/mUSDC protocol-owned liquidity, but the novelty-driven demand faded once alternative yields appeared [inference].
- *Code:* `liquity/ChickenBond` is **GPL-3.0**.

**2.4 Liquity v2 friendly forks and redemption protection.**
- *Design:* in v2, users set their own rate and redemptions hit the lowest-rate troves first. Batch managers and ARM delegates manage rates within user bounds ([ARM](https://www.liquity.org/blog/autonomous-rate-manager-arm-for-liquity-v2)).
- *Metrics (DefiLlama):* Liquity V2 $95.2M; BOLD supply $38.1M at $0.9958. Felix CDP $24.1M (plus Felix Vaults $32.8M). USDaf $0.38M, Quill $0.10M, Nerite $0.06M, Beraborrow $0.08M, Orki ≈$0.
- *Lesson:* forks without native distribution stalled. Felix worked as the native stable of HyperEVM.
- *Transfer to Mezo:* MUSD orders redemptions by ICR, so protection reduces to holding a higher CR, which is what existing entrants already ship. A Mezo-native analogue of Liquity v2's interest→SP routing would need governance [inference].
- *Code:* the v2 core is **BUSL-1.1** until 2027-09-01, then GPL-2.0-or-later, available through the [Friendly Fork Program](https://docs.liquity.org/v2-documentation/friendly-fork-program). The Zappers are **MIT**. Liquity v1 contracts carry **MIT** SPDX headers.

**2.5 Leverage/looping zaps.**
- *Code:* Liquity v2 `LeverageLSTZapper`/`LeverageWETHZapper` (MIT) use flash loans plus Curve/UniV3 exchange modules.
- *Transfer to Mezo:* weak.
  - Flash liquidity is tiny: Morpho on Mezo holds 1.154 BTC and 15.5k mUSDC.
  - DEX depth is a few BTC at most.
  - Leveraged troves sit at the front of the redemption queue while MUSD is below 0.9925.
  - Pylon already ships flash loop, unwind and exit; MezoRoute ships borrow→swap→LP.

**2.6 LUSD/BOLD integrations.**
- *LUSD:* Curve LUSD-3CRV ($12.9M); Aave v3 listing (proposed Jan 2023 with LTV 0%; caps raised through 2023, supply cap 12M→18M in Sep 2023) ([Aave gov](https://governance.aave.com/t/arc-add-lusd-to-ethereum-v3-market/11522)).
- *BOLD:* Curve BOLD-USDC $8.9M, Uniswap v4 $4.65M, plus yBOLD, sBOLD and FiRM.
- *MUSD analogues:*
  - Curve MetaNG pool 0xB557…955f holds 527k MUSD against 126k base LP (imbalanced).
  - Uniswap v4 USDC/MUSD: $2.49M. Aerodrome USDC/MUSD CL10: $1.16M at 0.96%.
  - **Morpho MUSD markets on Ethereum ≈$0**, and the "Alpha MUSD Core" vault holds ≈$17 (Morpho API).
- *Lesson:* integrations bought with incentives decay without native yield [inference].

## 3. ve(3,3) ecosystems
**3.1 Liquid lockers and managed veNFTs (Velodrome/Aerodrome Relay, Shadow x33, Convex).**
- *Problem solved:* illiquid locks and weekly voting toil.
- *Precedents:* Relay is a Votium-style auto-voter/compounder on managed veNFTs ([Blockworks](https://blockworks.com/analytics/aerodrome/aerodrome-aero-token/aerodrome-managed-venft-subsystem)). x33 auto-compounds xSHADOW, with a price floor at 50% because of the exit penalty.
- *Transfer to Mezo:*
  - veBTC's 28-day maximum lock shrinks the liquidity premium.
  - veMEZO is worth ≈$0.8M.
  - Native managed locks are disabled.
  - Prior winners BynD (a pooled veMEZO token) and Fractals (fractional veNFTs), and Aurove (avBTCm/avMEZOm), already cover it.
  - Verdict: poor fit.
- *Code:* velodrome-finance/relay and contracts are **BUSL-1.1**, changing to GPL-2.0-or-later on **2027-01-01** (ENS text record `date` on `v2-license-date.velodrome.eth`).

**3.2 veNFT marketplaces and lending.**
- *Precedent:* 40 Acres ($3.62M, on Base/OP/Avalanche) lends USDC against veAERO/veVELO, with repayment from weekly voting rewards ([40acres](https://40acresfinance.substack.com/p/exploring-40-acres-finance-the-defi)).
- *Already on Mezo:*
  - Vezo, a veNFT marketplace.
  - The `EnclaveDebtManager`, which is the institutional version of this pattern: 4 positions opened 2026-04-28→09-30, 1% rate, warning CR 150% / minimum CR 110%, `MAX_PLEDGED_VEBTC=20`.
  - **Thaw** (pooled, self-repaying MUSD credit against veBTC/veMEZO, with a tMUSD ERC-4626 vault) and **Latch** (P2P term loans) already target retail.
- *Assessment:* the fit is very high, but entering now would require clear differentiation [inference].

**3.3 Vote-incentive markets.**
- *Precedents:*
  - Votium hit a record ≈$21M per round in April 2022.
  - Hidden Hand was winding down by 2025-12-31 (Stake DAO proposal).
  - Stake DAO Votemarket v2 launched Nov 2024.
  - Paladin Warden/Quest are **MIT** but archived. DefiLlama shows Hidden Hand at $65k and Paladin Vote at $46k.
- *Already on Mezo:* `BoostVoter.addBribes` (Matchbox), incentives posted on MEZO Gauges, and PoolsVoter bribes. Budgets are small.

**3.4 Vote optimizers and auto-compounders.**
- *Precedents:* Beefy $107M, Yearn $155M, Convex $579M, Stake DAO $148M.
- *Already on Mezo:* Range (an ERC-4626 CL vault), plus MezoYield and Boost Relay as optimizers.
- *Problem:* compounding MEZO emissions loses value because the MEZO/MUSD pool holds 1.27M MEZO against 1.4k MUSD.

## 4. Stablecoin growth playbooks
| Savings / yield token | TVL | APY | Note |
|---|---|---|---|
| sUSDS (Sky) | $4.89B (+$364M Arbitrum) | 3.8% | sDAI successor; collateral on Spark and Morpho |
| sUSDe | $1.18B | 5.11% | 7-day unstake; Pendle PT markets |
| sGHO (Aave) | $233.6M | 4.5% | Aave Savings Rate |
| stUSDS | $179M | 5.64% | |
| sfrxUSD | $41.5M | 5.04% | |
| scrvUSD | $14.7M | 3.33% | Idle vault funded by a fee share of crvUSD interest ([docs](https://docs.curve.finance/user/yield/scrvusd)) |
| yBOLD | $7.6M | 5.24% | SP-yield wrapper |
| **sMUSD unstaked / staked** | **$2.07M / $5.29M** | **4.23% / 0.72%** | Not ERC-4626 |

(DefiLlama yields API, 2026-10-23.)

- **GHO is the closest analogue to MUSD's current state.** It traded ≈0.965 in 2023 and recovered through borrow-rate hikes (1.5%→6.35%), cap cuts, the GSM and sGHO. It was at $0.9997 by Aug 2026 ([Aave gov](https://governance.aave.com/t/gho-stewards-august-2026-gho-borrow-rate-and-aave-savings-rate-update/25534)).
- **Curated lending:** Morpho Blue $11.2B, Steakhouse $2.59B, Gauntlet $1.64B, Euler v2 $283.5M, Pendle V2 $1.06B (PT-sUSDS and PT-sUSDe expiring 26-Nov-2026).
- **Transfer to MUSD** [inference]:
  - MUSD has a savings rate but no composable savings token.
  - There is no MUSD market on Mezo's Morpho, no PSM, and the rate is fixed at 1% (Enclaves also pay 1%).
  - The "sDAI moment" for MUSD is still open.
  - A minting PSM or peg keeper needs a governance `addToMintList`. Market-based peg tools do not.

## 5. BTCfi: what reached product-market fit
- **Market size (DefiLlama):** Babylon $3.32B; Lombard LBTC $604M; SolvBTC $500M; Lorenzo enzoBTC $490M; Stacks sBTC $201.6M.
- **Chain TVLs:** Rootstock $76.7M, **Mezo $72.2M**, Stacks $66.3M, BOB $10.1M, CORE $4.0M, Botanix $0.
- **What worked:**
  - Yield without bridging: Babylon.
  - A liquid wrapper with deep Ethereum DeFi integrations: Lombard.
  - Institutional deals: Mezo's Enclaves drove its chain TVL from ≈$1M (Oct 2025) to ≈$77.5M (Sep 2026).
- **What failed:** standalone BTC L2s relying on points.
  - Botanix wound down in June 2026, citing weak demand ([Cointelegraph](https://cointelegraph.com/features/does-botanixs-failure-prove-bitcoiners-dont-care-about-defi)).
  - Corn's shutdown is reported (CryptoRank, low confidence).
  - Solv faced a proof-of-reserve controversy and a reported March-2026 double-mint (bex.co, medium-low confidence).
  - Stacks propped up sBTC with BTC reward programs; the original rewards ended 2025-11-04.
- **Implication** [inference]: institution-grade, low-risk yield on MUSD and BTC beats incentive farms.

## 6. License matrix (reuse must be open source and cited)
| Codebase | License | OK? |
|---|---|---|
| Mezo musd | GPL-3.0 | ✅ |
| MUSDSavingsRate (verified) | MIT | ✅ |
| mezo-org/thUSD BAMM.sol | MIT (repo GPL-3.0) | ✅ |
| Liquity v1 | MIT (SPDX), repo GPL-3.0 | ✅ |
| Liquity v2 Zappers | MIT | ✅ |
| Liquity v2 core | BUSL-1.1 → GPL-2.0+ on 2027-09-01 | ❌ |
| Chicken Bonds | GPL-3.0 | ✅ |
| B.Protocol | GPL-3.0 repo; BAMM MIT; crop.sol AGPL-3.0+ | ✅ |
| DeFi Saver v3 | MIT | ✅ |
| Summer.fi automation | AGPL-3.0 | ✅ |
| Morpho Blue / Vault V2 / MetaMorpho / oracles | GPL-2.0-or-later | ✅ |
| AdaptiveCurveIrm | MIT | ✅ |
| Euler EVC, Euler Earn | GPL-2.0+ | ✅ |
| Euler EVK | GPL-2.0+, **except `src/EVault/modules` BUSL until 2029-04-24** | ⚠️ |
| Aave v3-core (2022) | BUSL → MIT since 2023-01-27 | ✅ |
| Aave v3.7 (aave-v3-origin) | BUSL plus anti-competition grant until 2027-03-06 | ❌ |
| Velodrome v2 / Aerodrome / Slipstream / Relay | BUSL until 2027-01-01 | ❌ |
| Mezo tigris | GPL-3.0 repo, but `VotingEscrow`/`Voter`/`ManagedNFT` carry BUSL-1.1 SPDX | ⚠️ |
| Uniswap v3-core | BUSL → GPL-2.0+ since 2023-04-01 | ✅ |
| Uniswap v3-periphery | GPL-2.0+ | ✅ |
| Uniswap v4-periphery | MIT | ✅ |
| Uniswap v4-core | BUSL | ❌ |
| Yearn v3 / TokenizedStrategy | AGPL-3.0 | ✅ |
| OpenZeppelin / Solady ERC4626 | MIT | ✅ |
| solmate | AGPL-3.0-only | ✅ |
| Pendle v2 core | BUSL expired 2023-07-01; files GPL-3.0+ | ✅ |
| Curve crvUSD and scrvUSD RewardsHandler | All rights reserved | ❌ |
| Paladin Warden/Quest, Convex | MIT | ✅ |

## 7. Overlap with other Buildathon entrants (GitHub, 2026-10-23)
| Area | Projects already building it |
|---|---|
| Trove protection and automation | Lifeline (16 fork tests), Pylon, Ballast, Tripwire, Payung, Lockwatch, AgentVault, MezoShield, TrovePilot |
| veBTC credit | Thaw, Latch |
| SP vault | Morbit (basic) |
| Morpho on Mezo | Cosign (first-loss tranches on MEZO-collateral MUSD markets) |
| Money market | Mezodot (omnichain) |
| Vote optimization | MezoYield, Boost Relay |
| Liquid / fractional ve (prior Mezo Hackathon 2 winners) | BynD, Fractals |
| Automated borrowing (prior Mezo Hackathon 2 winner) | Cermin |
| Microloans | Mezo's own `Microloans.sol` in unmerged musd branches (Aug 2025) |

**Nothing found yet for:** an ERC-4626 sMUSD wrapper with Morpho collateral and looping, or a B.AMM port.

## 8. Ranking
The opportunities list is ranked by fit × openness × buildability. The ranking is driven by:
- MUSD demand and composability gaps (sMUSD is not 4626; Morpho-Mezo has no MUSD markets).
- The documented manual PCV rebalancing.
- Very thin retail trove activity, which caps the value of borrower-side tooling.
- Crowding.

# Research report: research:mezo-earn-ve

# Mezo Earn and MEZO: research for Buildathon idea selection

**Snapshot.** Mezo mainnet (chainId 31612), block about 12.72M, 2026-10-23 around 23:00 UTC. On-chain reads used `cast` against `https://mezo-mainnet.boar.network`, plus the Blockscout API at `https://api.explorer.mezo.org` (verified sources). Prices come from the DefiLlama coins API: MEZO **$0.0029**, BTC **$80,548**. "Docs" means `github.com/mezo-org/documentation`, paths under `src/content/docs/docs/`.

**Confidence labels:**
- **[V]** verified on-chain or in verified source.
- **[D]** docs or whitepaper only.
- **[I]** my inference.

---

## 0. What should shape the idea

1. **The docs list dead contracts.** The live Earn system is "v2", an Aerodrome ve(3,3) fork whose source is in a private repo, `mezo-org/tigris-token-launch` (named in both audits). Its sources are verified on Blockscout. The "Mainnet/Testnet Governance Contracts" table in `developers/features/mezo-pools.md` (last edited Oct 14, 2026) still lists v1 contracts:
   - old VeBTC `0x7D80…5914` holds 0.00096 BTC;
   - old VeBTCVoter `0x3A4a…2C1b` has 0 pools.
   [V]
2. **veBTC holds 804.53 BTC.** That is about $65M and about 72% of all BTC on Mezo (BTC totalSupply on Mezo is 1,117.1). About 750 BTC of it sits in two institutional Enclave positions. [V]
3. **MEZO has crashed.** It trades around $0.0029, down about 98% from its $0.1415 all-time high. Weekly emissions of 4.72M MEZO are worth only about $13.7k. The real cash flow in Earn is MUSD, not MEZO. [V/I]
4. **The sMUSD gauge is the dominant yield.** It pays exactly 10,000 MUSD/week to veBTC voters. That works out to about 44 MUSD/week per boosted vote unit, versus at most about $1.4 per unit on any pool gauge. [V]
5. **Boost is nearly free.** Reaching 5x on 1 BTC of veBTC needs about 154.5k veMEZO voting power, roughly $450 of max-locked MEZO. [I from V data]
6. **Incentive markets are thin.**
   - Boost-gauge bribes: 2–8 deposits per roughly 3 weeks, mostly MEZO worth hundreds of dollars.
   - Pool-gauge bribes: dormant since mid-September.
   - MEZO-Gauge bribes: zero, ever.
   [V]
7. **Composability hooks are open.**
   - Contracts can hold and vote veNFTs (there is no allowlist).
   - A GSN-style forwarder is trusted by all four voters.
   - Pool-gauge and boost-gauge creation are permissionless.
   [V]

---

## 1. MEZO token

**Supply and allocation** [D] (`users/mezo/token-distribution.md`, `public/docs/MEZO_Disclosure.pdf`):
- Genesis supply: 1,000,000,000 MEZO.
- Community 40%, Investors & Partners 30%, Team 20%, Foundation 10%.
- At TGE, 500M was unlocked, of which 250M was designated circulating.
- Team and investors: 12-month cliff, then 24 months of monthly linear vesting.
  - About 66.66M (team) plus 100M (investors) unlock on **Apr 1, 2027**.
- The initial airdrop was about 31.4M.
- Market-maker loans total 17.5M (Sense Capital, Hallingdal Labs, TopHash).

**Emissions** [D] (`users/mezo/emissions.md`, `public/docs/mezo-weekly-emissions-schedule.csv`):
- TGE was Apr 1, 2026; week 0 started Apr 2, 2026.
- Week 0 emitted 4,807,692 MEZO, which is 25% annualized.
- The schedule is piecewise-linear and the rate halves every 104 weeks (25%→12.5%→6.25%→2%), with a 2% tail after year 8.
- The CSV covers 260 weeks and ends at a supply of 1,855,643,904.

**On-chain match** [V]:
- `cast call 0x7B7c…0001 "totalSupply()(uint256)"` returns 1,138,540,989.7, exactly the CSV week-29 figure.
- MEZO's minter is MEZOMinter `0x66Bf…ffc3`.
- Its last `EpochProcessed` (Oct 22, epochIndex 28) emitted 4,717,276 MEZO: rebase 1,967,768 (41.7%) and rewards 2,749,508.

**Utility** [V/D]:
1. Lock as veMEZO.
2. Boost veBTC.
3. Vote on veBTC boost gauges and on MEZO Gauges.
4. Earn rebases.
5. Serve as a bribe token.
6. Provide liquidity (CL MEZO/MUSD and BTC/MEZO on Mezo; MEZO/MUSD on Aerodrome).

MEZO is not gas; BTC is gas on Mezo. The MEZO contract on Mezo ("MEZOCaller" precompile wrapper) supports EIP-2612 `permit`. MEZO is bridged with Wormhole NTT to Ethereum, Base, BSC and Solana at `0x8e4c…848b` (`users/resources/contracts-reference.md`). The disclosure says there is no burn mechanism.

---

## 2. veBTC and veMEZO mechanics

Source for this section: VeBTC impl `0x41d0…3ae3`, files `contracts/ve/Escrow.sol`, `NFT.sol`, `ManagedNFT.sol`.

**Basics** [V]:
- Both are ERC-721 tokens with an identical ABI.
- Weight = amount × remaining/max.
- Lock end is rounded down to the week: `unlockTime = ((now+dur)/WEEK)*WEEK`.

**Lock limits:**
- veBTC: max 28 days [D+V]; my sampled lock #6159 ends in 26 days.
- veMEZO: max 4 years (1,456 days), min 1 week [D].

**Operations** [V]:

| Operation | Rule |
|---|---|
| `lockPermanent` / `unlockPermanent` | Available for both tokens. Unlock restarts a full max-lock countdown and requires no active votes. |
| Permanent balances | veBTC 283.4 BTC; veMEZO 34.7M MEZO. |
| `merge(from,to)` | Both NORMAL; `from` not voted and not permanent. |
| `split` | Team-gated: `canSplit[0]=false`. The whitepaper's "splittable" is not generally live. |
| Transfer | Allowed for NORMAL and MANAGED. LOCKED NFTs (deposited in a managed NFT) cannot move. Voted NFTs can transfer. `ownershipChange` gives flash-NFT protection. |
| `withdraw` | Requires lock expired, `!voted` (call `reset` first), and not permanent. |

**Delegation.**
- `delegate` / `delegateBySig` are Aerodrome governance-vote delegation, not gauge-vote delegation.
- Gauge voting can be delegated through ERC-721 `approve` / `setApprovalForAll`. Voters check only `isApprovedOrOwner`, so any contract or operator can vote. The catch: approval also grants transfer rights.

**Managed NFTs (Aerodrome "relays").**
- Created via `createManagedLockFor`, which only the voter's `governor` (multisig `0x98D8…7C7a`) or `allowedManager` (currently 0) can call.
- Two exist per ve-contract [V, CreateManaged logs]:
  - Boar Finance: veBTC #1226 and veMEZO #37 (Jan 27, 2026).
  - Aurove: veBTC #6107 and veMEZO #2805 (Sep 3, 2026).
- Users join with `depositManaged(tokenId, mTokenId)`.

**Grants.** Productive vesting via `createGrantLockFor`. Grant NFTs cannot merge or split while revocable [D/V].

**Contracts holding veNFTs** [V]: Enclave proxies, BoarBTCRelay, the Aurove Vault (`0x708E…38c9`, holding 11 veBTC and 20 veMEZO), and Safe multisigs.

**Live state** [V]:

| | veBTC `0x3D4b…F279` | veMEZO `0xb90f…E122` |
|---|---|---|
| Locked | 804.53 BTC | 280.69M MEZO |
| Total voting power | 1,756.6 boosted (639.0 unboosted) | 98.73M |
| NFTs minted / holders | 6,161 / 1,796 | 2,904 / 1,376 |

**Enclave concentration** [V]:
- **#6033**: 250.15 BTC, permanent, 5x boost, voting power 1,250.8 (71% of all veBTC voting power). It is owned by Enclave proxy `0x1473…f786`.
- **#6114**: 500.07 BTC, 1x, no boost gauge, unlocks 2026-11-12. It is owned by Enclave `0x4da9…fb99`.
- Enclaves are allowlisted institutional deposit contracts (`users/mainnet/enclaves.md`). Their votes go mainly to the CL BTC/MUSD-200 and mUSDC/MUSD-10 pools.
- Non-permanent veBTC averages only about 1.06x boost: (1,756.6−1,381.0)/(639.0−283.4).

---

## 3. What each side earns

**veBTC** [V/D] (whitepaper §5; `users/mezo-earn/vote/*`):

1. **Passive chain and bridging fees in BTC.**
   - ChainFeeSplitter v2 `0x0268…a7aa` (needle 100) sends to RewardsDistributor `0xb584…74A2`; claim with `claim(tokenId)`.
   - This is tiny: 0.003–0.016 BTC/week across all veBTC (`tokensPerWeek`, Aug–Oct 2026).
2. **PoolsVoter.**
   - 100% of the fees from staked LPs in the pools you vote for.
   - On CL pools this includes the staked share plus a default 10% "unstaked fee". In code, `CLGauge._claimFees` sends this to `FeesVotingReward`, i.e. to voters. The docs wrongly say "to staked positions".
   - Plus bribes, and the sMUSD vault gauge's MUSD.
3. **ValidatorsVoter bribes.** This is an independent vote, so a holder can put 100% here and 100% on pools.
4. **EpochGovernor votes** on splitter nudges.

veBTC gets **no** MEZO emissions or rebases.

**Last epoch, voter fees by gauge** (`tokenRewardsPerEpoch`, epoch starting Oct 15) [V]:
- sMUSD: **10,000 MUSD**. This amount has been identical every epoch since May (`gaugeYieldClaimCap`=1e22).
- CL BTC/MUSD-200: about $540.
- vAMM BTC/MUSD: about $140.
- mUSDC/MUSD-10: about $95.
- CL mUSDC/BTC: about $84.
- MEZO/MUSD: about $47.
- BTC/MEZO: about $45.

The sMUSD gauge holds only 15.3% of vote weight (225.8 of 1,479.3). That is because the Enclaves direct about 650 units to liquidity pools. Rough per-BTC returns [I]:
- 1 BTC voting sMUSD at 1x: about 44 MUSD/week, roughly 2.9% APR.
- 1 BTC at 5x: about 217 MUSD/week, roughly 14% APR.
- This yield dilutes as more weight moves to sMUSD. If everyone voted sMUSD it would fall to 10,000/1,757 per unit.

**veMEZO** [V]:
- Rebase from RewardsDistributor `0x0751…6363`: about 1.97M MEZO/week, roughly 0.70% per week in MEZO terms.
- BoostVoter bribes.
- MEZO-Gauge bribes: none so far.
- No fees.

---

## 4. Boost formula and matching market

**Formula** (BoostVoter impl `0xA696…7624`, `_getBoost`) [V]:

`boost = min(5e18, 1e18 + 4 × (veBTC.unboostedTotalVotingPower / veBTC.unboostedVotingPowerOfNFT(id)) × (BoostVoter.weights[gauge(id)] / veMEZO.totalVotingPower))`

The veMEZO denominator is **all** veMEZO voting power (98.73M). It is not just the votes cast on boost gauges (59.82M). The boost is cached in `locked.boost` and changes only when someone calls `pokeBoost` / `pokeBoosts`, which are permissionless.

**Flow:**
1. A veBTC owner or approved address calls `createBoostGauge(gaugeFactory=0x4150…CCAd, tokenId, tokens[], amounts[])`. Gauges are created lazily: 719 exist versus 6,161 veBTC minted. The docs' "automatic gauge" claim is wrong.
2. Anyone can post incentives with `addBribes(gauge, tokens[], amounts[])`. Tokens must be whitelisted. The docs say "any ERC-20", which is wrong. Whitelisted on mainnet: BTC, MEZO, MUSD, mUSDC, mUSDT, mcbBTC, SATS, avBTCm, avMEZOm.
3. veMEZO holders call `vote(veMEZOId, gauges[], weights[])`, up to 30 gauges per NFT.
4. Bribes are claimed with `claimBribes` after the epoch.

There is no on-chain price for boost; the price emerges as bribe per veMEZO-weight. The contract is BUSL-1.1.

**Market data** [V]:
- 59.82M of the 98.73M veMEZO voting power votes on boost gauges, and 40.85M of that backs Enclave #6033.
- Boost-bribe deposits by block range, roughly 21 days per 500k blocks:

| Block range | Approx. dates | Deposits | Main amounts |
|---|---|---|---|
| 7.9M–8.5M | Apr 2026 | 39 | 55.5k MEZO |
| 10.5M–11.5M | Jul–Aug | 31 | 555.6k MEZO |
| 12.0M–12.5M | early Oct | 8 | 250.5k MEZO |
| last ~3 weeks | to Oct 23 | 2 | 160k MEZO (about $464) |

---

## 5. Gauges, voters, permissions, epochs

| Voter (proxy) | Votes with | Gauges | Creation | Funding |
|---|---|---|---|---|
| PoolsVoter `0x4823…1f03` | veBTC | 28 (incl. vault gauges sMUSD, mlvBTC-mUSDC) | `createPoolGauge(poolFactory,pool)` is **permissionless** if the factory is approved and both tokens are whitelisted (governor can bypass). `createVaultGauge` and `createNoFeesGauge` are governor-only. | 82% of the ecosystem branch |
| BoostVoter `0x2ba6…3d1` | veMEZO | 719 boost gauges | NFT owner or approved | no emissions (rewardToken=0) |
| ValidatorsVoter `0xe99a…515a` | veBTC | 24 (21 with weight) | `createValidatorGauge` by the operator or governor; the beneficiary can be any contract | chain-splitter 20% |
| ThirdPartyVoter `0x2e6D…A6EB` ("MEZO Gauges") | veMEZO | 7 (4 live) | `createThirdPartyGauge` is **governor-only** | 18% of the ecosystem branch |

**Live MEZO Gauges** (from `ThirdPartyGaugeCreated` metadata):

| Gauge | veMEZO votes |
|---|---|
| Uniswap v4 USDC/MUSD | 16.0M |
| Aerodrome USDC/MUSD CL10 | 11.45M |
| Aerodrome MEZO/MUSD CL200 | 6.87M |
| Curve MUSD | 0.82M |

- Killed MEZO Gauges were "Mezo Technical" and two "snf-community" gauges.
- The Aerodrome path: RemoteGaugeRegistry `0x8236…59539` sends MEZO through NTT to Wormhole chain 30 (Base) via relayer `0xf817…1bBb`.
- The Merkl-routed gauges pay to EOAs, which is an operator trust point.

**Epoch rules** [V/D]:
- Epochs start Thursday 00:00 UTC.
- Voting is open from epochStart+1h to next−1h; whitelisted NFTs are exempt from the end cutoff.
- One `vote` per NFT per epoch, and votes persist across epochs.
- `poke` is permissionless.
- Votes in epoch N set emissions for N+1; fees are paid for N.
- Claiming:
  - `claimFees`, `claimBribes`, `claimFeesAndBribes(rewards[],tokens[][],tokenId)` on PoolsVoter;
  - `claimBribes` on the non-staking voters;
  - `claim` / `claimMany` on the distributors.
- `GaugeFactory 0x4150…CCAd` creates both staking and non-staking gauges; `CLGaugeFactory 0xfc41…eb13`; FactoryRegistry `0x04B9…4F32`.

**Emission routing** [V]:
1. MEZOMinter `updatePeriod`.
2. Rebase = minted×((S−VP)/S)²/2, where VP is veMEZO **unboosted voting power**, not locked amount.
3. MEZOChainSplitter `0x5C6e…C5DA`, needle 80 (80% ecosystem, 20% validators).
4. MEZOEcosystemSplitter `0xe9e6…99FA`, needle **82**. It was nudged down from 90 over 8 epochs (Aug 13–Oct 15, 2026).

Needles move ±1 per epoch via EpochGovernor (`0x7F8c…4365` and `0xD60F…8ECF`). Their voting token is veBTC, `proposalThreshold`=0, voting period 1 week. The docs' "fixed 90/10" is stale.

Epoch-28 split: validators 549.9k, staking gauges 1.80M, MEZO Gauges 396k MEZO.

---

## 6. Mezo Pools (DEX)

**Basic pools** (Velodrome V2) [V]:
- PoolFactory `0x83FE…4248`: `createPool(a,b,stable)` is permissionless; 33 pools.
- Fees: volatile 30 bps, stable 2 bps, max 300 bps.
- Router `0x16A7…C706`; a second router `0xac93…0cd4` has the same ABI.
- Swap signature is `swapExactTokensForTokens(amountIn, minOut, Route[]{from,to,stable,factory}, to, deadline)`. The docs' `address[]` path sample is wrong, and `addLiquidity` needs a `bool stable`.
- `Router.voter` is unset, so `zapIn(stake=true)` is unusable.
- Flash swaps are available through `Pool.swap(...,bytes)`.

**CL pools** (Velodrome Slipstream, not a drop-in Uniswap V3) [V]:
- CLFactory `0xBB24…Eb79`: `createPool(a,b,tickSpacing,sqrtPriceX96)`; 15 pools.
- Tick spacings 1/10/50/100/200/2000; default unstaked fee 10%.
- NonfungiblePositionManager `0x509B…874c`: `mint` takes a `tickSpacing` argument.
- CLSwapRouter `0x37cD…6225`: `exactInputSingle` keys by `tickSpacing`.
- QuoterV2 `0x4e56…c7dc`; `CLPool.flash()` exists.
- Read lenses: LpSugar `0x4e70…e1ae`.

**Pool TVL** [V balances, I USD]:

| Pool | Holdings | Approx. TVL |
|---|---|---|
| mUSDC/MUSD CL-10 | 5,333,831 MUSD + 8,455 mUSDC | about $5.3M |
| BTC/MUSD basic | 0.475 BTC + 39.3k MUSD | about $77k |
| BTC/MUSD CL-200 | 0.394 BTC + 15.7k MUSD | about $47k |
| MUSD/mUSDT stable | — | about $13k |
| MUSD/mUSDC stable | — | about $12k |
| MEZO/MUSD CL-200 | 1.24M MEZO + 1.48k MUSD | about $5k |
| BTC/MEZO CL-2000 | — | about $1.3k |

- In the mUSDC/MUSD CL-10 pool, MUSD trades at **0.9896** mUSDC.
- DefiLlama totals: Tigris Mezo V3 $5.35M; V2 $113k; Mezo Earn $65.4M; Mezo Vaults $7.4M.
- sMUSD (`0xb4D4…51CC`) holds 7.38M; 5.31M of it is staked in VaultGauge `0x6778…a401`.

---

## 7. Testnet (chainId 31611)

**The full v2 stack exists** [V, `cast code`, found via `CLFactory.voter()`]:

| Contract | Address |
|---|---|
| PoolsVoter | `0x263F…5F0D` |
| VeBTC | `0x38E3…130a` |
| BoostVoter | `0x21d7…Bfd1` |
| VeMEZO | `0xaCE8…111b` |
| ThirdPartyVoter | `0x62FE…251D` |
| ValidatorsVoter | `0xac1b…3844` |
| MEZOMinter | `0xe195…1B74` (emissions on, epoch 47) |
| Chain splitter | `0xCa88…22A` |
| Ecosystem splitter | `0x47Fb…51F` (needle 90) |
| GaugeFactory | `0x2c01…8aD5` |
| Forwarder | `0x5fA3…8E24` |

The testnet DEX addresses in the docs (CL and basic) are live.

**Practical blockers for a demo:**
- Test MEZO is concentrated: 955M sits in `0x0504…8bb2`, and the testnet BTC/MEZO pools hold only about 25 MEZO.
- BTC is not whitelisted on testnet PoolsVoter.
- ThirdPartyVoter has no whitelisted tokens on testnet.
- The faucet dispenses only BTC; MUSD must be minted.

---

## 8. Audits and risks

**Halborn** (Dec 16, 2025–Jan 8, 2026): 1 High, 4 Medium, 4 Low, 7 Informational.
- 7.4: bribes are permanently lost if a gauge is killed with no voters. This was fixed in documentation only.
- 7.5: killed-gauge rewards are re-split by the splitter. Risk accepted.
- 7.8: `pokeBoosts` has an unbounded loop. Risk accepted.

**Thesis Defense** (Nov 28–Dec 31, 2025; 9 issues):
- #4: a single veMEZO can transiently back several boosts.
- #3/#5: boost staleness.
- Mezo kept poke-based eventual consistency as a design choice, run by an **off-chain poke maintainer**, and plans a zero-cost chain-integrated poke.
- Any integration must call `pokeBoost` / `poke` defensively.

**Other risks:**
- Enclave dominance: the Enclaves can swing gauge weights at will.
- The governance multisig `0x98D8…7C7a` holds governor and emergency-council roles, owns the factories, and controls whitelists, managed NFTs and gauge kills.

---

## 9. Existing ecosystem (avoid duplicating)

| Project | What it does | Status / size |
|---|---|---|
| Native BoostVoter | The matching market itself | live |
| Matchbox | Front end with off-chain profiles over native boost gauges; build manifest also shows pools, validator-gauges, mezo-gauges and incentives pages; manual flows | live |
| Aurove | Liquid locker (avBTCm, avMEZOm, ERC-1155 tranches); managed veBTC #6107; Vault; CL gauges for MUSD/avBTCm and avMEZOm/avBTCm | **on mainnet**, despite the "testnet" label in docs; small |
| Boar Finance | BoarBTCRelay holds managed veBTC #1226 (2.24 BTC, 5x) with vote/claim/compound and a `compoundFee`; also a MEZO vault paying BTC | about $182k TVL |
| Vezo | veNFT marketplace with listings, bids and offers | mainnet and testnet |
| Range | CL rebalancing vault | listed in docs |
| veBoost Calculator | Boost estimator | listed in docs |
| Mezo dApp | "Pair & Boost" stepper | live |
| Mezo | Merkl and Aerodrome campaigns for MUSD liquidity | live |
| Others on Mezo | Morpho Blue and VaultV2 (deployed by the Mezo deployer), Mellow, Upshift | live |

**No veNFT lending or veBTC-collateral product was found.** The docs explicitly say veBTC cannot be used as MUSD collateral (`users/mezo-earn/lock/vebtc/faqs-and-resources.md`). The whitepaper §2.2 lists it as a future possibility.

---

## 10. Opportunities (detail in the structured list)

1. **veBTC-collateralized, self-repaying MUSD credit.**
   - Votes are pointed at the sMUSD gauge, and the MUSD earned services the debt.
   - The 28-day max lock bounds liquidation latency.
   - Optionally, apply for a governor-created ecosystem gauge to fund lenders with MEZO.
2. **Non-custodial cross-voter Earn autopilot.**
   - Optimal pool and validator votes, a self-boost zap, auto-extend or permanent lock, claim and compound.
   - Gasless signed votes through MezoForwarder; a Telegram front end is optional.
   - Partly overlaps Boar's relay.
3. **Boost underwriting / auctions** for the long tail and for Enclave #6114. The market is thin.
4. **Cross-chain MEZO-Gauge bribe router** plus a validator auto-rebate beneficiary contract. Both are small in USD.

Avoid duplicates: liquid lockers, veNFT marketplaces, boost UIs, and CL rebalancers.

