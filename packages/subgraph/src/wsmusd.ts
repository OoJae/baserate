// wsMUSD (ERC-4626 over sMUSD with linear vesting of harvested yield). Supply comes from mints and burns in its
// events; the share price from flows (assets / shares), from Synced (right after a sync totalAssets() == stored)
// and from BaserateAllocator's checkpoints (allocator.ts).

import { BigInt, ethereum } from '@graphprotocol/graph-ts'
import { Vault, WsMusdSync } from '../generated/schema'
import {
  CapRaised,
  CapRaiseRevoked,
  CapRaiseSubmitted,
  Deposit,
  RedeemedInKind,
  Synced,
  Withdraw,
} from '../generated/WsMUSD/WsMUSD'
import {
  eventId,
  getVault,
  MIN_PRICE_SHARES,
  newGovernanceEvent,
  newVaultFlow,
  recordSharePrice,
  sharePriceOf,
  WAD,
  zeroFloorSub,
} from './common'

const KIND = 'WSMUSD'

/** Re-derives totalAssets from the share price (wsMUSD's exact total is only known right after a sync). */
function estimateAssets(vault: Vault): void {
  vault.totalAssets = vault.sharePrice.times(vault.totalSupply).div(WAD)
}

/** A flow's assets / shares is convertToAssets at that block up to one wei of share rounding. */
function priceFromFlow(vault: Vault, assets: BigInt, shares: BigInt, event: ethereum.Event): void {
  if (shares.ge(MIN_PRICE_SHARES)) {
    vault.sharePrice = assets.times(WAD).div(shares)
    estimateAssets(vault)
    vault.save()
    recordSharePrice(vault, 'FLOW', event)
  } else {
    estimateAssets(vault)
    vault.save()
  }
}

export function handleDeposit(event: Deposit): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalSupply = vault.totalSupply.plus(event.params.shares)
  vault.depositCount = vault.depositCount + 1
  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets)
  priceFromFlow(vault, event.params.assets, event.params.shares, event)

  newVaultFlow(
    event,
    vault.id,
    'DEPOSIT',
    event.params.sender,
    event.params.owner,
    event.params.assets,
    event.params.shares,
  ).save()
}

export function handleWithdraw(event: Withdraw): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalSupply = zeroFloorSub(vault.totalSupply, event.params.shares)
  vault.withdrawCount = vault.withdrawCount + 1
  vault.totalWithdrawn = vault.totalWithdrawn.plus(event.params.assets)
  priceFromFlow(vault, event.params.assets, event.params.shares, event)

  const flow = newVaultFlow(
    event,
    vault.id,
    'WITHDRAW',
    event.params.sender,
    event.params.owner,
    event.params.assets,
    event.params.shares,
  )
  flow.receiver = event.params.receiver
  flow.save()
}

/** In-kind exits price at (stored + vested) only, below convertToAssets, so they do not move the share price. */
export function handleRedeemedInKind(event: RedeemedInKind): void {
  const assets = event.params.smusdOut.plus(event.params.musdOut)
  const vault = getVault(event.address, KIND, event)
  vault.totalSupply = zeroFloorSub(vault.totalSupply, event.params.shares)
  vault.withdrawCount = vault.withdrawCount + 1
  vault.totalWithdrawn = vault.totalWithdrawn.plus(assets)
  estimateAssets(vault)
  vault.save()

  const flow = newVaultFlow(
    event,
    vault.id,
    'REDEEM_IN_KIND',
    event.params.caller,
    event.params.owner,
    assets,
    event.params.shares,
  )
  flow.receiver = event.params.receiver
  flow.smusdOut = event.params.smusdOut
  flow.musdOut = event.params.musdOut
  flow.save()
}

export function handleSynced(event: Synced): void {
  const p = event.params
  const sync = new WsMusdSync(eventId(event))
  sync.harvested = p.harvested
  sync.instant = p.instant
  sync.surplus = p.surplus
  sync.stored = p.stored
  sync.unvested = p.unvested
  sync.periodEnd = p.periodEnd
  sync.blockNumber = event.block.number
  sync.timestamp = event.block.timestamp
  sync.transactionHash = event.transaction.hash
  sync.logIndex = event.logIndex
  sync.save()

  const vault = getVault(event.address, KIND, event)
  vault.totalAssets = p.stored
  vault.sharePrice = sharePriceOf(p.stored, vault.totalSupply)
  vault.unvested = p.unvested
  vault.vestingEnd = p.periodEnd
  vault.save()
  recordSharePrice(vault, 'SYNC', event)
}

export function handleCapRaiseSubmitted(event: CapRaiseSubmitted): void {
  const g = newGovernanceEvent(event, 'WSMUSD_CAP_RAISE_SUBMITTED')
  g.caller = event.transaction.from
  g.value = event.params.newCap
  g.value2 = event.params.executableAt
  g.save()
}

export function handleCapRaised(event: CapRaised): void {
  const g = newGovernanceEvent(event, 'WSMUSD_CAP_RAISED')
  g.caller = event.transaction.from
  g.value = event.params.newCap
  g.value2 = event.params.oldCap
  g.save()
}

export function handleCapRaiseRevoked(event: CapRaiseRevoked): void {
  const g = newGovernanceEvent(event, 'WSMUSD_CAP_RAISE_REVOKED')
  g.caller = event.transaction.from
  g.value = event.params.revokedCap
  g.save()
}
