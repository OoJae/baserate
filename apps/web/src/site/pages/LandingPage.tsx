import '../ui/site.css'

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../theme/brand'
import { useAfterPaint } from '../data/useLive'
import { useMotion } from '../motion/useMotion'
import { Hero } from '../sections/Hero'
import { setFooterProgress, setHeroProgress } from '../webgl/useStage'

/**
 * The sections below the hero load as their own chunk, so the app (which shares this entry) never downloads them.
 * The landing asks for it right after its first paint, so it never competes with that paint; once it has loaded
 * (coming back to the landing), it renders in the first commit, so scroll restoration finds the whole page.
 */
let belowLoaded = false
const Below = lazy(() =>
  import('../sections/Below').then((m) => {
    belowLoaded = true
    return m
  }),
)

/** `?still=1`: every scene at rest and no intro, for screenshots (live values carry `data-live` to mask). */
function readStill(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has('still')
  } catch {
    return false
  }
}

/**
 * Until the first paint is on screen, the page's mono serials and italics use system faces (site.css, under
 * `html[data-fonts="early"]`), so only the two preloaded faces load before that paint; the brand faces swap in right
 * after it. Set during the first render, before anything measures layout, and cleared after the paint.
 */
function useEarlyFonts(afterPaint: boolean) {
  useState(() => {
    if (typeof document === 'undefined') return
    // Coming back to the landing, the faces are already loaded: nothing to hold back.
    const loaded =
      document.fonts?.check('500 12px "IBM Plex Mono"') &&
      document.fonts.check('italic 400 48px "Bodoni Moda Variable"')
    if (!loaded) document.documentElement.dataset.fonts = 'early'
  })
  useEffect(() => {
    if (afterPaint) delete document.documentElement.dataset.fonts
  }, [afterPaint])
  useEffect(
    () => () => {
      delete document.documentElement.dataset.fonts
    },
    [],
  )
}

/**
 * The landing at `/`: a banknote you scroll through. The hero's text is in the first commit and paints before
 * anything else loads; after that first frame the live reads, the motion chunk and the coin start, none of them on
 * the LCP path. Motion waits for the sections below the hero too, so every rail and station exists when the scroll
 * scene is built. Reduced motion (or `?still=1`) gets the same page at rest: no Lenis, no scroll scene, the static
 * engraved coin, every line drawn.
 */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [still] = useState(readStill)
  const calm = reduced || still
  const afterPaint = useAfterPaint()
  useEarlyFonts(afterPaint)
  const [below, setBelow] = useState(false)
  const onBelow = useCallback(() => setBelow(true), [])
  useMotion(root, afterPaint && below && !calm, {
    onHero: setHeroProgress,
    onFooter: setFooterProgress,
  })

  return (
    <div ref={root} className="landing" data-still={still ? '' : undefined}>
      <Hero calm={calm} still={still} live={afterPaint} />
      {afterPaint || belowLoaded ? (
        <Suspense fallback={null}>
          <Below live={afterPaint} onReady={onBelow} />
        </Suspense>
      ) : null}
    </div>
  )
}
