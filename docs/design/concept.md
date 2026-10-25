# Baserate

**Redemption-free BTC→MUSD credit, a curated MUSD lending vault, and an ERC-4626 sMUSD that actually works, all on Mezo's own Morpho.** Track 1.

## 1. Positioning and name

Mezo's H1 review promised "the first in a broader suite of lending markets… against BTC collateral". Baserate is that MUSD lending market. It is built only from Mezo's own rails:
- Morpho Blue `0x5658…A311`;
- the Vault V2 factory, using the same template as Mezo's USDC Lending Vault;
- sMUSD;
- the Skip and Pyth price feeds;
- the BTC precompile;
- Tigris pools;
- PoolsVoter gauges.

What it offers:
- **Borrow:** post BTC and receive MUSD in one transaction. There is no redemption queue, no 2,000-MUSD minimum and no capacity lock.
- **Lend:** deposit MUSD into vMUSD. Idle cash sits in sMUSD at the savings rate and moves into credit only when credit pays more. The savings rate becomes the base rate of BTC credit on Mezo, hence the name.
- **Save:** wsMUSD, an ERC-4626 wrapper over the real sMUSD that any vault, market or LP can hold.
- **Delegate:** capped, revocable credit lines that let apps and agents draw MUSD against the owner's BTC.

Because Baserate uses Mezo's exact stack, Mezo can adopt any piece of it by configuration. It extends Mezo's products instead of detouring around them.

Our claims are deliberately narrow:
- the first BTC→MUSD market on Mezo's official Morpho on mainnet, with an oracle that rejects stale prices;
- the first ERC-4626 over sMUSD that is tested against the live contract on a mainnet fork.

Prior work we credit:
- six dust-sized MUSD markets on a second, EOA-owned Morpho (`0x5e48…`), wound down on 2026-06-26;
- Mezodot's custom-built money market on testnet;
- Cosign's MEZO-collateral markets on its own testnet Morpho.

## 2. The problem, in numbers

- **Retail MUSD credit is gone.**
  - Troves fell from 104 (6.03M MUSD of debt, 2025-11-30) to 1 (14.5k).
  - MUSD has traded at $0.9885–0.9911 for 60 days. That is below the ≈$0.9925 floor implied by the 0.75% redemption fee.
  - 681 redemptions burned 1.28M MUSD in ≈30 days. While this lasts, any new trove with a lower collateral ratio than the survivor is first in the redemption queue [I].
  - The smallest allowed trove needs ≈0.027 BTC, which is 27 faucet drips.
- **The composable rails are empty.**
  - Mezo's Morpho has one market: BTC collateral, mUSDC loans. It has 81.9k supplied, 66.3k borrowed, 16 distinct borrowers ever and 0 liquidations ever.
  - Morpho holds 0 MUSD (re-read today).
  - USDC credit is capped by the 122k total supply of mUSDC.
- **Savings are not composable.**
  - sMUSD (7,382,555 supply, 448 holders) is not ERC-4626: `asset()` and `totalAssets()` revert.
  - So it cannot be collateral or serve as a vault's liquidity floor.
  - Its principal sits idle in IdleStrategy.
- **The savings rate is about to fall.**
  - In the last 30 days sMUSD received 19,367 MUSD. 12,207 of that (63%) was redemption-fee BTC converted through YieldConverter.
  - With only ≈12.5k MUSD of redemption capacity left, that source is nearly exhausted, and the steady-state rate is ≈1.2% [I].
- **Liquidation depth is the binding constraint.**
  - The BTC/MUSD CL200 pool holds 9,956 MUSD + 0.452 BTC, and the vAMM holds 39,194 MUSD + 0.476 BTC (re-read today).
  - 0.1 BTC sells cleanly on CL200. 0.2 BTC exhausts it at 9,901 MUSD. The vAMM loses 8% on a 0.05 BTC sale.
  - Clean depth within Morpho's 4.38% liquidation incentive is ≈0.10–0.12 BTC (≈$8–10k).
- **Value is stranded.** 5.70 BTC sits unclaimed in CollSurplusPool across 27 accounts whose troves were redeemed.

## 3. Mechanism, step by step

1. **Open.** The user calls `factory.openAndBorrow{value: btc}(musdOut, maxLtvBps)`.
   - The factory deploys, or reuses, the caller's BorrowAccount: an EIP-1167 clone at a CREATE2 address salted by the owner.
   - The clone wraps the BTC 1:1 into **brBTC**, calls `Morpho.supplyCollateral(M1, amt, clone, "")`, then `Morpho.borrow(M1, musdOut, 0, clone, owner)`.
   - Before borrowing, it checks four limits: post-borrow LTV ≤ min(maxLtv, opening ceiling); collateral ≤ the per-position cap; M1 `totalBorrowAssets` (after `accrueInterest`) ≤ the global borrow cap; borrowing is not paused.
   - A 0.10% origination fee, the same as the trove issuance fee, goes to the FeeRouter.
2. **Lend.** MUSD deposited into **vMUSD** (a Vault V2) flows through its liquidity adapter into **wsMUSD**. Idle cash earns the sMUSD rate and can be withdrawn instantly.
   - A permissionless allocator always keeps a buffer of max(2k MUSD, 15% of M1 supply) in M1, so borrowers can always borrow.
   - Beyond the buffer, it moves more cash into M1 only while M1's supply APY beats wsMUSD's 7-day APY, and only within Vault V2 caps.
3. **Save.** **wsMUSD** takes MUSD by permit, deposits it into sMUSD, and syncs yield on every interaction.
4. **Liquidate with zero capital.** Anyone can call `FlashLiquidator.liquidate(borrower)`.
   - It calls `Morpho.liquidate(M1, borrower, seized, 0, data)`.
   - Inside `onMorphoLiquidate` it unwraps the brBTC and sells the BTC to the best of three buyers: the **Backstop** (Skip price less half the incentive), CL200, or the vAMM. The sale must stay within a price-impact bound measured against Skip.
   - Morpho then pulls the repaid MUSD.
   - The liquidation incentive is 4.38% at LLTV 0.86 and 7.4% at LLTV 0.77.
5. **Backstop.** bMUSD depositors supply MUSD, parked in wsMUSD, that buys seized BTC at a discount anchored to the oracle. Liquidations can therefore clear even when DEX depth cannot absorb them. The backstop sells its BTC through a permissionless Dutch auction and keeper sales with bounded price impact.
6. **Exit.** `repayAndWithdraw(permit)` repays in full, withdraws the brBTC, unwraps it, and sends native BTC to the owner, all in one transaction. Morpho skips the oracle when a position has no debt, so this exit works even if the oracle is frozen.
7. **Credit lines (grafted from Tab).**
   - The owner calls `approveCredit(spender, {maxOutstanding, periodLimit, period, maxLtvBps, expiry, recipient})`, or signs the EIP-712 version (ECDSA or EIP-1271, so Safes can grant credit).
   - The spender calls `draw(amount)`, and MUSD goes only to the locked recipient.
   - Spenders have no code path to the collateral. `revokeCredit` takes effect immediately.
8. **Come back.** This flow serves the 27 accounts whose troves were redeemed.
   - The UI reads `CollSurplusPool.getCollateral(user)`.
   - The user's EOA signs an EIP-712 ClaimCollateral whose recipient is its own BorrowAccount address, which can be computed before the clone exists.
   - The factory deploys the clone and calls `claimCollateralWithSignature`. The BTC lands in the clone, is counted by balance change, then wrapped and supplied. The user can optionally borrow against it.
   - Safe owners call `BorrowerOperations.claimCollateral()` themselves and then open a position.
9. **Fees.** The FeeRouter splits fees three ways:
   - 40% donated to sMUSD via `receiveProtocolYield`;
   - 40% posted as MUSD incentives on the BTC/MUSD pool gauges;
   - 20% to a treasury for keeper gas and audits.

## 4. Architecture

1. **wsMUSD** (immutable ERC-4626).
   - **Accounting:** assets are tracked internally, not by `balanceOf`, so donations cannot move the share price. Dead shares are minted at deploy. It has 18 decimals with no offset, so oracles scale correctly.
   - **Sync:** every deposit and redeem first runs `PCV.distributeMUSD()` in try/catch. It then calls `sMUSD.claimYield()` when pending yield, `claimableYield(this) + balance × (yieldIndex − supplyYieldIndex(this))/1e18`, exceeds dust, and re-deposits.
   - **Vesting:** synced yield vests linearly over 3 days, starting from the previous sync. The keeper syncs hourly.
   - **Exits:** `sMUSD.withdraw()` (which auto-claims yield), or `redeemInKind()`, which returns sMUSD plus vested MUSD.
   - **Never stakes** in VaultGauge `0x6778…a401`.
   - **Admin power:** only raising the deposit cap (250k at launch), behind a 72 h timelock. It cannot pause and cannot lower the cap.
   - **Touches:** sMUSD `0xb4D4…51CC` (`deposit`, `withdraw`, `claimYield`, `claimableYield`, `yieldIndex`, `supplyYieldIndex`), PCV `0x391E…B993`, and MUSD `permit`.
2. **BtcMusdOracle** (immutable Morpho IOracle).
   - **Primary price:** Skip `0x7b7c…0015` `latestRoundData`. It requires answer > 0 and `updatedAt` ≥ now − 60 s, the same bound `PriceFeed` uses. `answeredInRound` is ignored because Skip returns 0.
   - **Sanity band:** Pyth `0x5D28…` BTC (`0xe62d…5b43`) only acts as a ±10% band, and only while it is ≤3,900 s old.
   - **MUSD leg:** Pyth MUSD (`0x0617…c6de`, ≤3,900 s old) clamped to [1.00, 1.02], or 1.00 if stale. So BTC is never valued above its USD price in MUSD terms.
   - Testnet uses Pyth `0x933a…`.
   - We offer the staleness check to Mezo's own BTC/mUSDC oracle as a drop-in.
3. **brBTC** (immutable gated collateral receipt).
   - Wraps native BTC 1:1.
   - Only BorrowAccounts registered by the immutable factories can mint. Any holder can unwrap.
   - Transfers are allowed only out of Morpho, or from a BorrowAccount into Morpho. That turns our router's limits into market-wide limits on a Morpho market that otherwise cannot restrict who borrows.
   - The sentinel can pause minting and nothing else.
   - Native BTC and the `0x7b7C…0000` precompile share one balance, so accounting uses totalSupply and never counts both views.
4. **M1.** Created with `Morpho.createMarket({MUSD, brBTC, BtcMusdOracle, AdaptiveCurveIrm 0x3760…c1e7, 0.86e18})` on `0x5658…A311`. On testnet it uses `0xCe1d…5a73` with IRM `0x0c97…7441` at 0.77e18. These are the only LLTVs enabled on each network.
5. **BorrowAccount and factory** (immutable implementation).
   - Clones are owner-only. Nothing holds Morpho authorization over users.
   - Morpho calls: `supplyCollateral`, `borrow`, `repay`, `withdrawCollateral`, `accrueInterest`, `market`.
   - MUSD: `permit` for EOAs, `approve` for Safes (MUSD's permit only accepts plain ECDSA signatures).
   - Claims: BorrowerOperationsSignatures `0xB57a…df7a` (`claimCollateralWithSignature`, `getNonce`) and CollSurplusPool `0xBF51…F491` (`getCollateral`).
   - A clearly labelled **CanaryFactory** reuses the same implementation with a ceiling of LLTV − 0.25 pt and a 0.002 BTC position cap, so a liquidation can always be demonstrated live.
6. **vMUSD.** A Vault V2 created with `VaultV2Factory.createVaultV2` (`0xA64f…`; testnet `0x25eB…`), on the template of Mezo's USDC Lending Vault `0x0629…`.
   - Mezo's adapter factory is an EOA, so we deploy adapters from Morpho's GPL source:
     - MorphoMarketV1AdapterV2 for M1;
     - a variant of MorphoVaultV1Adapter over wsMUSD as the liquidity adapter. It deposits `min(assets, wsMUSD.maxDeposit)` and leaves the rest idle, so a full wsMUSD can never block vMUSD deposits.
   - Fees are 0, and `maxRate` is set at deploy.
   - Caps on the wsMUSD adapter id are at least the vault's own cap.
   - `forceDeallocate` gives depositors an in-kind exit.
7. **BaserateAllocator** (permissionless; holds the allocator role). `rebalance()` computes targets from Morpho state, `IRM.borrowRateView` and wsMUSD price checkpoints. It moves a bounded amount per call and has no discretion.
8. **FlashLiquidator** (permissionless). Uses:
   - `Morpho.liquidate` with the `onMorphoLiquidate` callback;
   - `brBTC.unwrap`;
   - CLSwapRouter `0x37cD…6225` `exactInputSingle` (tickSpacing 200) on CL200 `0x9CBc…5022`;
   - Router `0x16A7…C706` `swapExactTokensForTokens(Route[])` on the vAMM `0x52e6…cefb`;
   - `Backstop.buyCollateral`.
9. **Backstop (bMUSD).** Built natively for Morpho. Its pricing is adapted from thUSD's MIT-licensed `BAMM.sol`, which we credit.
   - Withdrawals queue for 7 days and pay the lower of NAV at request and NAV at claim.
   - Liquidation premiums vest over 7 days.
   - BTC inventory is marked at Skip × 0.95.
   - Together these stop just-in-time deposits from capturing premiums and stop exits ahead of a loss.
10. **FeeRouter** (immutable splits).
    - Calls sMUSD `receiveProtocolYield`, skipping amounts small enough to trigger its `AmountTooSmall` revert.
    - Calls `BribeVotingReward.notifyRewardAmount(MUSD, x)` on the CL200 gauge `0x21d7…209E` (bribe `0x80cC…0e1a`) and the vAMM gauge `0x8Be2…9AaF` (bribe `0x94A9…E305`). Both are alive with MUSD whitelisted (read today).
    - If a gauge is killed, its share goes to sMUSD instead (Halborn finding 7.4).
11. **RiskLens** (read-only; grafted from Par's PegLens). Reports:
    - MUSD price (Pyth plus the CL10 `0xCC37…` `observe` TWAP);
    - clean depth (QuoterV2 `0x4e56…` on CL200, `Router.getAmountsOut` on the vAMM);
    - how caps are derived;
    - oracle ages;
    - backstop solvency;
    - a comparison with the trove redemption queue (`SortedTroves.getLast/getPrev`, `TroveManager.getCurrentICR`), which feeds the "redemption risk" column.
12. **Keeper** (open source; every action is permissionless). It runs wsMUSD syncs, the allocator, liquidations, the cap script, canaries, a watcher for sMUSD upgrades, and a clearly labelled testnet yield simulator. We also ship a **Goldsky subgraph** and a **TypeScript SDK**, because Morpho's API does not index chain 31612.
13. **Strategy packet** (governance-gated, fork-only, not in the demo).
    - BufferedLendingStrategy implements `IVaultStrategy`.
    - It supplies M1 directly and never calls sMUSD, vMUSD or wsMUSD, so it cannot re-enter sMUSD's `nonReentrant` deposit and withdraw.
    - `claimYield` uses try/catch and returns 0 when below a dust floor or when funds are illiquid.
    - Its idle buffer is at least its allocation, its size is capped at or below M1's cap, and first-loss cover is at least its exposure.
    - It is fork-tested against the sMUSD implementation `0xb33c…9e87` and delivered to multisig `0x98D8…7C7a` as a design note.

## 5. Composable outputs

- **wsMUSD:** the first ERC-4626 over sMUSD tested against the live contract on a mainnet fork. It can serve as collateral, an LP asset, a vault floor or a PT/YT base.
- **vMUSD:** a Vault V2 MUSD lending share. It is structurally eligible for a vault gauge, exactly like the USDC Lending Vault.
- **bMUSD:** liquidation-backstop shares.
- **The M1 market:** anyone can supply, liquidate or curate. Its idle MUSD is Mezo's first fee-free MUSD flash liquidity, via `Morpho.flashLoan` (the MUSD token itself has no ERC-3156 flash loans).
- **Reusable pieces:**
  - BtcMusdOracle;
  - `ICreditLine.draw()`, one call for any app, agent or card processor;
  - the come-back claim primitive;
  - FlashLiquidator;
  - RiskLens;
  - the SDK and subgraph.

## 6. Mezo Earn integration

**Permissionless now**
- **Incentives for the liquidation venues.**
  - The FeeRouter posts MUSD on the BTC/MUSD CL200 gauge (386.2 of 1,479.3 vote units; ≈474k MEZO/week of emissions) and the vAMM gauge (241.6 units).
  - veBTC voters earn MUSD for steering MEZO emissions to the pools that liquidate Baserate's collateral. This is Luongo's "a market that wants supply can post incentives to attract veBTC votes", applied to liquidation depth.
  - To be clear: these pools already draw ≈$2.2k/week of MEZO yet hold only ≈$10k of MUSD on CL200. The incentives complement the backstop; they do not replace it [I].
  - On testnet the same call targets the MUSD/BTC vAMM gauge `0x72D8…Cd2c` (bribe `0x75b6…0ee1`; MUSD whitelisted, read today), so judges can watch a real bribe land.
- **sMUSD donations.** ≈72% of each donation accrues to the VaultGauge and reaches veBTC voters through FeesVotingReward `0x33b8…`.
- **Faster fee flow.** wsMUSD syncs call `PCV.distributeMUSD()`, so protocol fees reach sMUSD sooner.
- **TVL in Mezo's own vault.** Every MUSD lent through vMUSD sits in sMUSD until it is borrowed.

**Governance-gated later.** These are requests to multisig `0x98D8…7C7a`, each with a fallback:
- (a) **Vault gauge for vMUSD:** `createVaultGauge` through Mezo's ERC4626VaultAdapter, as for the USDC Lending Vault (`0xd3f6…`, gauge `0x11E9…`). Lenders would earn MEZO and vMUSD interest would go to veBTC voters. Fallback: the fee-funded incentives above.
- (b) **Morpho fee switch on M1:** `setFeeRecipient`, then `setFee` (≤25%), paid to sMUSD. This is revenue for Mezo, not for us.
- (c) **Whitelist wsMUSD on PoolsVoter,** so it can have pool gauges and be used for bribes.
- (d) **`sMUSD.setStrategy`** with the strategy packet, after an audit.
- (e) **A lending-gauge sidecar (Phase 3).**
  - veBTC holders vote on how vMUSD is split across curator-approved markets, within caps.
  - Votes are keyed by tokenId, voting power is read at the start of each epoch, and the sidecar never takes custody of the NFT.
  - Voters earn a share of interest that vests over 4 epochs; bad debt forfeits it.
  - It moves onto a native vault gauge if Mezo creates one.

## 7. Security design

- **Oracles:** as described in §4. If Skip and a fresh Pyth price disagree by more than 10%, the oracle reverts. In the worst case this freezes the market for ≈65 min, until Pyth updates or ages past 3,900 s. We disclose this, and the oracle-free exit (repay all, then withdraw) always works.
- **Caps at mainnet launch:**
  - ≤0.05 BTC of collateral per position;
  - opening LTV ≤71%;
  - M1 borrow cap, and vMUSD's allocation to M1: min(2 × free backstop MUSD, free backstop MUSD + clean depth at 4% price impact, taking the lowest reading of the past 24 h). This starts at 5k with a hard ceiling of 10k during Wave 2;
  - vMUSD 50k; wsMUSD 250k; outside backstop deposits 25k;
  - credit lines: ≤250 MUSD outstanding per account and ≤50 MUSD/day per spender.

  The cap script lowers caps instantly whenever CL200's MUSD side shrinks.
- **Pause scope:** a 2-of-3 Safe acts as sentinel.
  - It can pause brBTC mints, new borrows and credit draws, cut caps, and pull funds out of M1.
  - It can never block repay, withdraw, unwrap, redeem, liquidation or the backstop queue.
  - Cutting caps does not shrink existing loans, and the UI says so.
- **Roles and timelocks:**
  - Immutable: wsMUSD, the oracle, brBTC, the BorrowAccount implementation, the FlashLiquidator and the FeeRouter.
  - Raises wait 48 h (Vault V2 curator actions; factory caps) or 72 h (wsMUSD). Decreases are instant.
  - No proxies, no ERC-2771 or MezoForwarder, no `tx.origin`. sMUSD still trusts MezoForwarder, but the forwarder requires an ECDSA signature from `from`, so a contract caller such as wsMUSD cannot be impersonated.
- **Invariants.** Foundry fuzz and invariant suites run on a pinned mainnet fork and on a testnet fork. They check that:
  - wsMUSD assets ≥ claims, and its share price never falls;
  - brBTC supply ≤ BTC held, and only registered clones can mint;
  - clones hold no MUSD after any call;
  - LTV after any open or draw ≤ the ceiling;
  - M1 borrows ≤ the global cap;
  - each spender's outstanding ≤ its allowance, and revoked spenders cannot draw;
  - backstop share value changes only on realized PnL;
  - the strategy's `claimYield` never reverts.
- **Scenario tests:**
  - a Skip outage;
  - stale or divergent Pyth prices;
  - an sMUSD upgrade;
  - Enclave A unwinding its 5.25M sMUSD and 5.26M of CL liquidity;
  - M1 at 100% utilization;
  - bad debt;
  - Mezo's limit of 20 precompile calls per transaction.
- **Process:**
  - Slither and Aderyn;
  - an AI audit with a public findings ledger;
  - a written threat model;
  - verified source on Blockscout and Sourcify;
  - CI;
  - a check that no secrets ship in front-end bundles.

## 8. Judge journey on testnet (≈5 minutes, faucet funds only)

1. Connect an EVM wallet and take 0.001 test BTC (≈$81) from the faucet.
2. **Borrow.** One transaction, with the BTC sent as `msg.value`, returns ≈40 MUSD (50% LTV against LLTV 0.77). The position card shows LTV, liquidation price, Skip and Pyth ages, the 7.4% incentive, and "Redemption risk: none".
3. **Lend.** Claim 100 MUSD from the dispenser and deposit it into vMUSD. Watch the split between M1 and wsMUSD, and both APYs.
4. **Save.** Deposit into wsMUSD and see the share price and pending yield.
5. **Credit line.** Give the demo agent 5 MUSD/day. It pays an x402 endpoint on eip155:31611, is refused at 5.01, and stops the moment it is revoked. A direct-transfer fallback covers the case where the third-party x402 facilitator is down.
6. **Liquidate.** RiskLens lists canary positions that can be liquidated. One click on the FlashLiquidator shows the caller's profit, with lenders made whole.
7. **Exit.** `repayAndWithdraw` returns the BTC natively in one transaction.
8. **Evidence tab.** Mainnet transactions, fork-test reports and the audit ledger.

**What we provide:**
- **Test MUSD:** 3–5k for M1, vMUSD and the backstop. We will request a DevRel grant; the fallback is faucet BTC swapped on pool `0xd16A…` at ≈78.65 MUSD per drip.
- **A dispenser:** 100 MUSD per address per day.
- **The keeper.** Testnet sMUSD has pcv = 0, so the keeper makes labelled `receiveProtocolYield` donations sized to mainnet's realized rate.
- **Canary positions** that real Skip price moves push past the liquidation line.
- **A quoter path.** QuoterV2 has no code on testnet, so depth comes from the vAMM through the Router, and caps are fixed and labelled.
- **The demo agent and an x402 test server.**

The come-back flow is a mainnet feature. The scanner works on any address, and the claim is shown live or on a fork, clearly labelled.

## 9. Mainnet with caps

- **Wave 2, week 1:** deploy and verify wsMUSD, the oracle, brBTC, both factories, M1 (LLTV 0.86), vMUSD, the allocator, the FlashLiquidator, the Backstop, the FeeRouter and RiskLens.
- **Team seed:** ≈5k MUSD in the backstop and ≈5k in vMUSD, bought on Tigris, plus ≈0.05 BTC for team loans and one canary.
- **Evidence by Nov 15:**
  - a real `openAndBorrow` with BTC as `msg.value`;
  - a `repayAndWithdraw`;
  - a FlashLiquidator liquidation of the team canary;
  - an allocator move;
  - wsMUSD syncs;
  - the first FeeRouter bribe on the CL200 gauge, and an sMUSD donation;
  - a cap cut.
- **During judging:** the keeper runs throughout. The epoch flip on Thursday Nov 19 makes the bribe claimable by voters while judges are watching.
- **Credit lines** launch with ≤250 MUSD per account. x402 runs on mainnet only with `@x402/evm` ≥2.15; otherwise it stays on testnet, labelled.
- **Cap increases** after the hackathon follow backstop size and measured depth, never the calendar.

## 10. Cross-chain plan

None in Wave 2, deliberately:
- judges discount depth that lives off Mezo;
- two-network flows depend on relayers;
- Portside's red flags (tolerating 6 h-old prices, a lopsided Aero pool) would put MUSD's peg at risk.

Phase 3, after the hackathon, is a Portside-style Base Morpho market:
- USDC credit against MUSD collateral;
- priced by a Wormhole relay of Mezo's Pyth feed plus TWAPs;
- fees looped back into sMUSD.

It ships only after an audit and after Mezo confirms that its Pyth pusher will keep running.

## 11. Business model and go-to-market

**Who pays.**
- Borrowers pay adaptive interest plus the 0.10% origination fee. For reference, the same IRM's rate at target has drifted to 3.54% on Mezo's USDC market.
- In return they get no redemption exposure, no minimum, and a 4.38% liquidation incentive instead of a trove liquidation.
- Apps may charge their own fees on credit-line draws.

**Who earns.**
- vMUSD lenders earn borrower interest on lent cash and the sMUSD rate on idle cash, with a 0% fee at launch. They carry M1 credit risk, bounded by the caps.
- bMUSD holders earn liquidation premiums.
- The fee splits feed sMUSD and veBTC voters.

**Honest scale.**
- A 5k cap at 3.5% yields ≈$175/yr. Fees will not fund the team during the hackathon.
- At MEZO ≈$0.003, Ignition (25k MEZO) and Founder (50k MEZO) grants are worth ≈$74 and ≈$148.
- Replacing the sMUSD gauge's 10k MUSD/week would take ≈$18–20M of borrowing, against ≈$10–25k that depth supports today. Baserate does not claim to fix the yield cliff; it restores the lending primitive.

**Target [I].** Within 6 months of an audit: 20–30 borrowers and $250–500k of M1 credit, gated on depth.
- The old trove book (6.03M MUSD across 104 borrowers at 1%) shows that demand once existed.
- The USDC market (16 borrowers, $66k) is the realistic floor.
- At scale the curator takes 10% of M1 interest only, once a vault gauge exists.

**Go-to-market.**
1. **Borrowers whose troves were redeemed:** 146 accounts have ever had surplus BTC, and 27 still hold 5.70 BTC unclaimed. Reach them through the scanner and the come-back flow.
2. **Apps that need MUSD without holding a balance:** the 13+ payment entries and 6 x402 entries, through `draw()`.
3. **Lenders:** veBTC voters paid in MUSD every week, and unstaked sMUSD (2.07M, of which 2.0M sits in one Safe).
4. **Mezo:** the vault gauge, the fee switch, the strategy packet, and an app listing.
5. **Morpho liquidators and curators,** through the SDK.

## 12. Why it beats the top competitors

- **Pylon (mainnet):** its loops open troves, which sit first in the mainnet redemption queue, and its reserve holds 10.14 MUSD. Baserate has no queue, and its mainnet evidence is a real loan and a real liquidation on Mezo's official Morpho.
- **mbLP:** the composability template, but trove-based and testnet-only, and its LP adds MUSD to the sell side. Baserate composes Morpho, Vault V2, sMUSD, Tigris depth and PoolsVoter on mainnet, and outputs three ERC-4626 tokens.
- **Mezodot:** ≈111 KB of custom, unaudited lending code on testnet. Baserate writes no lending engine.
- **Lockwatch:** strong automation for veBTC/veMEZO locks, but its MUSD path opens a trove when a lock expires, which joins the redemption queue. Baserate targets the brief's top two gaps.
- **Cosign (not yet submitted):** MEZO collateral, an AdminOracle, and its own testnet Morpho. Baserate uses BTC collateral, a guarded oracle and Mezo's official Morpho.
- **Mezo Flow, MUSD Yield Vault, Morbit:** one sMUSD wrapper tested only against a mock, and two Stability Pool wrappers (the pool has seen 28 liquidations ever). wsMUSD is tested on a mainnet fork and composed into other products.
- **Keel, Payung, Thaw, Latch:** built on troves or veBTC, so they face the redemption queue or a tiny market.
- **Mezo itself:** if Mezo ships its own MUSD market, it will run on the same stack, so vMUSD can allocate into it.

## 13. Risks and mitigations

1. **Weak borrow demand.** MUSD trades at 0.989, and the mUSDC bid is only ≈$14k.
   - Credit lines spend MUSD at par instead of selling it.
   - The redeemed-out borrowers are a ready audience.
   - There is no minimum loan size.
   - We size every claim honestly.
2. **Thin liquidation depth.**
   - brBTC enforces per-position limits.
   - Caps are tied to measured depth and backstop size.
   - Liquidation needs zero capital.
   - The backstop's BTC inventory risk is disclosed.
3. **Oracle freeze.** Disclosed, and the oracle-free exit always works.
4. **sMUSD is an upgradeable proxy.** A 4-of-7 multisig controls it, it has been upgraded 5 times, and there is no timelock.
   - An in-kind exit returns sMUSD itself.
   - An upgrade watcher cuts caps on any change.
   - wsMUSD itself is immutable.
5. **Enclave A moves.** Enclave A's veBTC #6114 is a rolling lock whose next end date is Nov 12. Mitigated by fork tests of its unwind, and by caps.
6. **Competition, or Mezo making sMUSD natively ERC-4626.** Mitigated by narrowly scoped claims and by Mezo being able to adopt Baserate through configuration.
7. **Scope.** If time runs short, we cut in this order:
   1. credit lines;
   2. outside deposits into the backstop;
   3. the come-back flow.

   A go/no-go check on Nov 13 decides. Anything not finished is listed as planned and is never shown.
8. **Testnet funding.** We ask DevRel for test MUSD and fall back to the faucet.

## 14. Milestones

- **Wave 1 slice (by 2026-10-26 15:00 UTC):**
  - on testnet: wsMUSD, the oracle, brBTC, M1, `openAndBorrow`, `repayAndWithdraw` and a minimal UI;
  - mainnet-fork tests against sMUSD `0xb33c…` and Morpho `0x5658…`;
  - one real borrow with BTC as `msg.value` on the evidence page;
  - a table separating what is built from what is planned.
- **Oct 27–Nov 1:** send the DevRel request, and read Wave 1's per-criterion scores from the API.
- **Wave 2:**
  - Nov 2–5: vMUSD, adapters, allocator, backstop, FlashLiquidator, FeeRouter, RiskLens, invariant suites.
  - Nov 6–8: mainnet deploy and the first real loop.
  - Nov 9–12: credit lines and the agent, the come-back flow, AI audit round 1, the first bribe.
  - Nov 13–15: go/no-go, canary liquidation, AI audit round 2, video, deck, and a criterion-by-criterion account of what changed.
- **After the hackathon:**
  - a third-party audit, then a Mezo Market listing (which requires an audit, a live mainnet deployment and MUSD integration);
  - an Ignition grant (≤25k MEZO, paid on testnet and mainnet milestones), then a Founder grant (≤50k MEZO; requires mainnet, MUSD as a medium of exchange, audit-readiness and a roadmap of at least 3 months);
  - governance requests (a)–(e) from §6;
  - cap growth;
  - the Phase 3 lending gauge;
  - vMUSD lending into more curator-approved markets, for example a veBTC market on Lockstep's redesigned terms;
  - Base.

## 15. Two-minute demo script

- **0:00–0:15.** "104 troves became 1. MUSD trades below its redemption floor, so every new trove is first in line to be redeemed. Mezo's Morpho holds zero MUSD."
- **0:15–0:45.** A fresh wallet with 0.001 faucet BTC borrows 40 MUSD in one transaction. The explorer shows BTC sent as `msg.value`, and the position card reads "Redemption risk: none".
- **0:45–1:05.** Deposit 100 MUSD into vMUSD. The split shows idle cash in wsMUSD earning the savings rate.
- **1:05–1:25.** The RiskLens depth panel shows 0.1 BTC of clean depth and how the caps follow from it. A one-click canary liquidation pays its caller, and lenders are made whole.
- **1:25–1:40.** The agent spends its 5 MUSD/day, is refused at 5.01, and is revoked.
- **1:40–1:55.** Mainnet evidence: the loan, repayment and liquidation on `0x5658…`, the CL200 bribe, and verified source.
- **1:55–2:00.** "Mezo's rails, Mezo's market. Adopt it by configuration."

## Red-team fixes applied

- **Strategy:** removed from the demo's climax, and redesigned to supply M1 directly without ever re-entering sMUSD.
- **Real limits:** brBTC gating and a global borrow cap make position limits apply to the whole market, not just our router.
- **Caps:** resized to measured depth (9,956 MUSD on CL200).
- **vMUSD deposit DoS:**
  - an adapter that deposits only up to wsMUSD's remaining capacity;
  - a wsMUSD cap well above every cap that depends on it;
  - no pause on wsMUSD;
  - `maxRate` set at deploy.
- **Fees and claims:** a 0% performance fee, and the claim that "lenders lose nothing" dropped.
- **Cut to the roadmap:** M2 and EscapeHatch.
- **Backstop:** rebuilt with a withdrawal cooldown, vested premiums, and exits paid at the lower of the two NAVs.
- **Liquidation:** the zero-capital flash liquidator is now the primary path.
- **Signed claims:** paid only to the user's own clone, and counted by balance change.
- **Added:** an in-kind exit, the upgrade watcher, the allocator's standing buffer, and a yield sync on every interaction.
- **Honest claims:** "first" claims narrowed; the 16-borrower baseline and the oracle freeze disclosed.
- **Evidence and demo:** a mainnet canary liquidation added, and the testnet demo sized to 3–5k test MUSD.
