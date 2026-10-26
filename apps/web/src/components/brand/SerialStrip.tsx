import { appChain } from '../../wagmi'
import { useChainHead } from '../NetworkGuard'
import { cx } from '../ui'

/**
 * The serial strip under the app: the network, its chain id and the live block, set like a note's serial number
 * (MEZO TESTNET · 31611 / BLOCK 16,368,412 ● LIVE).
 *
 * - Data: the chain head NetworkGuard already polls (one shared query, no new reads, and no oracle reads: Mezo allows
 *   20 precompile calls per multicalled eth_call).
 * - Semantics: plain text. Not a landmark, no live region, no status role; the e2e counts those.
 * - Motion: the block number fades in for 300 ms when a new block arrives (opacity only, so it stays under reduced
 *   motion). Its width is fixed, so a longer number never shifts the line.
 */
export function SerialStrip({
  className,
  stacked = false,
}: {
  className?: string
  /** Two lines (network, then block), for the sidebar's narrow foot. */
  stacked?: boolean
}) {
  const head = useChainHead()
  const block = head.data
  const state = head.isError ? 'down' : block !== undefined ? 'live' : 'wait'

  return (
    <div
      className={cx(
        'serial flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] tracking-[0.06em] text-muted sm:tracking-[0.12em]',
        className,
      )}
    >
      <span className={cx('inline-flex items-center gap-2', stacked && 'basis-full')}>
        <span>{appChain.name}</span>
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        <span>{appChain.id}</span>
      </span>
      {stacked ? null : (
        <span aria-hidden="true" className="text-faint">
          /
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        Block
        <span
          key={block === undefined ? 'none' : block.toString()}
          data-motion-safe=""
          className="serial-tick inline-block min-w-[10ch] text-ink"
        >
          {block !== undefined ? block.toLocaleString('en-US') : '—'}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cx(
            'inline-block size-1.5 rounded-full',
            state === 'live' ? 'bg-good' : state === 'down' ? 'bg-bad' : 'bg-faint',
          )}
        />
        {state === 'live' ? 'Live' : state === 'down' ? 'RPC down' : 'Connecting'}
      </span>
    </div>
  )
}
