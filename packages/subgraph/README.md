# @baserate/subgraph

The Baserate subgraph for Mezo testnet (chain 31611, Goldsky network slug `mezo-testnet`). It indexes every Baserate
contract plus M1 on Mezo's Morpho Blue, so the web app can read history in one GraphQL request instead of scanning
logs in 10,000-block windows.

Built with `@graphprotocol/graph-cli` 0.98.1 and `@graphprotocol/graph-ts` 0.38.2 (specVersion 1.0.0, mapping
apiVersion 0.0.9).

## What it indexes

| Data source                | Start block | Events                                                                                                                                                                 |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BorrowAccountFactory`     | 16380364    | AccountCreated (creates a `BorrowAccount` template per clone), ComeBack, timelock Submitted / Revoked / Accepted / PendingInvalidated, every parameter and role event  |
| `BorrowAccount` (template) | per clone   | Opened, Borrowed (incl. origination fee and LTV), Repaid, Exited, CollateralAdded, CollateralWithdrawn, Swept                                                          |
| `Morpho` (M1 only)         | 16380365    | CreateMarket, Supply, Withdraw, Borrow, Repay, SupplyCollateral, WithdrawCollateral, Liquidate, AccrueInterest. Mezo's Morpho hosts other markets; handlers skip them. |
| `WsMUSD`                   | 16380361    | Deposit, Withdraw, RedeemedInKind, Synced, CapRaiseSubmitted / CapRaised / CapRaiseRevoked                                                                             |
| `VMUSD` (Morpho Vault V2)  | 16380419    | Deposit, Withdraw, AccrueInterest, Allocate, Deallocate, ForceDeallocate                                                                                               |
| `BaserateAllocator`        | 16380426    | Rebalanced, CheckpointRecorded, IdleAllocated, MarketLiquidityPulled                                                                                                   |
| `Backstop`                 | 16380382    | Deposit, Checkpoint, CollateralBought, RedeemRequested, RedeemClaimed, RedeemPartiallyClaimed, AuctionTaken, InventorySold, DepositsPausedSet                          |
| `FlashLiquidator`          | 16380383    | Liquidated (joined to the Morpho Liquidate it follows in the same transaction), NativeKept, NativeSwept                                                                |
| `FeeRouter`                | 16380398    | Distributed, BribePosted, BribeRedirected, BribeCarried, SmusdYieldDeferred, SmusdYieldFailed, SmusdShareToTreasury                                                    |

Start blocks are the contracts' deploy blocks (`packages/sdk/src/deployments/31611.json`); Morpho starts at M1's
CreateMarket block. `pnpm check-config` verifies addresses, start blocks, the network and `src/config.ts` against
that registry (and `contracts/deployments/31611.json`); `pnpm build` runs it first.

WsMusdLiquidityAdapter is not a data source (its address only labels vMUSD's allocations), so its rescue events
(RescueSubmitted / RescueRevoked / RescueUnwound / RescuedInKind) are not indexed.

### After a redeploy

Once `packages/sdk/src/deployments/31611.json` holds the new addresses and deploy blocks, one command rewrites every
data source's `address` and `startBlock` in `subgraph.yaml` and the constants in `src/config.ts` from it, then runs the
same check:

```sh
pnpm --filter @baserate/subgraph sync-config     # = check-config --write
```

Morpho's start block is `markets.M1.block` when the registry has one, 16380365 for today's M1 (v2), and otherwise the
factory's deploy block (the deploy script creates M1 right after the factory, in the same broadcast). Then update the
start blocks in the table above, `pnpm --filter @baserate/subgraph build`, and deploy under a new version (below). The unit tests read M1, wsMUSD and
the M1 adapter from `src/config.ts`, so they keep passing after a sync.

### Entities

Aggregates (mutable):

- `Protocol` (id `baserate`): account and open-position counts, MUSD borrowed / repaid, origination fees,
  liquidations and liquidator profit, FeeRouter totals, and the factory's current fee recipient, global borrow cap,
  pause flags, governor and sentinel. `ProfileLimit` holds the per-profile position cap and LTV ceiling.
- `Account`: a BorrowAccount clone with its owner, profile, M1 `collateral` and `borrowShares` (replayed from Morpho's
  events, so they equal `Morpho.position(M1, account)` at every block), lifetime borrowed / repaid / fees and its
  `actions`, `marketEvents` and `liquidations`.
- `Market`: M1's params and totals (supply / borrow assets and shares, collateral, utilization, last borrow rate,
  interest), mirroring `Morpho.market(M1)`, plus `MarketDailySnapshot` (end-of-day state and the day's volumes).
- `Vault` for wsMUSD, vMUSD and the backstop: supply, total assets, latest share price, flow counts and totals, and
  per-kind state (vesting, backstop inventory and reserved exits, vMUSD fee shares). `SharePricePoint` keeps at most
  one share-price observation per vault per block.
- `RedeemRequest`: a backstop exit. A claim that cash cannot cover pays what there is (RedeemClaimed) and keeps the rest
  queued (RedeemPartiallyClaimed), so a request stays open across partial payments: `status` (PENDING,
  PARTIALLY_CLAIMED, CLAIMED), `sharesLeft` / `assetsLeft` (the contract's `redeemRequest(id)`), `paidAssets`,
  `burnedShares`, `claimCount`, and each payment as a VaultFlow in `payments`. `shares` / `assets` stay the original
  request; `claimed` and `claimedAssets` (total paid) are set only by the final payment.
- `TimelockSubmission`: a queued factory call and how it ended (ACCEPTED, REVOKED, INVALIDATED by a decrease of the same
  parameter, or EXPIRED). It is executable from `executableAt` until `expiresAt` (+14 days); a PENDING submission
  past `expiresAt` has expired (it is marked EXPIRED only when the same call is resubmitted or its parameter is cut).

Events (immutable): `AccountAction` (incl. SWEPT), `MarketEvent`, `Liquidation` (mutable only so FlashLiquidator can
add venue, proceeds, profit and `nativeKept`), `FlashLiquidatorNative` (NativeKept / NativeSwept), `VaultFlow`,
`WsMusdSync`, `VaultAllocation`, `Rebalance`, `AllocatorFlow`, `AllocatorCheckpoint`, `BackstopTrade`,
`Distribution` (id = transaction hash) with its `Bribe`s (posted or redirected) and `BribeCarry`s, and
`GovernanceEvent` (parameter and role changes on the factory, wsMUSD and the backstop, incl. TIMELOCK_INVALIDATED).

`Distribution` follows the FeeRouter's `total == toSmusd + toBribes + toTreasury + retained`: `toSmusd` is what sMUSD
actually took, `toTreasury` includes `smusdToTreasury` (the sMUSD leg paid to the treasury once sMUSD has failed past
its grace period), and `retained` is `bribesCarried + smusdCarried`; `smusdOutcome` says what happened to the sMUSD leg
(NONE, DONATED, DEFERRED, FAILED, TO_TREASURY). `Protocol` adds `totalSmusdToTreasury`, `feeRouterCarried` (the last
`retained`) and `smusdFailingSince` (0 while sMUSD is healthy).

Share prices come from events only (no eth_calls): vMUSD replays Vault V2's stored total assets and fee shares
exactly; the backstop uses each Checkpoint's book over the supply; wsMUSD uses each flow's assets / shares (exact up to
one wei of share rounding), the stored assets right after a Synced, and BaserateAllocator's checkpoints (which record
wsMUSD's `convertToAssets(1e18)`).

## Commands

```sh
pnpm install                                  # from the repo root
pnpm --filter @baserate/subgraph build        # check-config, graph codegen, graph build → build/
pnpm --filter @baserate/subgraph test:unit    # matchstick unit tests (downloads the matchstick 0.6.0 binary once)
pnpm --filter @baserate/subgraph abis         # refresh abis/ from a forge build (see scripts/extract-abis.mjs)
pnpm --filter @baserate/subgraph sync-config  # rewrite addresses / start blocks from the SDK registry, then check
```

`abis/` holds the event fragments of each contract's ABI (the mappings make no contract calls). To refresh them after
a contract change, build into a separate out dir and extract:

```sh
cd contracts && FOUNDRY_OUT=out-subgraph FOUNDRY_CACHE_PATH=cache-subgraph forge build \
  src/account/BorrowAccountFactory.sol src/account/BorrowAccount.sol src/savings/WsMUSD.sol \
  src/vault/BaserateAllocator.sol src/liquidation/Backstop.sol src/liquidation/FlashLiquidator.sol \
  src/fees/FeeRouter.sol lib/morpho-blue/src/Morpho.sol lib/vault-v2/src/VaultV2.sol
cd .. && pnpm --filter @baserate/subgraph abis && ./node_modules/.bin/biome format --write packages/subgraph/abis
```

A full build in the default out dir works too: `cd contracts && forge build`, then
`pnpm --filter @baserate/subgraph abis ../../contracts/out` (the path is relative to `packages/subgraph`).

Morpho Blue compiles with solc 0.8.19, which leaves library events out of the contract ABI, so `abis/Morpho.json` is
morpho-blue's `EventsLib`.

The unit tests (`tests/`) replay mocked events through the handlers: M1 position and market replay, BorrowAccount
sweeps, the FlashLiquidator join, NativeKept / NativeSwept and bad debt, distributions with bribes, carries and the
sMUSD fallback, the backstop exit queue including a partial claim, vMUSD and wsMUSD share prices, rebalances and the
factory timelock (acceptance, PendingInvalidated, expiry). `assemblyscript` 0.19.23 is a direct dev dependency only because matchstick
looks for `node_modules/assemblyscript/bin/asc` inside this package.

## Deploy to Goldsky

```sh
goldsky login                                          # browser sign-in; saves ~/.goldsky/auth_token
pnpm --filter @baserate/subgraph deploy:goldsky        # builds, then deploys baserate-mezo-testnet/<package version>
pnpm --filter @baserate/subgraph tag:prod              # points the stable `prod` tag at that version
```

The Goldsky CLI never builds: it uploads `build/`, so `deploy:goldsky` runs `build` first (a stale `build/` would ship
old addresses). Goldsky prints the version's endpoint,
`https://api.goldsky.com/api/public/<project-id>/subgraphs/baserate-mezo-testnet/<version>/gn`. The web app uses the
tag's URL instead, `.../subgraphs/baserate-mezo-testnet/prod/gn`, which never changes. A deployed version can't be
overwritten, so bump `version` in `package.json` for each redeploy, deploy, wait until `goldsky subgraph list` shows it
synced, move `prod` (`tag:prod`), and only then delete the old version (`goldsky subgraph delete
baserate-mezo-testnet/<old> -f`; Goldsky refuses while a tag points at it). A paused version resumes with
`goldsky subgraph start baserate-mezo-testnet/<version>`.

## Web app

Set `BASERATE_PUBLIC_SUBGRAPH_URL` to the `prod` tag's endpoint in `apps/web/.env.production.local` (or the shell that
runs `pnpm --filter web build`): the site is built locally and Vercel only serves the files, so a Vercel dashboard
variable has no effect. The URL is public, never a secret, and
`https://api.goldsky.com` is already in the CSP `connect-src`. The history hooks (Lend "Recent moves", Fees
distributions and fee-switch submission, Liquidate accounts, backstop exit requests, the walkthrough's wsMUSD
deposit check) then read the subgraph, plus a log read of the few blocks it has not indexed yet. Unset, on a local
fork, or when a query fails, they read logs exactly as before.

## Example queries

Recent allocator moves (what the Lend page shows):

```graphql
{
  rebalances(first: 3, orderBy: blockNumber, orderDirection: desc, where: { actionId_gt: 0 }) {
    action amount m1SupplyApy wsMusdApy timestamp transactionHash
  }
}
```

An owner's accounts with their position history:

```graphql
query ($owner: Bytes!) {
  accounts(where: { owner: $owner }) {
    id profile collateral borrowShares isOpen totalBorrowed totalFeesPaid
    actions(orderBy: timestamp, orderDirection: desc, first: 20) {
      kind musd fee btc debtAfter ltvBps timestamp transactionHash
    }
    liquidations { seizedAssets repaidAssets venue profit timestamp }
  }
}
```

M1 utilization over time and the last liquidations:

```graphql
{
  marketDailySnapshots(orderBy: day, orderDirection: desc, first: 30) {
    day totalSupplyAssets totalBorrowAssets utilization borrowRate interest liquidations
  }
  liquidations(orderBy: timestamp, orderDirection: desc, first: 10) {
    borrower seizedAssets repaidAssets badDebtAssets viaFlashLiquidator venue proceeds profit transactionHash
  }
}
```

Fee distributions with their bribes and carries, and vault share prices:

```graphql
{
  distributions(orderBy: blockNumber, orderDirection: desc) {
    total toSmusd toBribes toTreasury retained epochStart timestamp
    bribesCarried smusdCarried smusdToTreasury smusdOutcome smusdFailingSince
    bribes { gauge bribe amount posted redirectReason }
    bribeCarries { gauge amount reason }
  }
  vaults { kind totalSupply totalAssets sharePrice }
  sharePricePoints(where: { vault: "0xdafcb2cd3e722f6fee7f70150be612f1d7af8124" }, orderBy: blockNumber, first: 1000) {
    sharePrice source timestamp
  }
}
```

An owner's backstop exits, open ones first, with every payment:

```graphql
query ($owner: Bytes!) {
  redeemRequests(where: { owner: $owner }, orderBy: requestId, orderDirection: desc) {
    requestId status shares assets sharesLeft assetsLeft paidAssets claimableAt receiver
    payments(orderBy: timestamp) { assets shares timestamp transactionHash }
  }
}
```

Factory calls that can still be executed (`$now`: current unix time):

```graphql
query ($now: BigInt!) {
  timelockSubmissions(where: { status: PENDING, expiresAt_gte: $now }) {
    selector data executableAt expiresAt transactionHash
  }
}
```

## AssemblyScript notes

The mappings compile with AssemblyScript 0.19 (graph-cli's compiler), whose semantics differ from TypeScript, which is
why `biome.json` here turns off four lint rules for `src/` and `tests/`:

- `==` compares strings by value; `===` is identity. Keep `==` (`noDoubleEquals` off).
- `x == null` crashes the compiler when `x` is a nullable `Bytes` or `BigInt` (classes that overload `==`); test them
  with `!x` (see `orZero` in `src/common.ts`).
- `import type` does not parse (`useImportType` off); graph-ts exports a `BigInt` class (`noShadowRestrictedNames`
  off); template literals are avoided (`useTemplate` off).
