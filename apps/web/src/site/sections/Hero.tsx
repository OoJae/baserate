import { Link } from '@tanstack/react-router'
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { APP_CHAIN_ID } from '../../queryClient'
import { useHead, useMarketLive, useNear } from '../data/useLive'
import { Label } from '../ui/Label'
import { SerialStrip } from '../ui/SerialStrip'
import { probeStage, STAGE_POSTER, type StageMode, useStage } from '../webgl/useStage'

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** The brand coin, should the engraved poster (STAGE_POSTER, written by the brand scripts) be missing. */
const POSTER_FALLBACK = '/brand/coin.svg'

/** The coin at rest: the WebGL coin's static engraving, square, sized to the coin's anchor. */
function Poster() {
  const [src, setSrc] = useState<string>(STAGE_POSTER.src)
  return (
    <img
      src={src}
      alt={STAGE_POSTER.alt}
      width={STAGE_POSTER.width}
      height={STAGE_POSTER.height}
      decoding="async"
      data-motion-safe
      className="fade-in size-full select-none"
      onError={() => setSrc((s) => (s === POSTER_FALLBACK ? s : POSTER_FALLBACK))}
    />
  )
}

/**
 * Below 64rem the coin sits under the copy, its top a little below the serial strip and the rest running off the
 * frame, where the scroll scene brings it into view. The copy's height depends on the fonts and the width, so it is
 * measured (before paint, so the poster never lands in one place and moves) and published as --copy-end.
 */
function usePublishCopyEnd(
  frame: RefObject<HTMLDivElement | null>,
  end: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const f = frame.current
    const e = end.current
    if (!f || !e) return
    const publish = () => {
      const bottom = e.getBoundingClientRect().bottom - f.getBoundingClientRect().top
      f.style.setProperty('--copy-end', `${Math.round(bottom)}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(f)
    ro.observe(e)
    return () => ro.disconnect()
  }, [frame, end])
}

/**
 * The hero: one choreographed load (the headline rises line by line while the burin engraves the coin) and the
 * page's one scroll scene (the coin unwinds into the base-rate line). The section is taller than the screen by
 * --hero-scroll and its frame is CSS-sticky, so nothing in the DOM moves while the scene plays: motion.ts fades the
 * copy and hands the progress to the WebGL stage, or plays the 2D poster scene where there is no WebGL. The text is
 * in the first commit; the stage loads after the first paint and fades in. Reduced motion: one screen, the poster.
 */
export function Hero({ calm, still, live }: { calm: boolean; still: boolean; live: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const copyEnd = useRef<HTMLDivElement>(null)
  const near = useNear(frame, '0%')
  const head = useHead(live && near)
  const market = useMarketLive(live && near)
  const apr = market.data?.aprPct
  usePublishCopyEnd(frame, copyEnd)

  // The stage starts after the first paint (with the rest of the late work); until this hero has armed it, the coin
  // reads as pending, so a stage that has not begun never flashes its initial poster state.
  const { mode } = useStage(slot, {
    enabled: !calm && live,
    still,
    microtext: {
      chainId: APP_CHAIN_ID,
      block: head.data,
      m1BorrowApr: apr ?? undefined,
      lltv: market.data?.lltvPct,
    },
  })
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (live) setArmed(true)
  }, [live])
  const coin: StageMode = calm ? 'poster' : armed ? mode : 'pending'

  // The scene's length: the WebGL unwind, unless this device cannot draw it (then the shorter 2D poster scene).
  // probeStage() is cached; useStage's effect, declared first, has already run it.
  const [webgl, setWebgl] = useState<boolean | null>(null)
  useEffect(() => {
    if (!calm && live) setWebgl(probeStage().ok)
  }, [calm, live])

  // Keep the poster in the DOM once it has shown, so it can crossfade out under a late canvas.
  const [posterShown, setPosterShown] = useState(coin === 'poster')
  useEffect(() => {
    if (coin === 'poster') setPosterShown(true)
  }, [coin])

  return (
    <section
      data-hero
      data-coin={coin}
      data-scene={webgl === false ? '2d' : 'webgl'}
      aria-labelledby="hero-title"
      className="relative"
    >
      <div
        ref={frame}
        data-hero-frame
        className="sticky top-0 h-svh [--coin-d:min(100vw,50svh)] [--coin-x:50%] [--coin-y:calc(var(--copy-end,30rem)+1.25rem+var(--coin-d)/2)] sm:[--coin-d:min(64vw,50svh)] sm:[--coin-x:62%] lg:[--coin-d:min(44vw,74svh)] lg:[--coin-x:var(--rail-x)] lg:[--coin-y:calc((100svh-var(--site-header-h))/2)]"
      >
        {/* The WebGL stage's slot: the canvas fills it, aria-hidden, and fades in over the poster. */}
        <div ref={slot} data-webgl-slot="hero" aria-hidden className="absolute inset-0" />
        <div data-coin-anchor aria-hidden className="coin-anchor">
          <div data-coin-poster className="size-full">
            <div data-coin-2d className="size-full">
              {posterShown || coin === 'poster' ? <Poster /> : null}
            </div>
          </div>
        </div>
        {/* The 2D scene's line (no WebGL): from where the coin went, down the rail. Drawn by motion.ts. */}
        <span
          aria-hidden
          data-hero-line
          className="ln ln-y top-(--coin-y) bottom-0 left-(--rail-x)"
          style={{ transform: 'scaleY(0)' }}
        />

        <div
          data-hero-copy
          className="relative z-10 flex h-[calc(100svh-var(--site-header-h))] flex-col px-4 pt-5 pb-5 sm:px-6 lg:pt-6 lg:pr-(--gutter) lg:pb-8 lg:pl-(--inset)"
        >
          <div className="max-w-[23.5rem] sm:max-w-xl lg:my-auto lg:max-w-[min(64vw,64rem)]">
            <Label className="text-balance text-muted">
              Credit against bitcoin{'\u00a0'}· no redemption queue
            </Label>
            <h1
              id="hero-title"
              tabIndex={-1}
              className="knockout mt-4 font-display text-hero font-[440] text-ink lg:mt-7"
            >
              <span className="hl">
                <span data-motion-safe style={{ '--i': 0 } as CSSProperties}>
                  Dollars against{' '}
                </span>
              </span>
              <span className="hl">
                <span data-motion-safe style={{ '--i': 1 } as CSSProperties}>
                  your bitcoin.{' '}
                </span>
              </span>
              <span className="hl">
                <span data-motion-safe style={{ '--i': 2 } as CSSProperties}>
                  At the <em className="font-[420] italic">base rate</em>.
                </span>
              </span>
            </h1>
            <p className="mt-5 max-w-[34rem] text-pretty text-lead text-muted lg:mt-8">
              Borrow MUSD against your BTC on Mezo’s own Morpho market, with no redemption queue
              that can close your loan.
            </p>
            <div data-hero-cta className="mt-7 flex flex-wrap gap-3 lg:mt-10">
              <Link
                to="/borrow"
                className="inline-flex h-12 items-center gap-2.5 rounded-[3px] bg-ink px-5 text-[0.9375rem] font-semibold text-canvas transition-colors hover:bg-brand-strong"
              >
                Open the app
                <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/evidence"
                className="inline-flex h-12 items-center rounded-[3px] border border-line-strong px-5 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-raised"
              >
                Check the chain
              </Link>
            </div>
          </div>
          <div ref={copyEnd} className="relative mt-6 lg:mt-8">
            <SerialStrip
              block={head.data}
              btcUsd={market.data?.btcUsd}
              aprPct={apr}
              failed={head.isError || market.isError}
            />
            {/* The band's pattern is a file: it is drawn after the first paint, in a box that is already there. */}
            <div aria-hidden className={`mt-2.5 h-3.5 opacity-70 ${live ? 'band' : ''}`} />
          </div>
        </div>

        {/* Where the scene ends: the line alone on the rail, named. Shown by motion.ts at the end of the scroll. */}
        <p
          aria-hidden
          data-hero-tag
          className="serial invisible absolute bottom-[12%] left-[calc(var(--rail-x)+0.875rem)] text-muted opacity-0"
        >
          The base rate{apr != null ? ` · M1 ${apr.toFixed(2)}% APR` : ''}
        </p>
      </div>
    </section>
  )
}
