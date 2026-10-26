import {
  backstopAbi,
  baserateAllocatorAbi,
  blockscoutApi,
  borrowAccountAbi,
  borrowAccountFactoryAbi,
  btcMusdOracleAbi,
  feeRouterAbi,
  flashLiquidatorAbi,
  morphoAbi,
  musdDispenserAbi,
  riskLensAbi,
  vaultV2Abi,
  wsMusdAbi,
} from '@baserate/sdk'
import { type AbiFunction, toFunctionSelector } from 'viem'
import raw from '../evidence.json'

export const EVIDENCE_AREAS = [
  'core',
  'judge-journey',
  'lend',
  'liquidations',
  'fees',
  'risk',
  'keeper',
  'v1',
] as const
export type EvidenceArea = (typeof EVIDENCE_AREAS)[number]

/** One curated piece of on-chain evidence (schema: src/evidence.schema.json). */
export interface EvidenceEntry {
  chainId: 31611 | 31612
  /** Page section; rows without one are listed under "core". */
  area?: EvidenceArea
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
    if (e.area !== undefined && !EVIDENCE_AREAS.includes(e.area)) problems.push('area')
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
  raw_input?: string | null
}

/** Explorer calls give up after this long, so a hung API ends in a retry or a clear badge, never a forever-skeleton. */
const EXPLORER_TIMEOUT_MS = 12_000

/** A signal that aborts after `ms` (as a TimeoutError) or when `outer` aborts (with its reason). */
function timeoutSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms)
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  if (outer?.aborted) ctrl.abort(outer.reason)
  else outer?.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true })
  return ctrl.signal
}

let knownSelectors: Map<string, string> | undefined

/** 4-byte selector → function name for every Baserate contract and the Morpho calls we make. */
function selectorNames(): Map<string, string> {
  if (knownSelectors) return knownSelectors
  knownSelectors = new Map()
  const abis = [
    borrowAccountFactoryAbi,
    borrowAccountAbi,
    wsMusdAbi,
    musdDispenserAbi,
    btcMusdOracleAbi,
    morphoAbi,
    backstopAbi,
    flashLiquidatorAbi,
    feeRouterAbi,
    riskLensAbi,
    baserateAllocatorAbi,
    vaultV2Abi,
  ]
  for (const abi of abis)
    for (const item of abi)
      if (item.type === 'function')
        knownSelectors.set(toFunctionSelector(item as AbiFunction), item.name)
  return knownSelectors
}

/**
 * The called method's name. Blockscout only decodes calls to contracts it holds source for, so for Baserate
 * contracts (verified on Sourcify) and their clones it returns a bare selector or nothing; resolve those from our
 * own ABIs instead of showing `0xad3bf5ff`.
 */
export function methodName(tx: {
  method?: string | null
  decoded_input?: { method_call?: string } | null
  raw_input?: string | null
}): string | null {
  const named = tx.decoded_input?.method_call?.split('(')[0] || tx.method || null
  if (named && !/^0x[0-9a-fA-F]{8}$/.test(named)) return named
  const selector = (named ?? tx.raw_input?.slice(0, 10) ?? '').toLowerCase()
  return selectorNames().get(selector) ?? named
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
    const res = await fetch(`${base}/transactions/${entry.tx}`, {
      signal: timeoutSignal(EXPLORER_TIMEOUT_MS, signal),
    })
    if (res.status === 404)
      return { state: 'not-found', events: [], detail: 'Blockscout has no such transaction.' }
    if (!res.ok) return { state: 'error', events: [], detail: `Blockscout answered ${res.status}.` }
    const tx = (await res.json()) as BlockscoutTx

    let events: string[] = []
    try {
      const logsRes = await fetch(`${base}/transactions/${entry.tx}/logs`, {
        signal: timeoutSignal(EXPLORER_TIMEOUT_MS, signal),
      })
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
      method: methodName(tx),
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
  /** Which service holds the verified source. Sourcify is checked when Blockscout has none. */
  verifiedBy: 'blockscout' | 'sourcify' | null
  /** Sourcify's verdict: an exact match also reproduces the metadata hash; a (partial) match the bytecode only. */
  sourcifyMatch?: 'exact' | 'partial'
  name?: string | null
}

/**
 * Sourcify's match for an address, or null. Only a 404 means "not verified"; rate limits, 5xx and network failures
 * throw, so a transient Sourcify hiccup is retried and never shown as a false "Unverified".
 */
async function sourcifyMatch(
  chainId: number,
  address: string,
): Promise<'exact' | 'partial' | null> {
  const res = await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}`, {
    signal: timeoutSignal(EXPLORER_TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Sourcify ${res.status}`)
  const s = (await res.json()) as { match?: string | null }
  return s.match === 'exact_match' ? 'exact' : s.match === 'match' ? 'partial' : null
}

export async function fetchAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
  const res = await fetch(`${blockscoutApi(chainId)}/addresses/${address}`, {
    signal: timeoutSignal(EXPLORER_TIMEOUT_MS),
  })
  // Blockscout returns 404 for contracts it has not indexed yet (e.g. ones created inside another constructor).
  if (!res.ok && res.status !== 404) throw new Error(`Blockscout ${res.status}`)
  const a = res.ok
    ? ((await res.json()) as { is_contract?: boolean; is_verified?: boolean; name?: string | null })
    : {}
  if (a.is_verified)
    return { isContract: true, isVerified: true, verifiedBy: 'blockscout', name: a.name }
  const match = await sourcifyMatch(chainId, address)
  return {
    isContract: !!a.is_contract || match !== null,
    isVerified: match !== null,
    verifiedBy: match !== null ? 'sourcify' : null,
    sourcifyMatch: match ?? undefined,
    name: a.name,
  }
}
