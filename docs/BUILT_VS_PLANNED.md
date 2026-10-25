# Built vs planned

Judges told us to separate what works today from what is coming. Everything under **Built** runs on Mezo testnet and can be tested with faucet funds. Everything under **Planned** is designed, specified in `docs/design/`, and scheduled, but not yet shipped.

## Built (Wave 1)

| Component | What it does | Where |
|---|---|---|
| `BtcMusdOracle` | Morpho oracle for BTC priced in MUSD. Uses Skip BTC/USD (rejected if older than 60 s), a Pyth BTC ±10% sanity band, and an MUSD leg clamped to [1.00, 1.02]. `status()` never reverts | `contracts/src/oracle/` |
| `WsMUSD` | ERC-4626 wrapper over Mezo's claim-based sMUSD. Harvests and re-deposits yield, vests it over 3 days, resists donation and sandwich attacks, has an in-kind exit | `contracts/src/savings/` |
| `CollateralBTC` (bcBTC) | Gated 1:1 receipt for native BTC. Only registered borrow accounts can post it to Morpho, so our limits apply to the whole market | `contracts/src/collateral/` |
| `BorrowAccount` + factory | Per-user accounts that borrow MUSD against BTC in one transaction, plus a repay-and-withdraw exit that works even with the oracle down. LTV ceilings, per-position and global caps, a pause that never blocks exits, and timelocked governance | `contracts/src/account/` |
| M1 market | BTC→MUSD market on Mezo's official Morpho Blue testnet deployment | testnet |
| `MusdDispenser` | Testnet faucet for judge top-ups (25 MUSD per address per day) | `contracts/src/periphery/` |
| Web app | Borrow, Save and Evidence pages; get-test-funds card | `apps/web/` |
| SDK | Typed chains, ABIs, Morpho math, MUSD permit signing | `packages/sdk/` |

## Planned (Wave 2)

| Component | What it adds |
|---|---|
| `vMUSD` (Morpho Vault V2) | A MUSD lending vault: idle cash sits in wsMUSD and is lent to M1 only when that pays more |
| `BaserateAllocator` | Permissionless rebalancing between M1 and wsMUSD, keeping a standing buffer |
| `FlashLiquidator` | Zero-capital liquidations, selling through the best of the backstop, CL200 or the vAMM within a price-impact bound |
| `Backstop` (bMUSD) | MUSD that buys seized BTC when DEX depth can't absorb it |
| `FeeRouter` | Fees split three ways: sMUSD yield donations, MUSD bribes on the BTC/MUSD pool gauges, and the treasury |
| `RiskLens` | Dashboard of oracle health, liquidation depth, caps and the trove redemption queue |
| `CreditLineModule` | Capped, revocable MUSD credit lines for apps and AI agents, with an x402 agent demo |
| Come-back flow | Lets borrowers whose troves were redeemed reclaim stranded BTC straight into a redemption-free position |
| Keeper, subgraph, SDK release | Automation on Railway, a Goldsky indexer, and `@baserate/sdk` on npm |
| Mainnet proof mode | The same contracts on Mezo mainnet with caps of at most 2,000 MUSD, plus recorded evidence transactions |
