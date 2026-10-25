// FlashLiquidator.Liquidated is emitted after Morpho's Liquidate in the same call, so it enriches that liquidation
// (found through Market.lastLiquidation) with the venue, sale proceeds and the liquidator's profit. Native BTC the
// liquidation leaves behind goes to the caller; if the caller cannot take it, NativeKept follows Liquidated and the
// BTC waits in the contract for anyone's sweepNative (NativeSwept).

import { Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Liquidated, NativeKept, NativeSwept } from '../generated/FlashLiquidator/FlashLiquidator'
import { Account, FlashLiquidatorNative, Liquidation, Market } from '../generated/schema'
import { eventId, getProtocol, venueName, ZERO } from './common'
import { M1_MARKET_ID } from './config'

/** M1's latest liquidation, if it happened in this event's transaction. */
function liquidationInTx(event: ethereum.Event): Liquidation | null {
  const market = Market.load(Bytes.fromHexString(M1_MARKET_ID))
  if (market == null) return null
  const lastId = market.lastLiquidation
  if (!lastId) return null
  const last = Liquidation.load(lastId)
  if (last == null) return null
  if (!last.transactionHash.equals(event.transaction.hash)) return null
  return last
}

/** The FlashLiquidator liquidation in this transaction whose caller is `caller`. */
function flashLiquidationBy(event: ethereum.Event, caller: Bytes): Liquidation | null {
  const last = liquidationInTx(event)
  if (last == null) return null
  const liquidator = last.liquidator
  if (!liquidator) return null
  if (!liquidator.equals(caller)) return null
  return last
}

function matchingLiquidation(event: Liquidated): Liquidation | null {
  const last = liquidationInTx(event)
  if (last == null) return null
  if (!last.borrower.equals(event.params.borrower)) return null
  return last
}

export function handleLiquidated(event: Liquidated): void {
  let liquidation = matchingLiquidation(event)
  if (liquidation == null) {
    // Not expected (FlashLiquidator only liquidates M1 through Morpho); keep its own numbers rather than drop it.
    liquidation = new Liquidation(eventId(event))
    liquidation.market = Bytes.fromHexString(M1_MARKET_ID)
    const account = Account.load(event.params.borrower)
    if (account != null) liquidation.account = account.id
    liquidation.borrower = event.params.borrower
    liquidation.caller = event.address
    liquidation.repaidAssets = event.params.repaid
    liquidation.repaidShares = ZERO
    liquidation.seizedAssets = event.params.seized
    liquidation.badDebtAssets = ZERO
    liquidation.badDebtShares = ZERO
    liquidation.blockNumber = event.block.number
    liquidation.timestamp = event.block.timestamp
    liquidation.transactionHash = event.transaction.hash
    liquidation.logIndex = event.logIndex
  }
  liquidation.viaFlashLiquidator = true
  liquidation.liquidator = event.params.caller
  liquidation.venue = venueName(event.params.venue)
  liquidation.proceeds = event.params.proceeds
  liquidation.profit = event.params.profit
  liquidation.save()

  const protocol = getProtocol(event)
  protocol.totalLiquidatorProfit = protocol.totalLiquidatorProfit.plus(event.params.profit)
  protocol.save()
}

function newNative(event: ethereum.Event, kind: string, caller: Bytes): FlashLiquidatorNative {
  const n = new FlashLiquidatorNative(eventId(event))
  n.kind = kind
  n.caller = caller
  n.blockNumber = event.block.number
  n.timestamp = event.block.timestamp
  n.transactionHash = event.transaction.hash
  n.logIndex = event.logIndex
  return n
}

/** The caller could not take the liquidation's leftover native BTC (emitted right after Liquidated). */
export function handleNativeKept(event: NativeKept): void {
  const n = newNative(event, 'KEPT', event.params.caller)
  n.amount = event.params.amount
  const liquidation = flashLiquidationBy(event, event.params.caller)
  if (liquidation != null) {
    liquidation.nativeKept = event.params.amount
    liquidation.save()
    n.liquidation = liquidation.id
  }
  n.save()
}

export function handleNativeSwept(event: NativeSwept): void {
  const n = newNative(event, 'SWEPT', event.params.caller)
  n.to = event.params.to
  n.amount = event.params.amount
  n.save()
}
