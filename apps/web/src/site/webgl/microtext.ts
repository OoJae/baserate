/**
 * The coin's microtext ring, the drawing: lays the line (microtextLine.ts) around the ring and paints it into a strip
 * the stage wraps around the ring as a texture (u runs clockwise from twelve o'clock, v from the outer edge in, so
 * capitals stand outward). No three.js here; the stage owns the texture.
 *
 * The face is IBM Plex Mono 500 (self-hosted through src/brand/tokens.css); the stage waits for it with
 * `document.fonts.load` and repaints when it arrives. Import-free, like microtextLine.ts, so the brand scripts can
 * run it under Node.
 */

/** The face, as a CSS font shorthand at `px`. */
export function microtextFont(px: number): string {
  return `500 ${px.toFixed(2)}px "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace`
}

/** IBM Plex Mono's advance and capital height, in em. */
const ADVANCE = 0.6
const CAP_HEIGHT = 0.698

export interface MicrotextRing {
  /** Radius of the band's middle, in coin units. */
  readonly radius: number
  /** The band's radial height, in coin units. */
  readonly band: number
  /** Capital height wanted, in coin units. */
  readonly capHeight: number
}

export interface MicrotextLayout {
  /** The text repeated, with separators, so it closes the ring exactly once. */
  readonly text: string
  /** Characters around the ring. */
  readonly count: number
  /** Font size in coin units. */
  readonly fontSize: number
  /** Extra space per character, in em. */
  readonly tracking: number
}

/**
 * Fits the text around the ring: repeats it until the ring is full, choosing the number of repeats whose font size
 * lands nearest the wanted capital height with tracking between 0.06 and 0.32 em, then spreads the tracking so the
 * ring closes exactly.
 */
export function layoutMicrotext(
  text: string,
  ring: MicrotextRing,
  separator = ' · ',
): MicrotextLayout {
  const unit = Array.from(`${text}${separator}`)
  const circumference = 2 * Math.PI * ring.radius
  const wanted = ring.capHeight / CAP_HEIGHT
  let best: MicrotextLayout | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (let repeats = 1; repeats <= 12; repeats++) {
    const count = unit.length * repeats
    const slot = circumference / count
    // Largest size that keeps the tracking at least 0.06 em, no larger than wanted.
    const size = Math.min(wanted, slot / (ADVANCE + 0.06))
    const tracking = slot / size - ADVANCE
    if (tracking > 0.32) continue
    const score = Math.abs(Math.log(size / wanted)) + (tracking > 0.2 ? (tracking - 0.2) * 2 : 0)
    if (score < bestScore) {
      bestScore = score
      best = { text: unit.join('').repeat(repeats), count, fontSize: size, tracking }
    }
  }
  return (
    best ?? {
      text: unit.join(''),
      count: unit.length,
      fontSize: circumference / unit.length / (ADVANCE + 0.12),
      tracking: 0.12,
    }
  )
}

/**
 * Paints the ring's text into `canvas` (sized by the caller): one character per slot across the width, capitals
 * standing towards y = 0 (the ring's outer edge), in `color` on a transparent ground. The strip maps to the ring
 * with u along the circumference and v across the band, so the canvas is scaled to keep the letters' proportions.
 */
export function drawMicrotext(
  canvas: HTMLCanvasElement,
  layout: MicrotextLayout,
  ring: MicrotextRing,
  color: string,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  const circumference = 2 * Math.PI * ring.radius
  // Canvas px per coin unit along the ring and across it.
  const su = width / circumference
  const sv = height / ring.band
  const fontPx = layout.fontSize * sv
  ctx.save()
  ctx.fillStyle = color
  ctx.font = microtextFont(fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  // Letters are drawn at the band's scale across the ring and squeezed to its scale along it.
  ctx.scale(su / sv, 1)
  const slot = (circumference / layout.count) * sv
  // The capitals sit centred in the band: the baseline is half a capital height below the middle.
  const baseline = height / 2 + (layout.fontSize * CAP_HEIGHT * sv) / 2
  const chars = Array.from(layout.text)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (!ch || ch === ' ') continue
    ctx.fillText(ch, (i + 0.5) * slot, baseline)
  }
  ctx.restore()
}
