import { maxBig } from '@baserate/sdk'
import { env } from '../env'

/**
 * The Baserate subgraph (packages/subgraph, served by Goldsky) answers history reads (allocator moves,
 * distributions, borrow accounts, backstop exits) in one request instead of a log scan in 10,000-block windows.
 * It indexes Mezo testnet only, so a local fork never uses it. Unset, every hook reads logs exactly as before.
 */
export const subgraphUrl: string | undefined = env.localFork ? undefined : env.subgraphUrl

const TIMEOUT_MS = 8_000

/** Selected by every query: the block the subgraph answered at. */
export const META = '_meta { block { number } }'

export interface SubgraphMeta {
  _meta: { block: { number: number } }
}

export class SubgraphError extends Error {
  override name = 'SubgraphError'
}

/** POSTs a GraphQL query; throws on HTTP, GraphQL or shape errors so callers can fall back to logs. */
export async function querySubgraph<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T & SubgraphMeta> {
  if (!subgraphUrl) throw new SubgraphError('No subgraph configured')
  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new SubgraphError(`Subgraph HTTP ${res.status}`)
  const body = (await res.json()) as {
    data?: (T & SubgraphMeta) | null
    errors?: { message?: string }[]
  }
  if (body.errors?.length)
    throw new SubgraphError(body.errors[0]?.message ?? 'Subgraph query failed')
  const head = body.data?._meta?.block?.number
  if (!body.data || typeof head !== 'number') throw new SubgraphError('Malformed subgraph response')
  return body.data
}

/** The block a response was answered at. */
export function indexedTo(data: SubgraphMeta): bigint {
  return BigInt(data._meta.block.number)
}

let warned = false

/** The subgraph's answer, or undefined when none is configured or it fails (the caller then reads logs). */
export async function trySubgraph<T>(read: () => Promise<T>): Promise<T | undefined> {
  if (!subgraphUrl) return undefined
  try {
    return await read()
  } catch (error) {
    if (!warned) {
      warned = true
      console.warn('Baserate subgraph unavailable; reading history from logs instead.', error)
    }
    return undefined
  }
}

/**
 * A history read. With a subgraph: what it has indexed plus a log read of the blocks after its head, so events
 * from the last few seconds (and any stretch a lagging indexer missed) still show up. Without one, or if it fails:
 * the whole range from `startBlock` is read from logs, exactly as without a subgraph. Items are oldest first
 * (subgraph items, then the log tail); `logs(fromBlock)` must return events at or after `fromBlock`.
 */
export async function readHistory<T>(params: {
  subgraph: () => Promise<{ items: T[]; indexedTo: bigint }>
  logs: (fromBlock: bigint) => Promise<T[]>
  startBlock: bigint
}): Promise<T[]> {
  const indexed = await trySubgraph(params.subgraph)
  if (!indexed) return params.logs(params.startBlock)
  const from = maxBig(indexed.indexedTo + 1n, params.startBlock)
  try {
    return [...indexed.items, ...(await params.logs(from))]
  } catch {
    // The RPC is failing; what the subgraph indexed is still the best answer available.
    return indexed.items
  }
}
