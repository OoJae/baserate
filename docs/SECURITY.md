# Security

Baserate moves real BTC and MUSD. This page lists what can go wrong, what we built to stop it, and what we have not solved.

**Status:** pre-audit. Contracts are verified on testnet. Mainnet runs in proof mode, with hard caps of at most 2,000 MUSD of borrowing.

## Design principles

- **No new lending engine.**
  - Interest, liquidation and share accounting run on Mezo's own deployment of Morpho Blue, which has been audited.
  - Our contracts route into it and add limits; they do not reimplement it.
- **Immutable core.** None of the oracle, wsMUSD, the collateral receipt (`bcBTC`), the BorrowAccount implementation and its factory sits behind a proxy.
- **Exits never pause.**
  - Pausing stops new borrowing and credit draws; collateral-only deposits and all exits stay open.
  - The sentinel can never block repay, adding collateral, the full repay-and-withdraw exit, unwrap or liquidation. Top-ups are never limited by the position cap, which only stops new borrowing on a position above it.
  - Partial withdrawals stay open as long as the position remains within its LTV ceiling. With debt outstanding every withdrawal raises LTV, so a ceiling cut also limits how much can be withdrawn without repaying.
- **Decreases are instant; increases wait 48 hours.** Cap raises, ceiling raises, fee-recipient changes, module approvals and canary-operator grants all sit behind a public timelock. Cutting a parameter cancels every raise of it queued before the cut, and a queued raise lapses 14 days after it becomes executable. wsMUSD cap raises wait 72 hours.
- **No meta-transactions.** No ERC-2771, no `_msgSender()`, no `tx.origin`. The October 2026 veBTC exploit came from a forwarder bug.

## Threat model

| Threat | Mitigation |
|---|---|
| **Stale or manipulated BTC price** (the root cause of Velar's exploit) | Skip BTC/USD rejected if older than 60 s. Pyth BTC acts as a ±10% sanity band while it is at most 3,900 s old. Prices are never taken from DEX pools |
| **Oracle outage freezes the market** | Morpho does not consult the oracle once a position has no debt, so `repayAndWithdraw` works with the oracle down. Worst-case divergence freeze is about 65 minutes. A Skip outage is unbounded, and is disclosed. Backstop exits need no oracle while it holds at most dust BTC (under 0.00001 BTC), and an exit's owner can always claim with the BTC valued at 0 |
| **MUSD depeg makes debt look smaller** | The MUSD leg is clamped to [1.00, 1.02]. Collateral is never valued above its USD price in MUSD terms. At today's ~$0.989 this undervalues collateral by about 1.1%, which is conservative |
| **Positions bigger than liquidation depth** | All collateral must enter through `bcBTC`, which only registered accounts can mint, so per-position and global caps bind the whole market, not just our UI. A position above its cap cannot borrow; extra collateral behind existing debt does not enlarge a liquidation, which Morpho sizes by the debt. Caps start at 0.01 BTC per position (testnet) and 2,000 MUSD global (mainnet) |
| **Inflation, donation and sandwich attacks on wsMUSD** | Internal accounting: nothing that lands in a block, whether a donation or sMUSD protocol yield, moves the price in that block. Unclaimed sMUSD yield counts nothing until a sync harvests it; harvested yield and every surplus then vest over 3 days, so a failing or short sMUSD claim never lowers the price or breaks a preview. Same-block sandwiches earn nothing. 1 MUSD of dead shares at deploy |
| **Manipulating vMUSD's allocator** (flash supply, a borrower's transient repay or borrow) | The direction of a rate-driven move comes from 7-day trailing realized APYs (M1's supply-share price against wsMUSD's share price), which no transaction can move. No rate-driven move runs on M1 state changed earlier in the same block. Withdrawals from M1 are sized on the lowest outside M1 liquidity of the last day, so liquidity that appeared in M1 within the last day is never what vMUSD pulls against. Buffer top-ups never wait for the cooldown. At most 1,000 MUSD per move, inside the curator's caps |
| **Premium sniping, donation griefing and stuck exits in the liquidation layer** | Backstop deposits are priced at book plus unvested gains, so a late depositor pays for gains it did not fund and shares the next loss pro rata. A matured exit is paid from whatever cash there is and the rest stays queued. The FlashLiquidator forwards only the BTC its own liquidation produced, and never reverts because a caller cannot take BTC |
| **sMUSD proxy upgrade or strategy change** | `redeemInKind` makes no calls into sMUSD's deposit, withdraw or claim functions. vMUSD's M1-backed share still exits without penalty through `BaserateAllocator.withdraw`, which retries M1-first when the wsMUSD leg reverts, and a 72-hour timelocked adapter rescue hands vMUSD's wsMUSD position in kind to the vault owner only if wsMUSD can no longer pay it out. The FeeRouter never needs sMUSD to succeed: its reads are guarded low-level calls, a failed donation is kept in the router with its approval revoked, the treasury and bribe shares are always paid, and once sMUSD has kept failing across two weekly epoch flips its share goes to the treasury. An upgrade watcher that alerts and cuts caps is a planned keeper job |
| **Bribes nobody can claim** | The FeeRouter posts no bribe in the last hour of an epoch, when only whitelisted veNFTs can vote, and none on a bribe contract with zero votes. That share stays in the router and is added to the same gauge's next bribe |
| **Precompile and gas limits** (20 precompile calls per tx, 10M block gas) | Each flow's precompile budget is counted: open/borrow uses 2 Skip reads, exit uses 0. Deploy transactions stay under 8M gas |
| **Front-running clone creation** | Clones have no initializer; the owner is an immutable argument at a CREATE2 address salted by (owner, profile) |
| **Bad-debt seeding through canaries** | The canary profile (higher ceiling, for live liquidation demos) can only be opened by an allow-listed operator, at 0.002 BTC per position. Granting the role goes through the 48-hour timelock. A revoked operator cannot borrow, and can only withdraw down to the STANDARD ceiling |
| **Signed come-back claims replayed to someone else** | `comeBack` only claims for `msg.sender`, into the caller's own clone, and counts BTC by balance change |
| **Secrets in the front-end** (Mezo's July incident) | The web app has zero secrets: only `BASERATE_PUBLIC_*` variables. CI scans the built bundle for key-shaped strings and runs gitleaks on every push |

## Invariants we test

- wsMUSD's sMUSD plus MUSD backing is at least `totalAssets`, and its share price never decreases.
- A same-block donation, including sMUSD protocol yield, does not change wsMUSD's `totalAssets`, and neither does a reverting sMUSD claim.
- vMUSD's allocator never grows an allocation past its caps, never pulls M1 below the borrow buffer, and makes no rate-driven move when M1 was changed earlier in the same block.
- `bcBTC`'s native balance is at least its total supply. Every Morpho collateral holder is a registered account.
- Borrow accounts hold 0 MUSD and 0 `bcBTC` after every call. No entry point accepts the account itself as a receiver, and the owner can sweep tokens sent to it directly.
- LTV after any open, borrow or withdraw is at most the profile ceiling. Total M1 borrows are at most the global cap. No borrow succeeds on a position above its cap, and collateral top-ups always succeed.
- `repayAndWithdraw` succeeds while the oracle reverts.
- The backstop's share price only moves on realised PnL, never up instantly. A claim, partial or not, pays at most min(NAV at request, NAV at claim).
- Every MUSD that enters the FeeRouter is paid out or held as a recorded carry, the treasury gets exactly 20% of new fees, and no approval outlives a `distribute()`. This holds under failing sMUSD, dead gauges and the closing hour of an epoch.

## Known limitations

- **Pre-audit.** AI-assisted review rounds are logged in `docs/audit/`. A third-party audit is planned before any cap increase.
- **Thin liquidation depth.** About 0.1 BTC clears cleanly on Mezo mainnet today, which is why mainnet caps are deliberately tiny.
- **Upgradeable dependencies.** sMUSD, MUSD's BorrowerOperationsSignatures and Pyth are upgradeable by their owners.
- **A broken sMUSD withdraw strands vMUSD's wsMUSD share.** Vault V2 only exits in MUSD, so if sMUSD's withdraw breaks, the part of vMUSD parked in wsMUSD cannot be withdrawn until it is fixed; the M1 part still can, through the allocator. The adapter rescue then sends the wsMUSD shares to the vault owner, who has to unwind them (`redeemInKind` gives sMUSD) and return the value. Until then the vault books that value as a loss, and value returned through the vault is rate-limited by its `maxRate`. After a rescue the sentinel should cut the wsMUSD adapter's cap to 0 so nobody deposits into the marked-down vault.
- **Allocator trade-offs.** The trailing rule lags real rate changes by up to the 7-day window. Anyone touching M1 earlier in a block skips that block's rate-driven move (liveness, not safety). A borrower can briefly borrow to trigger a buffer top-up, which only adds M1 liquidity, within the caps.
- **wsMUSD harvest timing.** Unclaimed sMUSD yield counts nothing until it is harvested, then vests over 3 days. A depositor who joins before a harvest and stays through the vesting therefore shares in yield that accrued before it joined. The keeper harvests whenever 0.01 MUSD is pending, or at least every 6 hours.

## Reporting

Please report vulnerabilities privately via a GitHub security advisory on this repository.
