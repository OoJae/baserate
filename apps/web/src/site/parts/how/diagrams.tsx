import type { CSSProperties, ReactNode } from 'react'
import { ring, rosette } from '../../../brand/guilloche'
import { Ruling, useSvgId } from '../engraving'
import { Serial } from '../layout'
import { AmberCentre } from './amber'

/*
 * The mechanism diagrams on /how-it-works. Labels are DOM text (readable at 375 px and to screen readers); the
 * engraving is inline SVG from src/brand/guilloche.ts. Every value shown is a contract constant or a deploy
 * parameter, named in the caption with its source.
 */

const pct = (v: number) => `${(v * 100).toFixed(3)}%`

// -------------------------------------------------------------------------------------------------------------------
// Station medallions for the loan sequence
// -------------------------------------------------------------------------------------------------------------------

type StationKind = 'btc' | 'receipt' | 'market' | 'musd'

/** A small engraved medallion for one station of the loan (96 px; lines ≥ 1 CSS px). */
export function StationMedallion({ kind }: { kind: StationKind }) {
  const petals = kind === 'btc' ? 18 : kind === 'receipt' ? 12 : kind === 'market' ? 16 : 10
  const rope = ring(43, 3.2, 14, 3, { cx: 50, cy: 50 })
  const field = rosette(36, petals, 0, 4, { cx: 50, cy: 50, inner: 0.62, weave: true, segments: 3 })
  return (
    <svg viewBox="0 0 100 100" className="sp-station__art" aria-hidden focusable="false">
      <circle cx="50" cy="50" r="48.6" fill="none" stroke="var(--engrave)" strokeWidth="1.4" />
      <path d={rope} fill="none" stroke="var(--engrave)" strokeWidth="1.05" />
      <path d={field} fill="none" stroke="var(--engrave)" strokeWidth="0.9" />
      {kind === 'btc' ? (
        <AmberCentre cx={50} cy={50} r={21} pitch={2.9} rule={0.95} />
      ) : (
        <>
          <circle
            cx="50"
            cy="50"
            r="21"
            fill="var(--canvas)"
            stroke="var(--engrave)"
            strokeWidth="1.2"
          />
          <text
            x="50"
            y="50.5"
            className="sp-station__label"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {kind === 'receipt' ? 'bcBTC' : kind === 'market' ? 'M1' : 'MUSD'}
          </text>
        </>
      )}
    </svg>
  )
}

export interface LoanStep {
  kind: StationKind
  title: string
  body: ReactNode
}

/** The loan as the true sequence it is: four steps in one transaction, then the exit. */
export function LoanSequence({ steps, exit }: { steps: readonly LoanStep[]; exit: ReactNode }) {
  return (
    <figure className="sp-figure sp-loan">
      <ol className="sp-loan__steps">
        {steps.map((step, i) => (
          <li key={step.title} className="sp-station" style={{ '--i': i } as CSSProperties}>
            <StationMedallion kind={step.kind} />
            <p className="sp-station__n sp-serial">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="sp-h4 sp-station__title">{step.title}</h3>
            <p className="sp-small sp-station__body">{step.body}</p>
          </li>
        ))}
      </ol>
      <div className="sp-loan__exit">
        <svg viewBox="0 0 64 40" className="sp-loan__exit-art" aria-hidden focusable="false">
          <path
            d="M60 8H22a14 14 0 0 0 0 28h30"
            fill="none"
            stroke="var(--engrave)"
            strokeWidth="1.6"
          />
          <path d="M28 1l-7 7 7 7" fill="none" stroke="var(--engrave)" strokeWidth="1.6" />
        </svg>
        <div>
          <p className="sp-serial">Then, whenever you choose</p>
          <p className="sp-loan__exit-text">{exit}</p>
        </div>
      </div>
      <figcaption className="sp-serial sp-source">
        One transaction: factory.openAndBorrow · source contracts.md §3.4, §5
      </figcaption>
    </figure>
  )
}

// -------------------------------------------------------------------------------------------------------------------
// The oracle: how old each price may be
// -------------------------------------------------------------------------------------------------------------------

const AGE_MAX = 4000
const ageX = (seconds: number) => Math.log10(Math.max(1, seconds)) / Math.log10(AGE_MAX)

export interface AgeRow {
  name: string
  rule: string
  /** Seconds the price may age while it is used. */
  limit: number
  /** The limit as written ("60 s"). */
  limitLabel: string
  /** What happens once the print is older than the limit. */
  after: string
}

const AGE_TICKS = [
  { s: 1, label: '1 s' },
  { s: 10, label: '10 s' },
  { s: 60, label: '1 min' },
  { s: 600, label: '10 min' },
  { s: 3600, label: '1 h' },
]

/** Price age windows on a log scale: the bar is how old a print may be while the oracle uses it. */
export function PriceAges({ rows }: { rows: readonly AgeRow[] }) {
  const id = useSvgId()
  return (
    <figure className="sp-figure sp-ages">
      <svg width="0" height="0" className="sp-defs" aria-hidden focusable="false">
        <defs>
          <Ruling id={`${id}-hatch`} gap={4} weight={1} angle={-45} />
        </defs>
      </svg>
      <div className="sp-ages__rows">
        {rows.map((row) => (
          <div key={row.name} className="sp-ages__row">
            <div className="sp-ages__head">
              <p className="sp-ages__name">{row.name}</p>
              <p className="sp-small">{row.rule}</p>
            </div>
            <div className="sp-ages__track">
              <span className="sp-ages__bar" style={{ width: pct(ageX(row.limit)) }}>
                <svg className="sp-ages__fill" aria-hidden focusable="false">
                  <rect width="100%" height="100%" fill={`url(#${id}-hatch)`} />
                </svg>
              </span>
              <span
                className={
                  ageX(row.limit) > 0.9 ? 'sp-ages__end sp-ages__end--edge' : 'sp-ages__end'
                }
                style={{ left: pct(ageX(row.limit)) }}
              >
                <span className="sp-serial">{row.limitLabel}</span>
              </span>
            </div>
            <p className="sp-ages__then sp-serial">
              Past {row.limitLabel}: {row.after}
            </p>
          </div>
        ))}
      </div>
      <div className="sp-ages__axis" aria-hidden>
        {AGE_TICKS.map((tick) => (
          <span key={tick.s} className="sp-ages__tick" style={{ left: pct(ageX(tick.s)) }}>
            <span className="sp-serial sp-ages__label">{tick.label}</span>
          </span>
        ))}
      </div>
      <figcaption className="sp-serial sp-source">
        Age of the last print, log scale · BtcMusdOracle: SKIP_MAX_AGE 60, PYTH_BTC_BAND_MAX_AGE
        600, PYTH_MAX_AGE 3900
      </figcaption>
    </figure>
  )
}

// -------------------------------------------------------------------------------------------------------------------
// vMUSD: the split between M1 and wsMUSD
// -------------------------------------------------------------------------------------------------------------------

/** vMUSD's two homes for MUSD, with M1's idle buffer marked. The rows have fixed heights, so the strands land on
 * the bars at every width. */
export function VaultSplit({
  m1,
  idle,
  ws,
  allocator,
}: {
  m1: ReactNode
  idle: ReactNode
  ws: ReactNode
  allocator: ReactNode
}) {
  const id = useSvgId()
  const field = rosette(40, 14, 0, 5, { cx: 50, cy: 50, inner: 0.5, weave: true, segments: 3 })
  // The strands end on the bar centres: rows of 3.25rem with a 1.5rem bar at the foot, 1.5–2rem apart, so the
  // centres sit at about 30 % and 91 % of the diagram's height.
  return (
    <figure className="sp-figure sp-vault">
      <svg width="0" height="0" className="sp-defs" aria-hidden focusable="false">
        <defs>
          <Ruling id={`${id}-dense`} gap={3} weight={1} angle={-45} />
          <Ruling id={`${id}-open`} gap={6} weight={1} angle={-45} />
          <Ruling id={`${id}-idle`} gap={5} weight={1} angle={45} />
        </defs>
      </svg>
      <Serial>Your deposit, in vMUSD shares</Serial>
      <div className="sp-vault__diagram">
        <svg viewBox="0 0 100 100" className="sp-vault__art" aria-hidden focusable="false">
          <circle cx="50" cy="50" r="48.5" fill="none" stroke="var(--engrave)" strokeWidth="1.4" />
          <path d={field} fill="none" stroke="var(--engrave)" strokeWidth="0.9" />
          <circle
            cx="50"
            cy="50"
            r="19"
            fill="var(--canvas)"
            stroke="var(--engrave)"
            strokeWidth="1.2"
          />
          <text
            x="50"
            y="50.5"
            className="sp-station__label"
            textAnchor="middle"
            dominantBaseline="central"
          >
            vMUSD
          </text>
        </svg>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="sp-vault__strands"
          aria-hidden
          focusable="false"
        >
          <path
            d="M0 50 C 50 50, 50 30, 100 30"
            fill="none"
            stroke="var(--engrave)"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
            className="sp-vault__strand sp-vault__strand--m1"
          />
          <path
            d="M0 50 C 50 50, 50 91, 100 91"
            fill="none"
            stroke="var(--engrave)"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
            className="sp-vault__strand sp-vault__strand--ws"
          />
        </svg>
        <div className="sp-vault__rows">
          <div className="sp-vault__row">
            <p className="sp-vault__name">M1 · lent to BTC borrowers</p>
            <div className="sp-vault__bar">
              <svg className="sp-vault__fill" aria-hidden focusable="false">
                <rect width="100%" height="100%" fill={`url(#${id}-dense)`} />
              </svg>
              <span className="sp-vault__buffer">
                <svg className="sp-vault__fill" aria-hidden focusable="false">
                  <rect width="100%" height="100%" fill={`url(#${id}-idle)`} />
                </svg>
              </span>
            </div>
          </div>
          <div className="sp-vault__row">
            <p className="sp-vault__name">wsMUSD · sMUSD savings</p>
            <div className="sp-vault__bar">
              <svg className="sp-vault__fill" aria-hidden focusable="false">
                <rect width="100%" height="100%" fill={`url(#${id}-open)`} />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="sp-vault__notes">
        {[
          { key: 'dense', name: 'M1, lent', body: m1 },
          { key: 'idle', name: 'M1, kept idle', body: idle },
          { key: 'open', name: 'wsMUSD', body: ws },
        ].map((note) => (
          <div key={note.key}>
            <p className="sp-vault__note-label">
              <span className="sp-vault__key" aria-hidden>
                <svg aria-hidden focusable="false">
                  <rect width="100%" height="100%" fill={`url(#${id}-${note.key})`} />
                </svg>
              </span>
              <span className="sp-h4">{note.name}</span>
            </p>
            <div className="sp-small">{note.body}</div>
          </div>
        ))}
      </div>
      <div className="sp-vault__allocator sp-small">{allocator}</div>
      <figcaption className="sp-serial sp-source">
        BaserateAllocator: BUFFER_FLOOR 2,000 MUSD · BUFFER_BPS 1500 · MAX_MOVE 1,000 MUSD ·
        COOLDOWN 1 h · APY_WINDOW 7 d
      </figcaption>
    </figure>
  )
}

// -------------------------------------------------------------------------------------------------------------------
// Liquidations: the LTV gauge and its loupe
// -------------------------------------------------------------------------------------------------------------------

/** 0–100 % LTV with the borrow ceiling, the canary's target and the liquidation line; a loupe on the last point. */
export function LtvGauge({
  ceilingBps,
  canaryBps,
  lltvBps,
}: {
  ceilingBps: number
  canaryBps: number
  lltvBps: number
}) {
  const id = useSvgId()
  const fmt = (bps: number) => `${bps % 100 === 0 ? bps / 100 : (bps / 100).toFixed(2)}%`
  const at = (bps: number) => pct(bps / 10_000)
  const loupe = { from: 7600, to: 7800 }
  const inLoupe = (bps: number) => pct((bps - loupe.from) / (loupe.to - loupe.from))
  return (
    <figure className="sp-figure sp-gauge">
      <svg width="0" height="0" className="sp-defs" aria-hidden focusable="false">
        <defs>
          <Ruling id={`${id}-hatch`} gap={3.5} weight={1} angle={-45} />
        </defs>
      </svg>
      <div className="sp-gauge__scale">
        <div className="sp-gauge__track">
          <span className="sp-gauge__fill" style={{ width: at(ceilingBps) }}>
            <svg className="sp-gauge__hatch" aria-hidden focusable="false">
              <rect width="100%" height="100%" fill={`url(#${id}-hatch)`} />
            </svg>
          </span>
          {[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000].map((v) => (
            <span key={v} className="sp-gauge__tick" style={{ left: at(v) }} aria-hidden />
          ))}
          <span className="sp-gauge__line" style={{ left: at(lltvBps) }} aria-hidden />
        </div>
        <div className="sp-gauge__labels">
          <span className="sp-gauge__label" style={{ left: at(ceilingBps) }}>
            <span className="sp-numeral">{fmt(ceilingBps)}</span>
            <span className="sp-small">most you can borrow</span>
          </span>
          <span className="sp-gauge__label sp-gauge__label--seal" style={{ left: at(lltvBps) }}>
            <span className="sp-numeral">{fmt(lltvBps)}</span>
            <span className="sp-small">liquidation line</span>
          </span>
        </div>
        <div className="sp-gauge__axis" aria-hidden>
          <span className="sp-serial" style={{ left: '0%' }}>
            0
          </span>
          <span className="sp-serial" style={{ left: '50%' }}>
            50%
          </span>
          <span className="sp-serial" style={{ left: '100%' }}>
            100% LTV
          </span>
        </div>
      </div>
      <div className="sp-gauge__loupe">
        <p className="sp-serial">
          Under the loupe · {fmt(loupe.from)} to {fmt(loupe.to)}
        </p>
        <div className="sp-gauge__loupe-track">
          {[7600, 7625, 7650, 7675, 7700, 7725, 7750, 7775, 7800].map((v) => (
            <span
              key={v}
              className={
                v % 100 === 0
                  ? 'sp-gauge__loupe-tick sp-gauge__loupe-tick--major'
                  : 'sp-gauge__loupe-tick'
              }
              style={{ left: inLoupe(v) }}
              aria-hidden
            />
          ))}
          <span className="sp-gauge__mark" style={{ left: inLoupe(canaryBps) }}>
            <span className="sp-gauge__mark-label">
              <span className="sp-num">{fmt(canaryBps)}</span> canary
            </span>
          </span>
          <span className="sp-gauge__mark sp-gauge__mark--seal" style={{ left: inLoupe(lltvBps) }}>
            <span className="sp-gauge__mark-label">
              <span className="sp-num">{fmt(lltvBps)}</span> liquidation
            </span>
          </span>
        </div>
        <div className="sp-gauge__loupe-axis" aria-hidden>
          <span className="sp-serial" style={{ left: '0%' }}>
            {fmt(loupe.from)}
          </span>
          <span className="sp-serial" style={{ left: '50%' }}>
            {fmt((loupe.from + loupe.to) / 2)}
          </span>
          <span className="sp-serial" style={{ left: '100%' }}>
            {fmt(loupe.to)}
          </span>
        </div>
      </div>
      <figcaption className="sp-serial sp-source">
        Testnet, as deployed: STANDARD ceiling 6200 bps · CANARY 7675 bps · M1 LLTV 0.77 ·
        Deploy.s.sol
      </figcaption>
    </figure>
  )
}

// -------------------------------------------------------------------------------------------------------------------
// Fees: the 40/40/20 split and the epoch
// -------------------------------------------------------------------------------------------------------------------

export interface FeeLeg {
  share: number
  name: string
  body: ReactNode
  /** Rule spacing: tone from line density (denser = darker). */
  gap: number
  angle: number
}

/** The FeeRouter's split as one engraved bar: each leg's tone is its own ruling. */
export function FeeSplit({ legs }: { legs: readonly FeeLeg[] }) {
  const id = useSvgId()
  return (
    <figure className="sp-figure sp-fees">
      <svg width="0" height="0" className="sp-defs" aria-hidden focusable="false">
        <defs>
          {legs.map((leg, i) => (
            <Ruling key={leg.name} id={`${id}-${i}`} gap={leg.gap} weight={1} angle={leg.angle} />
          ))}
        </defs>
      </svg>
      <div className="sp-fees__bar" aria-hidden>
        {legs.map((leg, i) => (
          <span key={leg.name} className="sp-fees__seg" style={{ flexGrow: leg.share }}>
            <svg className="sp-fees__fill" aria-hidden focusable="false">
              <rect width="100%" height="100%" fill={`url(#${id}-${i})`} />
            </svg>
          </span>
        ))}
      </div>
      <dl className="sp-fees__legs">
        {legs.map((leg, i) => (
          <div key={leg.name} className="sp-fees__leg" style={{ flexGrow: leg.share }}>
            <dt>
              <svg className="sp-fees__swatch" aria-hidden focusable="false">
                <rect width="100%" height="100%" fill={`url(#${id}-${i})`} />
              </svg>
              <span className="sp-numeral sp-fees__share">{Math.round(leg.share * 100)}%</span>
              <span className="sp-h4">{leg.name}</span>
            </dt>
            <dd className="sp-small">{leg.body}</dd>
          </div>
        ))}
      </dl>
      <figcaption className="sp-serial sp-source">
        FeeRouter: SMUSD_BPS 4000 · BRIBES_BPS 4000 · TREASURY_BPS 2000 · ORIGINATION_FEE_BPS 10
      </figcaption>
    </figure>
  )
}

const DAYS = [
  { at: 0, label: 'Thu' },
  { at: 1, label: 'Fri' },
  { at: 2, label: 'Sat' },
  { at: 3, label: 'Sun' },
  { at: 4, label: 'Mon' },
  { at: 5, label: 'Tue' },
  { at: 6, label: 'Wed' },
  { at: 7, label: 'Thu' },
] as const

/** One Mezo Earn epoch, Thursday to Thursday (UTC), with the keeper's flush and the closed last hour. */
export function EpochBar({ flushAt, cutoff }: { flushAt: ReactNode; cutoff: ReactNode }) {
  const id = useSvgId()
  const hour = 1 / 168
  return (
    <figure className="sp-figure sp-epoch">
      <svg width="0" height="0" className="sp-defs" aria-hidden focusable="false">
        <defs>
          <Ruling id={`${id}-hatch`} gap={2} weight={1} angle={-45} />
        </defs>
      </svg>
      <div className="sp-epoch__track">
        {DAYS.map((day) => (
          <span
            key={day.at}
            className="sp-epoch__day"
            style={{ left: pct(day.at / 7) }}
            aria-hidden
          >
            <span className="sp-serial sp-epoch__label">{day.label}</span>
          </span>
        ))}
        <span className="sp-epoch__flush" style={{ left: pct((65 / 60) * hour) }} />
        <span className="sp-epoch__closed" style={{ left: pct(1 - hour), width: pct(hour) }}>
          <svg className="sp-epoch__fill" aria-hidden focusable="false">
            <rect width="100%" height="100%" fill={`url(#${id}-hatch)`} />
          </svg>
        </span>
      </div>
      <div className="sp-epoch__notes">
        <p className="sp-small">
          <span className="sp-epoch__key sp-epoch__key--flush" aria-hidden />
          {flushAt}
        </p>
        <p className="sp-small">
          <span className="sp-epoch__key sp-epoch__key--closed" aria-hidden />
          {cutoff}
        </p>
      </div>
      <figcaption className="sp-serial sp-source">
        One epoch, UTC, to scale · FeeRouter EPOCH 7 d, BRIBE_CUTOFF 1 h · keeper fee.flush from
        01:05
      </figcaption>
    </figure>
  )
}

/** A label/value list for limits, set like a rate sheet. */
export function RateSheet({
  rows,
  caption,
}: {
  rows: readonly { id: string; label: ReactNode; value: ReactNode; note?: ReactNode }[]
  caption?: ReactNode
}) {
  return (
    <div className="sp-ratesheet">
      <dl className="sp-sheetlist">
        {rows.map((row) => (
          <div key={row.id}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            {row.note ? <dd className="sp-sheetlist__note">{row.note}</dd> : null}
          </div>
        ))}
      </dl>
      {caption ? <Serial className="sp-source">{caption}</Serial> : null}
    </div>
  )
}
