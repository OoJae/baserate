import { useMemo } from 'react'
import { bitcoinSign } from '../../../brand/coin'
import { fmt } from '../../../brand/guilloche'

/*
 * The amber centre of the coin, for the loan diagram's first station. Kept apart from the shared engraving parts so
 * only /how-it-works loads the coin's geometry (src/brand/coin.ts).
 */

/** The bitcoin sign as path data: Bodoni Moda's B with its bars (src/brand/coin.ts, the coin's own sign). */
export function bitcoinSignPath(cx: number, cy: number, capHeight: number): string {
  const sign = bitcoinSign(cx, cy, capHeight)
  const letter = sign.letter
    .map((poly) => `M${poly.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`)
    .join('')
  const bars = sign.bars
    .map(([x0, y0, x1, y1]) => `M${fmt(x0)} ${fmt(y0)}H${fmt(x1)}V${fmt(y1)}H${fmt(x0)}Z`)
    .join('')
  return letter + bars
}

/**
 * The amber centre: Satoshi Amber struck with concentric ink rules (about a third ink, so the amber stays bright), cut
 * back by a keyline around the sign, and the sign in ink. Amber appears nowhere else.
 */
export function AmberCentre({
  cx,
  cy,
  r,
  pitch,
  rule,
}: {
  cx: number
  cy: number
  r: number
  /** Distance between rules and their width, in the figure's units. */
  pitch: number
  rule: number
}) {
  const sign = useMemo(() => bitcoinSignPath(cx, cy, r * 0.88), [cx, cy, r])
  const rings: number[] = []
  for (let rr = pitch * 1.5; rr < r - rule; rr += pitch) rings.push(rr)
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="var(--amber)" />
      <g fill="none" stroke="var(--intaglio)" strokeWidth={rule}>
        {rings.map((rr) => (
          <circle key={rr} cx={cx} cy={cy} r={rr} />
        ))}
      </g>
      <path
        d={sign}
        fill="var(--intaglio)"
        stroke="var(--amber)"
        strokeWidth={r * 0.14}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </g>
  )
}
