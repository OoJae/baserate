import type { CSSProperties, ReactNode, Ref } from 'react'

/**
 * A station: a figure where the base-rate line becomes a measurement. It sits in the row's figure column, which
 * starts on the rail from 64rem and sits under the copy below that; `--to-rail` is the distance from the figure's
 * left edge to the rail either way, so its line work is always drawn on the one line. Live values in a station are
 * DOM text in its figcaption ("as of block #…"); the drawing is aria-hidden.
 */
export function Station({
  children,
  caption,
  className,
  stationRef,
}: {
  children: ReactNode
  caption: ReactNode
  className?: string
  stationRef?: Ref<HTMLElement>
}) {
  return (
    <figure
      ref={stationRef}
      data-station
      className={`at-rail relative [--to-rail:calc(var(--rail-x)-var(--inset))] lg:[--to-rail:0px] ${className ?? ''}`}
    >
      {children}
      <figcaption className="mt-4 max-w-[26rem] text-sm leading-relaxed text-muted lg:pl-5">
        {caption}
      </figcaption>
    </figure>
  )
}

/** A label beside the rail inside a station: Plex Mono caps, never over the line. */
export function RailNote({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      data-draw="fade"
      className={`serial absolute left-[max(0px,calc(var(--to-rail)+1.25rem))] whitespace-nowrap ${className ?? ''}`}
      style={style}
    >
      {children}
    </span>
  )
}
