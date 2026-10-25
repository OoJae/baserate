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

No Critical or High findings. Status: **Open** (confirmed, fix in progress) → **Fixed** (code changed, regression test passing) → **Deployed** (live on testnet).

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| A-1 / D-1 | Medium | The position cap blocks BTC top-ups, and a cap or ceiling cut blocks top-ups and partial withdrawals | `BorrowAccount.sol` `_supply`, `_withdrawAndUnwrap` | Open |
| B-1 | Medium | Same-block state lets anyone invert the allocator's move and pull M1 below its buffer for free | `BaserateAllocator.sol` `rebalance`, `_snapshot` | Open |
| B-2 | Medium | vMUSD has no in-kind escape: a broken sMUSD `withdraw` freezes its wsMUSD position and the penalty-free exit out of M1 | `WsMusdLiquidityAdapter.sol`, `BaserateAllocator.sol` | Open |
| C-1 | Medium | Backstop deposits are priced without unvested gains, so late depositors capture realised liquidation premiums | `Backstop.sol` deposit/mint, `_checkpoint` | Open |
| D-2 | Medium | An sMUSD change that makes the yield leg revert freezes every fee in the ownerless FeeRouter | `FeeRouter.sol` `distribute` | Open |
| A-2 / D-4 | Low | Queued raises survive instant cuts and stale entries stay executable | `BorrowAccountFactory.sol` timelock | Open |
| A-3 | Low | A revoked canary operator can still raise LTV to the canary ceiling by withdrawing | `BorrowAccount.sol` `_withdrawAndUnwrap` | Open |
| A-4 | Low | MUSD sent or borrowed to a clone is stranded | `BorrowAccount.sol` | Open |
| B-3 | Low | A failed or short sMUSD `claimYield` lowers wsMUSD's share price; previews over-promise | `WsMUSD.sol` `_sync`, `_previewSync` | Open |
| C-2 | Low | 1 wei of donated BTC makes `liquidate` revert for contract callers that cannot receive BTC | `FlashLiquidator.sol` `liquidate` | Open |
| C-3 | Low | Exits are all-or-nothing in cash, and dust inventory ties every exit to the oracle | `Backstop.sol` `claimRedeem`, `_payOut` | Open |
| D-3 | Low | `distribute()` has no on-chain guard against the epoch's last hour | `FeeRouter.sol` | Open |
| D-5 | Low | RiskLens counts the backstop's reserved exit cash as free | `RiskLens.sol` | Open |
| D-7 | Low | Granting a canary operator is an instant ceiling raise | `BorrowAccountFactory.sol` `setCanaryOperator` | Open |
| A-5 | Info | Pause stops new borrowing but not collateral-only positions (docs said "new positions") | docs | Open |
| B-I1 | Info | A same-block sMUSD protocol-yield donation moves wsMUSD's `totalAssets` | `WsMUSD.sol`, docs | Open |
| D-6 | Info | `RiskLens.snapshot` panics on an implausibly large Skip answer | `RiskLens.sol` | Open |
| D-8 | Info | The trove queue counts troves below 110% that redemptions skip | `RiskLens.sol` `troveQueue` | Open |
| S-1 | Low | `Deploy.s.sol` writes the registry even on a dry run | `script/Deploy.s.sol` | Open |
| S-2 | Low | `DeployLiquidation.s.sol` defaults the immutable Backstop sentinel to the deployer on every chain | `script/DeployLiquidation.s.sol` | Open |
| S-3 | Low | No mainnet core deploy path with a Safe governor and the FeeRouter as fee recipient | `script/` | Open |
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
