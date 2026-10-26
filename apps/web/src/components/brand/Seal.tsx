import { useLayoutEffect, useRef } from 'react'
import { circle, markParts, ring } from '../../brand/guilloche'
import { DURATION_MS, EASE, prefersReducedMotion } from '../../theme/brand'
import { cx } from '../ui'

/**
 * The engraved seal a confirmed transaction stamps onto its toast: a woven rope, a plain rim and a plate with the
 * rate step cut from it. Text-free and aria-hidden: the toast's title and message carry the meaning.
 *
 * Drawn for 32 px: every line is at least 2 units of its 100-unit box (0.64 px at 32 px, MIN_LINE_PX in BRAND.md).
 * `mint` is the brand's seal for every success; `seal` (Seal Red) is for a liquidation only.
 *
 * Motion (once, on mount): it stamps in over 500 ms (scale 1.6 → 0.92 → 1, rotate −14° → 0, opacity 0 → 1) and an
 * ink ring spreads from it at the moment of impact. Under reduced motion it is simply there.
 */
export type SealTone = 'mint' | 'seal'

const TONE_COLOR: Record<SealTone, string> = {
  mint: 'var(--brand)',
  seal: 'var(--seal)',
}

let geometry: { rope: string; rim: string; plate: string; cut: string } | undefined

function sealGeometry() {
  if (geometry) return geometry
  const small = markParts('small')
  geometry = {
    rope: ring(44.5, 3.6, 14, 2, { cx: 50, cy: 50, segments: 3 }),
    rim: circle(50, 50, 37.8),
    plate: circle(50, 50, 33.5),
    // The small mark's step and base, scaled from its 42.4-unit plate onto this one.
    cut: small.cut,
  }
  return geometry
}

/** Where the stamp lands, as a share of its 500 ms: the ink ring spreads from here. */
const IMPACT = 0.62

export function Seal({ tone = 'mint', className }: { tone?: SealTone; className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const inkRef = useRef<SVGCircleElement>(null)
  const g = sealGeometry()
  const color = TONE_COLOR[tone]

  useLayoutEffect(() => {
    const svg = svgRef.current
    const ink = inkRef.current
    if (!svg || !ink || typeof svg.animate !== 'function' || prefersReducedMotion()) return
    const stamp = svg.animate(
      [
        { transform: 'scale(1.6) rotate(-14deg)', opacity: 0, easing: EASE.in },
        { transform: 'scale(0.92) rotate(-1deg)', opacity: 1, offset: IMPACT, easing: EASE.out },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ],
      { duration: DURATION_MS.seal, fill: 'backwards' },
    )
    const spread = ink.animate(
      [
        { transform: 'scale(0.86)', opacity: 0.45 },
        { transform: 'scale(1.5)', opacity: 0 },
      ],
      {
        duration: DURATION_MS.ring,
        delay: DURATION_MS.seal * IMPACT,
        easing: EASE.out,
        fill: 'forwards',
      },
    )
    return () => {
      stamp.cancel()
      spread.cancel()
    }
  }, [])

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className={cx('block overflow-visible', className)}
      aria-hidden
      focusable="false"
    >
      <circle
        ref={inkRef}
        cx="50"
        cy="50"
        r="47"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        opacity="0"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
      <g fill="none" stroke={color}>
        <path d={g.rope} strokeWidth="2.1" />
        <path d={g.rim} strokeWidth="2.6" />
      </g>
      <path d={g.plate} fill={color} />
      <path
        d={g.cut}
        fill="var(--surface)"
        transform="translate(50 50) scale(0.79) translate(-50 -50)"
      />
    </svg>
  )
}
