// Morpho Blue events for M1 only. Market totals and account positions replay Morpho's own storage updates
// (morpho-blue/src/Morpho.sol), so they match `market(id)` and `position(id, account)` at every block.

import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  AccrueInterest,
  Borrow,
  CreateMarket,
  Liquidate,
  Repay,
  Supply,
  SupplyCollateral,
  Withdraw,
  WithdrawCollateral,
} from '../generated/Morpho/Morpho'
import { Account, Liquidation, Market, MarketDailySnapshot, MarketEvent } from '../generated/schema'
import { eventId, getProtocol, ratio, SECONDS_PER_DAY, ZERO, zeroFloorSub } from './common'
import { M1_MARKET_ID } from './config'

function isM1(id: Bytes): boolean {
  return id.toHexString() == M1_MARKET_ID
}

function getMarket(id: Bytes, event: ethereum.Event): Market {
  let market = Market.load(id)
  if (market == null) {
    market = new Market(id)
    market.loanToken = Address.zero()
    market.collateralToken = Address.zero()
    market.oracle = Address.zero()
    market.irm = Address.zero()
    market.lltv = ZERO
    market.totalSupplyAssets = ZERO
    market.totalSupplyShares = ZERO
    market.totalBorrowAssets = ZERO
    market.totalBorrowShares = ZERO
    market.totalCollateral = ZERO
    market.utilization = ratio(ZERO, ZERO)
    market.borrowRate = ZERO
    market.lastUpdate = event.block.timestamp
    market.totalInterest = ZERO
    market.totalFeeShares = ZERO
    market.liquidationCount = 0
    market.createdAtBlock = event.block.number
    market.createdAtTimestamp = event.block.timestamp
  }
  return market
}

function getSnapshot(market: Market, event: ethereum.Event): MarketDailySnapshot {
  const day = event.block.timestamp.toI32() / SECONDS_PER_DAY
  const id = market.id.concatI32(day)
  let snapshot = MarketDailySnapshot.load(id)
  if (snapshot == null) {
    snapshot = new MarketDailySnapshot(id)
    snapshot.market = market.id
    snapshot.day = day
    snapshot.timestamp = BigInt.fromI32(day * SECONDS_PER_DAY)
    snapshot.supplied = ZERO
    snapshot.withdrawn = ZERO
    snapshot.borrowed = ZERO
    snapshot.repaid = ZERO
    snapshot.collateralSupplied = ZERO
    snapshot.collateralWithdrawn = ZERO
    snapshot.interest = ZERO
    snapshot.liquidations = 0
    snapshot.seizedCollateral = ZERO
  }
  return snapshot
}

/** Saves the market and copies its state into the day's snapshot. */
function commit(market: Market, snapshot: MarketDailySnapshot, event: ethereum.Event): void {
  market.utilization = ratio(market.totalBorrowAssets, market.totalSupplyAssets)
  market.save()
  snapshot.totalSupplyAssets = market.totalSupplyAssets
  snapshot.totalSupplyShares = market.totalSupplyShares
  snapshot.totalBorrowAssets = market.totalBorrowAssets
  snapshot.totalBorrowShares = market.totalBorrowShares
  snapshot.totalCollateral = market.totalCollateral
  snapshot.utilization = market.utilization
  snapshot.borrowRate = market.borrowRate
  snapshot.updatedAtBlock = event.block.number
  snapshot.save()
}

/** Applies a position change to a Baserate account (null for any other Morpho position, e.g. vMUSD's adapter). */
function updatePosition(
  onBehalf: Address,
  collateralDelta: BigInt,
  borrowSharesDelta: BigInt,
  event: ethereum.Event,
): Account | null {
  const account = Account.load(onBehalf)
  if (account == null) return null
  const wasOpen = account.isOpen
  account.collateral = account.collateral.plus(collateralDelta)
  account.borrowShares = account.borrowShares.plus(borrowSharesDelta)
  account.isOpen = !account.collateral.isZero() || !account.borrowShares.isZero()
  account.lastActivityTimestamp = event.block.timestamp
  account.save()
  if (wasOpen != account.isOpen) {
    const protocol = getProtocol(event)
    protocol.openPositionCount = protocol.openPositionCount + (account.isOpen ? 1 : -1)
    protocol.save()
  }
  return account
}

function newMarketEvent(
  event: ethereum.Event,
  market: Market,
  kind: string,
  onBehalf: Bytes,
  caller: Bytes,
  assets: BigInt,
  account: Account | null,
): MarketEvent {
  const e = new MarketEvent(eventId(event))
  e.market = market.id
  e.kind = kind
  e.onBehalf = onBehalf
  e.caller = caller
  e.assets = assets
  if (account != null) {
    e.account = account.id
    e.collateralAfter = account.collateral
    e.borrowSharesAfter = account.borrowShares
  }
  e.blockNumber = event.block.number
  e.timestamp = event.block.timestamp
  e.transactionHash = event.transaction.hash
  e.logIndex = event.logIndex
  return e
}

export function handleCreateMarket(event: CreateMarket): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  const params = event.params.marketParams
  market.loanToken = params.loanToken
  market.collateralToken = params.collateralToken
  market.oracle = params.oracle
  market.irm = params.irm
  market.lltv = params.lltv
  market.lastUpdate = event.block.timestamp
  market.createdAtBlock = event.block.number
  market.createdAtTimestamp = event.block.timestamp
  commit(market, getSnapshot(market, event), event)
}

export function handleAccrueInterest(event: AccrueInterest): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  const interest = event.params.interest
  market.totalBorrowAssets = market.totalBorrowAssets.plus(interest)
  market.totalSupplyAssets = market.totalSupplyAssets.plus(interest)
  market.totalSupplyShares = market.totalSupplyShares.plus(event.params.feeShares)
  market.totalInterest = market.totalInterest.plus(interest)
  market.totalFeeShares = market.totalFeeShares.plus(event.params.feeShares)
  market.borrowRate = event.params.prevBorrowRate
  market.lastUpdate = event.block.timestamp
  const snapshot = getSnapshot(market, event)
  snapshot.interest = snapshot.interest.plus(interest)
  commit(market, snapshot, event)
}

export function handleSupply(event: Supply): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalSupplyAssets = market.totalSupplyAssets.plus(event.params.assets)
  market.totalSupplyShares = market.totalSupplyShares.plus(event.params.shares)
  const snapshot = getSnapshot(market, event)
  snapshot.supplied = snapshot.supplied.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = Account.load(event.params.onBehalf)
  const e = newMarketEvent(
    event,
    market,
    'SUPPLY',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  )
  e.shares = event.params.shares
  e.save()
}

export function handleWithdraw(event: Withdraw): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalSupplyAssets = market.totalSupplyAssets.minus(event.params.assets)
  market.totalSupplyShares = market.totalSupplyShares.minus(event.params.shares)
  const snapshot = getSnapshot(market, event)
  snapshot.withdrawn = snapshot.withdrawn.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = Account.load(event.params.onBehalf)
  const e = newMarketEvent(
    event,
    market,
    'WITHDRAW',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  )
  e.receiver = event.params.receiver
  e.shares = event.params.shares
  e.save()
}

export function handleBorrow(event: Borrow): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalBorrowAssets = market.totalBorrowAssets.plus(event.params.assets)
  market.totalBorrowShares = market.totalBorrowShares.plus(event.params.shares)
  const snapshot = getSnapshot(market, event)
  snapshot.borrowed = snapshot.borrowed.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = updatePosition(event.params.onBehalf, ZERO, event.params.shares, event)
  const e = newMarketEvent(
    event,
    market,
    'BORROW',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  )
  e.receiver = event.params.receiver
  e.shares = event.params.shares
  e.save()
}

export function handleRepay(event: Repay): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalBorrowShares = market.totalBorrowShares.minus(event.params.shares)
  market.totalBorrowAssets = zeroFloorSub(market.totalBorrowAssets, event.params.assets)
  const snapshot = getSnapshot(market, event)
  snapshot.repaid = snapshot.repaid.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = updatePosition(
    event.params.onBehalf,
    ZERO,
    ZERO.minus(event.params.shares),
    event,
  )
  const e = newMarketEvent(
    event,
    market,
    'REPAY',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  )
  e.shares = event.params.shares
  e.save()
}

export function handleSupplyCollateral(event: SupplyCollateral): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalCollateral = market.totalCollateral.plus(event.params.assets)
  const snapshot = getSnapshot(market, event)
  snapshot.collateralSupplied = snapshot.collateralSupplied.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = updatePosition(event.params.onBehalf, event.params.assets, ZERO, event)
  newMarketEvent(
    event,
    market,
    'SUPPLY_COLLATERAL',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  ).save()
}

export function handleWithdrawCollateral(event: WithdrawCollateral): void {
  if (!isM1(event.params.id)) return
  const market = getMarket(event.params.id, event)
  market.totalCollateral = market.totalCollateral.minus(event.params.assets)
  const snapshot = getSnapshot(market, event)
  snapshot.collateralWithdrawn = snapshot.collateralWithdrawn.plus(event.params.assets)
  commit(market, snapshot, event)

  const account = updatePosition(
    event.params.onBehalf,
    ZERO.minus(event.params.assets),
    ZERO,
    event,
  )
  const e = newMarketEvent(
    event,
    market,
    'WITHDRAW_COLLATERAL',
    event.params.onBehalf,
    event.params.caller,
    event.params.assets,
    account,
  )
  e.receiver = event.params.receiver
  e.save()
}

/**
 * Morpho.liquidate: repaid shares leave the position and the market, repaid assets are floored at zero, seized
 * collateral leaves the position; when the position's collateral hits zero its remaining borrow shares are bad
 * debt, socialised by reducing total supply assets.
 */
export function handleLiquidate(event: Liquidate): void {
  if (!isM1(event.params.id)) return
  const p = event.params
  const market = getMarket(p.id, event)
  market.totalBorrowShares = market.totalBorrowShares.minus(p.repaidShares).minus(p.badDebtShares)
  market.totalBorrowAssets = zeroFloorSub(market.totalBorrowAssets, p.repaidAssets).minus(
    p.badDebtAssets,
  )
  market.totalSupplyAssets = market.totalSupplyAssets.minus(p.badDebtAssets)
  market.totalCollateral = market.totalCollateral.minus(p.seizedAssets)
  market.liquidationCount = market.liquidationCount + 1

  const liquidation = new Liquidation(eventId(event))
  market.lastLiquidation = liquidation.id
  const snapshot = getSnapshot(market, event)
  snapshot.liquidations = snapshot.liquidations + 1
  snapshot.seizedCollateral = snapshot.seizedCollateral.plus(p.seizedAssets)
  commit(market, snapshot, event)

  const account = updatePosition(
    p.borrower,
    ZERO.minus(p.seizedAssets),
    ZERO.minus(p.repaidShares.plus(p.badDebtShares)),
    event,
  )
  if (account != null) {
    account.liquidationCount = account.liquidationCount + 1
    account.save()
  }

  liquidation.market = market.id
  if (account != null) liquidation.account = account.id
  liquidation.borrower = p.borrower
  liquidation.caller = p.caller
  liquidation.repaidAssets = p.repaidAssets
  liquidation.repaidShares = p.repaidShares
  liquidation.seizedAssets = p.seizedAssets
  liquidation.badDebtAssets = p.badDebtAssets
  liquidation.badDebtShares = p.badDebtShares
  liquidation.viaFlashLiquidator = false
  liquidation.blockNumber = event.block.number
  liquidation.timestamp = event.block.timestamp
  liquidation.transactionHash = event.transaction.hash
  liquidation.logIndex = event.logIndex
  liquidation.save()

  const e = newMarketEvent(
    event,
    market,
    'LIQUIDATE',
    p.borrower,
    p.caller,
    p.repaidAssets,
    account,
  )
  e.shares = p.repaidShares
  e.save()

  const protocol = getProtocol(event)
  protocol.liquidationCount = protocol.liquidationCount + 1
  protocol.totalSeizedCollateral = protocol.totalSeizedCollateral.plus(p.seizedAssets)
  protocol.save()
}
