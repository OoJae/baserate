import { useEffect, useState } from 'react'

/** Wall-clock milliseconds, re-rendering every `intervalMs` (ages tick client-side). */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Seconds elapsed since a react-query `dataUpdatedAt` timestamp. */
export function secondsSince(updatedAtMs: number, nowMs: number): number {
  if (!updatedAtMs) return 0
  return Math.max(0, Math.floor((nowMs - updatedAtMs) / 1_000))
}
