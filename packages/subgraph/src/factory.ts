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
  PendingInvalidated,
  Revoked,
  SentinelSet,
  Submitted,
} from '../generated/BorrowAccountFactory/BorrowAccountFactory'
import {
  Account,
  AccountAction,
  ProfileLimit,
  TimelockParam,
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
//
// A submitted call is executable from `executableAt` until `executableAt + EXECUTION_WINDOW` (it then expires), unless
// it is revoked or an instant decrease of the same parameter invalidates it first (PendingInvalidated). The factory
// keys parameters by selector plus the first argument word (zero for setGlobalBorrowCap); TimelockParam mirrors that
// key so PendingInvalidated can close every call queued for it.

/** BorrowAccountFactory.EXECUTION_WINDOW: 14 days. */
export const EXECUTION_WINDOW = BigInt.fromI32(14 * 86400)
/** `setGlobalBorrowCap(uint256)`: its parameter key has no argument word. */
const SET_GLOBAL_BORROW_CAP = Bytes.fromHexString('0xfccdf210')
const ZERO_WORD = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000000000000000000000000000',
)

function slotId(data: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(data))
}

/** The parameter `data` changes, as PendingInvalidated reports it (the factory's `_paramKey`). */
function paramOf(selector: Bytes, data: Bytes): Bytes {
  if (selector.equals(SET_GLOBAL_BORROW_CAP) || data.length < 36) return ZERO_WORD
  return Bytes.fromUint8Array(data.subarray(4, 36))
}

function paramId(selector: Bytes, param: Bytes): Bytes {
  return selector.concat(param)
}

/** Drops `id` from its parameter's pending list. */
function unlistPending(submission: TimelockSubmission): void {
  const group = TimelockParam.load(paramId(submission.selector, submission.param))
  if (group == null) return
  const kept: Bytes[] = []
  const pending = group.pending
  for (let i = 0; i < pending.length; i++) {
    if (!pending[i].equals(submission.id)) kept.push(pending[i])
  }
  group.pending = kept
  group.save()
}

function close(
  submission: TimelockSubmission,
  status: string,
  by: Bytes | null,
  event: ethereum.Event | null,
): void {
  submission.status = status
  if (event != null) {
    submission.resolvedBy = by
    submission.resolvedAtBlock = event.block.number
    submission.resolvedAtTimestamp = event.block.timestamp
    submission.resolveTransactionHash = event.transaction.hash
  }
  submission.save()
}

/** Closes the pending submission for `data`, if any. */
function resolve(data: Bytes, status: string, by: Bytes, event: ethereum.Event): void {
  const slot = TimelockSlot.load(slotId(data))
  if (slot == null) return
  const pendingId = slot.pending
  if (!pendingId) return
  const submission = TimelockSubmission.load(pendingId)
  if (submission != null) {
    close(submission, status, by, event)
    unlistPending(submission)
  }
  slot.pending = null
  slot.save()
}

export function handleSubmitted(event: Submitted): void {
  // `submit` reverts while the same calldata is live, so a submission still pending here has expired.
  const previous = TimelockSlot.load(slotId(event.params.data))
  if (previous != null) {
    const previousId = previous.pending
    if (previousId) {
      const expired = TimelockSubmission.load(previousId)
      if (expired != null) {
        close(expired, 'EXPIRED', null, null)
        unlistPending(expired)
      }
    }
  }

  const submission = new TimelockSubmission(eventId(event))
  submission.contract = event.address
  submission.selector = event.params.selector
  submission.data = event.params.data
  submission.param = paramOf(event.params.selector, event.params.data)
  submission.executableAt = event.params.executableAt
  submission.expiresAt = event.params.executableAt.plus(EXECUTION_WINDOW)
  submission.status = 'PENDING'
  submission.blockNumber = event.block.number
  submission.timestamp = event.block.timestamp
  submission.transactionHash = event.transaction.hash
  submission.save()

  const slot = new TimelockSlot(slotId(event.params.data))
  slot.pending = submission.id
  slot.save()

  const key = paramId(submission.selector, submission.param)
  let group = TimelockParam.load(key)
  if (group == null) {
    group = new TimelockParam(key)
    group.pending = [] as Bytes[]
  }
  const pending = group.pending
  pending.push(submission.id)
  group.pending = pending
  group.save()

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

/**
 * An instant decrease (governor or sentinel) bumped the parameter's epoch: every call queued for it until now is
 * no longer executable. Those already past their execution window are recorded as EXPIRED instead.
 */
export function handlePendingInvalidated(event: PendingInvalidated): void {
  const selector = event.params.selector
  const param = event.params.param
  let invalidated = 0
  const group = TimelockParam.load(paramId(selector, param))
  if (group != null) {
    const pending = group.pending
    for (let i = 0; i < pending.length; i++) {
      const submission = TimelockSubmission.load(pending[i])
      if (submission == null || submission.status != 'PENDING') continue
      if (event.block.timestamp.gt(submission.expiresAt)) {
        close(submission, 'EXPIRED', null, null)
      } else {
        close(submission, 'INVALIDATED', event.transaction.from, event)
        invalidated++
      }
      const slot = TimelockSlot.load(slotId(submission.data))
      if (slot != null) {
        const slotPending = slot.pending
        if (slotPending) {
          if (slotPending.equals(submission.id)) {
            slot.pending = null
            slot.save()
          }
        }
      }
    }
    group.pending = [] as Bytes[]
    group.save()
  }

  const g = newGovernanceEvent(event, 'TIMELOCK_INVALIDATED')
  g.caller = event.transaction.from
  g.selector = selector
  g.param = param
  g.value = BigInt.fromI32(invalidated)
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
