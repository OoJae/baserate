import type { CSSProperties } from 'react'
import { fmt, type MarkDetail, markFloor, markParts } from '../../../brand/guilloche'
import {
  WORDMARK_DISPLAY,
  WORDMARK_FLOORS,
  WORDMARK_TEXT,
  type WordmarkCut,
} from '../../../brand/wordmark'
import { useSvgId } from '../engraving'

/*
 * The logo, drawn from the brand's own sources (src/brand/guilloche.ts markParts, src/brand/wordmark.ts) for the
 * /brand specimens, so the page shows exactly what the asset files contain. Colours are the emblem roles
 * (--emblem-line, --emblem-plate, --emblem-cut), which follow the ground.
 */

/** The emblem at one level of detail. */
export function Mark({
  detail,
  className,
  style,
}: {
  detail: MarkDetail
  className?: string
  style?: CSSProperties
}) {
  const parts = markParts(detail)
  return (
    <svg viewBox={parts.viewBox} className={className} style={style} aria-hidden focusable="false">
      <g fill="none" stroke="var(--emblem-line)">
        {parts.rims.map((rim) => (
          <path key={rim.d} d={rim.d} strokeWidth={rim.width} />
        ))}
        {parts.rope ? <path d={parts.rope.d} strokeWidth={parts.rope.width} /> : null}
      </g>
      <path d={parts.disc} fill="var(--emblem-plate)" />
      <path d={parts.cut} fill="var(--emblem-cut)" />
    </svg>
  )
}

/** The emblem's paths in its 100-unit box, to place inside a larger figure. */
export function MarkPaths({ detail, transform }: { detail: MarkDetail; transform?: string }) {
  const parts = markParts(detail)
  return (
    <g transform={transform}>
      <g fill="none" stroke="var(--emblem-line)">
        {parts.rims.map((rim) => (
          <path key={rim.d} d={rim.d} strokeWidth={rim.width} />
        ))}
        {parts.rope ? <path d={parts.rope.d} strokeWidth={parts.rope.width} /> : null}
      </g>
      <path d={parts.disc} fill="var(--emblem-plate)" />
      <path d={parts.cut} fill="var(--emblem-cut)" />
    </g>
  )
}

/** "Baserate", outlined, in one cut; the display cut can carry its engraving (paper lines through the thick strokes). */
export function Word({
  cut,
  engraved = false,
  className,
  style,
}: {
  cut: WordmarkCut
  engraved?: boolean
  className?: string
  style?: CSSProperties
}) {
  const id = useSvgId()
  const box = `M0 -2H${fmt(cut.width)}V${fmt(cut.height + 2)}H0Z`
  return (
    <svg
      viewBox={`0 0 ${fmt(cut.width)} ${fmt(cut.height)}`}
      className={className}
      style={style}
      aria-hidden
      focusable="false"
    >
      {engraved && cut.engraving ? (
        <>
          <defs>
            <clipPath id={`${id}-cut`}>
              <path d={box + cut.engraving} clipRule="evenodd" />
            </clipPath>
          </defs>
          <path d={cut.d} fill="var(--emblem-word)" clipPath={`url(#${id}-cut)`} />
        </>
      ) : (
        <path d={cut.d} fill="var(--emblem-word)" />
      )}
    </svg>
  )
}

/** The two optical cuts with the capital heights they are drawn at. */
export const WORD_CUTS = {
  display: WORDMARK_DISPLAY,
  text: WORDMARK_TEXT,
  floors: WORDMARK_FLOORS,
} as const

/** Width of a cut drawn at a given capital height (the cuts' capital height is 100 units). */
export function wordWidth(cut: WordmarkCut, capPx: number): number {
  return (cut.width / 100) * capPx
}

/**
 * The device-pixel floor of each level of detail: markFloor() rounded up to the 8-pixel step BRAND.md quotes
 * (166.7 → 168, 31.3 → 32, 15.6 → 16).
 */
export const MARK_FLOORS: Record<MarkDetail, number> = {
  fine: Math.ceil(markFloor('fine') / 8) * 8,
  medium: Math.ceil(markFloor('medium') / 8) * 8,
  small: Math.ceil(markFloor('small') / 8) * 8,
}

/** The clear space: a quarter of the mark's diameter on every side, measured on a medium mark. */
export function ClearSpace() {
  // Mark 160 units across, clear space 40 on every side: a 240-unit field.
  return (
    <svg viewBox="-12 -12 264 264" className="sp-clear" aria-hidden focusable="false">
      <rect x="0" y="0" width="240" height="240" className="sp-clear__field" />
      <rect x="40" y="40" width="160" height="160" className="sp-clear__box" />
      <MarkPaths detail="medium" transform="translate(40 40) scale(1.6)" />
      {/* Dimension lines: D across the mark, D/4 on two sides. */}
      <g className="sp-clear__dim">
        <path d="M40 222H200M40 216v12M200 216v12" />
        <path d="M210 0V40M204 0h12M204 40h12" />
        <path d="M0 18H40M0 12v12M40 12v12" />
      </g>
      <text x="120" y="238" className="sp-clear__label" textAnchor="middle">
        D
      </text>
      <text x="216" y="24" className="sp-clear__label">
        D/4
      </text>
      <text x="20" y="10" className="sp-clear__label" textAnchor="middle">
        D/4
      </text>
    </svg>
  )
}

export type DontKind = 'recolour' | 'rotate' | 'stretch' | 'live'

/** A logo misuse, drawn and struck through in ink (never Seal Red: it is kept for liquidation). */
export function LogoDont({ kind }: { kind: DontKind }) {
  return (
    <div className="sp-dont">
      <div className={`sp-dont__art sp-dont__art--${kind}`} aria-hidden>
        {kind === 'live' ? (
          <span className="sp-dont__live">
            <Mark detail="medium" className="sp-dont__mark" />
            <span>Baserate</span>
          </span>
        ) : (
          <Mark detail="medium" className="sp-dont__mark" />
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="sp-dont__strike"
          aria-hidden
          focusable="false"
        >
          <path d="M8 8L92 92M92 8L8 92" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  )
}
