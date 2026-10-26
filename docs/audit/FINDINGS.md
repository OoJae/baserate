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

No Critical or High findings. Status: **Open** (confirmed, fix in progress) → **Fixed** (code changed, regression test passing) → **Deployed** (live on testnet). Round-1 fixes landed in commit `af6eace`; each PoC became a `test_fix_*` regression test in the same file. Round-1 and round-2 fixes went live together in the v2 testnet stack on 26 Oct (`b4fb980`), all 14 contracts verified on Sourcify.

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| A-1 / D-1 | Medium | The position cap blocks BTC top-ups, and a cap or ceiling cut blocks top-ups and partial withdrawals | `BorrowAccount.sol` `_supply`, `_withdrawAndUnwrap` | Deployed |
| B-1 | Medium | Same-block state lets anyone invert the allocator's move and pull M1 below its buffer for free | `BaserateAllocator.sol` `rebalance`, `_snapshot` | Deployed |
| B-2 | Medium | vMUSD has no in-kind escape: a broken sMUSD `withdraw` freezes its wsMUSD position and the penalty-free exit out of M1 | `WsMusdLiquidityAdapter.sol`, `BaserateAllocator.sol` | Deployed |
| C-1 | Medium | Backstop deposits are priced without unvested gains, so late depositors capture realised liquidation premiums | `Backstop.sol` deposit/mint, `_checkpoint` | Deployed; completed in round 2 (R2V-1): deposits also close between a purchase and its sale |
| D-2 | Medium | An sMUSD change that makes the yield leg revert freezes every fee in the ownerless FeeRouter | `FeeRouter.sol` `distribute` | Deployed |
| A-2 / D-4 | Low | Queued raises survive instant cuts and stale entries stay executable | `BorrowAccountFactory.sol` timelock | Deployed |
| A-3 | Low | A revoked canary operator can still raise LTV to the canary ceiling by withdrawing | `BorrowAccount.sol` `_withdrawAndUnwrap` | Deployed |
| A-4 | Low | MUSD sent or borrowed to a clone is stranded | `BorrowAccount.sol` | Deployed |
| B-3 | Low | A failed or short sMUSD `claimYield` lowers wsMUSD's share price; previews over-promise | `WsMUSD.sol` `_sync`, `_previewSync` | Deployed |
| C-2 | Low | 1 wei of donated BTC makes `liquidate` revert for contract callers that cannot receive BTC | `FlashLiquidator.sol` `liquidate` | Deployed |
| C-3 | Low | Exits are all-or-nothing in cash, and dust inventory ties every exit to the oracle | `Backstop.sol` `claimRedeem`, `_payOut` | Deployed |
| D-3 | Low | `distribute()` has no on-chain guard against the epoch's last hour | `FeeRouter.sol` | Deployed |
| D-5 | Low | RiskLens counts the backstop's reserved exit cash as free | `RiskLens.sol` | Deployed |
| D-7 | Low | Granting a canary operator is an instant ceiling raise | `BorrowAccountFactory.sol` `setCanaryOperator` | Deployed |
| A-5 | Info | Pause stops new borrowing but not collateral-only positions (docs said "new positions") | docs | Deployed |
| B-I1 | Info | A same-block sMUSD protocol-yield donation moves wsMUSD's `totalAssets` | `WsMUSD.sol`, docs | Deployed |
| D-6 | Info | `RiskLens.snapshot` panics on an implausibly large Skip answer | `RiskLens.sol` | Deployed |
| D-8 | Info | The trove queue counts troves below 110% that redemptions skip | `RiskLens.sol` `troveQueue` | Deployed |
| S-1 | Low | `Deploy.s.sol` writes the registry even on a dry run | `script/Deploy.s.sol` | Deployed |
| S-2 | Low | `DeployLiquidation.s.sol` defaults the immutable Backstop sentinel to the deployer on every chain | `script/DeployLiquidation.s.sol` | Deployed |
| S-3 | Low | No mainnet core deploy path with a Safe governor and the FeeRouter as fee recipient | `script/` | Deployed |
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

Two fresh reviewers worked on the fixed code (`af6eace`): one verified every round-1 fix and hunted for regressions in the new code paths (`Round2Verify.t.sol`), the other attacked across contracts — compositions, economics, liveness, and Mezo's limits, measured (`Round2Cross.t.sol`). Every round-1 fix was confirmed except C-1, which was only partly fixed. Round-2 fixes landed in `16dbaf0` (547 non-fork and 188 fork tests passing) and are live in the v2 stack; known limitations are tested as `test_known_*` and documented.

**Mezo limits, measured** (state-diff counting, reverted frames included): no on-chain flow uses more than 7 of the 20 precompile calls a transaction may make (a vAMM liquidation: 5 BTC-precompile + 2 Skip); `RiskLens.snapshot` (an `eth_call`) uses 10; the worst on-chain flow costs about 1M gas against the 10M block limit.

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| R2V-1 / R2X-9 | Medium | A backstop deposit placed between a liquidation buy and its sale buys in at the 0.95 mark and takes most of the mark-up | `Backstop.sol` deposit pricing | Deployed: deposits close while the backstop holds BTC (`HoldingInventory`). `test_fix_R2V1_*`, `test_fix_R2X9_*` |
| R2V-7 / R2X-1 | Medium | A broken sMUSD `withdraw` freezes backstop exits and the backstop liquidation venue (it pays through wsMUSD) | `Backstop.sol` `_payOut`, `_park` | Deployed: when sMUSD's `withdraw` fails, exits pay what cash allows and the rest in kind (`PaidInKind`), and the venue runs on idle cash. `test_fix_R2V7_*`, `test_fix_R2X1_*` |
| R2X-4 | Medium | Anyone can force-deallocate vMUSD's wsMUSD position for free and strip its share of wsMUSD's vesting yield | `WsMusdLiquidityAdapter.sol`, vault config | Deployed: the adapter refuses `forceDeallocate` (`ForceDeallocateDisabled`); idle MUSD is parked during the cooldown. `test_fix_R2X4_*` |
| R2X-2 | Medium (conditional) | With Pyth up to 65 min stale, the ±10% band can block every liquidation in a fast crash; bad debt lands on vMUSD | `BtcMusdOracle.sol` | Deployed: the band gates only while Pyth is under 600 s old (`PYTH_BTC_BAND_MAX_AGE`). `test_fix_R2X2_*` |
| R2V-3 | Low | A borrow–checkpoint–repay in one transaction blocks the allocator's move to wsMUSD for 24 h | `BaserateAllocator.sol` `_checkpoint` | Deployed: the checkpoint carries the last reading forward, so a borrow repaid in the same transaction is not recorded. `test_fix_R2V3_*` |
| R2X-3 | Low | Buffer top-ups can be looped within one transaction to push vMUSD into M1 against policy | `BaserateAllocator.sol` | Deployed: one buffer top-up per block (`lastTopUpAt`). `test_fix_R2X3_*` |
| R2X-6 | Medium (keeper) | Spam accounts slow the keeper's liquidation scan (two reads per account) | `apps/keeper` | Deployed: one multicall per 200 accounts |
| R2X-7 | Low (keeper) | A 1-wei bribe made the keeper skip the epoch's fee flush | `apps/keeper` | Deployed: the keeper's own once-per-epoch record, per FeeRouter |
| R2X-8 | Low (keeper) | One skewed block could zero the depth sample behind cap cuts | `apps/keeper` | Deployed: 24 h median, never below current borrows |
| R2X-10 | Low (web) | The app's 1.3× gas headroom is too little for precompile-heavy transactions on Mezo | `apps/web` | Deployed: max(2 × estimate, 1.5M) |
| R2V-2 | Info | An unseeded backstop prices deposits off a donation again | `DeployLiquidation.s.sol` | Deployed: `DeployLiquidation` seeds the backstop in the same broadcast and refuses to run without it. `test_fix_R2V2_*` |
| R2V-4 | Info | A free `accrueInterest` front-run vetoes a block's rate-driven allocator move | `BaserateAllocator.sol` | Known limitation, documented in [SECURITY.md](../SECURITY.md). `test_known_R2V4_*` |
| R2V-5 / R2X-5 | Info / Low | Lump yield vesting in wsMUSD is shared with late depositors; a flash-funded deposit around `FeeRouter.distribute` captures part of the sMUSD share | `WsMUSD.sol`, `FeeRouter.sol` | Known limitation, documented in [SECURITY.md](../SECURITY.md). `test_known_R2V5_*`, `test_known_R2X5_*` |
| R2V-6 | Info | A core-only redeploy leaves dependent keys in the merged registry | `Deploy.s.sol` | Documented: the redeploy runs every script (as the v2 redeploy did) |

## Round 3 (26 Oct 2026)

Three fresh reviewers attacked the round-2 diff (`524b0f1..16dbaf0`) through three lenses: is each fix correct and complete, what regressed in the new code paths, and what the new behaviour enables economically. Every finding has a passing PoC in `contracts/test/audit/Round3_{fixes,regressions,economics}.t.sol` (19 tests). **No Critical, High or Medium findings**, so the v2 stack stands; the contract fixes below are in progress with regression tests. The oracle pair's keeper-side mitigation is built but off, because Pyth's Hermes now needs a paid plan.

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| R3-1 / R3E-1 / R3F-B | Low | The backstop's parking pause ends on a timer, or on any successful wsMUSD withdraw (even one wsMUSD pays from its own idle MUSD), while sMUSD's withdraw is still broken; the next deposit or sale re-parks the venue's cash and quotes still show the venue as open | `Backstop.sol` `_payOut`, `_park`, `quoteBuy` | Open: the pause will follow wsMUSD's health (a probe withdraw that must reach sMUSD), not a timer, and quotes stay capped at idle cash while paused |
| R3-3 | Info | During the pause, an exit paid in kind spends the venue's idle MUSD first, even when the backstop's wsMUSD could pay it | `Backstop.sol` `_payOut` | Open: pay in kind from the wsMUSD position first |
| R3-2 | Low | A 1 MUSD top-up (supply, rebalance, withdraw in one transaction) takes the block's only buffer top-up and throttles restoration to 1 MUSD per block | `BaserateAllocator.sol` `_planBufferTopUp` | Open: limit top-ups by amount per block, not by count |
| R3E-2 | Low | One touched checkpoint an hour can carry a recorded liquidity low forward indefinitely, blocking the move to wsMUSD | `BaserateAllocator.sol` `_checkpoint` | Open: a touched checkpoint records share prices but no liquidity observation, so a low ages out 24 h after it was seen |
| R3E-3 / R3F-C | Low | The 600 s Pyth band cuts both ways: between Mezo's hourly Pyth pushes it is off, so a Skip misprint above 10% gets through; and anyone can keep it on with genuine but lagged Pyth prints, stretching a crash-time freeze past 10 minutes | `BtcMusdOracle.sol` `price()` | Open. A keeper mitigation is built (`3d391da`: `pyth.push` pushes the latest Pyth BTC/USD print once the stored one is over 240 s old, and again before each liquidation, so the band stays on and Pyth rejects older prints), but it is off: since Pyth's August 2026 upgrade, Hermes updates need a paid plan. Until then the band relies on Mezo's own pushers. `test_known_*` |
| R3F-A | Low | MUSD sent to the backstop's predictable address before the seed deposit lands voids or blocks the dead-share seed | `DeployLiquidation.s.sol` `_seed` | Open: mint the dead shares in the constructor. Not hit on v2: `balanceOf(0x…dEaD)` = 1e18 = total supply |

What round 3 confirmed sound, with `test_R3_verify_*` tests where noted: deposits stay closed while the backstop holds BTC and no path reopens them; the in-kind fallback cannot be forced by a gas limit or triggered on a healthy wsMUSD; in-kind and partial claims never pay above the request's NAV and reserved assets always match open requests (512-run fuzz); vMUSD's `forceDeallocate` on the market adapter still works with sMUSD broken, and the allocator's M1-first exit stays reachable; the checkpoint carry-forward never raises the 24 h minimum; the 600 s band only removes reverts; and every flow stays at 7 precompile calls or fewer.

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
