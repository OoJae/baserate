import type { CSSProperties } from 'react'

/**
 * A live value in a fixed-width tabular slot, so its arrival never moves the text around it. Shows "—" until the
 * read lands, and "—" again if it fails (the caller links to Evidence then); a value is never estimated. Marked
 * `data-live` so screenshot checks can mask it.
 */
export function Live({
  value,
  width,
  className,
}: {
  value: string | null | undefined
  /** The slot's minimum width, e.g. "10ch". */
  width: string
  className?: string
}) {
  return (
    <span
      data-live
      aria-busy={value == null ? true : undefined}
      className={`slot ${className ?? ''}`}
      style={{ '--w': width } as CSSProperties}
    >
      {value ?? '—'}
    </span>
  )
}
