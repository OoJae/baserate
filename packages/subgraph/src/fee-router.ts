// FeeRouter.distribute(): per gauge BribePosted / BribeRedirected / BribeCarried, then TreasuryPaid, then the sMUSD
// leg's outcome (SmusdYieldPosted, SmusdYieldDeferred, SmusdYieldFailed or SmusdShareToTreasury), and Distributed
// last, all in one transaction. A distribution is keyed by its transaction hash: its bribes and carries point at that
// id, and the sMUSD and carry amounts gather in a PendingDistribution that Distributed folds in and removes.
//
// Distributed: toSmusd is what sMUSD actually took, toTreasury includes the sMUSD leg paid to the treasury after the
// grace period, retained is every carry (bribe shares and the sMUSD leg).

import { BigInt, Bytes, ethereum, store } from '@graphprotocol/graph-ts'
import {
  BribeCarried,
  BribePosted,
  BribeRedirected,
  Distributed,
  SmusdShareToTreasury,
  SmusdYieldDeferred,
  SmusdYieldFailed,
} from '../generated/FeeRouter/FeeRouter'
import { Bribe, BribeCarry, Distribution, PendingDistribution } from '../generated/schema'
import { carryReasonName, eventId, getProtocol, redirectReasonName, ZERO } from './common'

function pendingOf(event: ethereum.Event): PendingDistribution {
  let p = PendingDistribution.load(event.transaction.hash)
  if (p == null) {
    p = new PendingDistribution(event.transaction.hash)
    p.bribesCarried = ZERO
    p.smusdCarried = ZERO
    p.smusdToTreasury = ZERO
    p.smusdOutcome = 'NONE'
  }
  return p
}

export function handleDistributed(event: Distributed): void {
  const p = event.params
  // A second distribute() in the same transaction (only possible through a wrapper contract) gets its own id;
  // its bribes stay attached to the first.
  let id: Bytes = event.transaction.hash
  if (Distribution.load(id) != null) id = eventId(event)

  const legs = PendingDistribution.load(event.transaction.hash)
  let bribesCarried = ZERO
  let smusdCarried = ZERO
  let smusdToTreasury = ZERO
  let outcome = p.toSmusd.isZero() ? 'NONE' : 'DONATED'
  let failingSince: BigInt | null = null
  if (legs != null) {
    bribesCarried = legs.bribesCarried
    smusdCarried = legs.smusdCarried
    smusdToTreasury = legs.smusdToTreasury
    if (legs.smusdOutcome != 'NONE') outcome = legs.smusdOutcome
    failingSince = legs.smusdFailingSince
    store.remove('PendingDistribution', legs.id.toHexString())
  }

  const d = new Distribution(id)
  d.caller = p.caller
  d.epochStart = p.epochStart
  d.total = p.total
  d.toSmusd = p.toSmusd
  d.toBribes = p.toBribes
  d.toTreasury = p.toTreasury
  d.retained = p.retained
  d.bribesCarried = bribesCarried
  d.smusdCarried = smusdCarried
  d.smusdToTreasury = smusdToTreasury
  d.smusdOutcome = outcome
  d.smusdFailingSince = failingSince
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
  protocol.totalSmusdToTreasury = protocol.totalSmusdToTreasury.plus(smusdToTreasury)
  protocol.feeRouterCarried = p.retained
  // The streak ends with one full donation and starts (or goes on) with a failure; dust and no leg leave it alone.
  if (outcome == 'DONATED') protocol.smusdFailingSince = ZERO
  else if (failingSince) protocol.smusdFailingSince = failingSince
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

/** A gauge's share stays in the router (vote window closed, or no votes) and joins its share next time. */
export function handleBribeCarried(event: BribeCarried): void {
  const c = new BribeCarry(eventId(event))
  c.distribution = event.transaction.hash
  c.gauge = event.params.gauge
  c.amount = event.params.amount
  c.reason = carryReasonName(event.params.reason)
  c.blockNumber = event.block.number
  c.timestamp = event.block.timestamp
  c.transactionHash = event.transaction.hash
  c.logIndex = event.logIndex
  c.save()

  const legs = pendingOf(event)
  legs.bribesCarried = legs.bribesCarried.plus(event.params.amount)
  legs.save()
}

/** The sMUSD leg is below sMUSD's AmountTooSmall floor: carried, not a failure. */
export function handleSmusdYieldDeferred(event: SmusdYieldDeferred): void {
  const legs = pendingOf(event)
  legs.smusdCarried = legs.smusdCarried.plus(event.params.amount)
  legs.smusdOutcome = 'DEFERRED'
  legs.save()
}

/** The donation failed (or pulled less) within the grace period: the rest is carried. */
export function handleSmusdYieldFailed(event: SmusdYieldFailed): void {
  const legs = pendingOf(event)
  legs.smusdCarried = legs.smusdCarried.plus(event.params.amount)
  legs.smusdOutcome = 'FAILED'
  legs.smusdFailingSince = event.params.failingSince
  legs.save()
}

/** sMUSD has kept failing past the grace period: the rest of its leg went to the treasury. */
export function handleSmusdShareToTreasury(event: SmusdShareToTreasury): void {
  const legs = pendingOf(event)
  legs.smusdToTreasury = legs.smusdToTreasury.plus(event.params.amount)
  legs.smusdOutcome = 'TO_TREASURY'
  legs.smusdFailingSince = event.params.failingSince
  legs.save()
}
