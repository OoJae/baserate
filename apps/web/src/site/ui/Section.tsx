import type { ReactNode } from 'react'
import { Rail } from '../line/Rail'

/**
 * A landing section on its ground: Intaglio (ink) or Note (paper, with its fibre grain). Every section carries its
 * stretch of the base-rate line unless `rail` is false, and is named by its heading for assistive tech.
 */
export function Section({
  id,
  labelledBy,
  ground,
  rail = true,
  className,
  children,
}: {
  id?: string
  labelledBy: string
  ground: 'intaglio' | 'note'
  rail?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-ground={ground}
      data-section
      className={`relative ${ground === 'note' ? 'paper text-ink' : 'bg-canvas text-ink'} ${className ?? ''}`}
    >
      {rail ? <Rail /> : null}
      {children}
    </section>
  )
}
