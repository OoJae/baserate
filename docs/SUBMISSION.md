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

PROBLEM. Retail MUSD credit has collapsed: mainnet troves fell from 104 to 1 as MUSD traded at ~$0.989, below the ~$0.9925 redemption floor, so every low-ratio trove gets redeemed (1.28M MUSD in 30 days). A trove also needs 2,000 MUSD (~0.027 BTC). Mezo's own Morpho Blue holds no MUSD, and sMUSD is not ERC-4626, so nothing can build on it.

WHAT WE BUILT (all live and testable with one faucet drip):
- BTC→MUSD market M1 on Mezo's official testnet Morpho Blue (MUSD loan, bcBTC collateral, AdaptiveCurveIrm, LLTV 0.77). No redemption queue, no minimum.
- BorrowAccount clones + factory: openAndBorrow takes BTC as msg.value and returns MUSD in one tx; repayAndWithdraw repays exact debt and returns native BTC in one tx without reading the oracle.
- bcBTC: a gated 1:1 BTC receipt only our accounts can mint, so per-position caps, LTV ceilings and a global cap bind the whole market.
- BtcMusdOracle: Skip BTC/USD precompile (rejected if >60 s old), Pyth ±10% band, MUSD leg clamped to [1.00, 1.02].
- wsMUSD: ERC-4626 over Mezo's claim-based sMUSD; harvests and re-deposits yield, vests it over 3 days (same-block sandwiches earn ~0), in-kind exit.
- MusdDispenser so judges can top up interest and finish the round trip.
- Web app (Borrow, Save, Evidence) and @baserate/sdk.

MEZO INTEGRATION. Morpho Blue + AdaptiveCurveIrm, Skip precompile, Pyth BTC and MUSD feeds, native BTC, MUSD permit, sMUSD internals (claimYield, yieldIndex, receiveProtocolYield), BorrowerOperationsSignatures for the come-back flow.

PROOF. 349 Foundry tests (unit, fuzz, invariant, forks of Mezo mainnet and testnet against live contracts). All 6 contracts verified on Sourcify (exact match). Live txs: market 0x4810d36183cda01097e07258b1b692477ae07ff1449a7abdac134fab03172da5, borrow 0x4b25c6e57ebec23866fdba5f020bd2d1cb40a745f2c07cb83892ccbafaefa5f6, exit 0x98996d663b29140990502713f1bfb582ae3ceac7fe444dfa0d5ea458ec5adae1. The Evidence page re-verifies each tx live.

SECURITY. No new lending engine (Morpho does accounting), immutable core, no ERC-2771/tx.origin, exits never pause, 48 h timelock on raises. Threat model: docs/SECURITY.md.

NEXT (Wave 2): vMUSD lending vault (Vault V2), FlashLiquidator + Backstop, FeeRouter bribes to veBTC voters, credit lines with an x402 agent, keeper, subgraph, mainnet with caps ≤2,000 MUSD.

## How it works (long form, if the form asks separately)
Baserate adds a credit lane next to MUSD troves. A user posts BTC; their own BorrowAccount clone wraps it into bcBTC, supplies it to the M1 market on Mezo's Morpho Blue and borrows MUSD straight to their wallet. Because loans live in Morpho, nobody can redeem them at par while MUSD sits below the floor, and there is no 2,000-MUSD minimum. Lenders' MUSD earns the market rate (in Wave 2 through vMUSD, whose idle cash sits in wsMUSD so it never earns less than sMUSD). Protocol fees will flow to sMUSD and, as MUSD bribes, to veBTC voters on the BTC/MUSD pool gauges that liquidations depend on. When the peg heals, demand can return to 1% troves; Baserate complements them.

## Target group
BTC holders on Mezo who want dollars without selling BTC and without redemption risk, especially the borrowers redeemed out of troves this year (27 accounts still hold 5.70 BTC of unclaimed surplus); small borrowers priced out by the 2,000-MUSD minimum; MUSD holders who want a composable savings token; and apps and agents that need MUSD credit. Desktop and mobile web, EVM wallets.

## Tech stack
Solidity 0.8.28, Foundry, OpenZeppelin v5, Morpho Blue + AdaptiveCurveIrm, Pyth, Mezo Skip precompile; React 19, Vite, wagmi 2, viem 2, RainbowKit, TanStack Router and Query, Tailwind 4; Vercel; Sourcify.

## Future milestones
1. Wave 2 (by Nov 15, 2026): vMUSD lending vault, FlashLiquidator and Backstop, FeeRouter with MUSD gauge bribes, credit lines with an x402 agent, keeper and subgraph; mainnet proof deployment with caps ≤2,000 MUSD.
2. Dec 2026: third-party audit; ask Mezo for a vMUSD vault gauge and the Morpho fee switch on M1 paid to sMUSD.
3. Q1 2027: grow caps with measured liquidation depth; Base phase (MUSD-collateral USDC credit on Base Morpho).

## Team
OoJae: founder, full-stack and smart-contract engineering. [X / LinkedIn handle]
