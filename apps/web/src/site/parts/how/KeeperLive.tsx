import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { fetchKeeperStatus, keeperHealth } from '../../../lib/keeper'
import { useNow } from '../../../lib/useNow'
import { queryKeys } from '../../../queryClient'

/*
 * The public keeper's status, live: the same query (key, fetcher, 30 s refresh) the Evidence page and the landing's
 * proof use, so the three share one cache entry. It is fetched only once the line is near the screen, and says
 * plainly when the keeper does not answer.
 */

function useNearScreen<T extends Element>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: '100% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near] as const
}

export function KeeperLive() {
  const [ref, near] = useNearScreen<HTMLDivElement>()
  const q = useQuery({
    queryKey: queryKeys.keeperStatus,
    queryFn: ({ signal }) => fetchKeeperStatus(signal),
    refetchInterval: 30_000,
    retry: 1,
    enabled: near,
  })
  const now = useNow(1_000)
  const health = keeperHealth(q.data, { isError: q.isError, now })
  const positions = q.data?.accounts.length
  const age = health.scanAgeS === undefined ? null : Math.round(health.scanAgeS)
  return (
    <div ref={ref} className="sp-live">
      <span className={`sp-live__mark sp-live__mark--${health.state}`} aria-hidden />
      <p className="sp-serial sp-live__text">
        <span className="sp-live__label">Keeper, live</span>
        <span aria-hidden> · </span>
        <span>{health.label}</span>
        {age !== null ? (
          <>
            <span aria-hidden> · </span>
            <span>
              Last scan <span className="sp-num">{age}</span> s ago
            </span>
          </>
        ) : null}
        {positions !== undefined && health.state !== 'unreachable' ? (
          <>
            <span aria-hidden> · </span>
            <span>
              <span className="sp-num">{positions}</span>{' '}
              {positions === 1 ? 'position' : 'positions'} with debt
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}
