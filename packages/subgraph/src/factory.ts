import { BigInt, Bytes, crypto, ethereum } from '@graphprotocol/graph-ts'
import {
  Accepted,
  AccountCreated,
  CanaryOperatorSet,
  ComeBack,
  FeeRecipientSet,
  GlobalBorrowCapSet,
  GovernanceTransferred,
  GovernanceTransferStarted,
  LimitsSet,
  ModuleApprovalSet,
  PausedSet,
  Revoked,
  SentinelSet,
  Submitted,
} from '../generated/BorrowAccountFactory/BorrowAccountFactory'
import {
  Account,
  AccountAction,
  ProfileLimit,
  TimelockSlot,
  TimelockSubmission,
} from '../generated/schema'
import { BorrowAccount as BorrowAccountTemplate } from '../generated/templates'
import { eventId, getProtocol, newGovernanceEvent, profileName, ZERO } from './common'

export function handleAccountCreated(event: AccountCreated): void {
  const profile = profileName(event.params.profile)
  const account = new Account(event.params.account)
  account.owner = event.params.owner
  account.profile = profile
  account.canary = profile == 'CANARY'
  account.collateral = ZERO
  account.borrowShares = ZERO
  account.isOpen = false
  account.totalBorrowed = ZERO
  account.totalFeesPaid = ZERO
  account.totalRepaid = ZERO
  account.liquidationCount = 0
  account.createdAtBlock = event.block.number
  account.createdAtTimestamp = event.block.timestamp
  account.createdTransactionHash = event.transaction.hash
  account.lastActivityTimestamp = event.block.timestamp
  account.save()

  // Index the clone's own events (Opened, Borrowed, Repaid, ...) from now on.
  BorrowAccountTemplate.create(event.params.account)

  const protocol = getProtocol(event)
  protocol.accountCount = protocol.accountCount + 1
  if (account.canary) protocol.canaryAccountCount = protocol.canaryAccountCount + 1
  protocol.save()
}

/** Come back: BTC claimed from Mezo's surplus pool into the caller's account (then supplied as collateral). */
export function handleComeBack(event: ComeBack): void {
  const account = Account.load(event.params.account)
  if (account == null) return
  account.lastActivityTimestamp = event.block.timestamp
  account.save()

  const action = new AccountAction(eventId(event))
  action.account = account.id
  action.owner = event.params.owner
  action.kind = 'COME_BACK'
  action.btc = event.params.claimed
  action.blockNumber = event.block.number
  action.timestamp = event.block.timestamp
  action.transactionHash = event.transaction.hash
  action.logIndex = event.logIndex
  action.save()
}

// ---------------------------------------------------------------------------------------------------------------
// Timelock
// ---------------------------------------------------------------------------------------------------------------

function slotId(data: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(data))
}

/** Closes the pending submission for `data`, if any. */
function resolve(data: Bytes, status: string, by: Bytes, event: ethereum.Event): void {
  const slot = TimelockSlot.load(slotId(data))
  if (slot == null) return
  const pendingId = slot.pending
  if (!pendingId) return
  const submission = TimelockSubmission.load(pendingId)
  if (submission != null) {
    submission.status = status
    submission.resolvedBy = by
    submission.resolvedAtBlock = event.block.number
    submission.resolvedAtTimestamp = event.block.timestamp
    submission.resolveTransactionHash = event.transaction.hash
    submission.save()
  }
  slot.pending = null
  slot.save()
}

export function handleSubmitted(event: Submitted): void {
  const submission = new TimelockSubmission(eventId(event))
  submission.contract = event.address
  submission.selector = event.params.selector
  submission.data = event.params.data
  submission.executableAt = event.params.executableAt
  submission.status = 'PENDING'
  submission.blockNumber = event.block.number
  submission.timestamp = event.block.timestamp
  submission.transactionHash = event.transaction.hash
  submission.save()

  const slot = new TimelockSlot(slotId(event.params.data))
  slot.pending = submission.id
  slot.save()

  const g = newGovernanceEvent(event, 'TIMELOCK_SUBMITTED')
  g.caller = event.transaction.from
  g.selector = event.params.selector
  g.data = event.params.data
  g.value = event.params.executableAt
  g.save()
}

export function handleRevoked(event: Revoked): void {
  resolve(event.params.data, 'REVOKED', event.params.caller, event)

  const g = newGovernanceEvent(event, 'TIMELOCK_REVOKED')
  g.caller = event.params.caller
  g.selector = event.params.selector
  g.data = event.params.data
  g.save()
}

export function handleAccepted(event: Accepted): void {
  resolve(event.params.data, 'ACCEPTED', event.transaction.from, event)

  const g = newGovernanceEvent(event, 'TIMELOCK_ACCEPTED')
  g.caller = event.transaction.from
  g.selector = event.params.selector
  g.data = event.params.data
  g.save()
}

// ---------------------------------------------------------------------------------------------------------------
// Parameters and roles
// ---------------------------------------------------------------------------------------------------------------

export function handleGlobalBorrowCapSet(event: GlobalBorrowCapSet): void {
  const protocol = getProtocol(event)
  protocol.globalBorrowCap = event.params.globalBorrowCap
  protocol.save()

  const g = newGovernanceEvent(event, 'GLOBAL_BORROW_CAP_SET')
  g.caller = event.params.caller
  g.value = event.params.globalBorrowCap
  g.save()
}

export function handleLimitsSet(event: LimitsSet): void {
  const profile = profileName(event.params.profile)
  let limit = ProfileLimit.load(profile)
  if (limit == null) {
    limit = new ProfileLimit(profile)
    limit.profile = profile
  }
  limit.positionCap = event.params.positionCap
  limit.ceilingBps = event.params.ceilingBps
  limit.updatedAtBlock = event.block.number
  limit.updatedAtTimestamp = event.block.timestamp
  limit.save()

  const g = newGovernanceEvent(event, 'LIMITS_SET')
  g.caller = event.params.caller
  g.profile = profile
  g.value = event.params.positionCap
  g.value2 = BigInt.fromI32(event.params.ceilingBps)
  g.save()
}

export function handleFeeRecipientSet(event: FeeRecipientSet): void {
  const protocol = getProtocol(event)
  protocol.feeRecipient = event.params.feeRecipient
  protocol.save()

  const g = newGovernanceEvent(event, 'FEE_RECIPIENT_SET')
  g.caller = event.transaction.from
  g.target = event.params.feeRecipient
  g.save()
}

export function handleModuleApprovalSet(event: ModuleApprovalSet): void {
  const g = newGovernanceEvent(event, 'MODULE_APPROVAL_SET')
  g.caller = event.params.caller
  g.target = event.params.module
  g.flag = event.params.approved
  g.save()
}

export function handlePausedSet(event: PausedSet): void {
  const protocol = getProtocol(event)
  protocol.borrowPaused = event.params.borrowPaused
  protocol.creditPaused = event.params.creditPaused
  protocol.save()

  const g = newGovernanceEvent(event, 'PAUSED_SET')
  g.caller = event.params.caller
  g.flag = event.params.borrowPaused
  g.flag2 = event.params.creditPaused
  g.save()
}

export function handleCanaryOperatorSet(event: CanaryOperatorSet): void {
  const g = newGovernanceEvent(event, 'CANARY_OPERATOR_SET')
  g.caller = event.transaction.from
  g.target = event.params.operator
  g.flag = event.params.enabled
  g.save()
}

export function handleSentinelSet(event: SentinelSet): void {
  const protocol = getProtocol(event)
  protocol.sentinel = event.params.sentinel
  protocol.save()

  const g = newGovernanceEvent(event, 'SENTINEL_SET')
  g.caller = event.transaction.from
  g.target = event.params.sentinel
  g.save()
}

export function handleGovernanceTransferStarted(event: GovernanceTransferStarted): void {
  const protocol = getProtocol(event)
  protocol.pendingGovernor = event.params.pendingGovernor
  protocol.save()

  const g = newGovernanceEvent(event, 'GOVERNANCE_TRANSFER_STARTED')
  g.caller = event.params.governor
  g.target = event.params.pendingGovernor
  g.save()
}

export function handleGovernanceTransferred(event: GovernanceTransferred): void {
  const protocol = getProtocol(event)
  protocol.governor = event.params.newGovernor
  protocol.pendingGovernor = null
  protocol.save()

  const g = newGovernanceEvent(event, 'GOVERNANCE_TRANSFERRED')
  g.caller = event.params.previousGovernor
  g.target = event.params.newGovernor
  g.save()
}
