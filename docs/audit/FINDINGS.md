# Security findings ledger

Baserate has not had a third-party audit yet; one is planned before mainnet caps grow (see [BUILT_VS_PLANNED.md](../BUILT_VS_PLANNED.md)). This ledger records the internal review rounds: independent AI audit passes, static analysis and secret scanning. Every finding is listed with its status. Every confirmed finding has a proof-of-concept test, and every fix has a regression test.

## Round 1 (25 Oct 2026)

Four independent reviewers each took one area, working from the code, the spec ([docs/design/contracts.md](../design/contracts.md)), the threat model ([docs/design/red-team.md](../design/red-team.md)) and the claims in [SECURITY.md](../SECURITY.md). Each finding had to be demonstrated by a Foundry test in `contracts/test/audit/`.

| Area | Scope | PoC file |
|---|---|---|
| A · core credit | BorrowAccount, BorrowAccountFactory, CollateralBTC, BtcMusdOracle, MusdDispenser | `CoreAudit.t.sol` |
| B · savings and vault | WsMUSD, WsMusdLiquidityAdapter, BaserateAllocator, vMUSD configuration | `VaultAudit.t.sol` |
| C · liquidations | FlashLiquidator, Backstop, TigrisVenues | `LiquidationAudit.t.sol` |
| D · fees, lens, governance | FeeRouter, RiskLens, deploy scripts, roles and timelocks | `FeesGovAudit.t.sol` |

No Critical or High findings. Status: **Open** (confirmed, fix in progress) → **Fixed** (code changed, regression test passing) → **Deployed** (live on testnet). Round-1 fixes landed in commit `af6eace`; each PoC became a `test_fix_*` regression test in the same file.

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| A-1 / D-1 | Medium | The position cap blocks BTC top-ups, and a cap or ceiling cut blocks top-ups and partial withdrawals | `BorrowAccount.sol` `_supply`, `_withdrawAndUnwrap` | Fixed |
| B-1 | Medium | Same-block state lets anyone invert the allocator's move and pull M1 below its buffer for free | `BaserateAllocator.sol` `rebalance`, `_snapshot` | Fixed |
| B-2 | Medium | vMUSD has no in-kind escape: a broken sMUSD `withdraw` freezes its wsMUSD position and the penalty-free exit out of M1 | `WsMusdLiquidityAdapter.sol`, `BaserateAllocator.sol` | Fixed |
| C-1 | Medium | Backstop deposits are priced without unvested gains, so late depositors capture realised liquidation premiums | `Backstop.sol` deposit/mint, `_checkpoint` | Partially fixed: deposits made after a sale now pay for unvested gains; a deposit between a purchase and its sale was still open (R2V-1) |
| D-2 | Medium | An sMUSD change that makes the yield leg revert freezes every fee in the ownerless FeeRouter | `FeeRouter.sol` `distribute` | Fixed |
| A-2 / D-4 | Low | Queued raises survive instant cuts and stale entries stay executable | `BorrowAccountFactory.sol` timelock | Fixed |
| A-3 | Low | A revoked canary operator can still raise LTV to the canary ceiling by withdrawing | `BorrowAccount.sol` `_withdrawAndUnwrap` | Fixed |
| A-4 | Low | MUSD sent or borrowed to a clone is stranded | `BorrowAccount.sol` | Fixed |
| B-3 | Low | A failed or short sMUSD `claimYield` lowers wsMUSD's share price; previews over-promise | `WsMUSD.sol` `_sync`, `_previewSync` | Fixed |
| C-2 | Low | 1 wei of donated BTC makes `liquidate` revert for contract callers that cannot receive BTC | `FlashLiquidator.sol` `liquidate` | Fixed |
| C-3 | Low | Exits are all-or-nothing in cash, and dust inventory ties every exit to the oracle | `Backstop.sol` `claimRedeem`, `_payOut` | Fixed |
| D-3 | Low | `distribute()` has no on-chain guard against the epoch's last hour | `FeeRouter.sol` | Fixed |
| D-5 | Low | RiskLens counts the backstop's reserved exit cash as free | `RiskLens.sol` | Fixed |
| D-7 | Low | Granting a canary operator is an instant ceiling raise | `BorrowAccountFactory.sol` `setCanaryOperator` | Fixed |
| A-5 | Info | Pause stops new borrowing but not collateral-only positions (docs said "new positions") | docs | Fixed |
| B-I1 | Info | A same-block sMUSD protocol-yield donation moves wsMUSD's `totalAssets` | `WsMUSD.sol`, docs | Fixed |
| D-6 | Info | `RiskLens.snapshot` panics on an implausibly large Skip answer | `RiskLens.sol` | Fixed |
| D-8 | Info | The trove queue counts troves below 110% that redemptions skip | `RiskLens.sol` `troveQueue` | Fixed |
| S-1 | Low | `Deploy.s.sol` writes the registry even on a dry run | `script/Deploy.s.sol` | Fixed |
| S-2 | Low | `DeployLiquidation.s.sol` defaults the immutable Backstop sentinel to the deployer on every chain | `script/DeployLiquidation.s.sol` | Fixed |
| S-3 | Low | No mainnet core deploy path with a Safe governor and the FeeRouter as fee recipient | `script/` | Fixed |
| K-1 | Low | The keeper's liquidation gas (×1.4 of Mezo's estimate) ran out on-chain; Mezo's `eth_estimateGas` leaves out precompile cost | `apps/keeper` | Fixed and deployed: gas = max(2 × estimate, 2M). The canary was then liquidated in [0x61cd8945…](https://explorer.test.mezo.org/tx/0x61cd894541a3c40d22a3c88800216af1f3363cd65551e3b2eeaab4e32f5cae3c) (749k gas against an estimate of 477k) |

Design notes the reviewers raised but did not file as findings:
- The first-come global cap can be filled cheaply by Sybil positions. This is inherent to a tiny proof-mode cap.
- A front-run `comeBack` signature still lands the BTC in the user's own clone.
- The oracle fails open to MUSD = 1.00 when Pyth is unreadable. This is documented and not exploitable within the gas budget.
- A large vMUSD holder can move the vault's M1 supply to wsMUSD through the allocator exit.
- Anyone can claim a matured backstop exit at its scheduled time.

### What the reviewers found sound

| Area | Verified |
|---|---|
| bcBTC gate | It binds the whole M1 market: flash loans, callbacks, foreign markets and authorisations were all tried |
| Repay and exit | The oracle-free `repayAndWithdraw` survives third-party repay and supply |
| Oracle | Scaling, the staleness check, the Pyth band and the MUSD clamp are correct, and `status()` cannot revert |
| wsMUSD | Inflation and donation resistance hold with a working sMUSD |
| Allocator and vault | The allocator's cap math is correct, and vMUSD's timelocks and handover are right |
| FlashLiquidator | Callbacks cannot be spoofed and no allowance is left behind. A 512-run fuzz of the seizure math never got stuck |
| Backstop | Floors, reserves and CEI order hold |
| FeeRouter | The split conserves value. Killed gauges and hostile bribes are redirected |
| RiskLens | Its TWAP and depth math match the contracts |
| Precompile budget | At most 7 precompile calls per liquidation |
| Live wiring and addresses | Testnet wiring and both networks' external addresses check out |

## Round 2 (26 Oct 2026)

Two fresh reviewers worked on the fixed code (`af6eace`): one verified every round-1 fix and hunted for regressions in the new code paths (`Round2Verify.t.sol`), the other attacked across contracts — compositions, economics, liveness, and Mezo's limits, measured (`Round2Cross.t.sol`). Every round-1 fix was confirmed except C-1, which was only partly fixed.

**Mezo limits, measured** (state-diff counting, reverted frames included): no on-chain flow uses more than 7 of the 20 precompile calls a transaction may make (a vAMM liquidation: 5 BTC-precompile + 2 Skip); `RiskLens.snapshot` (an `eth_call`) uses 10; the worst on-chain flow costs about 1M gas against the 10M block limit.

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| R2V-1 / R2X-9 | Medium | A backstop deposit placed between a liquidation buy and its sale buys in at the 0.95 mark and takes most of the mark-up | `Backstop.sol` deposit pricing | Open |
| R2V-7 / R2X-1 | Medium | A broken sMUSD `withdraw` freezes backstop exits and the backstop liquidation venue (it pays through wsMUSD) | `Backstop.sol` `_payOut`, `_park` | Open |
| R2X-4 | Medium | Anyone can force-deallocate vMUSD's wsMUSD position for free and strip its share of wsMUSD's vesting yield | `WsMusdLiquidityAdapter.sol`, vault config | Open |
| R2X-2 | Medium (conditional) | With Pyth up to 65 min stale, the ±10% band can block every liquidation in a fast crash; bad debt lands on vMUSD | `BtcMusdOracle.sol` | Open |
| R2V-3 | Low | A borrow–checkpoint–repay in one transaction blocks the allocator's move to wsMUSD for 24 h | `BaserateAllocator.sol` `_checkpoint` | Open |
| R2X-3 | Low | Buffer top-ups can be looped within one transaction to push vMUSD into M1 against policy | `BaserateAllocator.sol` | Open |
| R2X-6 | Medium (keeper) | Spam accounts slow the keeper's liquidation scan (two reads per account) | `apps/keeper` | Fixed: one multicall per 200 accounts |
| R2X-7 | Low (keeper) | A 1-wei bribe made the keeper skip the epoch's fee flush | `apps/keeper` | Fixed: the keeper's own once-per-epoch record |
| R2X-8 | Low (keeper) | One skewed block could zero the depth sample behind cap cuts | `apps/keeper` | Fixed: 24 h median, never below current borrows |
| R2X-10 | Low (web) | The app's 1.3× gas headroom is too little for precompile-heavy transactions on Mezo | `apps/web` | Fixed: max(2 × estimate, 1.5M) |
| R2V-2 | Info | An unseeded backstop prices deposits off a donation again | `DeployLiquidation.s.sol` | Open |
| R2V-4 | Info | A free `accrueInterest` front-run vetoes a block's rate-driven allocator move | `BaserateAllocator.sol` | Open |
| R2V-5 / R2X-5 | Info / Low | Lump yield vesting in wsMUSD is shared with late depositors; a flash-funded deposit around `FeeRouter.distribute` captures part of the sMUSD share | `WsMUSD.sol`, `FeeRouter.sol` | Open |
| R2V-6 | Info | A core-only redeploy leaves dependent keys in the merged registry | `Deploy.s.sol` | Documented: the redeploy runs every script |

## Static analysis: Slither 0.11 (`contracts/src`, dependencies excluded)

351 results across 100 detectors. Triage:

| Detector (count) | Verdict |
|---|---|
| arbitrary-send-eth (2) | **False positive.** `FlashLiquidator.liquidate` returns proceeds to its caller, and `Backstop.takeAuction` pays the taker's chosen recipient after payment. Both are intended, `nonReentrant` and CEI. (C-2 changes the first to forward only this liquidation's proceeds.) |
| weak-prng (1) | **False positive.** Epoch arithmetic `t − t % 7 days`, not randomness. |
| reentrancy-no-eth (14) | **Not exploitable.** Every flagged function is `nonReentrant`, and the external calls go to MUSD, sMUSD, Morpho, wsMUSD or the Tigris router. |
| divide-before-multiply (20) | **False positive.** 19 are Uniswap's `TickMath` constants; one is FeeRouter giving the rounding remainder to the last gauge on purpose. |
| unused-return (21) | **Reviewed.** Results are either unneeded (Morpho `repay` with exact shares, wsMUSD `deposit` share counts) or checked through balance deltas (venue swaps, backstop purchases). |
| incorrect-equality (30), uninitialized-local (2), timestamp (53), calls-loop (11), missing-zero-check (13) | **Reviewed.** `== 0` sentinels, intentional zero-initialised accumulators, timelocks and epochs that run on timestamps by design, bounded loops over two gauges, and constructor addresses checked in the deploy scripts. |
| naming-convention (156), assembly (7), low-level-calls (4), others | Informational. |

## Secret scanning: gitleaks 8

- **Git history (41 commits) and working tree:** clean.
- **Initial findings:** the 6 initial hits were public contract addresses matched by the generic API-key rule. `.gitleaks.toml` allowlists only exact 40-hex-digit addresses, so a 64-digit private key is still caught (tested).
- **Bundle scan:** `pnpm --filter web check-bundle` scans the built app for key shapes on every CI run.
