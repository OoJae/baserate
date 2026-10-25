// vMUSD (Morpho Vault V2). Vault V2 keeps `_totalAssets` in storage: AccrueInterest sets it to newTotalAssets and
// mints the fee shares, deposits add, withdrawals subtract. Replaying that gives the exact totals and share price
// as of each event (virtualShares is 1 for an 18-decimal asset).

import { Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Vault, VaultAllocation } from '../generated/schema'
import {
  AccrueInterest,
  Allocate,
  Deallocate,
  Deposit,
  ForceDeallocate,
  Withdraw,
} from '../generated/VMUSD/VaultV2'
import {
  eventId,
  getVault,
  newVaultFlow,
  orZero,
  recordSharePrice,
  sharePriceOf,
  zeroFloorSub,
} from './common'
import { M1_ADAPTER, WS_MUSD_ADAPTER } from './config'

const KIND = 'VMUSD'

function reprice(vault: Vault, source: string, event: ethereum.Event): void {
  vault.sharePrice = sharePriceOf(vault.totalAssets, vault.totalSupply)
  vault.save()
  recordSharePrice(vault, source, event)
}

function adapterKind(adapter: string): string {
  if (adapter == WS_MUSD_ADAPTER) return 'WSMUSD_LIQUIDITY'
  if (adapter == M1_ADAPTER) return 'M1_MARKET'
  return 'OTHER'
}

export function handleAccrueInterest(event: AccrueInterest): void {
  const p = event.params
  const vault = getVault(event.address, KIND, event)
  const feeShares = p.performanceFeeShares.plus(p.managementFeeShares)
  vault.totalAssets = p.newTotalAssets
  vault.totalSupply = vault.totalSupply.plus(feeShares)
  vault.performanceFeeShares = orZero(vault.performanceFeeShares).plus(p.performanceFeeShares)
  vault.managementFeeShares = orZero(vault.managementFeeShares).plus(p.managementFeeShares)
  reprice(vault, 'VAULT_ACCRUAL', event)
}

export function handleDeposit(event: Deposit): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalAssets = vault.totalAssets.plus(event.params.assets)
  vault.totalSupply = vault.totalSupply.plus(event.params.shares)
  vault.depositCount = vault.depositCount + 1
  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets)
  reprice(vault, 'FLOW', event)

  newVaultFlow(
    event,
    vault.id,
    'DEPOSIT',
    event.params.sender,
    event.params.onBehalf,
    event.params.assets,
    event.params.shares,
  ).save()
}

export function handleWithdraw(event: Withdraw): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalAssets = zeroFloorSub(vault.totalAssets, event.params.assets)
  vault.totalSupply = zeroFloorSub(vault.totalSupply, event.params.shares)
  vault.withdrawCount = vault.withdrawCount + 1
  vault.totalWithdrawn = vault.totalWithdrawn.plus(event.params.assets)
  reprice(vault, 'FLOW', event)

  const flow = newVaultFlow(
    event,
    vault.id,
    'WITHDRAW',
    event.params.sender,
    event.params.onBehalf,
    event.params.assets,
    event.params.shares,
  )
  flow.receiver = event.params.receiver
  flow.save()
}

function newAllocation(
  event: ethereum.Event,
  kind: string,
  sender: Bytes,
  adapter: Bytes,
): VaultAllocation {
  const a = new VaultAllocation(eventId(event))
  a.vault = event.address
  a.kind = kind
  a.sender = sender
  a.adapter = adapter
  a.adapterKind = adapterKind(adapter.toHexString())
  a.blockNumber = event.block.number
  a.timestamp = event.block.timestamp
  a.transactionHash = event.transaction.hash
  a.logIndex = event.logIndex
  return a
}

export function handleAllocate(event: Allocate): void {
  getVault(event.address, KIND, event).save()
  const a = newAllocation(event, 'ALLOCATE', event.params.sender, event.params.adapter)
  a.assets = event.params.assets
  a.change = event.params.change
  a.ids = event.params.ids
  a.save()
}

export function handleDeallocate(event: Deallocate): void {
  getVault(event.address, KIND, event).save()
  const a = newAllocation(event, 'DEALLOCATE', event.params.sender, event.params.adapter)
  a.assets = event.params.assets
  a.change = event.params.change
  a.ids = event.params.ids
  a.save()
}

export function handleForceDeallocate(event: ForceDeallocate): void {
  getVault(event.address, KIND, event).save()
  const a = newAllocation(event, 'FORCE_DEALLOCATE', event.params.sender, event.params.adapter)
  a.assets = event.params.assets
  a.ids = event.params.ids
  a.onBehalf = event.params.onBehalf
  a.penaltyAssets = event.params.penaltyAssets
  a.save()
}
