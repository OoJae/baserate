# Judge guide: test everything in about 5 minutes

You need an EVM wallet (MetaMask, Rabby, etc.) and one faucet drip. Everything runs on **Mezo testnet (chain 31611)**; test tokens have no value.

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

Open **[Evidence](https://baserate-mezo.vercel.app/evidence)**. Every recorded transaction is re-verified live against Mezo's Blockscout explorer, and every contract shows its source-verification status (Sourcify exact match for ours).

## What is built and what is next

See [BUILT_VS_PLANNED.md](BUILT_VS_PLANNED.md). The sidebar's "Coming in the next release" items (lending vault, liquidations, credit lines, come-back flow, RiskLens) are designed and scheduled, and are not presented as working features.
