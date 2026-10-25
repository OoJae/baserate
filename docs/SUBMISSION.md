# AKINDO submission: Wave 1

Copy each field into the AKINDO form. Character counts are approximate.

## Product name
Baserate

## Product category (max 3)
BTC Lending · Stablecoin Credit · Yield

## TL;DR
Borrow MUSD against BTC in one transaction on Mezo's own Morpho Blue, with no redemption queue and no 2,000-MUSD minimum, and save idle MUSD in wsMUSD, the first ERC-4626 wrapper over sMUSD.

## Links
- Live app (Mezo testnet): https://baserate-mezo.vercel.app
- On-chain evidence: https://baserate-mezo.vercel.app/evidence
- GitHub: https://github.com/OoJae/baserate
- Deck: [paste the shared deck link]
- 2-minute video: [paste the video link]

## Updates in this Wave (≤3,000 characters)

Track 1 (DeFi). Chain: Mezo testnet (31611). Status: entirely new, built during the buildathon. Readiness: testnet deployment.

PROBLEM. Retail MUSD credit has collapsed: mainnet troves fell 104→1 as MUSD traded at ~$0.989, below the ~$0.9925 redemption floor, so low-ratio troves get redeemed (1.28M MUSD in 30 days). A trove needs 2,000 MUSD. Mezo's Morpho Blue holds no MUSD, and sMUSD is not ERC-4626.

LIVE ON TESTNET (14 contracts, all source-verified on Sourcify):
- Borrow: BTC→MUSD market M1 on Mezo's official Morpho Blue. openAndBorrow takes BTC as msg.value and returns MUSD in one tx; repayAndWithdraw returns native BTC in one tx without reading the oracle. No redemption queue, no minimum.
- bcBTC gated receipt so caps and LTV ceilings bind the whole market; BtcMusdOracle (Skip ≤60 s, Pyth ±10% band, MUSD leg clamped to $1.00–1.02).
- Save: wsMUSD, ERC-4626 over Mezo's sMUSD (harvest + 3-day vesting, sandwich-resistant, in-kind exit).
- Lend: vMUSD, a Morpho Vault V2 from Mezo's VaultV2Factory; idle MUSD earns sMUSD, an allocator lends into M1 only when it pays more.
- Liquidate: zero-capital FlashLiquidator (Tigris vAMM/CL200) + Backstop pool; a live canary is armed.
- Fees: FeeRouter sends 40% to sMUSD and 40% as MUSD bribes to veBTC voters on the BTC/MUSD gauge (live: 8 MUSD bribe + 8 MUSD sMUSD, tx 0x76fe18e5…8b130a). RiskLens: oracle, depth, caps and trove queue in one call.
- Web app (Borrow, Lend, Save, Liquidate, Risk, Fees, Evidence), SDK, judge dispenser.
- Keeper on Railway: hourly allocator upkeep, 30 s liquidation scan, fee distribution; public status at keeper-production-be8a.up.railway.app/status.

PROOF. 560 Foundry tests (unit, fuzz, invariant, forks of Mezo mainnet and testnet against live contracts). Live journey verified with a real wallet: borrow 0x4b25c6e5…efa5f6, exit 0x98996d66…5adae1, vault deposit 0xd89c582e…568ddb, allocator move 0x46cb7897…28aa4d. The Evidence page re-verifies each tx live.

SECURITY. Morpho does the accounting; immutable core; no ERC-2771/tx.origin; exits never pause; 48 h timelock on raises (fee switch to FeeRouter queued). docs/SECURITY.md.

NEXT (Wave 2): credit lines with an x402 agent, come-back flow for redeemed borrowers, subgraph, mainnet with caps ≤2,000 MUSD.

## How it works (long form, if the form asks separately)
Baserate adds a credit lane next to MUSD troves. A user posts BTC; their own BorrowAccount clone wraps it into bcBTC, supplies it to the M1 market on Mezo's Morpho Blue and borrows MUSD straight to their wallet. Because loans live in Morpho, nobody can redeem them at par while MUSD sits below the floor, and there is no 2,000-MUSD minimum. Lenders deposit MUSD into vMUSD, a Morpho Vault V2: an allocator lends into M1 when it pays more and keeps the rest in wsMUSD, so lenders never earn less than sMUSD. Unhealthy loans are liquidated with no capital up front through the FlashLiquidator, which sells seized BTC on Tigris or to the Backstop pool. Protocol fees flow to sMUSD and, as MUSD bribes, to veBTC voters on the BTC/MUSD pool gauge that liquidations depend on. A keeper runs all of this upkeep, and anyone can call it. When the peg heals, demand can return to 1% troves; Baserate complements them.

## Target group
BTC holders on Mezo who want dollars without selling BTC and without redemption risk, especially the borrowers redeemed out of troves this year (27 accounts still hold 5.70 BTC of unclaimed surplus); small borrowers priced out by the 2,000-MUSD minimum; MUSD holders who want a composable savings token; and apps and agents that need MUSD credit. Desktop and mobile web, EVM wallets.

## Tech stack
Solidity 0.8.28, Foundry, OpenZeppelin v5, Morpho Blue + AdaptiveCurveIrm, Morpho Vault V2, Pyth, Mezo Skip precompile, Tigris pools and gauges; React 19, Vite, wagmi 2, viem 2, RainbowKit, TanStack Router and Query, Tailwind 4, Playwright; Node keeper on Railway; Vercel; Sourcify.

## Future milestones
1. Wave 2 (by Nov 15, 2026): credit lines with an x402 agent, come-back flow for redeemed borrowers, subgraph, SDK on npm; mainnet proof deployment with caps ≤2,000 MUSD.
2. Dec 2026: third-party audit; ask Mezo for a vMUSD vault gauge and the Morpho fee switch on M1 paid to sMUSD.
3. Q1 2027: grow caps with measured liquidation depth; Base phase (MUSD-collateral USDC credit on Base Morpho).

## Team
OoJae: founder, full-stack and smart-contract engineering. [X / LinkedIn handle]
