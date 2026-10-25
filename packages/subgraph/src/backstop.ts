// Backstop (bMUSD). Every mutation emits Checkpoint with the recognised book (== totalAssets() right after it), so
// the share price is (book + 1) / (supply + 1) with supply from Deposit mints and RedeemClaimed burns. Exits are a
// queue: RedeemRequested escrows shares (supply unchanged), and each claim payment emits RedeemClaimed (shares burned,
// MUSD paid). A claim that cash cannot cover pays what there is and keeps the rest queued: RedeemPartiallyClaimed
// follows its RedeemClaimed with what is left, so a request closes only on the payment that burns its last share.
// claimRedeemWithoutOracle emits the same events.

import { Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  AuctionTaken,
  Checkpoint,
  CollateralBought,
  Deposit,
  DepositsPausedSet,
  InventorySold,
  RedeemClaimed,
  RedeemPartiallyClaimed,
  RedeemRequested,
} from '../generated/Backstop/Backstop'
import { BackstopTrade, RedeemRequest, Vault } from '../generated/schema'
import {
  eventId,
  getVault,
  newGovernanceEvent,
  newVaultFlow,
  orZero,
  recordSharePrice,
  sharePriceOf,
  venueName,
  ZERO,
  zeroFloorSub,
} from './common'

const PENDING = 'PENDING'
const PARTIALLY_CLAIMED = 'PARTIALLY_CLAIMED'
const CLAIMED = 'CLAIMED'

const KIND = 'BACKSTOP'

function reprice(vault: Vault, event: ethereum.Event): void {
  vault.sharePrice = sharePriceOf(vault.totalAssets, vault.totalSupply)
  vault.save()
  recordSharePrice(vault, 'BACKSTOP_CHECKPOINT', event)
}

export function handleCheckpoint(event: Checkpoint): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalAssets = event.params.book
  vault.unvested = event.params.unvested
  vault.vestingEnd = event.params.periodEnd
  vault.inventory = event.params.inventory
  reprice(vault, event)
}

/**
 * Deposits checkpoint first, then credit the book and mint. The deposit is split between the book and the gains still
 * vesting, so `totalAssets + assets` is an upper bound here; the Checkpoint emitted right after Deposit sets the exact
 * book (and this block's share-price point).
 */
export function handleDeposit(event: Deposit): void {
  const vault = getVault(event.address, KIND, event)
  vault.totalAssets = vault.totalAssets.plus(event.params.assets)
  vault.totalSupply = vault.totalSupply.plus(event.params.shares)
  vault.depositCount = vault.depositCount + 1
  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets)
  reprice(vault, event)

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

export function handleRedeemRequested(event: RedeemRequested): void {
  const p = event.params
  const vault = getVault(event.address, KIND, event)
  vault.reservedAssets = orZero(vault.reservedAssets).plus(p.assets)
  vault.pendingRedeemCount = vault.pendingRedeemCount + 1
  vault.save()

  const r = new RedeemRequest(p.id.toString())
  r.requestId = p.id
  r.vault = vault.id
  r.owner = p.owner
  r.receiver = p.receiver
  r.shares = p.shares
  r.assets = p.assets
  r.claimableAt = p.claimableAt
  r.status = PENDING
  r.sharesLeft = p.shares
  r.assetsLeft = p.assets
  r.paidAssets = ZERO
  r.burnedShares = ZERO
  r.claimCount = 0
  r.claimed = false
  r.blockNumber = event.block.number
  r.timestamp = event.block.timestamp
  r.transactionHash = event.transaction.hash
  r.save()
}

function decrementPending(vault: Vault): void {
  vault.pendingRedeemCount = vault.pendingRedeemCount > 0 ? vault.pendingRedeemCount - 1 : 0
}

/**
 * One claim payment: `shares` burned, `assets` paid. The claim's closing Checkpoint is emitted before RedeemClaimed,
 * so the burn is applied (and repriced) here. The payment that burns the request's last share closes it and releases
 * its reserve; a partial payment leaves that to the RedeemPartiallyClaimed that follows.
 */
export function handleRedeemClaimed(event: RedeemClaimed): void {
  const p = event.params
  const vault = getVault(event.address, KIND, event)
  const request = RedeemRequest.load(p.id.toString())
  if (request == null) {
    // Not expected (every request starts with RedeemRequested): treat it as a final payment.
    decrementPending(vault)
  } else {
    request.paidAssets = request.paidAssets.plus(p.assets)
    request.burnedShares = request.burnedShares.plus(p.shares)
    request.claimCount = request.claimCount + 1
    request.lastClaimAtBlock = event.block.number
    request.lastClaimAtTimestamp = event.block.timestamp
    request.lastClaimTransactionHash = event.transaction.hash
    if (p.shares.ge(request.sharesLeft)) {
      vault.reservedAssets = zeroFloorSub(orZero(vault.reservedAssets), request.assetsLeft)
      decrementPending(vault)
      request.sharesLeft = ZERO
      request.assetsLeft = ZERO
      request.status = CLAIMED
      request.claimed = true
      request.claimedAssets = request.paidAssets
      request.claimedAtBlock = event.block.number
      request.claimedAtTimestamp = event.block.timestamp
      request.claimTransactionHash = event.transaction.hash
    } else {
      // RedeemPartiallyClaimed follows with the exact remainder and releases the paid part of the reserve.
      request.status = PARTIALLY_CLAIMED
    }
    request.save()
  }
  vault.totalSupply = zeroFloorSub(vault.totalSupply, p.shares)
  vault.withdrawCount = vault.withdrawCount + 1
  vault.totalWithdrawn = vault.totalWithdrawn.plus(p.assets)
  reprice(vault, event)

  const flow = newVaultFlow(
    event,
    vault.id,
    'WITHDRAW',
    event.transaction.from,
    request == null ? p.receiver : request.owner,
    p.assets,
    p.shares,
  )
  flow.receiver = p.receiver
  if (request != null) flow.redeemRequest = request.id
  flow.save()
}

/**
 * Emitted right after the RedeemClaimed of a partial payment: what stays queued under `id` (the contract's
 * `redeemRequest(id)` now). The reserve drops by the request NAV of the shares just burned.
 */
export function handleRedeemPartiallyClaimed(event: RedeemPartiallyClaimed): void {
  const p = event.params
  const request = RedeemRequest.load(p.id.toString())
  if (request == null) return
  const vault = getVault(event.address, KIND, event)
  if (request.claimed) {
    // Defensive: the payment was taken for the last one, which released the whole reserve and closed the request.
    vault.reservedAssets = orZero(vault.reservedAssets).plus(p.assetsLeft)
    vault.pendingRedeemCount = vault.pendingRedeemCount + 1
    request.claimed = false
    request.claimedAssets = null
    request.claimedAtBlock = null
    request.claimedAtTimestamp = null
    request.claimTransactionHash = null
  } else {
    const released = zeroFloorSub(request.assetsLeft, p.assetsLeft)
    vault.reservedAssets = zeroFloorSub(orZero(vault.reservedAssets), released)
  }
  vault.save()

  request.status = PARTIALLY_CLAIMED
  request.sharesLeft = p.sharesLeft
  request.assetsLeft = p.assetsLeft
  request.save()
}

function newTrade(event: ethereum.Event, kind: string, trader: Bytes): BackstopTrade {
  const t = new BackstopTrade(eventId(event))
  t.kind = kind
  t.trader = trader
  t.blockNumber = event.block.number
  t.timestamp = event.block.timestamp
  t.transactionHash = event.transaction.hash
  t.logIndex = event.logIndex
  return t
}

export function handleCollateralBought(event: CollateralBought): void {
  const t = newTrade(event, 'BUY', event.params.seller)
  t.btcAmount = event.params.btcIn
  t.musdAmount = event.params.musdOut
  t.price = event.params.price
  t.save()
}

export function handleAuctionTaken(event: AuctionTaken): void {
  const t = newTrade(event, 'AUCTION', event.params.taker)
  t.recipient = event.params.to
  t.btcAmount = event.params.btcOut
  t.musdAmount = event.params.musdIn
  t.factorWad = event.params.factorWad
  t.save()
}

export function handleInventorySold(event: InventorySold): void {
  const t = newTrade(event, 'KEEPER_SALE', event.params.caller)
  t.btcAmount = event.params.btcIn
  t.musdAmount = event.params.musdOut
  t.venue = venueName(event.params.venue)
  t.save()
}

export function handleDepositsPausedSet(event: DepositsPausedSet): void {
  const vault = getVault(event.address, KIND, event)
  vault.depositsPaused = event.params.paused
  vault.save()

  const g = newGovernanceEvent(event, 'BACKSTOP_DEPOSITS_PAUSED_SET')
  g.caller = event.transaction.from
  g.flag = event.params.paused
  g.save()
}
