# @baserate/subgraph

The Baserate subgraph for Mezo testnet (chain 31611, Goldsky network slug `mezo-testnet`). It indexes every Baserate
contract plus M1 on Mezo's Morpho Blue, so the web app can read history in one GraphQL request instead of scanning
logs in 10,000-block windows.

Built with `@graphprotocol/graph-cli` 0.98.1 and `@graphprotocol/graph-ts` 0.38.2 (specVersion 1.0.0, mapping
apiVersion 0.0.9).

## What it indexes

| Data source                     | Start block | Events                                                                                                                                                                  |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BorrowAccountFactory`          | 16364338    | AccountCreated (creates a `BorrowAccount` template per clone), ComeBack, timelock Submitted / Revoked / Accepted, every parameter and role event                        |
| `BorrowAccount` (template)      | per clone   | Opened, Borrowed (incl. origination fee and LTV), Repaid, Exited, CollateralAdded, CollateralWithdrawn                                                                    |
| `Morpho` (M1 only)              | 16364340    | CreateMarket, Supply, Withdraw, Borrow, Repay, SupplyCollateral, WithdrawCollateral, Liquidate, AccrueInterest. Mezo's Morpho hosts other markets; handlers skip them. |
| `WsMUSD`                        | 16364313    | Deposit, Withdraw, RedeemedInKind, Synced, CapRaiseSubmitted / CapRaised / CapRaiseRevoked                                                                               |
| `VMUSD` (Morpho Vault V2)       | 16366237    | Deposit, Withdraw, AccrueInterest, Allocate, Deallocate, ForceDeallocate                                                                                                 |
| `BaserateAllocator`             | 16366247    | Rebalanced, CheckpointRecorded, IdleAllocated, MarketLiquidityPulled                                                                                                     |
| `Backstop`                      | 16365855    | Deposit, Checkpoint, CollateralBought, RedeemRequested, RedeemClaimed, AuctionTaken, InventorySold, DepositsPausedSet                                                    |
| `FlashLiquidator`               | 16365856    | Liquidated (joined to the Morpho Liquidate it follows in the same transaction)                                                                                          |
| `FeeRouter`                     | 16365872    | Distributed, BribePosted, BribeRedirected                                                                                                                                |

Start blocks are the contracts' deploy blocks (`packages/sdk/src/deployments/31611.json`); Morpho starts at M1's
CreateMarket block. `pnpm check-config` verifies addresses, start blocks, the network and `src/config.ts` against
that registry (and `contracts/deployments/31611.json`); `pnpm build` runs it first.

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
- `RedeemRequest`: a backstop exit, updated when claimed. `TimelockSubmission`: a queued factory call and how it ended.

Events (immutable): `AccountAction`, `MarketEvent`, `Liquidation` (mutable only so FlashLiquidator can add venue,
proceeds and profit), `VaultFlow`, `WsMusdSync`, `VaultAllocation`, `Rebalance`, `AllocatorFlow`,
`AllocatorCheckpoint`, `BackstopTrade`, `Distribution` (id = transaction hash) with its `Bribe`s, and
`GovernanceEvent` (parameter and role changes on the factory, wsMUSD and the backstop).

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

Morpho Blue compiles with solc 0.8.19, which leaves library events out of the contract ABI, so `abis/Morpho.json` is
morpho-blue's `EventsLib`.

The unit tests (`tests/`) replay mocked events through the handlers: M1 position and market replay, the
FlashLiquidator join and bad debt, distributions and bribes, the backstop exit queue, vMUSD and wsMUSD share prices,
rebalances and the factory timelock. `assemblyscript` 0.19.23 is a direct dev dependency only because matchstick
looks for `node_modules/assemblyscript/bin/asc` inside this package.

## Deploy to Goldsky

```sh
pnpm --filter @baserate/subgraph build
cd packages/subgraph
goldsky login
goldsky subgraph deploy baserate-mezo-testnet/1.0.0 --path .
```

(`pnpm --filter @baserate/subgraph deploy:goldsky` runs the same deploy with the package version.) Goldsky prints the
public GraphQL endpoint, `https://api.goldsky.com/api/public/<project-id>/subgraphs/baserate-mezo-testnet/1.0.0/gn`.
Bump the version for each redeploy; a Goldsky tag pointing at the current version gives the web app a URL that does
not change.

## Web app

Set `BASERATE_PUBLIC_SUBGRAPH_URL` (apps/web, Vercel) to the public endpoint; it is public, never a secret, and
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

Fee distributions with their bribes, and vault share prices:

```graphql
{
  distributions(orderBy: blockNumber, orderDirection: desc) {
    total toSmusd toBribes toTreasury epochStart timestamp
    bribes { gauge bribe amount posted redirectReason }
  }
  vaults { kind totalSupply totalAssets sharePrice }
  sharePricePoints(where: { vault: "0x92aa0306c3af1e02d776ea05857653a3839debeb" }, orderBy: blockNumber, first: 1000) {
    sharePrice source timestamp
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
