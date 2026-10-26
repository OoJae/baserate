import {
  formatBps,
  formatDuration,
  formatUsd,
  MUSD_MAX,
  MUSD_MIN,
  PYTH_BTC_BAND_MAX_AGE,
  SKIP_MAX_AGE,
  skipAgeTone,
  toFixedDecimal,
} from '@baserate/sdk'
import type { OracleView } from '../hooks/useOracle'
import { secondsSince, useNow } from '../lib/useNow'
import { IconClock } from './icons'
import { Badge, Card, CardHeader, Dot, Notice, Row, Skeleton, type Tone } from './ui'

const toneOf = { fresh: 'good', aging: 'warn', stale: 'bad' } as const

function px4(wad: bigint): string {
  return toFixedDecimal(wad, 18, 4)
}

export function OraclePanel({ oracle }: { oracle: OracleView }) {
  const now = useNow()
  const s = oracle.status
  const tick = secondsSince(oracle.updatedAt, now)
  const skipAge = s ? Number(s.skipAge) + tick : undefined
  const pythAge = s && s.pythBtcPrice > 0n ? Number(s.pythBtcAge) + tick : undefined
  const musdAge =
    s && oracle.musdPythRaw && oracle.musdPythRaw > 0n ? Number(s.musdAge) + tick : undefined
  const skipTone: Tone = skipAge === undefined ? 'neutral' : toneOf[skipAgeTone(skipAge)]

  const bandActive = !!s?.pythBtcFresh
  const bandTone: Tone = !s
    ? 'neutral'
    : !bandActive
      ? 'neutral'
      : s.deviationBps > 1_000n
        ? 'bad'
        : 'good'

  return (
    <Card aria-labelledby="oracle-title">
      <CardHeader
        id="oracle-title"
        icon={<IconClock className="size-4" />}
        title="Oracle"
        subtitle={
          oracle.source === 'contract'
            ? 'BtcMusdOracle.status(), read live'
            : 'Skip + Pyth read live; the BtcMusdOracle verdict is mirrored client-side until it is deployed'
        }
        action={
          s ? (
            <Badge tone={s.ok ? 'good' : 'bad'}>{s.ok ? 'Price OK' : 'Guard active'}</Badge>
          ) : null
        }
      />

      {s && !s.ok ? (
        <Notice tone="bad" className="mb-3" title="Borrowing paused by the oracle guard">
          {oracle.reason === 'skip-stale'
            ? `Skip has not updated for over ${SKIP_MAX_AGE.toString()} s.`
            : oracle.reason === 'pyth-deviation'
              ? 'Skip and Pyth disagree by more than 10%.'
              : 'Skip returned no valid price.'}{' '}
          Repay and withdraw still work: a position with no debt never consults the oracle.
        </Notice>
      ) : null}

      <dl className="divide-y divide-line">
        <Row
          label="BTC/USD (Skip)"
          tip="Mezo's Skip precompile is the primary price. Borrows revert if it is older than 60 seconds."
          value={s ? s.skipPrice > 0n ? formatUsd(s.skipPrice) : 'No price' : <Skeleton />}
          hint={
            skipAge !== undefined ? (
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={skipTone} />
                <span className="sr-only">Status: {skipAgeTone(skipAge)}.</span>
                {formatDuration(skipAge)} old
                {skipAge > Number(SKIP_MAX_AGE) ? ' · borrow would revert' : ''}
              </span>
            ) : undefined
          }
        />
        <Row
          label="Pyth band"
          tip={`Pyth BTC/USD only acts as a ±10% sanity band, and only while it is under ${PYTH_BTC_BAND_MAX_AGE.toString()} seconds old.`}
          value={
            s ? (
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={bandTone} />
                {bandActive
                  ? `${formatBps(s.deviationBps)} from Skip`
                  : s.pythBtcPrice > 0n
                    ? 'Inactive (Pyth stale)'
                    : 'Inactive'}
              </span>
            ) : (
              <Skeleton />
            )
          }
          hint={
            s && s.pythBtcPrice > 0n
              ? `${formatUsd(s.pythBtcPrice)} · ${pythAge !== undefined ? formatDuration(pythAge) : '—'} old · limit ±10%`
              : undefined
          }
        />
        <Row
          label="MUSD leg"
          tip="MUSD/USD from Pyth, clamped to [1.00, 1.02] (1.00 when stale). BTC is never valued above its USD price in MUSD, which is conservative for borrowers."
          value={
            oracle.musdUsed !== undefined ? (
              oracle.musdPythRaw && oracle.musdPythRaw > 0n ? (
                <>
                  Pyth {px4(oracle.musdPythRaw)}{' '}
                  {oracle.musdPythRaw < MUSD_MIN || oracle.musdPythRaw > MUSD_MAX
                    ? `clamped to ${toFixedDecimal(oracle.musdUsed, 18, 2)}`
                    : `used as ${px4(oracle.musdUsed)}`}
                </>
              ) : (
                `${toFixedDecimal(oracle.musdUsed, 18, 2)} (Pyth unavailable)`
              )
            ) : (
              <Skeleton />
            )
          }
          hint={musdAge !== undefined ? `${formatDuration(musdAge)} old` : undefined}
        />
      </dl>
    </Card>
  )
}
