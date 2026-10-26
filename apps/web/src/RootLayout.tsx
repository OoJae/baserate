import { type AnyRouter, Outlet, useRouter } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DURATION_MS, EASE, prefersReducedMotion, readCssColor } from './theme/brand'

/*
 * The root route: every page renders inside it, the landing's site layout and the app's layout alike. It owns what
 * spans both: the zone of the page (site chrome on the Intaglio ground, or the app on paper), page transitions,
 * focus and the screen-reader announcement on client navigation, and the document head. It renders no <main>; each
 * layout has its own.
 */

/** The seven app pages. Every other path (the landing, the site pages, a 404) is the site zone. */
export const APP_PATHS = [
  '/borrow',
  '/save',
  '/lend',
  '/liquidate',
  '/risk',
  '/fees',
  '/evidence',
] as const
export type AppPath = (typeof APP_PATHS)[number]

export type Zone = 'site' | 'app'

/** The zone a path renders in. Only the seven app paths are the app; anything under them is a 404 (site). */
export function zoneOf(pathname: string): Zone {
  return APP_PATHS.some((p) => pathname === p || pathname === `${p}/`) ? 'app' : 'site'
}

/**
 * Typed view transitions (`:active-view-transition-type()`): only then does the router start one. Without them the
 * fallback below runs instead, so an untyped browser never gets a transition the CSS cannot style.
 */
export const VT_TYPES =
  typeof document !== 'undefined' &&
  'startViewTransition' in document &&
  typeof CSS !== 'undefined' &&
  CSS.supports('selector(:active-view-transition-type(a))')

/**
 * The transition type for a navigation (styles in src/styles/motion.css):
 * - `rate-wipe`: app → app. The chrome holds still, the content crossfades and the base-rate line draws.
 * - `layout-swap`: site ↔ app. A plain crossfade.
 * - `site-wipe`: site → site (the landing work styles it).
 * None on the first load, on a same-path change (hash, search) or under reduced motion.
 */
export function navTypes({
  fromLocation,
  toLocation,
  pathChanged,
}: {
  fromLocation?: { pathname: string }
  toLocation: { pathname: string }
  pathChanged: boolean
}): string[] | false {
  if (!fromLocation || !pathChanged || prefersReducedMotion()) return false
  const from = zoneOf(fromLocation.pathname)
  const to = zoneOf(toLocation.pathname)
  if (from !== to) return ['layout-swap']
  return from === 'app' ? ['rate-wipe'] : ['site-wipe']
}

/**
 * Marks the document with the zone of the layout on screen: `data-zone` on <html>, plus `data-ground="intaglio"`
 * for the site, so the page background, overscroll, form controls and every semantic token follow the layout.
 * Each layout calls it; a layout effect, so the change lands in the same commit (and view-transition snapshot).
 */
export function useZone(zone: Zone) {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.zone = zone
    if (zone === 'site') root.dataset.ground = 'intaglio'
    else delete root.dataset.ground
    const ink = readCssColor('--intaglio') || '#0c1512'
    const paper = readCssColor('--note') || '#f2eee3'
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = zone === 'site' || meta.media.includes('dark') ? ink : paper
    }
  }, [zone])
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Document title. App pages leave it out: their PageHeader sets the title. */
    title?: string
    /** Meta description while the route is open; without one, the description the HTML shipped with. */
    description?: string
  }
}

let shippedDescription: string | undefined

function applyHead(router: AnyRouter) {
  const matches = router.state.matches
  const data = [...matches].reverse().find((m) => m.staticData?.title)?.staticData
  if (data?.title) document.title = data.title
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!meta) return
  shippedDescription ??= meta.content
  const description = [...matches].reverse().find((m) => m.staticData?.description)
    ?.staticData.description
  meta.content = description ?? shippedDescription
}

/** The base-rate line, drawn with the Web Animations API when typed view transitions are unavailable. */
function sweepFallback() {
  const line = document.querySelector<HTMLElement>('.rate-sweep')
  line?.animate(
    [
      { transform: 'scaleX(0)', opacity: 1 },
      { transform: 'scaleX(1)', opacity: 1, offset: 0.55 },
      { transform: 'scaleX(1)', opacity: 0 },
    ],
    { duration: DURATION_MS.page, easing: EASE.out },
  )
}

/** The page-enter fallback: the new page rises 8 px into place (class `.page-enter`, src/styles/motion.css). */
function pageEnterFallback(main: HTMLElement | null) {
  if (!main) return
  main.classList.remove('page-enter')
  void main.offsetWidth // restart the animation
  main.classList.add('page-enter')
  main.addEventListener('animationend', () => main.classList.remove('page-enter'), { once: true })
}

export function RootLayout() {
  const router = useRouter()
  const [announcement, setAnnouncement] = useState('')
  const lastAnnouncement = useRef('')

  useEffect(() => {
    const offResolved = router.subscribe('onResolved', ({ fromLocation, pathChanged }) => {
      applyHead(router)
      // Only client navigation: on the first load the browser already reads the new page.
      if (!fromLocation || !pathChanged) return
      const main = document.querySelector<HTMLElement>('main')
      const h1 = main?.querySelector<HTMLElement>('h1') ?? null
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1
        h1.focus({ preventScroll: true })
      }
      const title = h1?.textContent?.trim() || document.title
      // The same text twice in a row is not re-announced; vary it invisibly.
      const next = title === lastAnnouncement.current ? `${title} ` : title
      lastAnnouncement.current = next
      setAnnouncement(next)
      if (!VT_TYPES && !prefersReducedMotion()) pageEnterFallback(main ?? null)
    })
    const offBeforeNavigate = VT_TYPES
      ? undefined
      : router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation, pathChanged }) => {
          if (!fromLocation || !pathChanged || prefersReducedMotion()) return
          if (zoneOf(fromLocation.pathname) === 'app' && zoneOf(toLocation.pathname) === 'app')
            sweepFallback()
        })
    return () => {
      offResolved()
      offBeforeNavigate?.()
    }
  }, [router])

  return (
    <>
      <Outlet />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  )
}
