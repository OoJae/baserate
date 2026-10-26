import type { ReactNode } from 'react'
import { RailNote, Station } from './Station'

/**
 * Steps 01 and 04: the line passes a node, an engraved ring on the rail, with what happens there in two serial
 * lines. `btc` cuts the ring in the BTC colour (the only colour amber may take: bitcoin itself).
 */
export function NodeStation({
  lines,
  caption,
  btc = false,
}: {
  lines: [ReactNode, ReactNode]
  caption: ReactNode
  btc?: boolean
}) {
  return (
    <Station caption={caption}>
      <div aria-hidden className="relative h-20">
        <span
          data-draw="fade"
          className={`absolute top-2 size-[11px] -translate-x-1/2 rounded-full border bg-canvas ${btc ? 'border-btc' : 'border-[var(--engrave)]'}`}
          style={{ left: 'calc(var(--to-rail) + 0.5px)' }}
        />
        <RailNote className={btc ? 'top-1.5 text-btc' : 'top-1.5 text-ink'}>{lines[0]}</RailNote>
        <RailNote className="top-7 text-muted">{lines[1]}</RailNote>
      </div>
    </Station>
  )
}
