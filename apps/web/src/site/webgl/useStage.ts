/**
 * The landing's WebGL signature, loaded on demand: a capability probe, a lazy loader for stage.ts (three.js), and
 * the small store the hero, the footer and the scroll scene share. This file is in the landing's entry chunk, so it
 * imports no three.js and no gsap; stage.ts's README (the comment at its top) documents the whole API.
 *
 *   const { mode, stage } = useStage(slotRef, { enabled: !reducedMotion, microtext })   // the hero
 *   const { mode } = useFooterSpool(footerSlotRef, emblemRef)                          // the footer
 *   setHeroProgress(p) / setFooterProgress(p)                                           // motion.ts
 *
 * Debug override (also for screenshots): ?stage=off | poster | low | high | force (force skips the software-GL and
 * Save-Data checks), ?still=1 (no intro, no drift: one still frame).
 */

import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { STAGE_READY_TIMEOUT_MS } from './constants'
import { composeMicrotext, type MicrotextValues } from './microtextLine'
import type { Stage, StageStatus, StageTier } from './stage'

export {
  SPOOL_CROSSFADE,
  STAGE_FADE_MS,
  STAGE_POSTER,
  STAGE_READY_TIMEOUT_MS,
} from './constants'
export { composeMicrotext, type MicrotextValues } from './microtextLine'
export type { Stage, StageTier }

// -------------------------------------------------------------------------------------------------
// Capability
// -------------------------------------------------------------------------------------------------

export interface StageCapability {
  readonly ok: boolean
  readonly tier: StageTier
  /** Why not, when not ok: 'server' | 'off' | 'save-data' | 'no-webgl2' | 'software'. */
  readonly reason?: string
}

let capability: StageCapability | undefined

type Override = 'off' | 'poster' | 'low' | 'high' | 'force' | undefined

function override(): Override {
  if (typeof location === 'undefined') return undefined
  const value = new URLSearchParams(location.search).get('stage')
  return value === 'off' ||
    value === 'poster' ||
    value === 'low' ||
    value === 'high' ||
    value === 'force'
    ? value
    : undefined
}

/** True with ?still=1: the stage draws one still frame (no intro, no drift), for screenshots. */
export function stillFromUrl(): boolean {
  return (
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('still') === '1'
  )
}

/**
 * Can this device draw the stage, and at which tier? Cached after the first call. No WebGL 2, a software renderer
 * (SwiftShader, llvmpipe, …), a major-performance-caveat context or Save-Data all mean no.
 */
export function probeStage(): StageCapability {
  capability ??= detect()
  return capability
}

function detect(): StageCapability {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, tier: 'low', reason: 'server' }
  }
  const forced = override()
  if (forced === 'off' || forced === 'poster') return { ok: false, tier: 'low', reason: 'off' }
  const force = forced !== undefined
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean }
    deviceMemory?: number
  }
  if (!force && nav.connection?.saveData) return { ok: false, tier: 'low', reason: 'save-data' }
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = document.createElement('canvas').getContext('webgl2', {
      failIfMajorPerformanceCaveat: !force,
      antialias: false,
      depth: false,
      stencil: false,
    })
  } catch {
    gl = null
  }
  if (!gl) return { ok: false, tier: 'low', reason: 'no-webgl2' }
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  if (!force && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) {
    return { ok: false, tier: 'low', reason: 'software' }
  }
  if (forced === 'low' || forced === 'high') return { ok: true, tier: forced }
  const cores = nav.hardwareConcurrency || 4
  const memory = nav.deviceMemory ?? 8
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? false
  const tier: StageTier =
    cores >= 6 && memory >= 4 && fine && window.innerWidth >= 900 ? 'high' : 'low'
  return { ok: true, tier }
}

// -------------------------------------------------------------------------------------------------
// The shared store: the live stage, and the latest scroll progress for a stage that starts later
// -------------------------------------------------------------------------------------------------

let current: Stage | null = null
let heroProgress = 0
let footerProgress = 0
const listeners = new Set<() => void>()

function publish(stage: Stage | null) {
  current = stage
  // Development only (removed from production builds): the live stage, for inspecting it from the console or a test.
  if (import.meta.env.DEV) (window as Window & { __stage?: Stage | null }).__stage = stage
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getCurrent = () => current
const getNone = () => null

/** The hero scroll scene's progress (0 at rest, 1 unwound). Safe to call before the stage exists, or without one. */
export function setHeroProgress(progress: number): void {
  heroProgress = progress
  current?.setHero(progress)
}

/** The footer spool's progress (0 on the rail, 1 wound into the emblem). Safe to call at any time. */
export function setFooterProgress(progress: number): void {
  footerProgress = progress
  current?.setFooter(progress)
}

// -------------------------------------------------------------------------------------------------
// Hooks
// -------------------------------------------------------------------------------------------------

/** What the hero shows: nothing yet, the poster, or the live canvas. */
export type StageMode = 'pending' | 'poster' | 'live'

export interface UseStageOptions {
  /** False under reduced motion: WebGL is never imported and the mode is 'poster'. Default true. */
  readonly enabled?: boolean
  /** Live values for the coin's microtext ring; missing ones are left out. */
  readonly microtext?: MicrotextValues
  /** The coin's box. Default: the first [data-coin-anchor] inside the slot's closest [data-hero]. */
  readonly anchor?: RefObject<HTMLElement | null>
  /** One still frame, no intro or drift. Default: ?still=1. */
  readonly still?: boolean
}

export interface StageState {
  readonly mode: StageMode
  /** The live stage, for stage.setHero(p); null until it is drawing. */
  readonly stage: Stage | null
  readonly tier: StageTier | null
}

const POSTER: StageState = { mode: 'poster', stage: null, tier: null }
const PENDING: StageState = { mode: 'pending', stage: null, tier: null }

/**
 * Mounts the stage into `slot` (an empty, aria-hidden, absolutely positioned box the canvas fills) after first
 * paint, and keeps it until unmount. StrictMode-safe: a stage created by an effect that has since been cleaned up
 * is destroyed, never shown.
 */
export function useStage(
  slot: RefObject<HTMLElement | null>,
  options: UseStageOptions = {},
): StageState {
  const { enabled = true, microtext, anchor } = options
  const still = options.still ?? stillFromUrl()
  const [state, setState] = useState<StageState>(enabled ? PENDING : POSTER)
  const values = useRef(microtext)
  values.current = microtext
  const text = composeMicrotext(microtext)

  useEffect(() => {
    const el = slot.current
    if (!enabled || !el) {
      setState(POSTER)
      return
    }
    const cap = probeStage()
    if (!cap.ok) {
      setState(POSTER)
      return
    }
    let dead = false
    let late = false
    let live = false
    let stage: Stage | undefined
    setState(PENDING)

    const onStatus = (status: StageStatus) => {
      if (dead || !stage) return
      if (status === 'live') {
        if (live) setState({ mode: 'live', stage, tier: cap.tier })
      } else {
        setState({ mode: 'poster', stage: null, tier: cap.tier })
        if (status === 'failed' && current === stage) publish(null)
      }
    }

    const timer = window.setTimeout(() => {
      if (dead || live) return
      late = true
      setState(POSTER)
    }, STAGE_READY_TIMEOUT_MS)

    const load = async () => {
      if (dead) return
      try {
        const { createStage } = await import('./stage')
        if (dead) return
        stage = createStage(el, {
          tier: cap.tier,
          anchor: anchor?.current ?? null,
          still,
          microtext: values.current ?? {},
          hero: heroProgress,
          footer: footerProgress,
          onStatus,
        })
        await stage.ready
        if (dead) return
        window.clearTimeout(timer)
        live = true
        publish(stage)
        stage.start({ intro: !late })
        setState({ mode: 'live', stage, tier: cap.tier })
      } catch {
        if (dead) return
        window.clearTimeout(timer)
        stage?.destroy()
        stage = undefined
        setState(POSTER)
      }
    }
    // After the first frame, so neither the import nor the build competes with first paint.
    let idle = 0
    const raf = requestAnimationFrame(() => {
      idle = window.setTimeout(load, 0)
    })

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      window.clearTimeout(idle)
      window.clearTimeout(timer)
      if (stage && current === stage) publish(null)
      stage?.destroy()
      stage = undefined
    }
  }, [enabled, slot, anchor, still])

  // Redraw the microprint only when its text changes.
  useEffect(() => {
    if (state.stage && text) state.stage.setMicrotext(values.current ?? {})
  }, [text, state.stage])

  return state
}

/** What the footer shows: the HTML mark as it is, or the canvas winding the line into it. */
export type SpoolMode = 'html' | 'live'

/**
 * Registers the footer's slot (an empty, aria-hidden, absolutely positioned box) and the emblem's box with the live
 * stage. While the mode is 'live', the canvas draws the line winding into the emblem as setFooterProgress runs from
 * 0 to 1; fade your SVG mark in over SPOOL_CROSSFADE. In 'html' mode (no stage) show the mark as it is.
 */
export function useFooterSpool(
  slot: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
): { readonly mode: SpoolMode } {
  const stage = useSyncExternalStore(subscribe, getCurrent, getNone)
  const [attached, setAttached] = useState<Stage | null>(null)
  useEffect(() => {
    const s = slot.current
    const a = anchor.current
    if (!stage || !s || !a) {
      setAttached(null)
      return
    }
    const detach = stage.attachFooter(s, a)
    setAttached(stage)
    return () => {
      detach()
      setAttached(null)
    }
  }, [stage, slot, anchor])
  return { mode: attached && attached === stage ? 'live' : 'html' }
}
