// BorrowAccount clones (data source template, created on AccountCreated). Position state (collateral, borrow
// shares) comes from Morpho's events in morpho.ts; these handlers record what the owner did and the fees paid.

import { Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Account, AccountAction } from '../generated/schema'
import {
  Borrowed,
  CollateralAdded,
  CollateralWithdrawn,
  Exited,
  Opened,
  Repaid,
} from '../generated/templates/BorrowAccount/BorrowAccount'
import { eventId, getProtocol, ZERO } from './common'

function newAction(
  event: ethereum.Event,
  account: Account,
  owner: Bytes,
  kind: string,
): AccountAction {
  const action = new AccountAction(eventId(event))
  action.account = account.id
  action.owner = owner
  action.kind = kind
  action.blockNumber = event.block.number
  action.timestamp = event.block.timestamp
  action.transactionHash = event.transaction.hash
  action.logIndex = event.logIndex
  return action
}

function touch(event: ethereum.Event): Account | null {
  const account = Account.load(event.address)
  if (account == null) return null
  account.lastActivityTimestamp = event.block.timestamp
  return account
}

export function handleOpened(event: Opened): void {
  const account = touch(event)
  if (account == null) return
  account.save()
  const action = newAction(event, account, event.params.owner, 'OPENED')
  action.btc = event.params.collateralAdded
  action.musd = event.params.musdOut
  action.save()
}

export function handleBorrowed(event: Borrowed): void {
  const account = touch(event)
  if (account == null) return
  account.totalBorrowed = account.totalBorrowed.plus(event.params.musdOut)
  account.totalFeesPaid = account.totalFeesPaid.plus(event.params.fee)
  account.save()

  const action = newAction(event, account, event.params.owner, 'BORROWED')
  action.musd = event.params.musdOut
  action.fee = event.params.fee
  action.debtAfter = event.params.debt
  action.ltvBps = event.params.ltvBps.toI32()
  action.save()

  const protocol = getProtocol(event)
  protocol.totalBorrowed = protocol.totalBorrowed.plus(event.params.musdOut)
  protocol.totalOriginationFees = protocol.totalOriginationFees.plus(event.params.fee)
  protocol.save()
}

export function handleRepaid(event: Repaid): void {
  const account = touch(event)
  if (account == null) return
  account.totalRepaid = account.totalRepaid.plus(event.params.repaid)
  account.save()

  const action = newAction(event, account, event.params.owner, 'REPAID')
  action.musd = event.params.repaid
  action.debtAfter = event.params.remainingDebt
  action.save()

  const protocol = getProtocol(event)
  protocol.totalRepaid = protocol.totalRepaid.plus(event.params.repaid)
  protocol.save()
}

export function handleExited(event: Exited): void {
  const account = touch(event)
  if (account == null) return
  account.totalRepaid = account.totalRepaid.plus(event.params.repaid)
  account.save()

  const action = newAction(event, account, event.params.owner, 'EXITED')
  action.musd = event.params.repaid
  action.btc = event.params.btcOut
  action.debtAfter = ZERO
  action.collateralAfter = ZERO
  action.save()

  const protocol = getProtocol(event)
  protocol.totalRepaid = protocol.totalRepaid.plus(event.params.repaid)
  protocol.save()
}

export function handleCollateralAdded(event: CollateralAdded): void {
  const account = touch(event)
  if (account == null) return
  account.save()
  const action = newAction(event, account, event.params.owner, 'COLLATERAL_ADDED')
  action.btc = event.params.amount
  action.collateralAfter = event.params.collateral
  action.save()
}

export function handleCollateralWithdrawn(event: CollateralWithdrawn): void {
  const account = touch(event)
  if (account == null) return
  account.save()
  const action = newAction(event, account, event.params.owner, 'COLLATERAL_WITHDRAWN')
  action.btc = event.params.amount
  action.recipient = event.params.btcTo
  action.save()
}
