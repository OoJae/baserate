# Built vs planned

Judges told us to separate what works today from what is coming. Everything under **Built** runs on Mezo testnet and can be tested with faucet funds; every contract is source-verified on Sourcify and every recorded transaction is re-checked live on the [Evidence page](https://baserate-mezo.vercel.app/evidence). Everything under **Planned** is designed, specified in `docs/design/`, and scheduled, but not yet shipped.

## Built

### Core (Wave 1)

| Component | What it does | Where |
|---|---|---|
| `BtcMusdOracle` | Morpho oracle for BTC priced in MUSD. Uses Skip BTC/USD (rejected if older than 60 s), a Pyth BTC ±10% sanity band, and an MUSD leg clamped to [1.00, 1.02]. `status()` never reverts | `contracts/src/oracle/` |
| `WsMUSD` | ERC-4626 wrapper over Mezo's claim-based sMUSD. Harvests and re-deposits yield, vests it over 3 days, resists donation and sandwich attacks, has an in-kind exit | `contracts/src/savings/` |
| `CollateralBTC` (bcBTC) | Gated 1:1 receipt for native BTC. Only registered borrow accounts can post it to Morpho, so our limits apply to the whole market | `contracts/src/collateral/` |
| `BorrowAccount` + factory | Per-user accounts that borrow MUSD against BTC in one transaction, plus a repay-and-withdraw exit that works even with the oracle down. LTV ceilings, per-position and global caps, a pause that never blocks exits, and timelocked governance | `contracts/src/account/` |
| M1 market | BTC→MUSD market on Mezo's official Morpho Blue testnet deployment | testnet |
| `MusdDispenser` | Testnet faucet for judge top-ups (25 MUSD per address per day) | `contracts/src/periphery/` |

### Lending, liquidations, fees and risk (Wave 2, live on testnet)

| Component | What it does | Where |
|---|---|---|
| `vMUSD` (Morpho Vault V2) | A MUSD lending vault created through Mezo's own VaultV2Factory. Deposits go to wsMUSD first and are lent to M1 when borrowers need them or M1 pays more. Curator actions sit behind 48-hour timelocks | `contracts/script/DeployVault.s.sol`, `contracts/lib/vault-v2` |
| `WsMusdLiquidityAdapter` | vMUSD's liquidity adapter: parks idle MUSD in wsMUSD, and a full wsMUSD can never block a deposit | `contracts/src/vault/` |
| `BaserateAllocator` | vMUSD's only allocator, with no owner: keeps a 2,000 MUSD / 15% borrow buffer in M1 and moves the excess between wsMUSD and M1 by APY, at most 1,000 MUSD per move and once an hour. Anyone can trigger it; it also gives vMUSD holders a withdraw path out of M1 with no penalty | `contracts/src/vault/` |
| `FlashLiquidator` | Zero-capital liquidations: sells the seized BTC inside Morpho's callback through the backstop, CL200 or the vAMM, within a 6.89% price-impact bound. Testnet offers the backstop and the vAMM | `contracts/src/liquidation/` |
| `Backstop` (bMUSD) | MUSD that buys seized BTC at the oracle price less half the liquidation incentive, then sells it through a Dutch auction. Exits take 7 days | `contracts/src/liquidation/` |
| `FeeRouter` | Splits fees three ways: sMUSD yield, MUSD bribes on the BTC/MUSD pool gauge for veBTC voters, and the treasury. The first distribution is on-chain; the factory's switch of its fee recipient to the router is queued behind the 48-hour timelock | `contracts/src/fees/` |
| `RiskLens` | One call for oracle health, market state, caps, backstop solvency, liquidation depth and the trove redemption queue | `contracts/src/lens/` |
| Live canary | The keeper's CANARY-profile position just under the 77% LLTV, so liquidations run on real state. On the first deployment the keeper opened it, it was liquidated unattended and re-armed four minutes later; on the audited v2 stack the timelocked canary grant matures on 28 Oct and the keeper takes it from there | testnet |

### App and SDK

| Component | What it does | Where |
|---|---|---|
| Web app | Borrow, Save, Lend, Liquidate (with the backstop), Risk, Fees and Evidence pages; get-test-funds card | `apps/web/` |
| e2e harness | Playwright drives the deployed UI with a real signing wallet: the judge journey, a vMUSD deposit and withdrawal, and live checks of Liquidate, Risk and Fees, each confirmed from the RPC (and `cast`) | `apps/web/e2e/` |
| SDK | Typed chains and registry, ABIs generated from the contracts, Morpho math, MUSD permit signing, plain-language revert decoding, vault/liquidation/fee/RiskLens helpers | `packages/sdk/` |
| Keeper | Runs on Railway with separate keys per role and a Postgres action log. Ten jobs: a liquidation scan of every M1 account every 12 s (one multicall per 200 accounts, gas sized for Mezo's precompiles), the allocator and wsMUSD upkeep, a testnet yield simulator, backstop inventory sales and sync, a once-per-epoch fee flush, canary upkeep, depth-linked caps (a dry run on testnet), an sMUSD upgrade watcher and health checks. Alerts go to Telegram. Status at [/status](https://keeper-production-be8a.up.railway.app/status), JSON at `/v1/status` and `/v1/evidence` | `apps/keeper/` |
| Subgraph | A Goldsky indexer on Mezo testnet for history: accounts, M1 positions and liquidations, vault flows, allocator moves, backstop exits and fee distributions. The app reads history from it and falls back to log reads. [Endpoint](https://api.goldsky.com/api/public/project_clts5z9ypl0nf01uv385l1oui/subgraphs/baserate-mezo-testnet/prod/gn) | `packages/subgraph/` |
| Audit ledger | Three AI audit rounds, every contract finding proven by a Foundry PoC; rounds 1 and 2 fixed and live in the v2 stack, round 3 found no Medium or worse | `docs/audit/FINDINGS.md` |

## Planned

| Component | What it adds |
|---|---|
| `CreditLineModule` | Capped, revocable MUSD credit lines for apps and AI agents, with an x402 agent demo |
| Come-back flow | Lets borrowers whose troves were redeemed reclaim stranded BTC straight into a redemption-free position |
| Round-3 fixes | The round-3 Lows in the contracts: the backstop's parking pause follows wsMUSD's health, per-block top-up budgets, liquidity lows that age out, a seed minted in the constructor. The keeper's Pyth pusher for the oracle pair is built but off, because Pyth's Hermes now needs a paid plan |
| SDK release | `@baserate/sdk` published to npm |
| Mainnet proof mode | The same contracts on Mezo mainnet with caps of at most 2,000 MUSD, plus recorded evidence transactions |
