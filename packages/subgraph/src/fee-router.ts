// FeeRouter.distribute(): BribePosted / BribeRedirected are emitted per gauge before Distributed, all in one
// transaction, so a distribution is keyed by its transaction hash and its bribes point at that id.

import { Bytes } from '@graphprotocol/graph-ts'
import { BribePosted, BribeRedirected, Distributed } from '../generated/FeeRouter/FeeRouter'
import { Bribe, Distribution } from '../generated/schema'
import { eventId, getProtocol, redirectReasonName } from './common'

export function handleDistributed(event: Distributed): void {
  const p = event.params
  // A second distribute() in the same transaction (only possible through a wrapper contract) gets its own id;
  // its bribes stay attached to the first.
  let id: Bytes = event.transaction.hash
  if (Distribution.load(id) != null) id = eventId(event)

  const d = new Distribution(id)
  d.caller = p.caller
  d.epochStart = p.epochStart
  d.total = p.total
  d.toSmusd = p.toSmusd
  d.toBribes = p.toBribes
  d.toTreasury = p.toTreasury
  d.retained = p.retained
  d.blockNumber = event.block.number
  d.timestamp = event.block.timestamp
  d.transactionHash = event.transaction.hash
  d.logIndex = event.logIndex
  d.save()

  const protocol = getProtocol(event)
  protocol.distributionCount = protocol.distributionCount + 1
  protocol.totalDistributed = protocol.totalDistributed.plus(p.total)
  protocol.totalToSmusd = protocol.totalToSmusd.plus(p.toSmusd)
  protocol.totalToBribes = protocol.totalToBribes.plus(p.toBribes)
  protocol.totalToTreasury = protocol.totalToTreasury.plus(p.toTreasury)
  protocol.save()
}

export function handleBribePosted(event: BribePosted): void {
  const b = new Bribe(eventId(event))
  b.distribution = event.transaction.hash
  b.gauge = event.params.gauge
  b.bribe = event.params.bribe
  b.epochStart = event.params.epochStart
  b.amount = event.params.amount
  b.posted = true
  b.blockNumber = event.block.number
  b.timestamp = event.block.timestamp
  b.transactionHash = event.transaction.hash
  b.logIndex = event.logIndex
  b.save()
}

export function handleBribeRedirected(event: BribeRedirected): void {
  const b = new Bribe(eventId(event))
  b.distribution = event.transaction.hash
  b.gauge = event.params.gauge
  b.amount = event.params.amount
  b.posted = false
  b.redirectReason = redirectReasonName(event.params.reason)
  b.blockNumber = event.block.number
  b.timestamp = event.block.timestamp
  b.transactionHash = event.transaction.hash
  b.logIndex = event.logIndex
  b.save()
}
