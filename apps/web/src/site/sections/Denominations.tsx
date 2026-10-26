import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { DENOMINATIONS, type Denomination } from '../content/products'
import { formatPct, useMarketLive, useNear, useSerials, useSplit } from '../data/useLive'
import { Banknote } from '../ui/Banknote'
import { Label } from '../ui/Label'
import { Live } from '../ui/Live'
import { Section } from '../ui/Section'
import { ArrowRight } from './Hero'

/**
 * The five products as denominations, on ink: banknotes that open their page of the app. Borrow is the large note.
 * Face values are live where they are cheap to read (Borrow's rate, Lend's split) and printed where they are fixed
 * by the contract; each serial is the contract's address.
 */
export function Denominations({ live }: { live: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  const enabled = live && near
  const market = useMarketLive(enabled)
  const split = useSplit(enabled)
  const serials = useSerials(enabled)

  const s = split.data
  const lendFace =
    s && s.total > 0
      ? `${Math.round((s.m1 / s.total) * 100)}/${Math.round((s.wsMusd / s.total) * 100)}`
      : null

  const face = (note: Denomination) => {
    switch (note.face.kind) {
      case 'apr': {
        const apr = market.data?.aprPct
        return <Live value={apr != null ? formatPct(apr) : null} width="5ch" />
      }
      case 'split':
        return <Live value={lendFace} width="5ch" />
      case 'fixed':
        return (
          <>
            <span aria-hidden={note.face.spoken ? true : undefined}>{note.face.text}</span>
            {note.face.spoken ? <span className="sr-only">{note.face.spoken}</span> : null}
          </>
        )
    }
  }

  return (
    <Section labelledBy="notes-title" ground="intaglio" className="pt-24 pb-24 lg:pt-36 lg:pb-36">
      <div className="rail-grid">
        <div>
          <Label>Five notes · Mezo testnet</Label>
          <h2
            id="notes-title"
            className="mt-5 max-w-[17ch] text-balance font-display text-section text-ink"
          >
            Five notes, each backed by a contract you can read.
          </h2>
          <p className="mt-6 max-w-[34rem] text-lead text-muted">
            Each one opens its page in the app. Its serial is that contract’s address.
          </p>
        </div>
      </div>

      <div ref={ref} className="rail-grid mt-14 gap-y-10 lg:mt-20">
        <ul className="-ml-[calc(var(--inset)-var(--gutter))] grid gap-5 sm:grid-cols-2 lg:ml-0 lg:gap-6">
          {DENOMINATIONS.map((note, i) => (
            <Banknote
              key={note.key}
              note={note}
              face={face(note)}
              serial={serials.data?.[note.contract]}
              drawRosette={near}
              className={i === 0 ? 'sm:col-span-2' : undefined}
            />
          ))}
        </ul>
        <div className="at-rail self-start lg:pl-5">
          <Label>Serials · contract addresses</Label>
          <p className="mt-3 max-w-[22rem] text-sm leading-relaxed text-muted">
            Live values on the notes are read from Mezo testnet as you scroll. Fixed ones are set in
            the contracts.
          </p>
          <p className="mt-4">
            <Link
              to="/evidence"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink underline underline-offset-[6px] hover:no-underline"
            >
              See every contract’s source
              <ArrowRight className="size-4" />
            </Link>
          </p>
        </div>
      </div>
    </Section>
  )
}
