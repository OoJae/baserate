import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  UserRejectedRequestError,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { baserateErrorsAbi, borrowAccountFactoryAbi } from '../src/abis'
import { decodeBaserateError, decodeRevertData } from '../src/errors'

const ltvTooHigh = encodeErrorResult({
  abi: baserateErrorsAbi,
  errorName: 'LtvTooHigh',
  args: [6_500n, 6_200n],
})

describe('decodeRevertData', () => {
  it('decodes Baserate custom errors into plain messages', () => {
    const d = decodeRevertData(ltvTooHigh)
    expect(d.kind).toBe('contract')
    expect(d.errorName).toBe('LtvTooHigh')
    expect(d.message).toContain('65.00%')
    expect(d.message).toContain('62.00%')
  })

  it('explains the oracle guard and the oracle-free exit', () => {
    const data = encodeErrorResult({ abi: baserateErrorsAbi, errorName: 'SkipStale', args: [75n] })
    const d = decodeRevertData(data)
    expect(d.title).toBe('Oracle price is stale')
    expect(d.message).toContain('1m 15s')
    expect(d.message).toContain('repay and withdraw still work')
  })

  it('decodes OpenZeppelin errors with amounts', () => {
    const data = encodeErrorResult({
      abi: baserateErrorsAbi,
      errorName: 'ERC4626ExceededMaxDeposit',
      args: ['0x0000000000000000000000000000000000000001', 10n ** 21n, 25n * 10n ** 18n],
    })
    expect(decodeRevertData(data).message).toContain('25.00 MUSD')
  })

  it('maps Morpho string reasons', () => {
    const data = encodeErrorResult({
      abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }],
      errorName: 'Error',
      args: ['insufficient liquidity'],
    })
    const d = decodeRevertData(data)
    expect(d.kind).toBe('revert')
    expect(d.title).toBe('Not enough market liquidity')
  })

  it('reports unknown selectors instead of throwing', () => {
    const d = decodeRevertData('0xdeadbeef')
    expect(d.selector).toBe('0xdeadbeef')
    expect(d.message).toContain('0xdeadbeef')
    expect(decodeRevertData('0x').message).toContain('without a reason')
  })
})

describe('decodeBaserateError', () => {
  it('recognises wallet rejections', () => {
    const err = new UserRejectedRequestError(new Error('User rejected the request.'))
    expect(decodeBaserateError(err).kind).toBe('rejected')
    expect(decodeBaserateError({ code: 4001, message: 'nope' }).kind).toBe('rejected')
  })

  it('decodes a simulated revert wrapped by viem', () => {
    const revert = new ContractFunctionRevertedError({
      abi: borrowAccountFactoryAbi,
      data: ltvTooHigh,
      functionName: 'openAndBorrow',
    })
    const wrapped = new ContractFunctionExecutionError(revert, {
      abi: borrowAccountFactoryAbi,
      functionName: 'openAndBorrow',
      args: [1n, 2n],
    })
    const d = decodeBaserateError(wrapped)
    expect(d.errorName).toBe('LtvTooHigh')
    expect(d.title).toBe('Loan-to-value too high')
  })

  it('decodes raw revert data from an ABI that lacks the error', () => {
    const data = encodeErrorResult({ abi: baserateErrorsAbi, errorName: 'BorrowPaused' })
    const revert = new ContractFunctionRevertedError({
      abi: [],
      data,
      functionName: 'borrow',
    })
    const d = decodeBaserateError(new BaseError('call failed', { cause: revert }))
    expect(d.errorName).toBe('BorrowPaused')
    expect(d.message).toContain('Repay')
  })

  it('classifies network failures and plain errors', () => {
    const net = new HttpRequestError({ url: 'https://rpc.test.mezo.org', status: 503 })
    expect(decodeBaserateError(net).kind).toBe('network')
    expect(decodeBaserateError(new Error('boom')).message).toBe('boom')
    expect(decodeBaserateError('weird').message).toBe('weird')
  })
})

describe('Wave 2 periphery errors', () => {
  const decode = (errorName: string, args: readonly unknown[] = []) =>
    decodeRevertData(
      encodeErrorResult({ abi: baserateErrorsAbi, errorName, args } as Parameters<
        typeof encodeErrorResult
      >[0]),
    )

  it('decodes FlashLiquidator reverts with amounts', () => {
    expect(decode('ImpactTooHigh', [70n * 10n ** 18n, 75n * 10n ** 18n]).message).toContain(
      '75.00 MUSD floor',
    )
    expect(decode('InsufficientProceeds', [1n, 2n]).title).toBe('Sale does not cover the debt')
    expect(decode('ProfitTooLow', [10n ** 17n, 2n * 10n ** 17n]).message).toContain('0.2000')
    expect(decode('VenueUnavailable', [1]).message).toContain('CL200')
    expect(decode('NothingToLiquidate', ['0x0000000000000000000000000000000000000001']).title).toBe(
      'Nothing to liquidate',
    )
  })

  it('decodes backstop, allocator and fee-router reverts', () => {
    expect(decode('InsufficientCash', [80n * 10n ** 18n, 10n ** 18n]).message).toContain(
      '1.00 MUSD is free',
    )
    expect(decode('CooldownActive', [1_792_960_240n]).message).toContain('Sun, 25 Oct 2026')
    expect(decode('NothingToDistribute').title).toBe('Nothing to distribute')
    expect(decode('NotClaimable', [3n, 1_793_000_000n]).title).toBe('Not claimable yet')
    expect(decode('AbsoluteCapExceeded').title).toBe('Vault cap reached')
  })

  it('maps Morpho’s healthy-position revert', () => {
    const data = encodeErrorResult({
      abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }],
      errorName: 'Error',
      args: ['position is healthy'],
    })
    expect(decodeRevertData(data).title).toBe('Position is healthy')
  })
})
