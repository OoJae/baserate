import { type ReactNode, useState } from 'react'
import { circle, ring } from '../../../brand/guilloche'
import { rateLinePath, useReducedMotionPref } from '../engraving'

/*
 * Motion specimens for /brand: the two eases plotted from their own control points, the durations to scale, and the
 * three signature motions as small demos that play only when asked. Under reduced motion each demo plays as a
 * 0.2 s fade in place, as the brand's rule says, and says so.
 */

/** A cubic-bezier easing plotted as itself: the curve is the timing function's own Bézier. */
export function EaseCurve({
  name,
  token,
  points,
  gsap,
  use,
}: {
  name: string
  token: string
  points: readonly [number, number, number, number]
  gsap: string
  use: string
}) {
  const [x1, y1, x2, y2] = points
  const P = (x: number, y: number) => `${(x * 100).toFixed(2)} ${(100 - y * 100).toFixed(2)}`
  return (
    <figure className="sp-ease">
      <svg viewBox="-6 -6 112 112" className="sp-ease__art" aria-hidden focusable="false">
        <rect x="0" y="0" width="100" height="100" className="sp-ease__frame" />
        <path d="M0 100L100 0" className="sp-ease__linear" />
        <path d={`M${P(0, 0)}L${P(x1, y1)}M${P(1, 1)}L${P(x2, y2)}`} className="sp-ease__handle" />
        <circle cx={x1 * 100} cy={100 - y1 * 100} r="1.8" className="sp-ease__dot" />
        <circle cx={x2 * 100} cy={100 - y2 * 100} r="1.8" className="sp-ease__dot" />
        <path d={`M${P(0, 0)}C${P(x1, y1)} ${P(x2, y2)} ${P(1, 1)}`} className="sp-ease__curve" />
      </svg>
      <figcaption>
        <p className="sp-h4">{name}</p>
        <p className="sp-ease__token">
          <code className="sp-code">{token}</code>
        </p>
        <p className="sp-serial">
          cubic-bezier({points.join(', ')}) · GSAP {gsap}
        </p>
        <p className="sp-small sp-gap-sm">{use}</p>
      </figcaption>
    </figure>
  )
}

/** The duration tokens drawn to scale against 1.2 s. */
export function Durations({
  rows,
}: {
  rows: readonly { name: string; token: string; ms: number; range: string }[]
}) {
  const max = Math.max(...rows.map((r) => r.ms))
  return (
    <dl className="sp-durations">
      {rows.map((r) => (
        <div key={r.token} className="sp-durations__row">
          <dt>
            <span className="sp-h4">{r.name}</span>
            <code className="sp-code">{r.token}</code>
          </dt>
          <dd>
            <span
              className="sp-durations__bar"
              style={{ width: `${(r.ms / max) * 100}%` }}
              aria-hidden
            />
            <span className="sp-num sp-durations__value">
              {r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)} s` : `${r.ms} ms`}
              <span className="sp-durations__range"> · {r.range}</span>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Demo({
  name,
  spec,
  reduced,
  children,
}: {
  name: string
  spec: string
  reduced: boolean
  children: ReactNode
}) {
  const [run, setRun] = useState(0)
  return (
    <figure className="sp-demo">
      <div className="sp-demo__stage" key={run} data-run={run > 0 ? '' : undefined}>
        {children}
      </div>
      <figcaption className="sp-demo__cap">
        <p className="sp-h4">{name}</p>
        <p className="sp-serial">{spec}</p>
        <button
          type="button"
          className="sp-demo__play"
          onClick={() => setRun((n) => n + 1)}
          aria-label={`${run ? 'Play again' : 'Play'}: ${name.toLowerCase()}`}
        >
          <svg viewBox="0 0 16 16" aria-hidden focusable="false">
            <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
          </svg>
          {run ? 'Play again' : 'Play'}
        </button>
        {reduced ? (
          <p className="sp-small sp-gap-sm">Reduced motion is on, so this plays as a fade.</p>
        ) : null}
      </figcaption>
    </figure>
  )
}

export function MotionDemos() {
  const reduced = useReducedMotionPref()
  const { line, base } = rateLinePath(20, 14, 160)
  const rope = ring(46, 4.2, 18, 3, { cx: 60, cy: 60 })
  const sealRope = ring(40, 3.4, 16, 3, { cx: 60, cy: 60 })
  return (
    <div className="sp-demos">
      <Demo
        name="The base-rate line wipe"
        spec="0.8 s · --ease-out · base first, then flat, rise, flat"
        reduced={reduced}
      >
        <svg
          viewBox="0 0 200 120"
          className="sp-demo__art"
          aria-hidden
          focusable="false"
          data-motion-safe=""
        >
          <path d={base} pathLength={1} className="sp-demo-wipe__base" />
          <path d={line} pathLength={1} className="sp-demo-wipe__line" />
        </svg>
      </Demo>
      <Demo
        name="The press ring"
        spec="0.6 s · scale 1.04 → 1 · once, on a confirmed transaction"
        reduced={reduced}
      >
        <svg
          viewBox="0 0 120 120"
          className="sp-demo__art sp-demo-ring"
          aria-hidden
          focusable="false"
          data-motion-safe=""
        >
          <path d={circle(60, 60, 55)} pathLength={1} className="sp-demo-ring__rim" />
          <path d={rope} pathLength={1} className="sp-demo-ring__rope" />
          <path d={circle(60, 60, 37)} pathLength={1} className="sp-demo-ring__rim" />
        </svg>
      </Demo>
      <Demo
        name="The seal stamp"
        spec="0.3 s · scale 1.08 → 1, a 2° settle · liquidation only"
        reduced={reduced}
      >
        <svg
          viewBox="0 0 120 120"
          className="sp-demo__art sp-demo-seal"
          aria-hidden
          focusable="false"
          data-motion-safe=""
        >
          <circle cx="60" cy="60" r="52" className="sp-demo-seal__disc" />
          <path d={sealRope} className="sp-demo-seal__line" />
          <path d={circle(60, 60, 31)} className="sp-demo-seal__line" />
          <text
            x="60"
            y="61"
            textAnchor="middle"
            dominantBaseline="central"
            className="sp-demo-seal__text"
          >
            LIQUIDATED
          </text>
        </svg>
      </Demo>
    </div>
  )
}
