import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { formatBlock, formatPct, useHead, useMarketLive, useNear } from '../data/useLive'
import { Live } from '../ui/Live'
import { Ln } from './Ln'
import { RailNote, Station } from './Station'

const TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

/**
 * Step 02: the rail becomes a loan-to-value gauge, 0 % at the top and 100 % at the bottom, so it fills as the pen
 * draws down the page. The heavy stroke runs to the most a standard account may borrow (`limits(STANDARD)`, live);
 * the one Seal Red mark on the page is M1's liquidation threshold (its LLTV).
 */
export function LtvGaugeStation({ live }: { live: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const near = useNear(ref)
  const market = useMarketLive(live && near)
  const head = useHead(live && near)
  const max = market.data?.maxLtvPct ?? null
  const lltv = market.data?.lltvPct ?? null

  return (
    <Station
      stationRef={ref}
      caption={
        market.isError ? (
          <>
            The live limits did not load.{' '}
            <Link to="/evidence" className="text-ink underline underline-offset-4">
              Check them on Evidence
            </Link>
            .
          </>
        ) : (
          <>
            Borrow up to <Live value={max != null ? formatPct(max, 0) : null} width="3ch" /> of your
            BTC’s value. M1 liquidates a loan at{' '}
            <Live value={lltv != null ? formatPct(lltv, 0) : null} width="3ch" />. Read at block{' '}
            <Live
              value={head.data !== undefined ? `#${formatBlock(head.data)}` : null}
              width="11ch"
            />
            .
          </>
        )
      }
    >
      <div aria-hidden className="relative h-64 lg:h-80">
        {TICKS.map((t) => (
          <Ln
            key={t}
            axis="x"
            className={t % 50 === 0 ? 'w-3.5' : 'w-[7px] opacity-70'}
            style={{ left: 'var(--to-rail)', top: `${t}%` }}
          />
        ))}
        <RailNote className="-translate-y-1/2 text-faint" style={{ top: '0%' }}>
          0%
        </RailNote>
        <RailNote className="-translate-y-1/2 text-faint" style={{ top: '100%' }}>
          100% LTV
        </RailNote>
        {max != null ? (
          <>
            <span
              data-draw="y"
              className="absolute top-0 w-[3px] origin-top bg-[var(--engrave)]"
              style={{ left: 'calc(var(--to-rail) - 1px)', height: `${max}%` }}
            />
            <RailNote className="-translate-y-1/2 text-ink" style={{ top: `${max}%` }}>
              {formatPct(max, 0)} · most you can borrow
            </RailNote>
          </>
        ) : null}
        {lltv != null ? (
          <>
            <span
              data-draw="fade"
              className="absolute h-0.5 w-4 -translate-y-1/2 bg-seal"
              style={{ left: 'calc(var(--to-rail) - 7.5px)', top: `${lltv}%` }}
            />
            <RailNote className="-translate-y-1/2 text-bad" style={{ top: `${lltv}%` }}>
              {formatPct(lltv, 0)} · liquidation threshold
            </RailNote>
          </>
        ) : null}
      </div>
    </Station>
  )
}
