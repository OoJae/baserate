import { Link } from '@tanstack/react-router'
import { type CSSProperties, useRef } from 'react'
import { formatBlock, formatPct, useHead, useNear, useSplit } from '../data/useLive'
import { Live } from '../ui/Live'
import { Ln } from './Ln'
import { RailNote, Station } from './Station'

/** Hairlines per strand: 1 to 6, following the share of vMUSD's MUSD behind it. */
function strands(share: number | null): number {
  if (share == null || !Number.isFinite(share)) return 1
  return Math.min(6, Math.max(1, Math.round(share * 6)))
}

/** The station's geometry, in px: the drawing's height, where the strands part and rejoin on the rail, and how far
 * the wsMUSD strand runs beside it (the diagonals run BRANCH across and DROP down). */
const H = 272
const PART = 36
const BRANCH = 96
const DROP = 48
const DIAGONAL = Math.hypot(BRANCH, DROP)
const ANGLE = (Math.atan2(DROP, BRANCH) * 180) / Math.PI

/**
 * Step 03: the rail branches into vMUSD's two strands, M1 (on the rail) and wsMUSD (beside it), then they rejoin.
 * Each strand carries one to six hairlines, by the live share of the vault's MUSD behind it (Vault V2 `allocation`).
 */
export function AllocationSplitStation({ live }: { live: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const near = useNear(ref)
  const split = useSplit(live && near)
  const head = useHead(live && near)
  const s = split.data
  const m1 = s && s.total > 0 ? s.m1 / s.total : null
  const ws = s && s.total > 0 ? s.wsMusd / s.total : null
  const k1 = strands(m1)
  const k2 = strands(ws)

  const bundle = (k: number, at: string, top: number) =>
    Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * 3).map((offset) => (
      <Ln
        key={`${at}:${offset}`}
        axis="y"
        style={{ left: `calc(${at} + ${offset}px)`, top: `${top}px`, height: `${H - 2 * top}px` }}
      />
    ))

  return (
    <Station
      stationRef={ref}
      caption={
        split.isError ? (
          <>
            The vault’s split did not load.{' '}
            <Link to="/evidence" className="text-ink underline underline-offset-4">
              Check vMUSD on Evidence
            </Link>
            .
          </>
        ) : s === null ? (
          'vMUSD is not deployed on this network yet.'
        ) : (
          <>
            vMUSD lends <Live value={m1 != null ? formatPct(m1 * 100, 0) : null} width="4ch" /> of
            its MUSD to M1 borrowers and keeps{' '}
            <Live value={ws != null ? formatPct(ws * 100, 0) : null} width="4ch" /> in wsMUSD. Read
            at block{' '}
            <Live
              value={head.data !== undefined ? `#${formatBlock(head.data)}` : null}
              width="11ch"
            />
            .
          </>
        )
      }
    >
      <div aria-hidden className="relative" style={{ height: `${H}px` }}>
        {/* The branch: off the rail, down and across to the wsMUSD strand. */}
        <Ln
          axis="x"
          className="rotate-(--a)"
          style={
            {
              left: 'var(--to-rail)',
              top: `${PART}px`,
              width: `${DIAGONAL}px`,
              '--a': `${ANGLE}deg`,
            } as CSSProperties
          }
        />
        {bundle(k1, 'var(--to-rail)', PART)}
        {bundle(k2, `var(--to-rail) + ${BRANCH}px`, PART + DROP)}
        {/* The rejoin: back across and down onto the rail. */}
        <Ln
          axis="x"
          className="rotate-(--a)"
          style={
            {
              left: `calc(var(--to-rail) + ${BRANCH}px)`,
              top: `${H - PART - DROP}px`,
              width: `${DIAGONAL}px`,
              '--a': `${180 - ANGLE}deg`,
            } as CSSProperties
          }
        />
        <RailNote
          className="-translate-y-[140%] text-faint normal-case"
          style={{ top: `${PART}px` }}
        >
          vMUSD
        </RailNote>
        <RailNote className="text-ink" style={{ top: `${H / 2 - 18}px` }}>
          M1
        </RailNote>
        <RailNote className="text-muted" style={{ top: `${H / 2 + 2}px` }}>
          <Live value={m1 != null ? formatPct(m1 * 100, 0) : null} width="4ch" />
        </RailNote>
        <span
          data-draw="fade"
          className="serial absolute text-ink normal-case"
          style={{ left: `calc(var(--to-rail) + ${BRANCH + 16}px)`, top: `${H / 2 - 18}px` }}
        >
          wsMUSD
        </span>
        <span
          data-draw="fade"
          className="serial absolute text-muted"
          style={{ left: `calc(var(--to-rail) + ${BRANCH + 16}px)`, top: `${H / 2 + 2}px` }}
        >
          <Live value={ws != null ? formatPct(ws * 100, 0) : null} width="4ch" />
        </span>
      </div>
    </Station>
  )
}
