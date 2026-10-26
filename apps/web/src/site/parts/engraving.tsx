import { type CSSProperties, type ReactNode, useId, useMemo, useSyncExternalStore } from 'react'
import { circle, microtextRing, reeding, ring, rosette } from '../../brand/guilloche'

/*
 * Engraved figures for the site pages, drawn from src/brand/guilloche.ts in the reader's browser (the same calls the
 * brand's render scripts make). Line work is ink, never alpha: Guilloche on ink, Mint on paper (--engrave). Every
 * line holds at least 0.5 device px at the size it is shown: figures shown small draw fewer, heavier lines.
 *
 * Load choreography: paths marked `draw` engrave in from the rim (stroke-dashoffset over pathLength 1, staggered by
 * --i), styled in site.css only under prefers-reduced-motion: no-preference. Without it they are simply there.
 */

/** Each line of a rosette or ring is one closed subpath starting with M. */
export function subpaths(d: string): string[] {
  return d.split(/(?=M)/).filter(Boolean)
}

/** A useId() safe inside url(#…) and href="#…" (React's ids carry punctuation). */
export function useSvgId(): string {
  return `sp${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const WIDE_QUERY = '(min-width: 64rem)'

function subscribeWide(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True from 64rem: figures are shown large there and can carry their full line count. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => typeof window !== 'undefined' && window.matchMedia?.(WIDE_QUERY).matches === true,
    () => true,
  )
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReduced(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(REDUCED_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True when the reader asked for reduced motion (live: follows the setting). */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== 'undefined' && window.matchMedia?.(REDUCED_QUERY).matches === true,
    () => false,
  )
}

/** Paths that engrave in one after another when `draw` is set (index offset `from`, so layers queue up). */
export function Lines({
  d,
  width,
  draw = false,
  from = 0,
  className,
  stroke = 'var(--engrave)',
}: {
  d: string
  width: number
  draw?: boolean
  from?: number
  className?: string
  stroke?: string
}) {
  const parts = useMemo(() => (draw ? subpaths(d) : [d]), [d, draw])
  return (
    <g fill="none" stroke={stroke} strokeWidth={width} className={className}>
      {parts.map((part, i) => (
        <path
          key={part.slice(0, 48) + String(i)}
          d={part}
          pathLength={draw ? 1 : undefined}
          className={draw ? 'sp-draw' : undefined}
          style={draw ? ({ '--i': from + i } as CSSProperties) : undefined}
        />
      ))}
    </g>
  )
}

export interface MedallionSpec {
  /** Microprint around the rim: true data only (dates, counts, names). */
  microtext?: string
  /** Petals and lines of the woven rosette. */
  petals: number
  lines: number
  /** Twist per line; the default turns the petals gently. */
  twist?: number
}

/**
 * An engine-turned plate on a 1000-unit box: milled edge, rims, a rope, a woven rosette and a clear centre for
 * `children` (drawn in the same 1000-unit space, centre 500, 500, radius 150). `wide` picks the full line count.
 */
export function Medallion({
  spec,
  wide,
  draw = true,
  centre,
  className,
}: {
  spec: MedallionSpec
  wide: boolean
  draw?: boolean
  centre?: ReactNode
  className?: string
}) {
  const ids = useSvgId()
  const art = useMemo(() => {
    // Shown at ≥ 470 px across when wide (0.47 px per unit), ≈ 300 px otherwise (0.3 px per unit).
    const w = wide ? 1.3 : 2
    const rosetteLines = wide ? spec.lines : Math.max(6, Math.round(spec.lines / 2))
    const rosettePetals = wide ? spec.petals : Math.max(8, Math.round(spec.petals / 2))
    return {
      w,
      edge: reeding(500, 500, 486, 499, wide ? 240 : 150),
      rims: [
        { d: circle(500, 500, 482), w: wide ? 2.6 : 3.2 },
        { d: circle(500, 500, 466), w },
        { d: circle(500, 500, 437), w },
        { d: circle(500, 500, 383), w },
        { d: circle(500, 500, 157), w: wide ? 2.4 : 3 },
      ],
      rope: ring(410, 19, wide ? 40 : 20, wide ? 9 : 4, { cx: 500, cy: 500 }),
      braid: spec.microtext
        ? null
        : ring(451.5, 9.5, wide ? 48 : 24, wide ? 4 : 2, { cx: 500, cy: 500 }),
      field: rosette(372, rosettePetals, 0, rosetteLines, {
        cx: 500,
        cy: 500,
        inner: 0.45,
        twist: spec.twist ?? 0.16,
        weave: true,
        segments: 3,
      }),
      micro: spec.microtext
        ? microtextRing(spec.microtext, 451, { cx: 500, cy: 500, fontSize: wide ? 13 : 20 })
        : null,
    }
  }, [spec, wide])

  return (
    <svg viewBox="0 0 1000 1000" className={className} aria-hidden focusable="false">
      <path
        d={art.edge}
        fill="none"
        stroke="var(--engrave)"
        strokeWidth={wide ? 1.6 : 2.4}
        className={draw ? 'sp-fade' : undefined}
      />
      {art.rims.map((rim, i) => (
        <g key={rim.d.slice(0, 24)} fill="none" stroke="var(--engrave)" strokeWidth={rim.w}>
          <path
            d={rim.d}
            pathLength={draw ? 1 : undefined}
            className={draw ? 'sp-draw' : undefined}
            style={draw ? ({ '--i': i } as CSSProperties) : undefined}
          />
        </g>
      ))}
      {art.micro ? (
        <>
          <defs>
            <path id={`${ids}-micro`} d={art.micro.d} />
          </defs>
          <text
            className={draw ? 'sp-fade sp-micro' : 'sp-micro'}
            fontSize={art.micro.fontSize}
            letterSpacing={art.micro.letterSpacing}
            fill="var(--engrave)"
            dominantBaseline="central"
          >
            <textPath
              href={`#${ids}-micro`}
              textLength={art.micro.textLength}
              lengthAdjust="spacing"
            >
              {art.micro.text}
            </textPath>
          </text>
        </>
      ) : art.braid ? (
        <Lines d={art.braid} width={art.w * 0.8} draw={draw} from={5} />
      ) : null}
      <Lines d={art.rope} width={art.w} draw={draw} from={6} />
      <Lines d={art.field} width={art.w * 0.85} draw={draw} from={8} />
      <circle cx="500" cy="500" r="155.5" fill="var(--ground)" />
      {centre}
    </svg>
  )
}

/**
 * The base-rate line as a stroke: flat, rise, flat, over a solid base, in the mark's proportions (the step is 6.2
 * flat, 3.6 across the rise, 6.2 flat, of 16; it rises 5 of 16). `x`, `y`: the top-left of its box; `w`: its width.
 */
export function rateLinePath(x: number, y: number, w: number): { line: string; base: string } {
  const u = w / 16
  const yHigh = y
  const yLow = y + 5 * u
  const r0 = x + 6.2 * u
  const r1 = r0 + 3.6 * u
  const yBase = yLow + 4.5 * u
  return {
    line: `M${x} ${yLow}H${r0}L${r1} ${yHigh}H${x + w}`,
    base: `M${x} ${yBase}H${x + w}`,
  }
}

/** Parallel rules for a fill: tone from line density (`gap` between rules, `weight` each), at `angle` degrees. */
export function Ruling({
  id,
  gap,
  weight,
  angle = 0,
  color = 'var(--engrave)',
}: {
  id: string
  gap: number
  weight: number
  angle?: number
  color?: string
}) {
  return (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform={angle ? `rotate(${angle})` : undefined}
    >
      <line x1="0" y1={gap / 2} x2={gap} y2={gap / 2} stroke={color} strokeWidth={weight} />
    </pattern>
  )
}

/** A small engraved rosette, for rail nodes, bullets and medallion icons (shown at `px` CSS px across). */
export function Rosette({
  px,
  petals = 12,
  lines = 4,
  className,
}: {
  px: number
  petals?: number
  lines?: number
  className?: string
}) {
  // 100-unit box: the stroke is sized so it renders at ≥ 0.75 CSS px whatever px is.
  const width = Math.max(1.2, (0.75 * 100) / px)
  const d = useMemo(
    () => rosette(46, petals, 0, lines, { cx: 50, cy: 50, inner: 0.35, weave: true, segments: 3 }),
    [petals, lines],
  )
  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={d} fill="none" stroke="var(--engrave)" strokeWidth={width} />
    </svg>
  )
}
