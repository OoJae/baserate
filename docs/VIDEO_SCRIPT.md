# Two-minute demo video: script

About 290 words, read at roughly 150 words per minute. Each beat is followed by what is on screen. The borrow stays open from 0:18 to 1:26, so the story runs borrow → save → lend → liquidate → fees → exit → proof.

| Time | Voiceover | On screen |
|---|---|---|
| 0:00 | Retail MUSD borrowing on Mezo has collapsed. Mainnet troves fell from one hundred and four to one: MUSD trades below its redemption floor, so every new trove is first in line to be redeemed. And Mezo's own Morpho holds no MUSD at all. | Title card, then four numbers: 104 → 1 · $0.989 · 1.28M redeemed · 0 MUSD |
| 0:18 | Baserate is a credit layer on Mezo's own rails. From a fresh wallet, I borrow against nine ten-thousandths of a bitcoin. Live Skip price, Pyth sanity band, redemption risk: none. One transaction wraps my BTC, posts it to Morpho, and sends me MUSD. | Borrow page: amount typed, oracle and redemption panels, position card after confirmation |
| 0:35 | Idle MUSD goes into wsMUSD, the first ERC-4626 wrapper over sMUSD, so any protocol can build on Mezo's savings rate. | Save page: deposit with a permit, shares appear |
| 0:44 | Lenders deposit into vMUSD, a Morpho Vault V2 from Mezo's own factory. An allocator lends into the market when borrowers need it and parks the rest in wsMUSD, so lenders never earn less than sMUSD. | Lend page: where the MUSD sits, deposit |
| 0:58 | If a loan goes bad, anyone can liquidate it with zero capital: the FlashLiquidator sells the seized BTC on Tigris or to our backstop pool. A live canary sits just under the line, and our keeper checks it every thirty seconds. | Liquidate page: canary row and preview; Evidence → Keeper card |
| 1:14 | Fees go back to Mezo: forty percent to sMUSD holders, forty percent as MUSD bribes for veBTC voters on the BTC/MUSD gauge. The first distribution is already on-chain. | Fees page: the split and the first distribution |
| 1:26 | To exit, one transaction repays and returns my bitcoin. It never reads the oracle, so it works even if prices freeze. | Repay & withdraw; position closed |
| 1:34 | Don't trust the UI. The Evidence page re-checks every transaction live, all fourteen contracts we deployed are verified on Sourcify, and five hundred sixty tests include forks of Mezo mainnet and testnet. | Evidence page scroll: "Verified live" badges, contracts table |
| 1:47 | Next: credit lines for AI agents, a way back for redeemed borrowers, and mainnet with tight caps. | Roadmap card |
| 1:54 | Baserate. Mezo's rails, Mezo's market. | End card with links |

## Recording tips

- One take of the whole script is easiest to edit; separate takes per row are fine too. A phone voice memo in a quiet room works.
- Leave a one-second pause between rows: the edit cuts on those pauses, so the picture follows your pace rather than the timings above.
- Any format ffmpeg reads (m4a, wav, mp3). Send the file path and the edit is built around it.
