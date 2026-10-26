import { Link } from '@tanstack/react-router'
import { env } from '../../env'
import { Tally, type TallyItem } from '../line/Tally'
import { Live } from '../ui/Live'
import { ProofRow } from './ProofRow'

/** The tally's one-line status, in a fixed-height slot so a change of wording never moves the page. */
function TallyStatus({ items }: { items: readonly TallyItem[] | null }) {
  if (!items) return <p className="serial mt-3 h-4 text-faint">Waiting to check</p>
  const pending = items.filter((t) => t.state === 'pending').length
  const failed = items.filter((t) => t.state === 'failed').length
  if (pending > 0)
    return (
      <p className="serial mt-3 h-4 whitespace-nowrap text-faint">
        Checking · {items.length - pending} of {items.length} looked up
      </p>
    )
  if (failed > 0)
    return (
      <p className="serial mt-3 h-4 whitespace-nowrap text-faint">
        {failed} not confirmed ·{' '}
        <Link to="/evidence" className="text-ink underline underline-offset-4">
          see Evidence
        </Link>
      </p>
    )
  return <p className="serial mt-3 h-4 whitespace-nowrap text-faint">All confirmed just now</p>
}

/**
 * The two proof rows checked live against the explorer: recorded transactions and contract sources. The entry renders
 * them with empty slots until the lazy ProofLive chunk takes over with the same markup, so the section never moves
 * when the checks land.
 */
export function ProofLiveRows({
  txs,
  txTotal,
  v1Count,
  sources,
  sourcesTotal,
  sourcesError,
  keeper,
}: {
  /** The keeper's health word and the age of its last liquidation scan, once its status has answered. */
  keeper: { label: string; age: string | null; failed: boolean } | null
  txs: readonly TallyItem[] | null
  txTotal: number | null
  v1Count: number | null
  sources: { verified: number; checked: number } | null
  sourcesTotal: number | null
  sourcesError: boolean
}) {
  const verified = txs ? txs.filter((t) => t.state === 'verified').length : null
  const of = (n: number | null, total: number | null) =>
    n != null && total != null ? `${n} of ${total}` : null

  return (
    <>
      <ProofRow
        label="Transactions verified live"
        value={<Live value={of(verified, txTotal)} width="7ch" />}
        figure={
          <>
            {txs ? <Tally items={txs} /> : <div aria-hidden className="h-7" />}
            <TallyStatus items={txs} />
          </>
        }
        body="Every transaction recorded for the current contracts, re-checked against the chain as you read: it exists, it succeeded, and it sits in the block we recorded."
        source={
          <>
            src/evidence.json · Mezo Blockscout
            {v1Count ? ` · ${v1Count} more from v1 on Evidence` : ''}
          </>
        }
      />
      <ProofRow
        label="Contracts with verified source"
        value={
          <Live
            value={sourcesError ? null : of(sources?.verified ?? null, sourcesTotal)}
            width="7ch"
          />
        }
        body={
          sourcesError ? (
            <>
              The source check did not answer.{' '}
              <Link to="/evidence" className="underline underline-offset-4">
                Check each contract on Evidence
              </Link>
              .
            </>
          ) : (
            'Every contract Baserate deployed, with its source code published and matched to the bytecode on chain.'
          )
        }
        source="Blockscout, else Sourcify · src/lib/contracts.ts"
      />
      <ProofRow
        label="Keeper"
        value={<Live value={keeper?.label} width="9ch" />}
        figure={
          <p className="serial h-4 whitespace-nowrap text-faint">
            {keeper?.failed ? (
              <Link to="/evidence" className="text-ink underline underline-offset-4">
                Status did not answer · see Evidence
              </Link>
            ) : (
              <>
                Last scan <Live value={keeper?.age} width="10ch" />
              </>
            )}
          </p>
        }
        body="Our keeper scans every M1 loan for liquidation, runs vMUSD’s allocator and pays out fees. Each of those calls is open to anyone, so you can make it yourself."
        source={
          <a
            href={`${env.keeperUrl}/status`}
            className="underline underline-offset-4 hover:no-underline"
            rel="noreferrer"
          >
            keeper /status
          </a>
        }
      />
    </>
  )
}
