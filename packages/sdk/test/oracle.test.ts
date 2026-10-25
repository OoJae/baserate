import { describe, expect, it } from 'vitest'
import { ORACLE_PRICE_SCALE, WAD } from '../src/math'
import {
  clampMusd,
  computeOracleStatus,
  type FeedSnapshot,
  impliedMusdLeg,
  MUSD_MAX,
  pythTo18,
  skipAgeTone,
  statusReason,
} from '../src/oracle'

/** Live testnet reads at block ~16,363,513 (2026-10-25): Skip, Pyth BTC and Pyth MUSD. */
const NOW = 1_792_945_115n
const SKIP_ANSWER = 80_502_988_440_000_000_000_000n
const live: FeedSnapshot = {
  now: NOW,
  skip: { answer: SKIP_ANSWER, updatedAt: 1_792_945_105n },
  pythBtc: { price: 8_051_298_091_060n, expo: -8, publishTime: 1_792_945_089n },
  pythMusd: { price: 99_008_267n, expo: -8, publishTime: 1_792_945_089n },
}

describe('computeOracleStatus (mirror of BtcMusdOracle.status)', () => {
  it('reproduces the live testnet verdict', () => {
    const s = computeOracleStatus(live)
    expect(s.ok).toBe(true)
    expect(s.reason).toBe('ok')
    expect(s.skipAge).toBe(10n)
    expect(s.pythBtcPrice).toBe(80_512_980_910_600_000_000_000n)
    expect(s.pythBtcFresh).toBe(true)
    expect(s.deviationBps).toBe(1n)
    // MUSD at 0.99008 is clamped up to 1.00, so price = Skip × 1e36 / 1e18.
    expect(s.musdPythRaw).toBe(990_082_670_000_000_000n)
    expect(s.musdUsed).toBe(WAD)
    expect(s.price).toBe(80_502_988_440_000_000_000_000n * 10n ** 18n)
    expect(impliedMusdLeg(s)).toBe(WAD)
  })

  it('reverts-equivalent when Skip is older than 60 s', () => {
    const s = computeOracleStatus({ ...live, now: live.now + 51n })
    expect(s.skipAge).toBe(61n)
    expect(s.ok).toBe(false)
    expect(s.reason).toBe('skip-stale')
    expect(s.price).toBe(0n)
    expect(statusReason(s)).toBe('skip-stale')
  })

  it('treats a future updatedAt as age 0', () => {
    const s = computeOracleStatus({
      ...live,
      skip: { answer: SKIP_ANSWER, updatedAt: NOW + 5n },
    })
    expect(s.skipAge).toBe(0n)
    expect(s.ok).toBe(true)
  })

  it('flags an invalid Skip answer or a reverted read', () => {
    expect(computeOracleStatus({ ...live, skip: { answer: 0n, updatedAt: NOW } }).reason).toBe(
      'skip-invalid',
    )
    expect(computeOracleStatus({ ...live, skip: null }).reason).toBe('skip-invalid')
  })

  it('trips the band only above 10% deviation from a fresh Pyth', () => {
    const pyth = 80_000n * WAD
    const at = (skip: bigint) =>
      computeOracleStatus({
        ...live,
        skip: { answer: skip, updatedAt: NOW },
        pythBtc: { price: 8_000_000_000_000n, expo: -8, publishTime: NOW },
      })
    expect(at(pyth + pyth / 10n).ok).toBe(true) // exactly 10%
    expect(at(pyth + pyth / 10n).deviationBps).toBe(1_000n)
    expect(at(pyth + pyth / 10n + 1n).reason).toBe('pyth-deviation')
    expect(at(pyth - pyth / 10n - 1n).reason).toBe('pyth-deviation')
  })

  it('ignores the band when Pyth BTC is stale (> 3,900 s)', () => {
    const s = computeOracleStatus({
      ...live,
      skip: { answer: 100_000n * WAD, updatedAt: NOW },
      pythBtc: { price: 8_000_000_000_000n, expo: -8, publishTime: NOW - 3_901n },
    })
    expect(s.pythBtcFresh).toBe(false)
    expect(s.deviationBps).toBe(0n)
    expect(s.ok).toBe(true)
  })

  it('clamps the MUSD leg to [1.00, 1.02] and uses 1.00 when stale', () => {
    expect(clampMusd(990_000_000_000_000_000n, true)).toBe(WAD)
    expect(clampMusd(1_010_000_000_000_000_000n, true)).toBe(1_010_000_000_000_000_000n)
    expect(clampMusd(1_100_000_000_000_000_000n, true)).toBe(MUSD_MAX)
    expect(clampMusd(1_010_000_000_000_000_000n, false)).toBe(WAD)
    const premium = computeOracleStatus({
      ...live,
      pythMusd: { price: 101_000_000n, expo: -8, publishTime: NOW },
    })
    expect(premium.musdUsed).toBe(1_010_000_000_000_000_000n)
    expect(premium.price).toBe((SKIP_ANSWER * ORACLE_PRICE_SCALE) / premium.musdUsed)
    const stale = computeOracleStatus({
      ...live,
      pythMusd: { price: 101_000_000n, expo: -8, publishTime: NOW - 4_000n },
    })
    expect(stale.musdFresh).toBe(false)
    expect(stale.musdUsed).toBe(WAD)
  })

  it('scales Pyth prices and rejects bad exponents', () => {
    expect(pythTo18({ price: 99_008_267n, expo: -8, publishTime: 0n })).toBe(
      990_082_670_000_000_000n,
    )
    expect(pythTo18({ price: 1n, expo: 1, publishTime: 0n })).toBeNull()
    expect(pythTo18({ price: 1n, expo: -19, publishTime: 0n })).toBeNull()
    expect(pythTo18({ price: -1n, expo: -8, publishTime: 0n })).toBeNull()
  })

  it('colours Skip age green < 30 s, amber 30–60 s, red > 60 s', () => {
    expect(skipAgeTone(0)).toBe('fresh')
    expect(skipAgeTone(29)).toBe('fresh')
    expect(skipAgeTone(30)).toBe('aging')
    expect(skipAgeTone(60)).toBe('aging')
    expect(skipAgeTone(61)).toBe('stale')
  })
})
