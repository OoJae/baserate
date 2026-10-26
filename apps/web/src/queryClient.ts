import { QueryClient, type QueryKey } from '@tanstack/react-query'
import type { AppChain } from './chain'
import { env } from './env'

/**
 * The one QueryClient, shared by the site and the app, so a value read on the landing (the chain head, the keeper's
 * status) is already cached when the app opens. This module stays light on purpose: it is in the landing's entry
 * chunk, so it imports neither wagmi nor viem.
 */

/**
 * wagmi's query-key hash (`hashFn` from `wagmi/query`), copied so the entry chunk needs no wagmi: sorts plain-object
 * keys and writes bigints as strings. wagmi's own hooks get the same hashes they would get from wagmi's copy.
 */
export function hashFn(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_, value) => {
    if (isPlainObject(value))
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = value[key]
          return result
        }, {})
    if (typeof value === 'bigint') return value.toString()
    return value
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!hasObjectPrototype(value)) return false
  // A modified constructor or prototype means a class instance, not a plain object.
  const ctor = (value as { constructor?: unknown }).constructor
  if (typeof ctor === 'undefined') return true
  const prot = (ctor as { prototype?: unknown }).prototype
  if (!hasObjectPrototype(prot)) return false
  return Object.hasOwn(prot as object, 'isPrototypeOf')
}

function hasObjectPrototype(o: unknown): boolean {
  return Object.prototype.toString.call(o) === '[object Object]'
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: hashFn,
      staleTime: 4_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * The app chain's id without importing the SDK (the literals are checked against `AppChain` at compile time). Use it
 * for query keys in eagerly loaded code; lazy code can use `appChain.id` from `src/chain.ts`.
 */
export const APP_CHAIN_ID: AppChain['id'] = env.localFork ? 31_337 : 31_611

/**
 * Query keys shared by the site and the app. The values are the keys the app already uses, so both read one cache
 * entry: `NetworkGuard.useChainHead` for the head, the Evidence page's keeper card for the keeper.
 */
export const queryKeys = {
  chainHead: ['baserate-head', APP_CHAIN_ID] as const,
  keeperStatus: ['keeper-status', env.keeperUrl] as const,
}
