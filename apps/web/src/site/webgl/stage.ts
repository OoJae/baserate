/**
 * The stage: the landing's WebGL signature. An engraved bitcoin coin, drawn as line work only, that the hero scroll
 * unwinds into the base-rate line, and that the footer winds back into the emblem.
 *
 * README: how the landing uses it
 * ===============================
 *
 * The page never imports this file. It uses `useStage.ts` (entry chunk, no three.js), which probes WebGL, imports
 * this chunk after first paint (three.js and gsap's ticker), and hands back a `Stage`:
 *
 *   const slot = useRef<HTMLDivElement>(null)
 *   const { mode, stage } = useStage(slot, {
 *     enabled: !reducedMotion,                                   // false: never imports WebGL; mode is 'poster'
 *     microtext: { chainId: 31611, block, m1BorrowApr, lltv },   // live values; missing ones are left out
 *   })
 *
 *   <section data-hero …>                          // tall: 100svh + the scroll scene
 *     <div className="sticky top-0 h-svh">          // no overflow: hidden on any ancestor (use overflow-x: clip)
 *       <div ref={slot} aria-hidden className="absolute inset-0" />   // the WebGL slot: the canvas fills it
 *       <div data-coin-anchor …>                    // the coin's box: centre and diameter (min of width, height)
 *         <img src={STAGE_POSTER.src} … />         // the poster, sized to the box: show it while mode is 'poster'
 *       …copy…
 *
 *   mode  'pending'  the first moments: show neither (the hero copy carries the page)
 *         'poster'   show the poster: reduced motion, no WebGL 2, Save-Data, a software renderer, a lost context,
 *                    or WebGL not ready 3 s after first paint
 *         'live'     the canvas is drawing: hide the poster; if it was showing, fade it out over STAGE_FADE_MS
 *                    (600 ms) while the canvas fades in over the same time (a late stage skips the burin intro)
 *
 * Exports of useStage.ts: useStage, useFooterSpool, setHeroProgress, setFooterProgress, probeStage, stillFromUrl,
 * composeMicrotext, STAGE_POSTER, STAGE_FADE_MS, STAGE_READY_TIMEOUT_MS, SPOOL_CROSSFADE, and the types.
 *
 * Scroll (motion.ts): `setHeroProgress(p)` drives the hero scene (0 at rest, 1 when the coin has unwound), e.g. a
 * ScrollTrigger on [data-hero] from 'top top' to 'bottom bottom', scrubbed. It works before the stage exists (a
 * stage starts from the latest value) and costs nothing without one. `stage.setHero(p)` is the same call.
 *
 * What it reads from the DOM (again on resize and when fonts load):
 *   [data-coin-anchor]  the coin's box, relative to the slot. Default: the first one inside the slot's closest
 *                       [data-hero]; or pass `anchor`. If the box leaves part of the coin outside the slot (a phone,
 *                       where the coin waits under the copy), the coin rises to the slot's middle as the scene
 *                       starts and the copy fades, and only then unwinds.
 *   --rail-x            the rail's left edge, as `left: var(--rail-x)` places it in the slot's box (16px, 72%,
 *                       min(72%, 50% + 19.8rem), calc(…); percentages are of the slot's width). The rail is --rail-w
 *                       wide (default 1px) in --rail-ink (any colour that computes to hex, e.g. var(--engrave);
 *                       default Note). Without --rail-x the line drops from the coin's centre.
 *   The exit: where the line leaves the coin, at (rail, coin centre). Published on the slot as --coin-exit-x and
 *   --coin-exit-y (px from the slot's top left, at rest), for a label such as "THE BASE RATE · M1 1.17% APR".
 *
 * The hero scene. The load: the burin cuts the coin in 1.2 s (expo.out): the rim, the outer bands, the rosette (two
 * burins running opposite ways from twelve), the bitcoin sign and the rules rippling out from it, then the
 * microprint, with a fresh cut just behind each burin. The scroll: the engraving is pulled off family by family,
 * outer rings first and the bitcoin last, each family eaten by a hand sweeping from six o'clock; the pulled line hangs
 * from the exit down the rail, so at progress 1 one vertical line at --rail-x remains, running off the foot of the
 * canvas into the page's own rail. The coin turns a little as it unwinds. The light drifts for 20 s after the load
 * and follows a fine pointer; line width follows the light on the coin's relief (line density is light).
 *
 * The footer spool: `useFooterSpool(slotRef, anchorRef)` registers a second slot and the emblem's box; the one
 * canvas moves into whichever slot is on screen (the two are never both visible). `setFooterProgress(p)` winds the
 * line into the emblem: rims, rope, plate, and the rate step last. The stage draws the line's supply itself, down the
 * rail and into the emblem's rim (into its top when the rail crosses it, else turning along its middle into the side
 * facing the rail), so the page's own footer rail may stand down. The spool draws the mark the page shows:
 * `data-mark-detail` on the box if set, else `fine` from 120 px and `medium` below (as LogoMark at 168 and 80 px).
 * Over SPOOL_CROSSFADE (0.86–1) the canvas emblem fades out; fade the crisp SVG mark in over the same range. Without
 * a stage the hook's mode is 'html': show the mark as it is.
 *
 * Engineering notes:
 * - One instanced draw of capsule quads (threadGeometry.ts) plus the microtext ring; MAX blending, no depth buffer;
 *   colours are raw sRGB from the brand tokens (CSS variables, with the token values as fallbacks).
 * - Renders inside gsap.ticker (the same rAF as Lenis and ScrollTrigger), only when something changed, the slot is
 *   on screen and the tab is visible.
 * - Tiering: `high` draws every line at a pixel ratio up to 1.75; `low` draws the core lines up to 1.5. If the p75
 *   frame time passes 20 ms over 90 frames it steps the pixel ratio down, then drops to the core lines.
 * - Shaders compile with compileAsync before the first frame. A lost context shows the poster and comes back on
 *   restore; after two losses the stage stays on the poster.
 * - The canvas is created here, never owned by React; destroy() releases everything (StrictMode-safe).
 */

import { gsap } from 'gsap'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CustomBlending,
  DoubleSide,
  GLSL3,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  MaxEquation,
  Mesh,
  Object3D,
  OneFactor,
  PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { COIN, outerRadial, reliefHeight } from '../../brand/coin'
import type { MarkDetail } from '../../brand/guilloche'
import { SPOOL_CROSSFADE, STAGE_FADE_MS } from './constants'
import { drawMicrotext, layoutMicrotext, type MicrotextLayout } from './microtext'
import { composeMicrotext, MICROTEXT_SEPARATOR, type MicrotextValues } from './microtextLine'
import ringFrag from './ring.frag.glsl?raw'
import ringVert from './ring.vert.glsl?raw'
import threadFrag from './thread.frag.glsl?raw'
import threadVert from './thread.vert.glsl?raw'
import {
  coinThread,
  EMBLEM_WEIGHT,
  emblemRim,
  emblemThread,
  type SpoolEntry,
  STRIDE,
  type ThreadData,
} from './threadGeometry'

export type StageTier = 'high' | 'low'
export type StageStatus = 'live' | 'lost' | 'failed'

export interface StageInit {
  readonly tier: StageTier
  /** The coin's box. Default: the first [data-coin-anchor] inside the slot's closest [data-hero]. */
  readonly anchor?: HTMLElement | null
  /** One still frame: no intro, no light drift, no pointer (for screenshots: ?still=1). */
  readonly still?: boolean
  readonly microtext?: MicrotextValues
  /** The hero progress to start from (useStage passes the latest). */
  readonly hero?: number
  readonly footer?: number
  readonly onStatus?: (status: StageStatus) => void
}

export interface Stage {
  readonly tier: StageTier
  /** Resolves when the first frame can draw without a stall (geometry built, shaders compiled). */
  readonly ready: Promise<void>
  /** Starts drawing: with the burin intro, or (a late stage) a 600 ms fade in over the poster. */
  start(options: { intro: boolean }): void
  /** The hero scroll scene: 0 at rest, 1 when the coin has unwound into the line. */
  setHero(progress: number): void
  /** The footer spool: 0 the line on the rail, 1 wound into the emblem. */
  setFooter(progress: number): void
  /** Live values for the microtext ring; redrawn only when the text changes. */
  setMicrotext(values: MicrotextValues): void
  /** Registers the footer's slot and the emblem's box; returns a function that removes them. */
  attachFooter(slot: HTMLElement, anchor: HTMLElement): () => void
  /** Where the line leaves the coin, in px from the hero slot's top left. */
  readonly exit: { readonly x: number; readonly y: number }
  destroy(): void
}

export function createStage(slot: HTMLElement, init: StageInit): Stage {
  return new StageImpl(slot, init)
}

// -------------------------------------------------------------------------------------------------

const FOV = 26
const DPR_CAP: Record<StageTier, number> = { high: 1.75, low: 1.5 }
const INTRO_S = 1.2
const FRESH = 0.035
const IDLE_S = 20
/** The token values, should the CSS variables be missing. */
const TOKENS = {
  '--note': '#f2eee3',
  '--guilloche': '#7fb8a6',
  '--amber': '#f0a23b',
  '--mint': '#0b6e5f',
} as const
/** How far the coin turns as it unwinds (radians), on --ease-in-out. */
const TURN = { yaw: 0.36, pitch: 0.03 }
/** How quickly a pulled point travels down the rail: it reaches the canvas foot this far into the scene. */
const DROP = 0.12
/**
 * Where the anchor leaves part of the coin outside the slot (a phone's hero, where the coin waits under the copy),
 * the coin rises to the slot's middle over this stretch of the scene, as the copy fades, and the unwind waits for
 * it: the scene's own progress starts at LIFT_LEAD.
 */
const LIFT = [0.14, 0.46] as const
const LIFT_LEAD = 0.3

/** Lets the browser paint and handle input between chunks of work. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function hexToRgb(hex: string, fallback: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim()) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)
  let h = m?.[1] ?? 'ffffff'
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
}

function cssColor(element: Element, name: keyof typeof TOKENS): [number, number, number] {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return hexToRgb(value || TOKENS[name], TOKENS[name])
}

/** power2.inOut, the brand's --ease-in-out. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** The thread material's uniforms (thread.vert.glsl). */
type ThreadUniforms = {
  uViewport: IUniform<Vector2>
  uDpr: IUniform<number>
  uLight: IUniform<Vector3>
  uWidth: IUniform<Vector3>
  uWeight: IUniform<number>
  uEngrave: IUniform<number>
  uFresh: IUniform<number>
  uProgress: IUniform<number>
  uDir: IUniform<number>
  uExit: IUniform<Vector2>
  uConveyor: IUniform<number>
  uRail: IUniform<number>
  uInk: IUniform<Vector3[]>
  uRailInk: IUniform<Vector3>
  uOpacity: IUniform<number>
  uSupplyA: IUniform<Vector2>
  uSupplyB: IUniform<Vector2>
}

/** The microtext ring's uniforms (ring.frag.glsl). */
type RingUniforms = {
  uText: IUniform<CanvasTexture | null>
  uInk: IUniform<Vector3>
  uEngrave: IUniform<number>
  uEngraveWindow: IUniform<Vector2>
  uProgress: IUniform<number>
  uUnwind: IUniform<Vector4>
  uOpacity: IUniform<number>
}

function threadUniforms(): ThreadUniforms {
  return {
    uViewport: { value: new Vector2(1, 1) },
    uDpr: { value: 1 },
    uLight: { value: new Vector3(0, 0, 1) },
    uWidth: { value: new Vector3(COIN.width.min, COIN.width.max, COIN.width.gamma) },
    uWeight: { value: 1 },
    uEngrave: { value: 0 },
    uFresh: { value: FRESH },
    uProgress: { value: 0 },
    uDir: { value: 1 },
    uExit: { value: new Vector2(0, 0) },
    uConveyor: { value: 1000 },
    uRail: { value: 1 },
    uInk: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
    uRailInk: { value: new Vector3() },
    uOpacity: { value: 1 },
    uSupplyA: { value: new Vector2() },
    uSupplyB: { value: new Vector2() },
  }
}

function threadMaterial(uniforms: ThreadUniforms): RawShaderMaterial {
  return new RawShaderMaterial({
    name: 'baserate-thread',
    glslVersion: GLSL3,
    vertexShader: threadVert,
    fragmentShader: threadFrag,
    uniforms,
    // The quads are built in screen space, so their winding is a convention, not a facing: never cull.
    side: DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  })
}

/** The instanced capsule quads over a thread buffer. */
function threadGeometry(thread: ThreadData): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  const buf = new InstancedInterleavedBuffer(thread.data, STRIDE, 1)
  g.setAttribute('aA', new InterleavedBufferAttribute(buf, 3, 0))
  g.setAttribute('aNA', new InterleavedBufferAttribute(buf, 3, 3))
  g.setAttribute('aMA', new InterleavedBufferAttribute(buf, 4, 6))
  g.setAttribute('aB', new InterleavedBufferAttribute(buf, 3, STRIDE))
  g.setAttribute('aNB', new InterleavedBufferAttribute(buf, 3, STRIDE + 3))
  g.setAttribute('aMB', new InterleavedBufferAttribute(buf, 2, STRIDE + 6))
  g.instanceCount = thread.full
  // The quads are expanded in the vertex shader: never cull by the stored points.
  g.boundingSphere = null
  return g
}

/** The microprint band as a mesh: u clockwise from twelve o'clock, v from the outer edge in, on the rim's slope. */
function ringGeometry(): BufferGeometry {
  const { inner, outer } = COIN.microtext
  const steps = 360
  const rows = 4
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const theta = -Math.PI / 2 + 2 * Math.PI * u
    for (let j = 0; j <= rows; j++) {
      const v = j / rows
      const r = outer + (inner - outer) * v
      const x = r * Math.cos(theta)
      const y = r * Math.sin(theta)
      pos.push(x, -y, reliefHeight(x, y) + 0.2)
      uv.push(u, v)
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j
      const b = a + rows + 1
      index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(index)
  return g
}

interface Slot {
  readonly el: HTMLElement
  readonly anchor: HTMLElement | null
  visible: boolean
}

interface Layout {
  /** Canvas size, CSS px. */
  width: number
  height: number
  dpr: number
  /** The coin's (or emblem's) centre and diameter, CSS px, from the slot's top left. */
  cx: number
  cy: number
  size: number
  /** The exit (the hero) or the entry on the emblem's rim (the footer), CSS px. */
  ex: number
  ey: number
  /** The rail's width, CSS px. */
  rail: number
  /** The footer: the mark's detail, which side the line enters from, and the supply's first two points. */
  detail: MarkDetail
  entry: SpoolEntry
  supplyA: [number, number]
  supplyB: [number, number]
}

/**
 * The detail of the mark in the footer's box, so the spool matches the SVG mark it crossfades to: the box's
 * `data-mark-detail` if it has one, else `fine` from 120 CSS px across (the landing shows LogoMark fine at 168 px
 * and medium at 80 px).
 */
function spoolDetail(anchor: HTMLElement | null, size: number): MarkDetail {
  const named = anchor?.dataset.markDetail
  if (named === 'fine' || named === 'medium' || named === 'small') return named
  return size >= 120 ? 'fine' : 'medium'
}

class StageImpl implements Stage {
  readonly tier: StageTier
  readonly ready: Promise<void>
  exit = { x: 0, y: 0 }

  private readonly hero: Slot
  private footer: Slot | undefined
  private active: Slot
  private readonly canvas: HTMLCanvasElement
  private readonly probe: HTMLSpanElement
  private renderer: WebGLRenderer | undefined
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 10000)
  private readonly coin = new Object3D()
  private readonly coinUniforms = threadUniforms()
  private readonly emblemUniforms = threadUniforms()
  private coinMesh: Mesh | undefined
  private emblemMesh: Mesh | undefined
  private ringMesh: Mesh | undefined
  private readonly ringUniforms: RingUniforms
  private thread: ThreadData | undefined
  private text: { canvas: HTMLCanvasElement; texture: CanvasTexture; width: number } | undefined
  private microtext = ''
  private microLayout: MicrotextLayout | undefined
  private fontReady = false

  private layout: Layout = {
    width: 1,
    height: 1,
    dpr: 1,
    cx: 0,
    cy: 0,
    size: 0,
    ex: 0,
    ey: 0,
    rail: 1,
    detail: 'fine',
    entry: 'top',
    supplyA: [0, 0],
    supplyB: [0, 0],
  }
  private emblemKey = ''
  private dprCap: number
  private detail: 'full' | 'core'
  private heroP = 0
  /** The coin's centre y now (CSS px from the slot's top), after any lift. */
  private coinY = 0
  /** The exit's y at rest, device px. */
  private restExitY = 0
  private footerP = 0
  private started = false
  private dead = false
  private lost = false
  private losses = 0
  private failed = false
  private running = false
  private dirty = true
  private layoutDue = true
  private readonly still: boolean
  private readonly onStatus: ((status: StageStatus) => void) | undefined

  // Light: view space, y up.
  private readonly restLight: Vector3
  private readonly light = new Vector3()
  private readonly lightTarget = new Vector3()
  private readonly lightBefore = new Vector3()
  private pointer: { x: number; y: number; fresh: boolean } | undefined
  private readonly finePointer: boolean
  private startedAt = 0
  private lastTick = 0

  // Frame monitor for the runtime downgrade.
  private readonly frames: number[] = []
  private lastRender = 0
  private downgrades = 0

  private readonly observers: { disconnect(): void }[] = []
  private readonly cleanups: (() => void)[] = []
  private intro: gsap.core.Tween | undefined

  constructor(slot: HTMLElement, init: StageInit) {
    this.tier = init.tier
    this.dprCap = DPR_CAP[init.tier]
    this.detail = init.tier === 'high' ? 'full' : 'core'
    this.still = init.still ?? false
    this.onStatus = init.onStatus
    this.heroP = clamp01(init.hero ?? 0)
    this.footerP = clamp01(init.footer ?? 0)
    const anchor =
      init.anchor ??
      slot.closest('[data-hero]')?.querySelector<HTMLElement>('[data-coin-anchor]') ??
      null
    this.hero = { el: slot, anchor, visible: true }
    this.active = this.hero
    this.finePointer =
      typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches && !this.still

    const [lx, ly, lz] = COIN.light
    this.restLight = new Vector3(lx, -ly, lz).normalize()
    this.light.copy(this.restLight)
    this.lightTarget.copy(this.restLight)

    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.dataset.stage = ''
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
      opacity: '0',
    })
    // Resolves --rail-x and --rail-w as lengths (72vw, 16px, calc(…)): the probe's width and height.
    this.probe = document.createElement('span')
    this.probe.setAttribute('aria-hidden', 'true')
    Object.assign(this.probe.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: 'var(--rail-x, -1px)',
      height: 'var(--rail-w, 1px)',
      visibility: 'hidden',
      pointerEvents: 'none',
    })

    this.ringUniforms = {
      uText: { value: null },
      uInk: { value: new Vector3() },
      uEngrave: { value: 0 },
      uEngraveWindow: { value: new Vector2(...COIN.engrave.microtext) },
      uProgress: { value: 0 },
      // The same sweep as the outer family's thread (coin.ts unwindAt), at the band's radius.
      uUnwind: {
        value: new Vector4(
          COIN.unwind.outer[0],
          COIN.unwind.outer[1],
          COIN.unwind.stagger,
          outerRadial((COIN.microtext.inner + COIN.microtext.outer) / 2),
        ),
      },
      uOpacity: { value: 1 },
    }

    this.ready = this.build(init)
  }

  // ---------------------------------------------------------------------------------------------
  // Build

  private async build(init: StageInit): Promise<void> {
    const renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
      preserveDrawingBuffer: false,
    })
    this.renderer = renderer
    renderer.setClearColor(0x000000, 0)
    renderer.autoClear = true

    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)

    this.hero.el.append(this.canvas)
    this.hero.el.append(this.probe)

    this.readInks()
    // The coin's geometry, a family per task: a slow phone never sees one long task.
    this.thread = await coinThread(this.detail, yieldToMain)
    if (this.dead) return
    const coinMesh = new Mesh(threadGeometry(this.thread), threadMaterial(this.coinUniforms))
    coinMesh.frustumCulled = false
    this.coinMesh = coinMesh
    this.coin.add(coinMesh)

    const ringMaterial = new RawShaderMaterial({
      name: 'baserate-microtext',
      glslVersion: GLSL3,
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: this.ringUniforms,
      side: DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendEquationAlpha: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    })
    const ringMesh = new Mesh(ringGeometry(), ringMaterial)
    ringMesh.frustumCulled = false
    ringMesh.visible = false
    this.ringMesh = ringMesh
    this.coin.add(ringMesh)
    this.scene.add(this.coin)

    this.measure()
    this.applyLayout()
    this.setMicrotext(init.microtext ?? {})
    this.watch()
    // A blank text texture until the font arrives keeps the program's shape stable for compileAsync.
    this.ensureTextTexture()
    ringMesh.visible = true
    await renderer.compileAsync(this.scene, this.camera)
    if (this.dead) return
  }

  private readInks() {
    const root = document.documentElement
    const note = cssColor(root, '--note')
    const inks = [
      note,
      cssColor(root, '--guilloche'),
      cssColor(root, '--amber'),
      cssColor(root, '--mint'),
    ]
    const railValue = getComputedStyle(this.hero.el).getPropertyValue('--rail-ink').trim()
    const rail = railValue ? hexToRgb(railValue, TOKENS['--note']) : note
    for (const u of [this.coinUniforms, this.emblemUniforms]) {
      inks.forEach((c, i) => {
        u.uInk.value[i]?.set(c[0], c[1], c[2])
      })
      u.uRailInk.value.set(rail[0], rail[1], rail[2])
    }
    this.ringUniforms.uInk.value.set(note[0], note[1], note[2])
  }

  // ---------------------------------------------------------------------------------------------
  // Public API

  start({ intro }: { intro: boolean }) {
    if (this.dead || this.started) return
    this.started = true
    this.startedAt = performance.now()
    const u = this.coinUniforms
    const done = 1 + FRESH
    // A restored scroll position already inside the scene skips the intro.
    const skip = !intro || this.still || this.heroP > 0.02
    if (skip) {
      u.uEngrave.value = done
      this.ringUniforms.uEngrave.value = done
      this.canvas.style.transition = this.still
        ? ''
        : `opacity ${STAGE_FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
    } else {
      u.uEngrave.value = 0
      this.ringUniforms.uEngrave.value = 0
      const state = { value: 0 }
      this.intro = gsap.to(state, {
        value: done,
        duration: INTRO_S,
        ease: 'expo.out',
        onUpdate: () => {
          u.uEngrave.value = state.value
          this.ringUniforms.uEngrave.value = state.value
          this.dirty = true
        },
      })
    }
    this.dirty = true
    this.updateRunning()
    // Draw the first frame now, then reveal the canvas (the fade is the late stage's crossfade).
    this.tick()
    requestAnimationFrame(() => {
      if (this.dead) return
      this.canvas.style.opacity = '1'
      this.onStatus?.('live')
    })
  }

  setHero(progress: number) {
    const p = clamp01(progress)
    if (p === this.heroP) return
    this.heroP = p
    if (this.active === this.hero) this.dirty = true
  }

  setFooter(progress: number) {
    const p = clamp01(progress)
    if (p === this.footerP) return
    this.footerP = p
    if (this.active === this.footer) this.dirty = true
  }

  setMicrotext(values: MicrotextValues) {
    const text = composeMicrotext(values)
    if (text === this.microtext) return
    this.microtext = text
    this.microLayout = layoutMicrotext(
      text,
      {
        radius: (COIN.microtext.inner + COIN.microtext.outer) / 2,
        band: COIN.microtext.outer - COIN.microtext.inner,
        capHeight: COIN.microtext.capHeight,
      },
      MICROTEXT_SEPARATOR,
    )
    this.drawText()
  }

  attachFooter(slot: HTMLElement, anchor: HTMLElement): () => void {
    if (this.dead) return () => {}
    const footer: Slot = { el: slot, anchor, visible: false }
    this.footer = footer
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.target === slot) footer.visible = e.isIntersecting
      this.pickSlot()
    })
    io.observe(slot)
    const ro = new ResizeObserver(() => {
      if (this.active === footer) this.layoutDue = true
      this.dirty = true
    })
    ro.observe(slot)
    ro.observe(anchor)
    return () => {
      io.disconnect()
      ro.disconnect()
      if (this.footer === footer) {
        this.footer = undefined
        this.pickSlot()
      }
    }
  }

  destroy() {
    if (this.dead) return
    this.dead = true
    this.intro?.kill()
    gsap.ticker.remove(this.tick)
    for (const o of this.observers) o.disconnect()
    for (const c of this.cleanups) c()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    for (const mesh of [this.coinMesh, this.emblemMesh, this.ringMesh]) {
      if (!mesh) continue
      mesh.geometry.dispose()
      ;(mesh.material as RawShaderMaterial).dispose()
    }
    this.text?.texture.dispose()
    const renderer = this.renderer
    if (renderer) {
      renderer.dispose()
      // Free the context now rather than at garbage collection: StrictMode mounts twice.
      renderer.forceContextLoss()
    }
    this.canvas.remove()
    this.probe.remove()
    this.hero.el.style.removeProperty('--coin-exit-x')
    this.hero.el.style.removeProperty('--coin-exit-y')
  }

  // ---------------------------------------------------------------------------------------------
  // Watching the page

  private watch() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.target === this.hero.el) this.hero.visible = e.isIntersecting
      this.pickSlot()
    })
    io.observe(this.hero.el)
    this.observers.push(io)

    const ro = new ResizeObserver(() => {
      this.layoutDue = true
      this.dirty = true
    })
    ro.observe(this.hero.el)
    if (this.hero.anchor) ro.observe(this.hero.anchor)
    this.observers.push(ro)

    const onVisibility = () => this.updateRunning()
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

    const onResize = () => {
      this.layoutDue = true
      this.dirty = true
    }
    window.addEventListener('resize', onResize)
    this.cleanups.push(() => window.removeEventListener('resize', onResize))

    // A new pixel ratio (the window moved to another screen, or the page was zoomed) fires no ResizeObserver.
    let stopDpr = () => {}
    const watchDpr = () => {
      if (typeof window.matchMedia !== 'function') return
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      const onChange = () => {
        stopDpr()
        onResize()
        watchDpr()
      }
      query.addEventListener('change', onChange)
      stopDpr = () => query.removeEventListener('change', onChange)
    }
    watchDpr()
    this.cleanups.push(() => stopDpr())

    document.fonts?.ready.then(() => {
      if (this.dead) return
      this.layoutDue = true
      this.dirty = true
    })

    if (this.finePointer) {
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
        this.pointer = { x: e.clientX, y: e.clientY, fresh: true }
        this.dirty = true
      }
      const onLeave = () => {
        this.pointer = undefined
        this.dirty = true
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
      this.cleanups.push(() => {
        window.removeEventListener('pointermove', onMove)
        document.documentElement.removeEventListener('pointerleave', onLeave)
      })
    }
  }

  /** The canvas lives in whichever slot is on screen: the hero first. */
  private pickSlot() {
    const next = this.hero.visible || !this.footer?.visible ? this.hero : (this.footer ?? this.hero)
    if (next !== this.active) {
      this.active = next
      if (this.canvas.parentElement !== next.el) next.el.append(this.canvas, this.probe)
      this.coin.visible = next === this.hero
      if (this.emblemMesh) this.emblemMesh.visible = next !== this.hero
      this.layoutDue = true
      this.dirty = true
    }
    this.updateRunning()
  }

  private updateRunning() {
    const visible = this.hero.visible || (this.footer?.visible ?? false)
    const run =
      this.started && !this.dead && !this.lost && !this.failed && visible && !document.hidden
    if (run === this.running) return
    this.running = run
    if (run) {
      this.dirty = true
      this.lastRender = 0
      gsap.ticker.add(this.tick)
    } else {
      gsap.ticker.remove(this.tick)
    }
  }

  /** The footer's spool: built for the mark's detail and the side the line enters from, rebuilt if they change. */
  private ensureEmblem(detail: MarkDetail, entry: SpoolEntry) {
    const key = `${detail}|${entry}`
    if (this.emblemMesh && this.emblemKey === key) return
    this.emblemKey = key
    const u = this.emblemUniforms
    u.uDir.value = -1
    u.uEngrave.value = 1 + FRESH
    const geometry = threadGeometry(emblemThread(detail, entry))
    if (this.emblemMesh) {
      this.emblemMesh.geometry.dispose()
      this.emblemMesh.geometry = geometry
      return
    }
    const mesh = new Mesh(geometry, threadMaterial(u))
    mesh.frustumCulled = false
    mesh.visible = this.active !== this.hero
    this.emblemMesh = mesh
    this.scene.add(mesh)
  }

  // ---------------------------------------------------------------------------------------------
  // Layout

  private measure() {
    const slot = this.active
    const rect = slot.el.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap)
    let cx = width / 2
    let cy = height / 2
    let size = Math.min(width, height) * 0.6
    let top = cy - size / 2
    if (slot.anchor) {
      const a = slot.anchor.getBoundingClientRect()
      if (a.width > 0 && a.height > 0) {
        cx = a.left + a.width / 2 - rect.left
        cy = a.top + a.height / 2 - rect.top
        size = Math.min(a.width, a.height)
        top = a.top - rect.top
      }
    }
    // --rail-x is the rail's left edge, as `left: var(--rail-x)` places it in the slot's box (percentages resolve
    // against the slot's width); unset, the line drops from the coin's centre.
    const probe = this.probe.getBoundingClientRect()
    const rail = Math.max(0.5, probe.height || 1)
    const hasRail = getComputedStyle(slot.el).getPropertyValue('--rail-x').trim() !== ''
    const railLeft = hasRail ? probe.width : cx - rail / 2
    const railC = railLeft + rail / 2
    // The hero's line leaves from the coin's centre height, on the rail.
    let ex = railC
    let ey = cy
    // The footer's line runs down the rail into the emblem's rim: into its top when the rail crosses the emblem,
    // else turning along the emblem's middle into the side that faces the rail.
    const detail = spoolDetail(slot.anchor, size)
    let entry: SpoolEntry = 'top'
    let supplyB: [number, number] = [railC, top]
    if (slot !== this.hero) {
      const r = (size / 2) * (emblemRim(detail) / 50)
      const dx = railC - cx
      if (Math.abs(dx) <= r * 0.92) {
        entry = 'top'
        ey = cy - Math.sqrt(Math.max(0, r * r - dx * dx))
        supplyB = [railC, ey]
      } else {
        entry = dx < 0 ? 'left' : 'right'
        ex = cx + (dx < 0 ? -r : r)
        ey = cy
        supplyB = [railC, cy]
      }
    }
    this.layout = {
      width,
      height,
      dpr,
      cx,
      cy,
      size,
      ex,
      ey,
      rail,
      detail,
      entry,
      supplyA: [railC, -4],
      supplyB,
    }
    if (slot === this.hero) {
      this.exit = { x: ex, y: ey }
      this.hero.el.style.setProperty('--coin-exit-x', `${ex.toFixed(2)}px`)
      this.hero.el.style.setProperty('--coin-exit-y', `${ey.toFixed(2)}px`)
    }
  }

  private applyLayout() {
    const renderer = this.renderer
    if (!renderer) return
    const { width, height, dpr, cy, size } = this.layout
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    const cam = this.camera
    cam.aspect = width / height
    // The coin (1000 units) spans `size` px at its own plane.
    const distance =
      ((COIN.radius * 2) / Math.max(size, 1)) * (height / 2 / Math.tan((FOV * Math.PI) / 360))
    cam.position.set(0, 0, distance)
    cam.near = Math.max(1, distance - 1500)
    cam.far = distance + 1500
    cam.lookAt(0, 0, 0)

    const vw = Math.round(width * dpr)
    const vh = Math.round(height * dpr)
    // Snap the rail's left edge to the device grid so the line is as crisp as the DOM rail.
    const railPx = this.layout.rail * dpr
    const exitX = Math.round(this.layout.ex * dpr - railPx / 2) + railPx / 2
    const exitY = this.layout.ey * dpr
    this.restExitY = exitY
    for (const u of [this.coinUniforms, this.emblemUniforms]) {
      u.uViewport.value.set(vw, vh)
      u.uDpr.value = dpr
      u.uExit.value.set(exitX, exitY)
      u.uRail.value = railPx
    }
    // Lens shift: the coin's centre lands on the anchor without turning the coin towards the camera.
    this.coinY = Number.NaN
    this.place(cy)
    if (this.active !== this.hero) {
      // The footer: the supply runs down the rail (snapped like the exit) and turns into the entry.
      const snap = (x: number) => Math.round(x * dpr - railPx / 2) + railPx / 2
      const { supplyA, supplyB, entry } = this.layout
      this.emblemUniforms.uSupplyA.value.set(snap(supplyA[0]), supplyA[1] * dpr)
      this.emblemUniforms.uSupplyB.value.set(snap(supplyB[0]), supplyB[1] * dpr)
      if (entry === 'top') this.emblemUniforms.uExit.value.x = snap(this.layout.ex)
      this.ensureEmblem(this.layout.detail, entry)
    }
    // A pulled point reaches the canvas foot DROP into the scene (and the footer's rail clears the top as fast),
    // measured from where the exit is once any lift is done.
    const settledY = this.active === this.hero && this.lifts() ? (height / 2) * dpr : exitY
    this.coinUniforms.uConveyor.value = Math.max(vh - settledY, vh * 0.25) / DROP
    this.emblemUniforms.uConveyor.value = Math.max(exitY, vh * 0.25) / DROP
    // The emblem's lines scale with it, as the SVG mark's do (its weights are in mark units: EMBLEM_WEIGHT).
    this.emblemUniforms.uWeight.value = (size / 100) * EMBLEM_WEIGHT
    this.ensureTextTexture()
    this.dirty = true
  }

  /**
   * Puts the coin's (or emblem's) centre at `y` (CSS px from the slot's top) by lens shift, and moves the hero's
   * exit with it, so the line always leaves from where the coin is.
   */
  private place(y: number) {
    if (y === this.coinY) return
    this.coinY = y
    const { width, height, cx, cy, dpr } = this.layout
    this.camera.setViewOffset(width, height, width / 2 - cx, height / 2 - y, width, height)
    this.camera.updateProjectionMatrix()
    if (this.active === this.hero) {
      this.coinUniforms.uExit.value.y = this.restExitY + (y - cy) * dpr
    }
  }

  /**
   * The coin's centre y at hero progress p: on its anchor when the whole coin fits in the slot; otherwise it rises to
   * the slot's middle over LIFT (a phone's hero, where the coin waits under the copy until the scene starts).
   */
  private heroCentreY(p: number): number {
    const { cy, height } = this.layout
    if (!this.lifts()) return cy
    const t = easeInOut(clamp01((p - LIFT[0]) / (LIFT[1] - LIFT[0])))
    return cy + (height / 2 - cy) * t
  }

  /** Whether the anchor leaves part of the coin outside the slot, so the scene lifts it into view first. */
  private lifts(): boolean {
    const { cy, size, height } = this.layout
    const margin = height * 0.04
    return cy - size / 2 < margin || cy + size / 2 > height - margin
  }

  // ---------------------------------------------------------------------------------------------
  // Microtext

  /** A texture wide enough for the ring at its size on screen: about one texel per device pixel. */
  private ensureTextTexture() {
    const renderer = this.renderer
    if (!renderer) return
    const { size, dpr } = this.layout
    const mid = (COIN.microtext.inner + COIN.microtext.outer) / 2
    const band = COIN.microtext.outer - COIN.microtext.inner
    const around = 2 * Math.PI * mid * (size / (COIN.radius * 2)) * dpr
    const max = Math.min(8192, renderer.capabilities.maxTextureSize)
    let width = 1024
    while (width < around * 1.15 && width < max) width *= 2
    if (this.text?.width === width) return
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.max(16, Math.ceil((((width * band) / (2 * Math.PI * mid)) * 1.6) / 4) * 4)
    const texture = new CanvasTexture(canvas)
    texture.flipY = false
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    this.text?.texture.dispose()
    this.text = { canvas, texture, width }
    this.ringUniforms.uText.value = texture
    this.drawText()
  }

  private drawText() {
    const text = this.text
    const layout = this.microLayout
    if (!text || !layout) return
    const ring = {
      radius: (COIN.microtext.inner + COIN.microtext.outer) / 2,
      band: COIN.microtext.outer - COIN.microtext.inner,
      capHeight: COIN.microtext.capHeight,
    }
    const paint = () => {
      if (this.dead || this.text !== text) return
      drawMicrotext(text.canvas, layout, ring, '#ffffff')
      text.texture.needsUpdate = true
      this.dirty = true
    }
    if (this.fontReady || !document.fonts) {
      paint()
      return
    }
    // Wait for Plex Mono 500 (at most 2.5 s), then paint; repaint if it arrives later.
    const font = '500 16px "IBM Plex Mono"'
    let painted = false
    const timer = window.setTimeout(() => {
      painted = true
      paint()
    }, 2500)
    document.fonts
      .load(font)
      .then(() => {
        this.fontReady = true
        window.clearTimeout(timer)
        paint()
      })
      .catch(() => {
        window.clearTimeout(timer)
        if (!painted) paint()
      })
  }

  // ---------------------------------------------------------------------------------------------
  // The frame

  private readonly tick = () => {
    if (this.dead || !this.renderer) return
    const now = performance.now()
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 1 / 60
    this.lastTick = now
    if (this.layoutDue) {
      this.layoutDue = false
      this.measure()
      this.applyLayout()
    }
    this.updateLight(now, dt)
    if (!this.dirty) {
      this.lastRender = 0
      return
    }
    this.dirty = false
    this.draw()
    this.monitor(now)
  }

  private updateLight(now: number, dt: number) {
    if (this.still) {
      this.light.copy(this.restLight)
      return
    }
    const target = this.lightTarget
    const { cx, size } = this.layout
    const cy = Number.isNaN(this.coinY) ? this.layout.cy : this.coinY
    if (this.pointer && this.active === this.hero) {
      // The pointer is the lamp: the light comes from its side of the coin. (The slot is measured only when the
      // pointer has moved, never every frame.)
      if (this.pointer.fresh) {
        this.pointer.fresh = false
        const rect = this.active.el.getBoundingClientRect()
        const r = Math.max(size / 2, 1)
        const dx = Math.max(-1.4, Math.min(1.4, (this.pointer.x - rect.left - cx) / r))
        const dy = Math.max(-1.4, Math.min(1.4, (this.pointer.y - rect.top - cy) / r))
        target.set(dx * 0.75, -dy * 0.75, 0.8).normalize()
      }
    } else {
      target.copy(this.restLight)
      const t = (now - this.startedAt) / 1000
      if (this.started && t < IDLE_S) {
        // The idle sweep: the lamp swings slowly round the coin, then settles back to rest.
        const fade = 1 - smoothstep(IDLE_S - 3, IDLE_S, t)
        const swing = 0.55 * Math.sin((2 * Math.PI * t) / 10) * fade
        const c = Math.cos(swing)
        const s = Math.sin(swing)
        target.set(target.x * c - target.y * s, target.x * s + target.y * c, target.z).normalize()
      }
    }
    const k = 1 - Math.exp(-dt / 0.22)
    const before = this.lightBefore.copy(this.light)
    this.light.lerp(target, k).normalize()
    if (before.distanceToSquared(this.light) > 1e-9) this.dirty = true
  }

  private draw() {
    const renderer = this.renderer
    if (!renderer || this.lost) return
    if (this.active === this.hero) {
      this.place(this.heroCentreY(this.heroP))
      // A lifted coin starts to unwind once it is nearly in place.
      const p = this.lifts() ? clamp01((this.heroP - LIFT_LEAD) / (1 - LIFT_LEAD)) : this.heroP
      const e = easeInOut(p)
      this.coin.rotation.set(
        COIN.pose.pitch + (TURN.pitch - COIN.pose.pitch) * e,
        COIN.pose.yaw + (TURN.yaw - COIN.pose.yaw) * e,
        0,
        'YXZ',
      )
      this.coinUniforms.uProgress.value = p
      this.ringUniforms.uProgress.value = p
      this.coinUniforms.uLight.value.copy(this.light)
    } else {
      const p = this.footerP
      this.emblemUniforms.uProgress.value = p
      this.emblemUniforms.uOpacity.value = 1 - smoothstep(SPOOL_CROSSFADE[0], SPOOL_CROSSFADE[1], p)
      this.emblemUniforms.uLight.value.copy(this.restLight)
      if (this.emblemMesh) this.emblemMesh.rotation.set(0, 0, 0)
    }
    renderer.render(this.scene, this.camera)
  }

  /** The runtime downgrade: a slow device steps its pixel ratio down, then drops to the core lines. */
  private monitor(now: number) {
    const last = this.lastRender
    this.lastRender = now
    if (!last || now - last > 60) return
    this.frames.push(now - last)
    if (this.frames.length < 90) return
    const sorted = [...this.frames].sort((a, b) => a - b)
    this.frames.length = 0
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0
    if (p75 <= 20) return
    // First a step down in pixel ratio, then the low tier's core lines, then the pixel ratio again down to 1.
    const stepDpr = () => {
      this.dprCap = Math.max(1, this.dprCap * 0.8)
    }
    if (this.downgrades === 0 && this.dprCap > 1.05) stepDpr()
    else if (this.detail === 'full' && this.thread && this.coinMesh) {
      this.detail = 'core'
      ;(this.coinMesh.geometry as InstancedBufferGeometry).instanceCount = this.thread.core
      // Half the lines on a coin sized for all of them: a little heavier, so the tone holds.
      this.coinUniforms.uWeight.value = 1.15
    } else if (this.dprCap > 1.05) stepDpr()
    else return
    this.downgrades++
    this.layoutDue = true
    this.dirty = true
  }

  // ---------------------------------------------------------------------------------------------
  // Context loss

  private readonly onLost = (event: Event) => {
    event.preventDefault()
    this.losses++
    this.lost = true
    this.updateRunning()
    this.onStatus?.('lost')
  }

  private readonly onRestored = () => {
    if (this.dead) return
    this.lost = false
    if (this.losses >= 2) {
      // Twice is a pattern: stay on the poster.
      this.failed = true
      this.updateRunning()
      this.onStatus?.('failed')
      return
    }
    // three.js re-creates its GL state on restore; buffers, programs and textures upload again on the next frame.
    if (this.text) this.text.texture.needsUpdate = true
    this.layoutDue = true
    this.dirty = true
    this.updateRunning()
    this.onStatus?.('live')
  }
}
