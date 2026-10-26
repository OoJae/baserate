import { fmt, type MarkDetail, type MarkParts, markParts, rosette } from '../brand/guilloche'
import { WORDMARK_TEXT } from '../brand/wordmark'

/** Gap between the mark and the word, in the mark's 100-unit box (a fifth of the mark, as in the lockup files). */
const GAP = 20

/** The emblem's layers in its 100 × 100 box; colours follow the brand roles, with paper-ground fallbacks. */
function Emblem({ parts }: { parts: MarkParts }) {
  return (
    <>
      <g fill="none" stroke="var(--emblem-line, #0b6e5f)">
        {parts.rims.map((rim) => (
          <path key={rim.d} d={rim.d} strokeWidth={rim.width} />
        ))}
        {parts.rope ? <path d={parts.rope.d} strokeWidth={parts.rope.width} /> : null}
      </g>
      <path d={parts.disc} fill="var(--emblem-plate, #0b6e5f)" />
      <path d={parts.cut} fill="var(--emblem-cut, #f2eee3)" />
    </>
  )
}

/**
 * The engraved emblem: the medium mark's rims, plate and rate step, with a woven guilloche rosette between the rims
 * in place of the rope. Its finest line is 1.1 units, so it holds MIN_LINE_PX from 46 px across (BRAND.md).
 */
const ENGRAVED_LINE = 1.1
let engravedBand: string | undefined

function EngravedEmblem() {
  const parts = markParts('medium')
  engravedBand ??= rosette(46.7, 16, 0, 3, {
    cx: 50,
    cy: 50,
    inner: 0.84,
    amplitude: 1.5,
    weave: true,
    segments: 3,
  })
  return (
    <>
      <g fill="none" stroke="var(--emblem-line, #0b6e5f)">
        {parts.rims.map((rim) => (
          <path key={rim.d} d={rim.d} strokeWidth={rim.width} />
        ))}
        <path d={engravedBand} strokeWidth={ENGRAVED_LINE} />
      </g>
      <path d={parts.disc} fill="var(--emblem-plate, #0b6e5f)" />
      <path d={parts.cut} fill="var(--emblem-cut, #f2eee3)" />
    </>
  )
}

/**
 * Baserate mark: the rate line stepping up from a solid base, cut from a mint plate inside a guilloche rosette.
 * `detail` trades engraving for legibility: 'fine' from 96 px, 'medium' (the default) from 24 px, 'small' below.
 */
export function LogoMark({
  className,
  detail = 'medium',
}: {
  className?: string
  detail?: MarkDetail
}) {
  const parts = markParts(detail)
  return (
    <svg viewBox={parts.viewBox} className={className} aria-hidden>
      <Emblem parts={parts} />
    </svg>
  )
}

/**
 * The mark engraved: a woven rosette ring around the plate and its rate step. Text-free and aria-hidden. Use it at
 * 46 px across or more (below that, `<LogoMark detail="medium" />`).
 */
export function EngravedMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <EngravedEmblem />
    </svg>
  )
}

/**
 * The horizontal lockup: the mark and "Baserate" in Bodoni Moda, outlined so it never waits for a font. The word's
 * capital height runs from the top of the rate step to the foot of its base, so the word stands on the same base.
 * `engraved` swaps in the engraved emblem (46 px tall and up); the word takes the ground's --emblem-word.
 */
export function Wordmark({
  engraved = false,
  className = 'h-9',
}: {
  engraved?: boolean
  className?: string
}) {
  const parts = markParts('medium')
  const word = WORDMARK_TEXT
  const scale = (parts.step.bottom - parts.step.top) / 100
  const width = 100 + GAP + word.width * scale
  const y = parts.step.top - word.capTop * scale
  return (
    <span className="flex items-center">
      <svg
        viewBox={`0 0 ${fmt(width)} 100`}
        className={`w-auto shrink-0 text-ink ${className}`}
        aria-hidden
      >
        {engraved ? <EngravedEmblem /> : <Emblem parts={parts} />}
        <path
          d={word.d}
          fill="var(--emblem-word, currentColor)"
          transform={`translate(${100 + GAP} ${fmt(y, 3)}) scale(${fmt(scale, 5)})`}
        />
      </svg>
      <span className="sr-only">Baserate</span>
    </span>
  )
}
