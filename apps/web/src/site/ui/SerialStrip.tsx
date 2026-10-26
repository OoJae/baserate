import { Link } from '@tanstack/react-router'
import { formatBlock, formatPct, formatUsd0 } from '../data/useLive'
import { Dot } from './Label'
import { Live } from './Live'

/**
 * The hero's frame label, the way a note carries its serial: the network, the block it was read at, BTC/USD from
 * Mezo's Skip feed and M1's borrow rate. Every field is a live read; none is decorative. Slots hold their width, so
 * nothing moves when the values land.
 */
export function SerialStrip({
  block,
  btcUsd,
  aprPct,
  failed,
  className,
}: {
  block: bigint | undefined
  btcUsd: number | null | undefined
  aprPct: number | null | undefined
  /** A read failed: say so and point to the chain instead of showing stale numbers. */
  failed: boolean
  className?: string
}) {
  return (
    <div className={`serial relative text-muted ${className ?? ''}`}>
      {/* Two pairs that never break apart: below 40rem they stack, and the dot between them shows only on one line. */}
      <p className="flex flex-wrap items-baseline gap-y-1.5">
        <span className="whitespace-nowrap">
          <span className="text-ink">Mezo testnet</span>
          <Dot />
          Block{' '}
          <span className="text-ink">
            <Live value={block !== undefined ? formatBlock(block) : null} width="10ch" />
          </span>
        </span>
        <span className="whitespace-nowrap max-sm:basis-full">
          <span className="max-sm:hidden">
            <Dot />
          </span>
          BTC{' '}
          <span className="text-btc">
            <Live value={btcUsd != null ? formatUsd0(btcUsd) : null} width="7ch" />
          </span>
          <Dot />
          M1{' '}
          <span className="text-ink">
            <Live value={aprPct != null ? `${formatPct(aprPct)} APR` : null} width="9ch" />
          </span>
        </span>
      </p>
      {/* Out of flow, so the notice never moves the hero when a read fails late. */}
      {failed ? (
        <p className="absolute top-full left-0 mt-1 normal-case tracking-normal">
          <Link to="/evidence" className="text-ink underline underline-offset-4 hover:no-underline">
            Live read failed. Check the chain on Evidence
          </Link>
        </p>
      ) : null}
    </div>
  )
}
