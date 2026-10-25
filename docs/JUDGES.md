# Judge guide: test everything in about 10 minutes

You need an EVM wallet (MetaMask, Rabby, etc.) and one faucet drip. Everything runs on **Mezo testnet (chain 31611)**; test tokens have no value. Steps 1 to 5 are the core (about 5 minutes); steps 6 to 9 cover the lending vault, liquidations, risk and fees.

## 1. Get test BTC (1 minute)

1. Open [faucet.test.mezo.org](https://faucet.test.mezo.org), keep **BTC** selected, paste your address and request tokens (0.001 BTC per day).
2. Open [baserate-mezo.vercel.app](https://baserate-mezo.vercel.app) and connect. The app offers to add Mezo testnet to your wallet if needed.

## 2. Borrow MUSD against BTC in one transaction (1 minute)

1. On **Borrow**, enter `0.0009` BTC. Leave the target loan-to-value at 30%.
2. Check the preview: MUSD you receive, the 0.10% origination fee, health factor, liquidation price and borrow rate.
3. Check the right-hand panels:
   - **Oracle:** the live Skip BTC/USD price and its age, the Pyth sanity band, and the MUSD leg clamped to $1.00.
   - **Redemption risk: none:** the same loan as an MUSD trove would sit in the redemption queue while MUSD trades below the floor.
4. Click **Borrow**. Your BTC is sent as the transaction value; one transaction wraps it, posts it to Morpho and sends you MUSD.

## 3. Save in wsMUSD (1 minute)

1. On **Save**, deposit a few MUSD. You sign a permit, then one transaction deposits into Mezo's real sMUSD through the ERC-4626 wrapper.
2. Redeem, or try **redeem in kind** to receive sMUSD directly.

## 4. Repay and get your BTC back (1 minute)

1. Interest means you owe slightly more than you borrowed. Use **Claim test MUSD** in the Get test funds card (up to 25 MUSD per day) if you need a top-up.
2. On **Borrow**, click **Repay & withdraw**. One transaction repays the exact debt and returns native BTC to your wallet. This path never reads the oracle, so it works even if prices freeze.

## 5. Check the chain, not the UI (1 minute)

Open **[Evidence](https://baserate-mezo.vercel.app/evidence)**. Every recorded transaction, grouped by area (core, the recorded judge journey, Lend, Liquidations, Fees, Risk), is re-verified live against Mezo's Blockscout explorer, and every contract shows its source-verification status (Sourcify for ours). The **Keeper** card shows the off-chain keeper's jobs, the positions it watches and its recent transactions, live.

## 6. Lend MUSD in vMUSD (2 minutes)

1. On **Lend**, look at where the vault's MUSD is: lent in M1, parked in wsMUSD, or idle; the M1 supply APY next to wsMUSD's; and the 2,000 MUSD borrow buffer the allocator keeps in M1.
2. Deposit a few MUSD: approve, then deposit (Morpho Vault V2 has no permit deposit). You get vMUSD 1:1 and the liquidity adapter moves your MUSD into wsMUSD in the same transaction.
3. Withdraw with **Max**. While the vault's idle MUSD and wsMUSD cover it, it comes straight from vMUSD; a larger withdrawal goes through the allocator, which pulls the rest out of M1 with no penalty.
4. **Rebalance** is permissionless. It is disabled during the one-hour cooldown after a move, with a countdown, and shows what the next move would be.

## 7. Liquidate, or watch the canary (1 minute)

1. On **Liquidate**, positions are sorted riskiest first. The team's **Canary** sits just under the 77% liquidation LTV; each row shows the BTC price at which it becomes liquidatable.
2. The preview comes from `FlashLiquidator.previewLiquidation`, simulated live: seizable BTC, repayment, bad debt, and what the backstop and the vAMM would pay. CL200 is disabled on testnet (no pool).
3. If BTC dips below the canary's threshold, **Liquidate** turns on: one transaction, no MUSD needed, profit at least 90% of the preview. Our keeper ([public status](https://keeper-production-be8a.up.railway.app/status)) scans every 30 seconds, so you may have to be quick.
4. The **Backstop** card shows bMUSD's NAV, free cash, BTC inventory and auction; deposits are open and exits take 7 days.

## 8. Read the risk dashboard (30 seconds)

**Risk** is one `RiskLens.snapshot()` call: oracle health, MUSD peg, market, caps, backstop solvency, how much seized BTC the vAMM absorbs at each size, and the first troves in the MUSD redemption queue. Grey sources are the ones testnet does not have (CL200 pool, MUSD/USD pool).

## 9. Follow the fees (30 seconds)

**Fees** shows the FeeRouter's next split (40% sMUSD yield, 40% bribe on the BTC/MUSD gauge for veBTC voters, 20% treasury), the first distribution (an 8 MUSD bribe and 8 MUSD to sMUSD), and the pending switch of the factory's fee recipient to the router with its 48-hour timelock countdown. **Distribute** is permissionless and enabled whenever the router holds MUSD.

## What is built and what is next

See [BUILT_VS_PLANNED.md](BUILT_VS_PLANNED.md). The sidebar's "Coming in the next release" items (credit lines and the come-back flow) are designed and scheduled, and are not presented as working features. The keeper is live on Railway; the subgraph and mainnet proof mode are planned.
