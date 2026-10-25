import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
  HttpRequestError,
  InsufficientFundsError,
  isHex,
  TimeoutError,
  UserRejectedRequestError,
} from 'viem'
import { baserateErrorsAbi } from './abis'
import { formatBps, formatDuration, formatMusd, formatUsd } from './format'

/**
 * Turns wallet, RPC and revert errors into plain messages. Reverts are decoded against every Baserate custom
 * error, OpenZeppelin v5 errors, sMUSD errors and Morpho's string reasons.
 */

export type DecodedErrorKind =
  | 'rejected'
  | 'contract'
  | 'revert'
  | 'panic'
  | 'funds'
  | 'chain'
  | 'network'
  | 'unknown'

export interface DecodedError {
  kind: DecodedErrorKind
  /** Short headline, e.g. "Oracle price is stale". */
  title: string
  /** One or two plain sentences on what happened and what to do. */
  message: string
  /** Custom error name or revert reason, when known. */
  errorName?: string
  args?: readonly unknown[]
  /** 4-byte selector of an undecodable custom error. */
  selector?: Hex
}

const ORACLE_GUARD_NOTE = 'Borrowing is paused by the oracle guard; repay and withdraw still work.'

/** Plain-language text for a decoded custom error. */
export function describeCustomError(
  name: string,
  args: readonly unknown[] = [],
): Pick<DecodedError, 'title' | 'message'> {
  const big = (i: number): bigint => (typeof args[i] === 'bigint' ? (args[i] as bigint) : 0n)
  switch (name) {
    case 'SkipStale':
      return {
        title: 'Oracle price is stale',
        message: `The Skip BTC/USD price is ${formatDuration(big(0))} old and borrows need it under 60 s. ${ORACLE_GUARD_NOTE}`,
      }
    case 'SkipInvalidAnswer':
      return {
        title: 'Oracle returned no price',
        message: `The Skip BTC/USD feed returned an invalid answer. ${ORACLE_GUARD_NOTE}`,
      }
    case 'PythDeviation':
      return {
        title: 'Oracle sanity band tripped',
        message: `Skip (${formatUsd(big(0))}) and Pyth (${formatUsd(big(1))}) disagree by more than 10%. ${ORACLE_GUARD_NOTE}`,
      }
    case 'LtvTooHigh':
      return {
        title: 'Loan-to-value too high',
        message: `This would put the position at ${formatBps(big(0))} LTV, above the ${formatBps(big(1))} limit. Borrow less or add more BTC.`,
      }
    case 'PositionCapExceeded':
      return {
        title: 'Position cap reached',
        message:
          'Borrowing needs the position to stay within the per-position collateral cap. Borrow against less BTC. Adding collateral without borrowing is always allowed.',
      }
    case 'InvalidReceiver':
      return {
        title: 'Invalid receiver',
        message: 'Funds cannot be sent to the borrow account itself. Choose your wallet instead.',
      }
    case 'NotCanaryOperator':
      return {
        title: 'Not a canary operator',
        message: 'Only canary operators can borrow on canary accounts.',
      }
    case 'DustRemainder':
      return {
        title: 'Would leave dust',
        message: 'Take the whole backstop inventory, or leave a larger amount behind.',
      }
    case 'NotRequestOwner':
      return {
        title: 'Not your exit request',
        message: 'Only the owner of this exit request can claim it without the oracle.',
      }
    case 'GlobalCapExceeded':
      return {
        title: 'Market borrow cap reached',
        message: 'The market-wide borrow cap would be exceeded. Try a smaller amount.',
      }
    case 'BorrowPaused':
      return {
        title: 'Borrowing is paused',
        message:
          'New borrows are paused by the risk sentinel. Repay, withdraw and adding collateral still work.',
      }
    case 'Unauthorized':
      return { title: 'Not your account', message: 'Only the account owner can do this.' }
    case 'ModuleNotApproved':
      return {
        title: 'Module not approved',
        message: 'This module is not approved by the factory.',
      }
    case 'NotAccount':
      return {
        title: 'Not a borrow account',
        message: 'Only Baserate borrow accounts can wrap BTC collateral.',
      }
    case 'TransferRestricted':
      return {
        title: 'Collateral transfer blocked',
        message: 'bcBTC only moves between borrow accounts and Morpho. Unwrap it instead.',
      }
    case 'NativeSendFailed':
      return {
        title: 'BTC transfer failed',
        message: 'Sending native BTC failed. Check that the receiving address can accept BTC.',
      }
    case 'ZeroAmount':
      return { title: 'Amount is zero', message: 'Enter an amount greater than zero.' }
    case 'AmountTooSmall':
      return { title: 'Amount too small', message: 'sMUSD rejects amounts this small.' }
    case 'InsufficientBalance':
      return args.length === 0
        ? { title: 'Not enough sMUSD', message: 'The sMUSD balance is too low for this.' }
        : {
            title: 'Not enough BTC',
            message: `Balance ${formatMusd(big(0), { dp: 6 })} is below the ${formatMusd(big(1), { dp: 6 })} needed.`,
          }
    case 'ERC20InsufficientBalance':
      return {
        title: 'Not enough balance',
        message: `You have ${formatMusd(big(1))} but this needs ${formatMusd(big(2))}.`,
      }
    case 'ERC20InsufficientAllowance':
      return {
        title: 'Allowance too low',
        message: `${formatMusd(big(1))} is approved but ${formatMusd(big(2))} is needed. Approve again or sign a new permit.`,
      }
    case 'ERC2612ExpiredSignature':
      return { title: 'Permit expired', message: 'The permit signature expired. Sign again.' }
    case 'ERC2612InvalidSigner':
      return {
        title: 'Permit signer mismatch',
        message: 'The permit was not signed by the token owner. Sign again from this wallet.',
      }
    case 'InvalidAccountNonce':
      return { title: 'Permit nonce changed', message: 'Your permit nonce moved on. Sign again.' }
    case 'ECDSAInvalidSignature':
    case 'ECDSAInvalidSignatureLength':
    case 'ECDSAInvalidSignatureS':
      return { title: 'Invalid signature', message: 'The signature could not be verified.' }
    case 'ERC4626ExceededMaxDeposit':
      return {
        title: 'wsMUSD cap reached',
        message: `The deposit cap allows at most ${formatMusd(big(2))} MUSD right now.`,
      }
    case 'ERC4626ExceededMaxMint':
      return {
        title: 'wsMUSD cap reached',
        message: `At most ${formatMusd(big(2))} wsMUSD can be minted right now.`,
      }
    case 'ERC4626ExceededMaxWithdraw':
      return {
        title: 'Withdrawal too large',
        message: `You can withdraw at most ${formatMusd(big(2))} MUSD.`,
      }
    case 'ERC4626ExceededMaxRedeem':
      return {
        title: 'Redemption too large',
        message: `You can redeem at most ${formatMusd(big(2))} wsMUSD.`,
      }
    case 'ReentrancyGuardReentrantCall':
      return { title: 'Re-entrant call', message: 'The contract rejected a re-entrant call.' }
    case 'SafeERC20FailedOperation':
      return { title: 'Token transfer failed', message: 'A token transfer inside the call failed.' }
    case 'OwnableUnauthorizedAccount':
      return { title: 'Owner only', message: 'Only the contract owner can do this.' }
    case 'EnforcedPause':
      return { title: 'Paused', message: 'This contract is paused.' }
    // FlashLiquidator
    case 'NothingToLiquidate':
      return {
        title: 'Nothing to liquidate',
        message: 'This position has no debt in the market, so there is nothing to liquidate.',
      }
    case 'ImpactTooHigh':
      return {
        title: 'Price impact too high',
        message: `The venue would pay ${formatMusd(big(0))} MUSD, below the ${formatMusd(big(1))} MUSD floor (the seized BTC at the oracle price minus the maximum impact). Try another venue.`,
      }
    case 'InsufficientProceeds':
      return {
        title: 'Sale does not cover the debt',
        message: `Selling the seized BTC would return ${formatMusd(big(0))} MUSD but ${formatMusd(big(1))} MUSD must be repaid. Try another venue.`,
      }
    case 'ProfitTooLow':
      return {
        title: 'Profit below your minimum',
        message: `This liquidation would pay ${formatMusd(big(0), { dp: 4 })} MUSD, below your ${formatMusd(big(1), { dp: 4 })} MUSD minimum. Prices moved; refresh the preview.`,
      }
    case 'VenueUnavailable':
      return {
        title: 'Venue unavailable',
        message: `${['The backstop', 'The CL200 pool', 'The vAMM pool'][Number(args[0])] ?? 'This venue'} is not available on this network.`,
      }
    // Backstop
    case 'InsufficientCash':
      return {
        title: 'Backstop is short of cash',
        message: `The backstop needs ${formatMusd(big(0))} MUSD but only ${formatMusd(big(1))} MUSD is free. Sell on a DEX venue instead.`,
      }
    case 'InsufficientOutput':
      return {
        title: 'Output below minimum',
        message: `The call would pay ${formatMusd(big(0))} MUSD, below the ${formatMusd(big(1))} MUSD minimum.`,
      }
    case 'ExcessiveInput':
      return {
        title: 'Auction price moved',
        message: `The auction now costs ${formatMusd(big(0))} MUSD, above your ${formatMusd(big(1))} MUSD maximum. Refresh the quote.`,
      }
    case 'ExceedsInventory':
      return {
        title: 'More BTC than the backstop holds',
        message: `At most ${formatMusd(big(1), { dp: 8 })} BTC is available.`,
      }
    case 'UseRedeemQueue':
      return {
        title: 'Use the redeem queue',
        message: 'Backstop exits go through Request redeem, then Claim after 7 days.',
      }
    case 'UnknownRequest':
      return {
        title: 'No such request',
        message: `Redeem request #${big(0).toString()} is not pending (already claimed or never made).`,
      }
    case 'NotClaimable':
      return {
        title: 'Not claimable yet',
        message: `Redeem request #${big(0).toString()} unlocks on ${new Date(Number(big(1)) * 1000).toUTCString()}.`,
      }
    case 'OracleUnavailable':
      return {
        title: 'Oracle unavailable',
        message:
          'The backstop holds BTC and the oracle is down, so its NAV cannot be computed now.',
      }
    case 'NotLiquidator':
      return {
        title: 'Liquidator only',
        message: 'Only the FlashLiquidator can sell collateral to the backstop.',
      }
    // BaserateAllocator
    case 'CooldownActive':
      return {
        title: 'Rebalance cooling down',
        message: `The allocator moved funds less than an hour ago. Next rebalance from ${new Date(Number(big(0)) * 1000).toUTCString()}.`,
      }
    // FeeRouter
    case 'NothingToDistribute':
      return {
        title: 'Nothing to distribute',
        message:
          'The fee router holds no MUSD yet. Origination fees arrive once the factory points at it.',
      }
    case 'InsufficientGas':
      return {
        title: 'Not enough gas',
        message: 'Send the distribution with more gas so every bribe gets its full stipend.',
      }
    // RiskLens
    case 'TooManySizes':
      return {
        title: 'Too many depth sizes',
        message: `At most ${big(1).toString()} BTC sizes fit in one snapshot.`,
      }
    case 'TooManyTroves':
      return {
        title: 'Too many troves',
        message: `At most ${big(1).toString()} troves fit in one snapshot.`,
      }
    // Morpho Vault V2 (vMUSD)
    case 'AbsoluteCapExceeded':
    case 'RelativeCapExceeded':
      return {
        title: 'Vault cap reached',
        message: 'This would take one of vMUSD’s allocations above its cap. Try a smaller amount.',
      }
    case 'ZeroAbsoluteCap':
      return {
        title: 'Allocation not enabled',
        message: 'The curator has not set a cap for this allocation yet.',
      }
    case 'CannotReceiveShares':
    case 'CannotSendShares':
    case 'CannotReceiveAssets':
    case 'CannotSendAssets':
      return { title: 'Blocked by a vault gate', message: 'A vMUSD gate rejected this address.' }
    case 'TransferFromReverted':
    case 'TransferFromReturnedFalse':
      return {
        title: 'Token transfer failed',
        message: 'The vault could not pull your MUSD. Check your balance and approval.',
      }
    default:
      return { title: `Reverted: ${name}`, message: `The contract reverted with ${name}.` }
  }
}

/** Morpho Blue reverts with string reasons (ErrorsLib). */
const MORPHO_REASONS: Record<string, Pick<DecodedError, 'title' | 'message'>> = {
  'insufficient collateral': {
    title: 'Not enough collateral',
    message: 'At the current oracle price the position would be over its borrow limit.',
  },
  'insufficient liquidity': {
    title: 'Not enough market liquidity',
    message:
      'The market does not hold enough MUSD for this borrow right now. Try a smaller amount.',
  },
  'market not created': {
    title: 'Market not found',
    message: 'The Baserate market does not exist on this network yet.',
  },
  'zero assets': { title: 'Amount is zero', message: 'Enter an amount greater than zero.' },
  'inconsistent input': {
    title: 'Inconsistent input',
    message: 'The request mixed asset and share amounts.',
  },
  unauthorized: {
    title: 'Not authorized',
    message: 'This address is not authorized on that position.',
  },
  'position is healthy': {
    title: 'Position is healthy',
    message: 'Only unhealthy positions can be liquidated.',
  },
  'transfer reverted': {
    title: 'Token transfer failed',
    message: 'A token transfer inside Morpho failed.',
  },
  'transfer from reverted': {
    title: 'Token transfer failed',
    message: 'Morpho could not pull the tokens. Check balance and allowance.',
  },
  'max uint128 exceeded': {
    title: 'Amount too large',
    message: 'The amount exceeds what Morpho can store.',
  },
}

export function describeRevertReason(reason: string): Pick<DecodedError, 'title' | 'message'> {
  return (
    MORPHO_REASONS[reason.toLowerCase()] ?? {
      title: 'Transaction would revert',
      message: reason,
    }
  )
}

/** Decodes raw revert data (custom error, `Error(string)` or `Panic(uint256)`). */
export function decodeRevertData(data: Hex): DecodedError {
  if (!isHex(data) || data.length < 10) {
    return {
      kind: 'revert',
      title: 'Transaction would revert',
      message: 'The call reverted without a reason.',
    }
  }
  try {
    const decoded = decodeErrorResult({ abi: baserateErrorsAbi, data })
    const args = (decoded.args ?? []) as readonly unknown[]
    // viem also decodes the built-in Error(string) and Panic(uint256).
    const name = decoded.errorName as string
    if (name === 'Error') {
      return {
        kind: 'revert',
        errorName: String(args[0]),
        ...describeRevertReason(String(args[0])),
      }
    }
    if (name === 'Panic') {
      return {
        kind: 'panic',
        errorName: 'Panic',
        args,
        title: 'Contract panic',
        message: `The contract hit an internal error (panic ${String(args[0])}).`,
      }
    }
    return { kind: 'contract', errorName: name, args, ...describeCustomError(name, args) }
  } catch {
    const selector = data.slice(0, 10) as Hex
    return {
      kind: 'contract',
      selector,
      title: 'Transaction would revert',
      message: `The contract reverted with an unrecognised error (${selector}).`,
    }
  }
}

function isUserRejection(e: unknown): boolean {
  if (e instanceof UserRejectedRequestError) return true
  const code = (e as { code?: unknown } | null)?.code
  if (code === 4001 || code === 'ACTION_REJECTED') return true
  const msg = (e as { message?: unknown } | null)?.message
  return typeof msg === 'string' && /user (rejected|denied)|rejected the request/i.test(msg)
}

/** Best-effort, never-throwing decoder for anything a wallet, RPC or simulation can throw. */
export function decodeBaserateError(error: unknown): DecodedError {
  if (error instanceof BaseError) {
    if (error.walk(isUserRejection)) {
      return {
        kind: 'rejected',
        title: 'Request rejected',
        message: 'You rejected the request in your wallet.',
      }
    }
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as
      | (ContractFunctionRevertedError & { raw?: Hex })
      | null
    if (revert) {
      const name = revert.data?.errorName
      if (name === 'Error' || (!name && revert.reason)) {
        const reason = revert.reason ?? String(revert.data?.args?.[0] ?? '')
        return { kind: 'revert', errorName: reason, ...describeRevertReason(reason) }
      }
      if (name === 'Panic') {
        return {
          kind: 'panic',
          errorName: 'Panic',
          title: 'Contract panic',
          message: revert.reason ?? 'The contract hit an internal error.',
        }
      }
      if (name) {
        const args = (revert.data?.args ?? []) as readonly unknown[]
        return { kind: 'contract', errorName: name, args, ...describeCustomError(name, args) }
      }
      if (revert.raw) return decodeRevertData(revert.raw)
      if (revert.signature) return decodeRevertData(revert.signature)
      return {
        kind: 'revert',
        title: 'Transaction would revert',
        message: 'The call reverted without a reason.',
      }
    }
    // Raw revert data surfaced by RPC errors outside a contract-call wrapper.
    const withData = error.walk((e) => {
      const d = (e as { data?: unknown } | null)?.data
      return typeof d === 'string' && isHex(d) && d.length >= 10
    }) as { data?: Hex } | null
    if (withData?.data) return decodeRevertData(withData.data)

    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      return {
        kind: 'funds',
        title: 'Not enough BTC',
        message: 'Your wallet does not hold enough BTC for this amount plus gas.',
      }
    }
    if (error.walk((e) => e instanceof ChainMismatchError)) {
      return {
        kind: 'chain',
        title: 'Wrong network',
        message: 'Your wallet is on a different network. Switch to Mezo Testnet.',
      }
    }
    if (error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) {
      return {
        kind: 'network',
        title: 'Network problem',
        message: 'The Mezo RPC did not answer. Try again in a moment.',
      }
    }
    return { kind: 'unknown', title: 'Something went wrong', message: error.shortMessage }
  }
  if (isUserRejection(error)) {
    return {
      kind: 'rejected',
      title: 'Request rejected',
      message: 'You rejected the request in your wallet.',
    }
  }
  if (error instanceof Error) {
    return { kind: 'unknown', title: 'Something went wrong', message: error.message }
  }
  return { kind: 'unknown', title: 'Something went wrong', message: String(error) }
}
