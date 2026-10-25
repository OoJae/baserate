import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { GovernanceEvent, Protocol, SharePricePoint, Vault, VaultFlow } from '../generated/schema'

export const ZERO = BigInt.zero()
export const ONE = BigInt.fromI32(1)
export const WAD = BigInt.fromString('1000000000000000000')
/** Flows smaller than this many shares are too coarse for an assets/shares price (rounding is up to 1 wei). */
export const MIN_PRICE_SHARES = BigInt.fromString('1000000000000')

export const PROTOCOL_ID = 'baserate'
export const SECONDS_PER_DAY = 86400

/** Unique, compact id for an event entity: transaction hash + log index. */
export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

export function getProtocol(event: ethereum.Event): Protocol {
  let protocol = Protocol.load(PROTOCOL_ID)
  if (protocol == null) {
    protocol = new Protocol(PROTOCOL_ID)
    protocol.accountCount = 0
    protocol.canaryAccountCount = 0
    protocol.openPositionCount = 0
    protocol.totalBorrowed = ZERO
    protocol.totalOriginationFees = ZERO
    protocol.totalRepaid = ZERO
    protocol.liquidationCount = 0
    protocol.totalSeizedCollateral = ZERO
    protocol.totalLiquidatorProfit = ZERO
    protocol.distributionCount = 0
    protocol.totalDistributed = ZERO
    protocol.totalToSmusd = ZERO
    protocol.totalToBribes = ZERO
    protocol.totalToTreasury = ZERO
    protocol.totalSmusdToTreasury = ZERO
    protocol.feeRouterCarried = ZERO
    protocol.smusdFailingSince = ZERO
    protocol.borrowPaused = false
    protocol.creditPaused = false
  }
  protocol.updatedAtBlock = event.block.number
  protocol.updatedAtTimestamp = event.block.timestamp
  return protocol
}

// ---------------------------------------------------------------------------------------------------------------
// Solidity enums → schema enums
// ---------------------------------------------------------------------------------------------------------------

export function profileName(value: i32): string {
  return value == 1 ? 'CANARY' : 'STANDARD'
}

export function venueName(value: i32): string {
  if (value == 0) return 'BACKSTOP'
  if (value == 1) return 'CL200'
  return 'VAMM'
}

export function allocatorActionName(value: i32): string {
  if (value == 1) return 'BUFFER_TOP_UP'
  if (value == 2) return 'TO_MARKET'
  if (value == 3) return 'TO_LIQUIDITY'
  return 'NONE'
}

export function redirectReasonName(value: i32): string {
  if (value == 0) return 'GAUGE_DEAD'
  if (value == 1) return 'VOTER_UNREADABLE'
  return 'NOTIFY_FAILED'
}

export function carryReasonName(value: i32): string {
  return value == 0 ? 'VOTE_WINDOW_CLOSED' : 'NO_VOTES'
}

// ---------------------------------------------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------------------------------------------

/** a / b, 0 when b is 0. */
export function ratio(a: BigInt, b: BigInt): BigDecimal {
  if (b.isZero()) return BigDecimal.zero()
  return a.toBigDecimal().div(b.toBigDecimal())
}

/**
 * A nullable BigInt field, or 0. (AssemblyScript 0.19 cannot compile `x == null` on classes that overload `==`,
 * such as BigInt and Bytes: test them with `!x`.)
 */
export function orZero(value: BigInt | null): BigInt {
  if (!value) return ZERO
  return value
}

/** max(a - b, 0), Morpho's zeroFloorSub. */
export function zeroFloorSub(a: BigInt, b: BigInt): BigInt {
  return a.gt(b) ? a.minus(b) : ZERO
}

/**
 * convertToAssets(1e18) of an ERC-4626 vault with a zero decimals offset (wsMUSD, the backstop, and Vault V2 over
 * an 18-decimal asset): (totalAssets + 1) x 1e18 / (totalSupply + 1).
 */
export function sharePriceOf(totalAssets: BigInt, totalSupply: BigInt): BigInt {
  return totalAssets.plus(ONE).times(WAD).div(totalSupply.plus(ONE))
}

// ---------------------------------------------------------------------------------------------------------------
// Vaults
// ---------------------------------------------------------------------------------------------------------------

export function getVault(address: Address, kind: string, event: ethereum.Event): Vault {
  let vault = Vault.load(address)
  if (vault == null) {
    vault = new Vault(address)
    vault.kind = kind
    vault.totalSupply = ZERO
    vault.totalAssets = ZERO
    vault.sharePrice = WAD
    vault.depositCount = 0
    vault.withdrawCount = 0
    vault.totalDeposited = ZERO
    vault.totalWithdrawn = ZERO
    if (kind == 'WSMUSD' || kind == 'BACKSTOP') {
      vault.unvested = ZERO
      vault.vestingEnd = ZERO
    }
    if (kind == 'BACKSTOP') {
      vault.inventory = ZERO
      vault.reservedAssets = ZERO
      vault.pendingRedeemCount = 0
      vault.depositsPaused = false
    }
    if (kind == 'VMUSD') {
      vault.performanceFeeShares = ZERO
      vault.managementFeeShares = ZERO
    }
  }
  vault.updatedAtBlock = event.block.number
  vault.updatedAtTimestamp = event.block.timestamp
  return vault
}

/** Upserts the vault's share-price point for this block from its current state (the block's last value wins). */
export function recordSharePrice(vault: Vault, source: string, event: ethereum.Event): void {
  const id = vault.id.concatI32(event.block.number.toI32())
  let point = SharePricePoint.load(id)
  if (point == null) {
    point = new SharePricePoint(id)
    point.vault = vault.id
    point.blockNumber = event.block.number
    point.timestamp = event.block.timestamp
  }
  point.sharePrice = vault.sharePrice
  point.totalAssets = vault.totalAssets
  point.totalSupply = vault.totalSupply
  point.source = source
  point.save()
}

export function newVaultFlow(
  event: ethereum.Event,
  vault: Bytes,
  kind: string,
  sender: Bytes,
  owner: Bytes,
  assets: BigInt,
  shares: BigInt,
): VaultFlow {
  const flow = new VaultFlow(eventId(event))
  flow.vault = vault
  flow.kind = kind
  flow.sender = sender
  flow.owner = owner
  flow.assets = assets
  flow.shares = shares
  flow.blockNumber = event.block.number
  flow.timestamp = event.block.timestamp
  flow.transactionHash = event.transaction.hash
  flow.logIndex = event.logIndex
  return flow
}

// ---------------------------------------------------------------------------------------------------------------
// Governance log
// ---------------------------------------------------------------------------------------------------------------

export function newGovernanceEvent(event: ethereum.Event, kind: string): GovernanceEvent {
  const g = new GovernanceEvent(eventId(event))
  g.contract = event.address
  g.kind = kind
  g.blockNumber = event.block.number
  g.timestamp = event.block.timestamp
  g.transactionHash = event.transaction.hash
  g.logIndex = event.logIndex
  return g
}
