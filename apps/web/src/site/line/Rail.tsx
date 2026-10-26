/**
 * A section's stretch of the base-rate line: 1 px at --rail-x, top to bottom of its section, so consecutive sections
 * join into one line. motion.ts scrubs its scaleY with the pen at 60 % of the viewport; without motion it is drawn.
 */
export function Rail() {
  return <span aria-hidden data-rail className="rail" />
}
