import { mulDivDown, ORACLE_PRICE_SCALE, WAD } from './math'

/**
 * BtcMusdOracle policy constants (contracts.md §3.1) and a client-side mirror of `status()`.
 *
 * The mirror lets the UI show the same verdict before the oracle is deployed, and cross-check it afterwards.
 * The deployed contract is the source of truth.
 */

/** Skip answers older than this revert `price()`. */
export const SKIP_MAX_AGE = 60n
/** Pyth only acts as a band while it is this fresh. */
export const PYTH_MAX_AGE = 3_900n
/** Maximum |Skip − Pyth| / Pyth before the band trips, in bps. */
export const MAX_DEV_BPS = 1_000n
/** MUSD leg clamp: never value MUSD below $1.00 or above $1.02. */
export const MUSD_MIN = WAD
export const MUSD_MAX = 1_020_000_000_000_000_000n

/** `BtcMusdOracle.Status` as returned by `status()`. Prices are 1e18 USD; `price` is 1e36-scaled. */
export interface OracleStatus {
  price: bigint
  ok: boolean
  skipPrice: bigint
  skipAge: bigint
  pythBtcPrice: bigint
  pythBtcAge: bigint
  pythBtcFresh: boolean
  musdPrice: bigint
  musdAge: bigint
  musdFresh: boolean
  deviationBps: bigint
}

export interface PythPrice {
  price: bigint
  expo: number
  publishTime: bigint
}

export interface FeedSnapshot {
  /** Block timestamp the reads were taken at. */
  now: bigint
  /** Skip `latestRoundData` (answer, updatedAt), or null if the call reverted. */
  skip: { answer: bigint; updatedAt: bigint } | null
  pythBtc: PythPrice | null
  pythMusd: PythPrice | null
}

export interface ComputedOracleStatus extends OracleStatus {
  /** The MUSD/USD value actually used for `price` (Pyth clamped to [1.00, 1.02], or 1.00 when stale). */
  musdUsed: bigint
  /** Raw Pyth MUSD/USD (1e18), 0 when invalid. */
  musdPythRaw: bigint
  /** Why the oracle is not ok, if it is not. */
  reason: 'ok' | 'skip-invalid' | 'skip-stale' | 'pyth-deviation'
}

function ageOf(now: bigint, t: bigint): bigint {
  return t > now ? 0n : now - t
}

/** Scales a Pyth price to 1e18. Invalid (non-positive or expo outside [−18, 0]) returns null. */
export function pythTo18(p: PythPrice): bigint | null {
  if (p.price <= 0n || p.expo < -18 || p.expo > 0) return null
  return p.price * 10n ** BigInt(18 + p.expo)
}

/** Clamps the MUSD leg exactly as the oracle does. */
export function clampMusd(px: bigint, fresh: boolean): bigint {
  if (!fresh || px === 0n) return MUSD_MIN
  if (px < MUSD_MIN) return MUSD_MIN
  if (px > MUSD_MAX) return MUSD_MAX
  return px
}

/** Mirror of `BtcMusdOracle.status()` computed from raw feed reads. Never throws. */
export function computeOracleStatus(s: FeedSnapshot): ComputedOracleStatus {
  const skipPrice = s.skip && s.skip.answer > 0n ? s.skip.answer : 0n
  const skipAge = s.skip ? ageOf(s.now, s.skip.updatedAt) : 0n

  const btc18 = s.pythBtc ? pythTo18(s.pythBtc) : null
  const pythBtcAge = s.pythBtc ? ageOf(s.now, s.pythBtc.publishTime) : 0n
  const pythBtcFresh = btc18 !== null && pythBtcAge <= PYTH_MAX_AGE

  const musd18 = s.pythMusd ? pythTo18(s.pythMusd) : null
  const musdAge = s.pythMusd ? ageOf(s.now, s.pythMusd.publishTime) : 0n
  const musdFresh = musd18 !== null && musdAge <= PYTH_MAX_AGE
  const musdUsed = clampMusd(musd18 ?? 0n, musdFresh)

  let deviationBps = 0n
  let tripped = false
  if (pythBtcFresh && btc18 !== null && skipPrice > 0n) {
    const diff = skipPrice > btc18 ? skipPrice - btc18 : btc18 - skipPrice
    deviationBps = mulDivDown(diff, 10_000n, btc18)
    tripped = diff * 10_000n > MAX_DEV_BPS * btc18
  }

  let reason: ComputedOracleStatus['reason'] = 'ok'
  if (skipPrice === 0n) reason = 'skip-invalid'
  else if (skipAge > SKIP_MAX_AGE) reason = 'skip-stale'
  else if (tripped) reason = 'pyth-deviation'
  const ok = reason === 'ok'

  return {
    price: ok ? mulDivDown(skipPrice, ORACLE_PRICE_SCALE, musdUsed) : 0n,
    ok,
    skipPrice,
    skipAge,
    pythBtcPrice: btc18 ?? 0n,
    pythBtcAge,
    pythBtcFresh,
    musdPrice: musdUsed,
    musdAge,
    musdFresh,
    deviationBps,
    musdUsed,
    musdPythRaw: musd18 ?? 0n,
    reason,
  }
}

/** Why an on-chain status is not ok, derived from its fields. */
export function statusReason(s: OracleStatus): ComputedOracleStatus['reason'] {
  if (s.ok) return 'ok'
  if (s.skipPrice === 0n) return 'skip-invalid'
  if (s.skipAge > SKIP_MAX_AGE) return 'skip-stale'
  return 'pyth-deviation'
}

/** The MUSD/USD leg implied by an ok status: skipPrice × 1e36 / price. */
export function impliedMusdLeg(s: Pick<OracleStatus, 'price' | 'skipPrice'>): bigint | null {
  if (s.price === 0n) return null
  return mulDivDown(s.skipPrice, ORACLE_PRICE_SCALE, s.price)
}

export type AgeTone = 'fresh' | 'aging' | 'stale'

/** Skip age colour: green under 30 s, amber 30–60 s, red over 60 s (a borrow would revert). */
export function skipAgeTone(ageSeconds: number): AgeTone {
  if (ageSeconds < 30) return 'fresh'
  if (ageSeconds <= Number(SKIP_MAX_AGE)) return 'aging'
  return 'stale'
}
