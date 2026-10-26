import { type RefObject, useEffect, useRef } from 'react'
import type { MotionHooks, SiteMotion } from './motion'

/**
 * Loads and starts the landing's motion (./motion: Lenis, ScrollTrigger and the scenes) once `enabled`, and tears it
 * down when it turns false or the page unmounts. StrictMode-safe: a cleanup that runs before the chunk arrives marks
 * the effect dead, so the late import never starts a second Lenis. Callers pass enabled = after first paint and not
 * reduced motion, so the chunk is off the LCP path and never loaded for readers who asked for less motion.
 */
export function useMotion(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  hooks: MotionHooks,
): RefObject<SiteMotion | null> {
  const latest = useRef(hooks)
  latest.current = hooks
  const ctl = useRef<SiteMotion | null>(null)

  useEffect(() => {
    const el = root.current
    if (!enabled || !el) return
    let dead = false
    import('./motion')
      .then((m) => {
        if (dead) return
        ctl.current = m.initSiteMotion(el, {
          onHero: (p) => latest.current.onHero?.(p),
          onFooter: (p) => latest.current.onFooter?.(p),
        })
      })
      .catch(() => {
        // The page reads complete without motion: every line is drawn and every value is in place.
      })
    return () => {
      dead = true
      ctl.current?.destroy()
      ctl.current = null
    }
  }, [enabled, root])

  return ctl
}
