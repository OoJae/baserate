import { blockscoutApi } from '@baserate/sdk'
import raw from '../evidence.json'

/** One curated piece of on-chain evidence (schema: src/evidence.schema.json). */
export interface EvidenceEntry {
  chainId: 31611 | 31612
  kind: string
  tx: `0x${string}`
  block: number
  summary: string
  proves: string
}

/** Validates the bundled evidence file; malformed rows are reported, never silently dropped. */
export function parseEvidence(input: unknown): { entries: EvidenceEntry[]; errors: string[] } {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { entries?: unknown }).entries)
      ? (input as { entries: unknown[] }).entries
      : null
  if (!list) return { entries: [], errors: ['evidence.json must contain an "entries" array'] }

  const entries: EvidenceEntry[] = []
  const errors: string[] = []
  list.forEach((item, i) => {
    const e = item as Partial<EvidenceEntry>
    const problems: string[] = []
    if (e.chainId !== 31611 && e.chainId !== 31612) problems.push('chainId must be 31611 or 31612')
    if (typeof e.kind !== 'string' || !/^[a-z0-9-]{2,40}$/.test(e.kind)) problems.push('kind')
    if (typeof e.tx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(e.tx)) problems.push('tx hash')
    if (typeof e.block !== 'number' || !Number.isInteger(e.block) || e.block < 1)
      problems.push('block')
    if (typeof e.summary !== 'string' || e.summary.length < 3) problems.push('summary')
    if (typeof e.proves !== 'string' || e.proves.length < 3) problems.push('proves')
    if (problems.length) errors.push(`Entry ${i + 1}: invalid ${problems.join(', ')}`)
    else entries.push(e as EvidenceEntry)
  })
  return { entries, errors }
}

export const evidence = parseEvidence(raw)

export interface TxVerification {
  state: 'verified' | 'failed' | 'mismatch' | 'not-found' | 'error'
  status?: string
  block?: number
  method?: string | null
  from?: string
  to?: string | null
  value?: string
  timestamp?: string
  events: string[]
  detail?: string
}

interface BlockscoutTx {
  status?: string | null
  result?: string
  block_number?: number | null
  method?: string | null
  value?: string
  timestamp?: string
  from?: { hash?: string }
  to?: { hash?: string } | null
  decoded_input?: { method_call?: string } | null
}

interface BlockscoutLogs {
  items?: { decoded?: { method_call?: string } | null }[]
}

/**
 * Re-verifies a transaction from Blockscout's v2 API (CORS *): it must exist, have succeeded, and sit in the
 * recorded block. Decoded log names (e.g. SupplyCollateral, Borrow) are returned for display.
 */
export async function verifyTx(
  entry: EvidenceEntry,
  signal?: AbortSignal,
): Promise<TxVerification> {
  const base = blockscoutApi(entry.chainId)
  try {
    const res = await fetch(`${base}/transactions/${entry.tx}`, { signal })
    if (res.status === 404)
      return { state: 'not-found', events: [], detail: 'Blockscout has no such transaction.' }
    if (!res.ok) return { state: 'error', events: [], detail: `Blockscout answered ${res.status}.` }
    const tx = (await res.json()) as BlockscoutTx

    let events: string[] = []
    try {
      const logsRes = await fetch(`${base}/transactions/${entry.tx}/logs`, { signal })
      if (logsRes.ok) {
        const logs = (await logsRes.json()) as BlockscoutLogs
        events = (logs.items ?? [])
          .map((l) => l.decoded?.method_call?.split('(')[0])
          .filter((n): n is string => !!n)
      }
    } catch {
      // Logs are a nice-to-have; the transaction check above is what verifies.
    }

    const base_ = {
      status: tx.result ?? tx.status ?? undefined,
      block: tx.block_number ?? undefined,
      method: tx.method ?? tx.decoded_input?.method_call?.split('(')[0] ?? null,
      from: tx.from?.hash,
      to: tx.to?.hash ?? null,
      value: tx.value,
      timestamp: tx.timestamp,
      events,
    }
    if (tx.status !== 'ok') {
      return {
        ...base_,
        state: 'failed',
        detail: `Transaction status: ${tx.result ?? tx.status ?? 'pending'}.`,
      }
    }
    if (tx.block_number !== entry.block) {
      return {
        ...base_,
        state: 'mismatch',
        detail: `Recorded block ${entry.block}, Blockscout says ${tx.block_number ?? 'pending'}.`,
      }
    }
    return { ...base_, state: 'verified' }
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw e
    return { state: 'error', events: [], detail: 'Could not reach Blockscout.' }
  }
}

export interface AddressInfo {
  isContract: boolean
  isVerified: boolean
  name?: string | null
}

export async function fetchAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
  const res = await fetch(`${blockscoutApi(chainId)}/addresses/${address}`)
  if (!res.ok) throw new Error(`Blockscout ${res.status}`)
  const a = (await res.json()) as {
    is_contract?: boolean
    is_verified?: boolean
    name?: string | null
  }
  return { isContract: !!a.is_contract, isVerified: !!a.is_verified, name: a.name }
}
