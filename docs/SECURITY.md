# Security

Baserate moves real BTC and MUSD. This page lists what can go wrong, what we built to stop it, and what we have not solved.

**Status:** pre-audit. Contracts are verified on testnet. Mainnet runs in proof mode, with hard caps of at most 2,000 MUSD of borrowing.

## Design principles

- **No new lending engine.**
  - Interest, liquidation and share accounting run on Mezo's own deployment of Morpho Blue, which has been audited.
  - Our contracts route into it and add limits; they do not reimplement it.
- **Immutable core.** None of the oracle, wsMUSD, the collateral receipt (`bcBTC`), the BorrowAccount implementation and its factory sits behind a proxy.
- **Exits never pause.**
  - The sentinel can pause new borrows, credit draws and new positions.
  - It can never block repay, withdraw, add collateral, unwrap or liquidation.
- **Decreases are instant; increases wait 48 hours.** Cap raises, ceiling raises, fee-recipient changes and module approvals all sit behind a public timelock. wsMUSD cap raises wait 72 hours.
- **No meta-transactions.** No ERC-2771, no `_msgSender()`, no `tx.origin`. The October 2026 veBTC exploit came from a forwarder bug.

## Threat model

| Threat | Mitigation |
|---|---|
| **Stale or manipulated BTC price** (the root cause of Velar's exploit) | Skip BTC/USD rejected if older than 60 s. Pyth BTC acts as a ±10% sanity band while it is at most 3,900 s old. Prices are never taken from DEX pools |
| **Oracle outage freezes the market** | Morpho does not consult the oracle once a position has no debt, so `repayAndWithdraw` works with the oracle down. Worst-case divergence freeze is about 65 minutes. A Skip outage is unbounded, and is disclosed |
| **MUSD depeg makes debt look smaller** | The MUSD leg is clamped to [1.00, 1.02]. Collateral is never valued above its USD price in MUSD terms. At today's ~$0.989 this undervalues collateral by about 1.1%, which is conservative |
| **Positions bigger than liquidation depth** | All collateral must enter through `bcBTC`, which only registered accounts can mint, so per-position and global caps bind the whole market, not just our UI. Caps start at 0.01 BTC per position (testnet) and 2,000 MUSD global (mainnet) |
| **Inflation, donation and sandwich attacks on wsMUSD** | Internal accounting means donations never move the price instantly. Harvested yield vests over 3 days. Same-block sandwiches earn about nothing. 1 MUSD of dead shares at deploy |
| **sMUSD proxy upgrade or strategy change** | `redeemInKind` makes no calls into sMUSD's deposit, withdraw or claim functions. An upgrade watcher (keeper) alerts and cuts caps |
| **Precompile and gas limits** (20 precompile calls per tx, 10M block gas) | Each flow's precompile budget is counted: open/borrow uses 2 Skip reads, exit uses 0. Deploy transactions stay under 8M gas |
| **Front-running clone creation** | Clones have no initializer; the owner is an immutable argument at a CREATE2 address salted by (owner, profile) |
| **Bad-debt seeding through canaries** | The canary profile (higher ceiling, for live liquidation demos) can only be opened by an allow-listed operator, at 0.002 BTC per position |
| **Signed come-back claims replayed to someone else** | `comeBack` only claims for `msg.sender`, into the caller's own clone, and counts BTC by balance change |
| **Secrets in the front-end** (Mezo's July incident) | The web app has zero secrets: only `BASERATE_PUBLIC_*` variables. CI scans the built bundle for key-shaped strings and runs gitleaks on every push |

## Invariants we test

- wsMUSD's sMUSD plus MUSD backing is at least `totalAssets`, and its share price never decreases.
- A same-block donation does not change wsMUSD's `totalAssets`.
- `bcBTC`'s native balance is at least its total supply. Every Morpho collateral holder is a registered account.
- Borrow accounts hold 0 MUSD and 0 `bcBTC` after every call.
- LTV after any open, borrow or withdraw is at most the profile ceiling. Total M1 borrows are at most the global cap.
- `repayAndWithdraw` succeeds while the oracle reverts.

## Known limitations

- **Pre-audit.** AI-assisted review rounds are logged in `docs/audit/`. A third-party audit is planned before any cap increase.
- **Thin liquidation depth.** About 0.1 BTC clears cleanly on Mezo mainnet today, which is why mainnet caps are deliberately tiny.
- **Upgradeable dependencies.** sMUSD, MUSD's BorrowerOperationsSignatures and Pyth are upgradeable by their owners.

## Reporting

Please report vulnerabilities privately via a GitHub security advisory on this repository.
