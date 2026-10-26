/** WCAG 2.2 contrast, computed from hex values, so every ratio on /brand is calculated rather than typed. */

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** The contrast ratio of two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * "16.01:1", rounded to two places as scripts/brand/contrast.mjs and BRAND.md print it. Whether a pair passes is
 * decided on the unrounded ratio (carries), so rounding never turns a fail into a pass.
 */
export function ratioLabel(ratio: number): string {
  return `${ratio.toFixed(2)}:1`
}

export type ContrastUse = 'text' | 'large' | 'decoration'

/** What a pair may carry: any text (4.5:1), large text and graphics (3:1), or decoration only. */
export function carries(ratio: number): ContrastUse {
  if (ratio >= 4.5) return 'text'
  if (ratio >= 3) return 'large'
  return 'decoration'
}
