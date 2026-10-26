import { type Address, type Hash, isAddress, isHash } from 'viem'
import { env } from '../env'

export type KeeperJob = 'liquidations' | 'allocator' | 'fees'

export interface KeeperAction {
  t: string
  job: string
  fn: string
  tx: Hash
  status: 'success' | 'reverted'
  block: number
}

/** One keeper job's run state, as `/status` reports it (keeper v2). */
export interface KeeperJobState {
  cadenceS: number
  lastRun: string | null
  lastSuccess: string | null
  failures: number
  note: string | null
}

export interface KeeperStatus {
  keeper: Address
  gasBalanceBtc: string | null
  startedAt: string
  lastRun: Partial<Record<KeeperJob, string>>
  accounts: { account: Address; ltvPct: number; liquidatable: boolean }[]
  actions: KeeperAction[]
  /** Every job by name (keeper v2); absent on older keepers, which report `lastRun` only. */
  jobs?: Record<string, KeeperJobState>
}

/**
 * The keeper's public `/status` (apps/keeper). It is an off-chain service, so rows whose address or tx hash is
 * malformed are dropped rather than linked.
 */
export async function fetchKeeperStatus(signal?: AbortSignal): Promise<KeeperStatus> {
  const res = await fetch(`${env.keeperUrl}/status`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`Keeper returned HTTP ${res.status}`)
  const body = await res.json()
  if (!isAddress(body?.keeper ?? '') || !Array.isArray(body.actions)) {
    throw new Error('Unexpected keeper reply')
  }
  return {
    keeper: body.keeper,
    gasBalanceBtc: typeof body.gasBalanceBtc === 'string' ? body.gasBalanceBtc : null,
    startedAt: String(body.startedAt ?? ''),
    lastRun: body.lastRun ?? {},
    accounts: (Array.isArray(body.accounts) ? body.accounts : []).filter(
      (a: { account?: string }) => isAddress(a?.account ?? ''),
    ),
    actions: body.actions.filter((a: { tx?: string }) => isHash(a?.tx ?? '')),
    jobs: body.jobs && typeof body.jobs === 'object' ? body.jobs : undefined,
  }
}

/** A liquidation scan younger than this means the keeper is running. */
export const KEEPER_RUNNING_MAX_AGE_S = 180

export type KeeperHealthState = 'running' | 'stalled' | 'unreachable' | 'checking'

export interface KeeperHealth {
  state: KeeperHealthState
  /** The word to show: "Running", "Stalled", "Unreachable" or "Checking". */
  label: 'Running' | 'Stalled' | 'Unreachable' | 'Checking'
  /** Seconds since the last liquidation scan, when the keeper reported one. */
  scanAgeS?: number
}

/**
 * The keeper's health from its status, the rule the Evidence page shows: "Running" while the last liquidation scan
 * is under 180 s old, "Stalled" after that, "Unreachable" when the status request failed, "Checking" before the
 * first answer. Pure (no viem), so eagerly loaded code can import it; pass the status query's result.
 */
export function keeperHealth(
  status: KeeperStatus | undefined,
  { isError = false, now = Date.now() }: { isError?: boolean; now?: number } = {},
): KeeperHealth {
  if (isError) return { state: 'unreachable', label: 'Unreachable' }
  if (!status) return { state: 'checking', label: 'Checking' }
  const last = status.lastRun.liquidations
  const scanAgeS = last ? Math.max(0, (now - Date.parse(last)) / 1_000) : undefined
  return scanAgeS !== undefined && scanAgeS < KEEPER_RUNNING_MAX_AGE_S
    ? { state: 'running', label: 'Running', scanAgeS }
    : { state: 'stalled', label: 'Stalled', scanAgeS }
}
