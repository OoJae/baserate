import { useQuery } from '@tanstack/react-query'
import { type RefObject, useEffect, useState } from 'react'
import { APP_CHAIN_ID, queryKeys } from '../../queryClient'

/*
 * Live values on the landing, without wagmi. Each hook's queryFn imports ./reads (viem, the registry) on first use,
 * so the entry chunk stays free of them. Rules for every query here:
 * - gated: callers pass `enabled` from useNear (within one viewport) and useAfterPaint (never before first paint);
 * - shared keys where the app has one (the chain head), so a value read here is already cached there;
 * - a failed read shows "—" and a link to Evidence; a value is never estimated.
 */

const reads = () => import('./reads')

/**
 * False on the first render; true once the page's first contentful paint has been presented (a paint-timing
 * observer, so the moment is the browser's, not a guess), or two frames and 100 ms after mounting where paint timing
 * is missing. Live reads, the sections below the hero, the motion and WebGL chunks and the hero's late fonts wait for
 * it, so none of them competes with the first paint (the largest one included) for bandwidth or main-thread time.
 * Coming back to the landing, the entry is already there and it resolves at once.
 */
export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    let second = 0
    let observer: PerformanceObserver | undefined
    const go = () => {
      if (done) return
      done = true
      observer?.disconnect()
      timer = setTimeout(() => setReady(true), 0)
    }
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('paint')
    ) {
      observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) go()
      })
      observer.observe({ type: 'paint', buffered: true })
    }
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        fallback = setTimeout(go, observer ? 1_500 : 100)
      })
    })
    return () => {
      done = true
      observer?.disconnect()
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      if (timer) clearTimeout(timer)
      if (fallback) clearTimeout(fallback)
    }
  }, [])
  return ready
}

/** True while `ref` is on screen or within `margin` of it (an IntersectionObserver root margin). */
export function useNear(ref: RefObject<Element | null>, margin = '100%'): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (entry) setNear(entry.isIntersecting)
      },
      { rootMargin: `${margin} 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin])
  return near
}

/** The chain head, every 12 s (the key NetworkGuard.useChainHead uses, with the same bigint value). */
export function useHead(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chainHead,
    queryFn: async () => (await reads()).readHead(),
    enabled,
    refetchInterval: 12_000,
    retry: 1,
  })
}

/** M1's live rate, the borrow ceiling, LLTV and BTC/USD, every 30 s while a consumer is near the viewport. */
export function useMarketLive(enabled: boolean) {
  return useQuery({
    queryKey: ['site-market', APP_CHAIN_ID] as const,
    queryFn: async () => (await reads()).readMarket(),
    enabled,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  })
}

/** vMUSD's split between M1 and wsMUSD, every 30 s near the Lend note and the split station. */
export function useSplit(enabled: boolean) {
  return useQuery({
    queryKey: ['site-vault-split', APP_CHAIN_ID] as const,
    queryFn: async () => (await reads()).readSplit(),
    enabled,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  })
}

/** The notes' serials: the products' contract addresses from the registry. Fixed for a build. */
export function useSerials(enabled: boolean) {
  return useQuery({
    queryKey: ['site-serials', APP_CHAIN_ID] as const,
    queryFn: async () => (await reads()).readSerials(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
}

// Formatting (en-US, so screenshots and the app read the same). The SDK's formatters are not imported here: this
// module is in the entry chunk, and the SDK barrel brings viem with it.

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** 16368412n → "16,368,412". */
export function formatBlock(block: bigint | number): string {
  return grouped.format(typeof block === 'bigint' ? Number(block) : block)
}

/** 80354.2 → "$80,354". */
export function formatUsd0(value: number): string {
  return `$${grouped.format(Math.round(value))}`
}

/** 1.1734 → "1.17%". */
export function formatPct(value: number, dp = 2): string {
  return `${value.toFixed(dp)}%`
}

/** "0x0EF62F97130fe4D1D22DE4ACc4163154F82890b1" → "0x0EF6…90b1". */
export function shortHex(address: string, chars = 4): string {
  return address.length > 2 + chars * 2
    ? `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
    : address
}
