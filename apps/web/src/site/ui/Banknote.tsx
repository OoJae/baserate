import { Link } from '@tanstack/react-router'
import { type ReactNode, useMemo } from 'react'
import { rosette } from '../../brand/guilloche'
import type { Denomination } from '../content/products'
import { shortHex } from '../data/useLive'
import { SerialText } from './Label'

/** The note's rosette: woven, in the ground's engraving colour, 0.6-unit lines (≥ 0.5 px at the size it is shown). */
function NoteRosette({ petals, phase, draw }: { petals: number; phase: number; draw: boolean }) {
  const d = useMemo(
    () =>
      draw
        ? rosette(54, petals, phase, 7, { cx: 60, cy: 60, inner: 0.34, weave: true, segments: 2 })
        : '',
    [draw, petals, phase],
  )
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden
      className="note-rosette size-full text-[var(--engrave)]"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="60" cy="60" r="58.5" strokeWidth="0.9" />
      <circle cx="60" cy="60" r="56" strokeWidth="0.6" />
      {d ? <path d={d} strokeWidth="0.6" /> : null}
      <circle cx="60" cy="60" r="17" strokeWidth="0.9" />
    </svg>
  )
}

/**
 * A denomination: one product as a banknote. Hairline frame within a frame, the woven band along its top, a Bodoni
 * face value, a rosette, and the contract's address as its serial. The heading's link covers the note, so the whole
 * note opens that page of the app while the link's name stays the product's.
 */
export function Banknote({
  note,
  face,
  serial,
  drawRosette,
  className,
}: {
  className?: string
  note: Denomination
  face: ReactNode
  serial: string | undefined
  drawRosette: boolean
}) {
  const id = `note-${note.key}`
  return (
    <li
      className={`note min-h-[11.5rem] grid-rows-[auto_1fr] sm:min-h-[13.5rem] ${className ?? ''}`}
    >
      <div aria-hidden className="band mx-3 mt-3 h-2.5 opacity-80" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr_auto] gap-x-4 px-5 pt-3 pb-4 sm:px-6 sm:pb-5">
        <h3 className="font-display text-[1.75rem] leading-none text-ink">
          <Link
            to={note.to}
            aria-describedby={`${id}-caption`}
            className="note-link inline-flex min-h-11 items-center"
          >
            {note.name}
          </Link>
        </h3>
        <p className="serial self-center text-right text-faint">
          <span className="sr-only">{note.contractName} contract </span>
          <span data-live className="slot normal-case [--w:11ch]">
            {serial ? shortHex(serial) : '—'}
          </span>
        </p>
        <div className="col-start-1 row-start-2 self-end">
          <p className="numeral text-[clamp(2.75rem,4.6vw,4.25rem)] leading-[0.95] tracking-[-0.02em] text-ink">
            {face}
          </p>
          <p className="serial mt-2 text-muted">
            <SerialText>{note.unit}</SerialText>
          </p>
        </div>
        <div className="col-start-2 row-span-2 row-start-2 size-[5.75rem] self-center justify-self-end sm:size-28">
          <NoteRosette petals={note.rosette.petals} phase={note.rosette.phase} draw={drawRosette} />
        </div>
        <p
          id={`${id}-caption`}
          className="col-start-1 row-start-3 mt-3 max-w-[30rem] text-sm leading-snug text-muted"
        >
          {note.caption}
        </p>
      </div>
    </li>
  )
}
