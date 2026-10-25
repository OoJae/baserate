// BaserateAllocator: rebalance decisions (the Lend page's "Recent moves"), wsMUSD share-price checkpoints and the
// idle / market-liquidity helpers.

import { Address } from '@graphprotocol/graph-ts'
import {
  CheckpointRecorded,
  IdleAllocated,
  MarketLiquidityPulled,
  Rebalanced,
} from '../generated/BaserateAllocator/BaserateAllocator'
import { AllocatorCheckpoint, AllocatorFlow, Rebalance } from '../generated/schema'
import { allocatorActionName, eventId, getVault, recordSharePrice, WAD } from './common'
import { WS_MUSD } from './config'

export function handleRebalanced(event: Rebalanced): void {
  const p = event.params
  const r = new Rebalance(eventId(event))
  r.action = allocatorActionName(p.action)
  r.actionId = p.action
  r.amount = p.amount
  r.m1SupplyApy = p.m1SupplyApy
  r.wsMusdApy = p.wsMusdApy
  r.apyWindow = p.apyWindow
  r.m1Liquidity = p.m1Liquidity
  r.bufferTarget = p.bufferTarget
  r.from = event.transaction.from
  r.blockNumber = event.block.number
  r.timestamp = event.block.timestamp
  r.transactionHash = event.transaction.hash
  r.logIndex = event.logIndex
  r.save()
}

/** A wsMUSD convertToAssets(1e18) observation: also the wsMUSD vault's current share price. */
export function handleCheckpointRecorded(event: CheckpointRecorded): void {
  const c = new AllocatorCheckpoint(eventId(event))
  c.index = event.params.index
  c.observedAt = event.params.timestamp
  c.sharePrice = event.params.sharePrice
  c.blockNumber = event.block.number
  c.timestamp = event.block.timestamp
  c.transactionHash = event.transaction.hash
  c.logIndex = event.logIndex
  c.save()

  const vault = getVault(Address.fromString(WS_MUSD), 'WSMUSD', event)
  vault.sharePrice = event.params.sharePrice
  vault.totalAssets = vault.sharePrice.times(vault.totalSupply).div(WAD)
  vault.save()
  recordSharePrice(vault, 'ALLOCATOR_CHECKPOINT', event)
}

export function handleIdleAllocated(event: IdleAllocated): void {
  const f = new AllocatorFlow(eventId(event))
  f.kind = 'IDLE_ALLOCATED'
  f.caller = event.transaction.from
  f.assets = event.params.amount
  f.blockNumber = event.block.number
  f.timestamp = event.block.timestamp
  f.transactionHash = event.transaction.hash
  f.logIndex = event.logIndex
  f.save()
}

export function handleMarketLiquidityPulled(event: MarketLiquidityPulled): void {
  const f = new AllocatorFlow(eventId(event))
  f.kind = 'MARKET_LIQUIDITY_PULLED'
  f.caller = event.params.caller
  f.assets = event.params.assets
  f.blockNumber = event.block.number
  f.timestamp = event.block.timestamp
  f.transactionHash = event.transaction.hash
  f.logIndex = event.logIndex
  f.save()
}
