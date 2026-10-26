import { useQueries, useQuery } from '@tanstack/react-query'
import { contractRows } from '../../lib/contracts'
import { evidence } from '../../lib/evidence'
import { addressInfoQuery, evidenceTxQuery, keeperStatusQuery } from '../../lib/evidenceQueries'
import { keeperHealth } from '../../lib/keeper'
import type { TallyItem } from '../line/Tally'
import { ProofLiveRows } from './proofCopy'

/*
 * The proof's live checks, in their own chunk (they bring the evidence file, the SDK ABIs that name methods, and
 * the explorer client). Same query options and keys as the Evidence page, through its 3-at-a-time explorer limit,
 * so a judge who opens Evidence next finds these checks already done.
 */

/** The current stack's entries; the retired v1 deployment's history stays on the Evidence page. */
const current = evidence.entries.filter((e) => e.area !== 'v1')
const v1Count = evidence.entries.length - current.length
const ours = contractRows().filter((r) => r.ours)

/** Seconds since the keeper's last liquidation scan, in words. */
function scanAge(seconds: number | undefined): string | null {
  if (seconds === undefined) return null
  if (seconds < 90) return `${Math.round(seconds)} s ago`
  if (seconds < 5_400) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3_600)} h ago`
}

/** `active`: the section is within a screen, so the keeper's status keeps polling; out of range it rests. */
export default function ProofLive({ active }: { active: boolean }) {
  const txs = useQueries({ queries: current.map((entry) => evidenceTxQuery(entry)) })
  const sources = useQueries({ queries: ours.map((row) => addressInfoQuery(row.address)) })

  const items: TallyItem[] = txs.map((q, i) => ({
    id: current[i]?.tx ?? String(i),
    state:
      q.data?.state === 'verified'
        ? 'verified'
        : q.isPending || q.isFetching
          ? 'pending'
          : 'failed',
  }))
  const keeper = useQuery({ ...keeperStatusQuery(), enabled: active })
  const health = keeperHealth(keeper.data, { isError: keeper.isError })
  const checked = sources.filter((q) => q.data !== undefined)
  const sourcesError = sources.some((q) => q.isError)

  return (
    <ProofLiveRows
      txs={items}
      txTotal={current.length}
      v1Count={v1Count}
      sources={
        checked.length === ours.length
          ? {
              verified: checked.filter((q) => q.data?.isVerified).length,
              checked: checked.length,
            }
          : null
      }
      sourcesTotal={ours.length}
      sourcesError={sourcesError}
      keeper={
        keeper.isPending
          ? null
          : { label: health.label, age: scanAge(health.scanAgeS), failed: keeper.isError }
      }
    />
  )
}
