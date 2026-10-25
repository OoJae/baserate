import { describe, expect, it } from 'vitest'
import {
  btcToUsdWad,
  formatBps,
  formatBtc,
  formatDuration,
  formatMusd,
  formatPercent,
  formatPercentWad,
  formatUsd,
  formatWad,
  parseAmount,
  shortAddress,
  toFixedDecimal,
  toInputString,
} from '../src/format'

const E18 = 10n ** 18n

describe('fixed-point formatting', () => {
  it('rounds down, up and to nearest', () => {
    expect(toFixedDecimal(1_234_567n, 6, 2)).toBe('1.23')
    expect(toFixedDecimal(1_235_000n, 6, 2)).toBe('1.24')
    expect(toFixedDecimal(1_230_001n, 6, 2, 'up')).toBe('1.24')
    expect(toFixedDecimal(1_239_999n, 6, 2, 'down')).toBe('1.23')
    expect(toFixedDecimal(5n, 0, 2)).toBe('5.00')
    expect(toFixedDecimal(-1_500_000n, 6, 0)).toBe('-2')
  })

  it('formats MUSD with 2 decimals and thousands separators', () => {
    expect(formatMusd(1_234_567_890_000_000_000_000n)).toBe('1,234.57')
    expect(formatMusd(40_040_000_000_000_000_000n)).toBe('40.04')
    expect(formatMusd(1n, { dp: 6, mode: 'up' })).toBe('0.000001')
    expect(formatMusd(0n)).toBe('0.00')
  })

  it('formats BTC with 6–8 decimals', () => {
    expect(formatBtc(900_000_000_000_000n)).toBe('0.000900')
    expect(formatBtc(123_456_789_000_000_000n)).toBe('0.12345679')
    expect(formatBtc(1_000_000_000_000_000_000n)).toBe('1.000000')
    expect(formatBtc(12_340_000_000_000n)).toBe('0.00001234')
  })

  it('formats USD, percentages and ratios', () => {
    expect(formatUsd(80_502_988_440_000_000_000_000n)).toBe('$80,502.99')
    expect(formatUsd(-5n * E18)).toBe('-$5.00')
    expect(btcToUsdWad(E18 / 1_000n, 80_000n * E18)).toBe(80n * E18)
    expect(formatPercentWad(495_500_000_000_000_000n)).toBe('49.55%')
    expect(formatPercent(0.07411)).toBe('7.41%')
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatBps(6_200)).toBe('62.00%')
    expect(formatBps(7n, 1)).toBe('0.1%')
    expect(formatWad(1_540_200_000_000_000_000n)).toBe('1.54')
  })

  it('formats durations', () => {
    expect(formatDuration(12)).toBe('12s')
    expect(formatDuration(245)).toBe('4m 05s')
    expect(formatDuration(3_780n)).toBe('1h 03m')
    expect(formatDuration(187_200)).toBe('2d 4h')
    expect(formatDuration(-3)).toBe('0s')
  })

  it('shortens addresses', () => {
    expect(shortAddress('0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503')).toBe('0x1189…c503')
  })
})

describe('parseAmount', () => {
  it('parses decimal input into fixed point', () => {
    expect(parseAmount('0.0009')).toBe(900_000_000_000_000n)
    expect(parseAmount('1,234.5')).toBe(1_234_500_000_000_000_000_000n)
    expect(parseAmount('.5')).toBe(E18 / 2n)
    expect(parseAmount('7')).toBe(7n * E18)
    expect(parseAmount('1.123456789', 6)).toBe(1_123_456n)
  })

  it('rejects malformed input', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('.')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
    expect(parseAmount('-1')).toBeNull()
    expect(parseAmount('1e18')).toBeNull()
  })

  it('round-trips through the input formatter', () => {
    expect(toInputString(900_000_000_000_000n)).toBe('0.0009')
    expect(toInputString(5n * E18)).toBe('5')
    expect(parseAmount(toInputString(123_456_789_000_000_000n))).toBe(123_456_780_000_000_000n)
  })
})
