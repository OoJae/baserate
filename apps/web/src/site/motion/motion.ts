import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { SPOOL_CROSSFADE } from '../webgl/constants'

/*
 * The landing's motion, loaded after the first paint and never under reduced motion (useMotion.ts decides).
 *
 * - Lenis smooths wheel scrolling on native scroll (touch stays native); ScrollTrigger reads the same scroll, and
 *   both run on GSAP's ticker, the one rAF the WebGL stage also renders in.
 * - One scroll scene: the hero. Its frame is CSS-sticky (no pin, no pin-spacer, no layout shift); its progress fades
 *   the copy out and drives the WebGL stage, or the 2D poster scene when there is no WebGL.
 * - The line: every section's rail is scrubbed with the pen at 60 % of the viewport, and each station's line work
 *   draws as the pen reaches it. Transform and opacity only.
 * Everything is created inside gsap.matchMedia, so reverting it (unmount, or the reader turning on reduced motion)
 * restores every element to its drawn, static state.
 */

export interface MotionHooks {
  /** Hero scene progress, 0 to 1: the WebGL stage's unwind. */
  onHero?: (progress: number) => void
  /** Footer spool progress, 0 to 1: the WebGL stage winding the line into the emblem. */
  onFooter?: (progress: number) => void
}

export interface SiteMotion {
  refresh(): void
  destroy(): void
}

const PEN = 'top 60%'
const PEN_END = 'bottom 60%'

function heroScene(root: HTMLElement, hooks: MotionHooks) {
  const hero = root.querySelector<HTMLElement>('[data-hero]')
  if (!hero) return
  const copy = hero.querySelector('[data-hero-copy]')
  const cta = hero.querySelector('[data-hero-cta]')
  const tag = hero.querySelector('[data-hero-tag]')
  const anchor = hero.querySelector<HTMLElement>('[data-coin-anchor]')
  const poster = hero.querySelector<HTMLElement>('[data-coin-2d]')
  const line = hero.querySelector<HTMLElement>('[data-hero-line]')

  // The copy fades in place over the first third of a screen, whatever the scene's length (the DOM never moves);
  // its buttons leave the tab order once they are invisible.
  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * 0.32)}`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    })
    .to(copy, { opacity: 0 }, 0)
    .to(cta, { autoAlpha: 0 }, 0)

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => hooks.onHero?.(self.progress),
      onRefresh: (self) => hooks.onHero?.(self.progress),
    },
  })
  // The 2D scene, for the poster only (CSS hides it once the WebGL stage draws the coin): the coin turns, shrinks
  // and slides onto the rail, then the line is drawn down from where it went. The anchor itself never moves: the
  // WebGL stage measures it.
  if (poster && anchor && line) {
    tl.fromTo(
      poster,
      { rotate: 0, scale: 1, opacity: 1, x: 0 },
      {
        rotate: 48,
        scale: 0.06,
        opacity: 0,
        x: () => line.offsetLeft - (anchor.offsetLeft + anchor.offsetWidth / 2),
        duration: 0.55,
        ease: 'power2.inOut',
      },
      0.12,
    )
  }
  if (line) tl.fromTo(line, { scaleY: 0 }, { scaleY: 1, duration: 0.45 }, 0.5)
  if (tag) tl.fromTo(tag, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, 0.9)
  tl.set({}, {}, 1)
}

/**
 * The footer: the line winds back into the emblem. Progress runs from the emblem entering the screen to its centre
 * reaching 45 % of it; it drives the WebGL spool, and the crisp SVG mark fades in over the handover range. Without
 * the stage, CSS keeps the SVG mark at full strength and the station timeline draws the HTML line into it.
 */
function footerScene(root: HTMLElement, hooks: MotionHooks) {
  const emblem = root.querySelector<HTMLElement>('[data-emblem]')
  if (!emblem) return
  const mark = emblem.querySelector('[data-mark-live]')
  const [from, to] = SPOOL_CROSSFADE
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: emblem,
      start: 'top bottom',
      end: 'center 45%',
      scrub: true,
      onUpdate: (self) => hooks.onFooter?.(self.progress),
      onRefresh: (self) => hooks.onFooter?.(self.progress),
    },
  })
  if (mark) tl.fromTo(mark, { opacity: 0 }, { opacity: 1, duration: to - from }, from)
  tl.set({}, {}, 1)
}

function rails(root: HTMLElement) {
  for (const rail of root.querySelectorAll<HTMLElement>('[data-rail]')) {
    gsap.fromTo(
      rail,
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: rail, start: PEN, end: PEN_END, scrub: true },
      },
    )
  }
}

/** Station line work draws as the pen (60 % of the viewport) reaches each piece, scrubbed. */
function stations(root: HTMLElement) {
  for (const station of root.querySelectorAll<HTMLElement>('[data-station]')) {
    const box = station.getBoundingClientRect()
    if (box.height <= 0) continue
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: station, start: PEN, end: PEN_END, scrub: true },
    })
    const at = (el: Element) => {
      const r = el.getBoundingClientRect()
      return Math.min(0.98, Math.max(0, (r.top - box.top) / box.height))
    }
    const span = (el: Element) => {
      const r = el.getBoundingClientRect()
      return Math.max(0.02, Math.min(1 - at(el), r.height / box.height))
    }
    for (const el of station.querySelectorAll<HTMLElement>('[data-ln="y"], [data-draw="y"]'))
      tl.fromTo(el, { scaleY: 0 }, { scaleY: 1, duration: span(el) }, at(el))
    for (const el of station.querySelectorAll<HTMLElement>('[data-ln="x"]'))
      tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.06 }, at(el))
    for (const el of station.querySelectorAll<HTMLElement>('[data-draw="fade"]'))
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.06 }, at(el))
    for (const el of station.querySelectorAll<HTMLElement>('[data-draw="mark"]'))
      tl.fromTo(
        el,
        { opacity: 0, scale: 1.04 },
        { opacity: 1, scale: 1, duration: 0.3, ease: 'expo.out' },
        at(el),
      )
    tl.set({}, {}, 1)
  }
}

export function initSiteMotion(root: HTMLElement, hooks: MotionHooks = {}): SiteMotion {
  gsap.registerPlugin(ScrollTrigger)
  ScrollTrigger.config({ ignoreMobileResize: true })

  const lenis = new Lenis({
    lerp: 0.1,
    autoRaf: false,
    syncTouch: false,
    prevent: (node: HTMLElement) => !!node.closest?.('[data-lenis-prevent]'),
  })
  lenis.on('scroll', ScrollTrigger.update)
  const tick = (time: number) => lenis.raf(time * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  const mm = gsap.matchMedia(root)
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    heroScene(root, hooks)
    rails(root)
    stations(root)
    footerScene(root, hooks)
  })

  // Web fonts and late content change heights: re-measure (debounced) when the page's size settles.
  let pending: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => ScrollTrigger.refresh(), 150)
  }
  document.fonts?.ready.then(refresh)
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh)
  ro?.observe(root)

  return {
    refresh,
    destroy() {
      if (pending) clearTimeout(pending)
      ro?.disconnect()
      mm.revert()
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.destroy()
    },
  }
}
