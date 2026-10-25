// FlashLiquidator.Liquidated is emitted after Morpho's Liquidate in the same call, so it enriches that liquidation
// (found through Market.lastLiquidation) with the venue, sale proceeds and the liquidator's profit.

import { Bytes } from '@graphprotocol/graph-ts'
import { Liquidated } from '../generated/FlashLiquidator/FlashLiquidator'
import { Account, Liquidation, Market } from '../generated/schema'
import { eventId, getProtocol, venueName, ZERO } from './common'
import { M1_MARKET_ID } from './config'

function matchingLiquidation(event: Liquidated): Liquidation | null {
  const market = Market.load(Bytes.fromHexString(M1_MARKET_ID))
  if (market == null) return null
  const lastId = market.lastLiquidation
  if (!lastId) return null
  const last = Liquidation.load(lastId)
  if (last == null) return null
  if (!last.transactionHash.equals(event.transaction.hash)) return null
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
