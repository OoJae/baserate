import type { CSSProperties } from 'react'

/**
 * The line primitive: a 1 px span of the base-rate line, in the ground's engraving colour (Guilloche on ink, Mint on
 * paper). It is drawn complete; motion.ts scrubs it from scale 0 when the reader allows motion, using only scaleX,
 * scaleY and opacity. `draw` names the scene that scrubs it ("station" lines draw as their station passes the pen).
 */
export function Ln({
  axis,
  className,
  style,
  draw = 'station',
}: {
  axis: 'x' | 'y'
  className?: string
  style?: CSSProperties
  draw?: 'station' | 'none'
}) {
  return (
    <span
      aria-hidden
      data-ln={draw === 'none' ? undefined : axis}
      className={`ln ${axis === 'x' ? 'ln-x' : 'ln-y'} ${className ?? ''}`}
      style={style}
    />
  )
}
