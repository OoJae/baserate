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
