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

export interface KeeperStatus {
  keeper: Address
  gasBalanceBtc: string | null
  startedAt: string
  lastRun: Partial<Record<KeeperJob, string>>
  accounts: { account: Address; ltvPct: number; liquidatable: boolean }[]
  actions: KeeperAction[]
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
  }
}
