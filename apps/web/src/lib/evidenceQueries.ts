import { queryOptions } from '@tanstack/react-query'
import type { Address } from 'viem'
import { appChain } from '../chain'
import { queryKeys } from '../queryClient'
import { type EvidenceEntry, fetchAddressInfo, verifyTx } from './evidence'
import { fetchKeeperStatus } from './keeper'

/*
 * Query options shared by the Evidence page and the landing's proof section: the same keys, so both read one cache,
 * and the same 3-at-a-time limit on explorer requests (Blockscout and Sourcify rate-limit bursts). Use them as
 * `useQuery(evidenceTxQuery(entry))`. This module pulls in the SDK's ABIs (through lib/evidence), so load it lazily
 * on the site.
 */

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The request was cancelled.', 'AbortError')
}

/**
 * Runs at most `max` tasks at once, in call order. A task whose signal aborts while it waits is dropped without
 * taking a slot.
 */
export function createLimiter(max: number) {
  let active = 0
  const waiting: Array<() => void> = []
  const pump = () => {
    while (active < max) {
      const job = waiting.shift()
      if (!job) return
      job()
    }
  }
  return function limit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        const i = waiting.indexOf(job)
        if (i >= 0) waiting.splice(i, 1)
        reject(abortReason(signal))
      }
      const job = () => {
        signal?.removeEventListener('abort', cancel)
        if (signal?.aborted) {
          reject(abortReason(signal))
          return
        }
        active += 1
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            pump()
          })
      }
      signal?.addEventListener('abort', cancel, { once: true })
      waiting.push(job)
      pump()
    })
  }
}

/** Every explorer request (Blockscout, Sourcify) on the page goes through this: three at a time. */
export const explorerLimit = createLimiter(3)

/** One recorded transaction, re-verified live against Blockscout (exists, succeeded, in the recorded block). */
export function evidenceTxQuery(entry: EvidenceEntry) {
  return queryOptions({
    queryKey: ['evidence', entry.chainId, entry.tx, entry.block] as const,
    queryFn: ({ signal }) => explorerLimit(() => verifyTx(entry, signal), signal),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** Whether an address holds code with verified source (Blockscout, else Sourcify). */
export function addressInfoQuery(address: Address, { enabled = true }: { enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: ['blockscout-address', appChain.id, address] as const,
    queryFn: ({ signal }) => explorerLimit(() => fetchAddressInfo(appChain.id, address), signal),
    enabled,
    staleTime: 10 * 60_000,
    // Blockscout and Sourcify both rate-limit bursts: back off and retry.
    retry: 3,
  })
}

/** The keeper's public status, refreshed every 30 s. Pair it with `keeperHealth()` from lib/keeper. */
export function keeperStatusQuery() {
  return queryOptions({
    queryKey: queryKeys.keeperStatus,
    queryFn: ({ signal }) => fetchKeeperStatus(signal),
    refetchInterval: 30_000,
    retry: 1,
  })
}
