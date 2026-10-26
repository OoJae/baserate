/**
 * The coin: Baserate's bitcoin coin as engraved line work. This is the one canonical description of it, shared by the
 * WebGL hero (src/site/webgl), the static poster (public/brand/coin-engraved.svg, written by
 * scripts/brand/render-coin.mjs) and any later Open Graph render, so all of them show the same coin.
 *
 * Pure arithmetic with no imports, like guilloche.ts, so Node, the browser and the film get identical numbers.
 *
 * Units: the coin is 1000 units across, centred on 0, 0. x grows right, y grows DOWN (as in guilloche.ts and SVG),
 * z grows towards the viewer. Angles are radians clockwise on screen from three o'clock.
 *
 * What a stroke carries, per point:
 *   - its position, on the relief (the face is not flat: the rim, the rope band, the rosette and the centre are
 *     raised, so the coin shows parallax when it turns);
 *   - its relief normal, which the engraving law turns into line width: `engravedWidth(dot(normal, light))`. Line
 *     density is light. Nothing else shades the coin: no gradients, no gloss. The normal follows the relief's slope
 *     times each part's `shade` gain, as an engraver models form more boldly than the metal does;
 *   - `order`, the moment the burin cuts it during the load (0–1, ENGRAVE windows);
 *   - `tau`, the moment it leaves the coin when the hero scroll unwinds it into the base-rate line (0–1, UNWIND
 *     windows). Every family is pulled by a hand that sweeps clockwise from six o'clock, outer families first, the
 *     bitcoin last; the last point of all leaves at exactly 1.
 *
 * The families, from the edge in (inks are the brand's: Guilloche and Note on Intaglio, Amber only in the centre):
 *   edge      the reeded edge of the 3D coin and its back rim (Guilloche); seen only where it faces the viewer
 *   reeding   the milled ticks on the face's border (Guilloche)
 *   rim       plain rims (Guilloche)
 *   microtext a ring of live microprint (Note), drawn by the stage from a texture, not as strokes: MICROTEXT
 *   braid     a fine braid (Guilloche)
 *   rope      the rope (Note), shaded as a twisted cord: each strand swells as it passes over and thins under
 *   rosette   the woven rosette, both twists, on a low dome (Guilloche)
 *   centre    the amber boss: concentric rules on a lens, echo lines around the bitcoin sign, and the sign itself
 *             struck in ink (no lines: it is the ground showing through)
 *
 * Detail: every stroke is `core` or `fine`. Small or slow screens draw the core strokes only: fewer lines, the same
 * width law, so they read heavier (BRAND.md: small sizes get fewer, heavier lines, never thinner ones).
 *
 * coinStrokes() returns every stroke at once (the poster script); coinStrokeBatches() yields them a family at a time,
 * so the WebGL stage can pause between batches and never block a slow phone's main thread for long.
 */

const TAU = Math.PI * 2

/** Six o'clock: where the unwind hand starts, pointing down the base-rate line. */
const SIX = Math.PI / 2
/** Twelve o'clock: where the burin starts. */
const TWELVE = -Math.PI / 2

export type CoinInk = 'note' | 'guilloche' | 'amber'
export type CoinFamily = 'edge' | 'reeding' | 'rim' | 'braid' | 'rope' | 'rosette' | 'centre'
export type CoinTier = 'core' | 'fine'
export type CoinDetail = 'core' | 'full'

export interface CoinStroke {
  readonly family: CoinFamily
  readonly ink: CoinInk
  /** Multiplies the width law's result. */
  readonly weight: number
  /** `core` strokes draw at every level of detail; `fine` strokes only at full detail. */
  readonly tier: CoinTier
  /** On the coin's edge (the cylinder), not its face: hidden wherever its normal faces away from the viewer. */
  readonly edge: boolean
  /** x, y, z per point. */
  readonly points: Float32Array
  /** nx, ny, nz per point: the unit relief normal. */
  readonly normals: Float32Array
  /** Engraving time per point, 0–1. */
  readonly order: Float32Array
  /** Unwind time per point, 0–1. */
  readonly tau: Float32Array
}

/** [start, end] of a family's share of a 0–1 timeline. */
export type Window = readonly [start: number, end: number]

/**
 * The coin's preset. Radii and line weights are in coin units; the relief heights are in coin units towards the
 * viewer. Changing a number here changes the WebGL coin, the poster and any later render together.
 */
export const COIN = {
  radius: 500,
  /** Depth of the edge, from the rim's crown back. */
  thickness: 40,
  /** The burin's timeline (the load, 1.2 s expo.out on uEngrave). */
  engrave: {
    rim: [0, 0.1],
    outer: [0.1, 0.45],
    rosette: [0.45, 0.75],
    centre: [0.75, 0.95],
    microtext: [0.9, 1],
  },
  /** The unwind's timeline (the hero's scroll progress). Overlapping windows keep the line continuous. */
  unwind: {
    outer: [0.03, 0.4],
    rosette: [0.26, 0.7],
    centre: [0.56, 1],
    /**
     * Inside a family, outer lines can lead inner ones by this share of the window (a spiral hand). At 0 every pull
     * point of a family lies on one radius, so the taut threads to the exit (the coin's centre) are one clock hand.
     */
    stagger: 0,
  },
  /**
   * The relief: heights towards the viewer, which give the coin parallax as it turns. A coin's relief is shallow,
   * so each part also has a `shade` gain on its slope for the normals the engraving law reads: an engraver models
   * form more boldly than the metal does.
   */
  relief: {
    /** The rim rises from the field between these radii to this height, and rounds off at the very edge. */
    rim: { from: 452, to: 470, height: 13, roundFrom: 493, round: 3, shade: 1 },
    /** The rope sits on a half-round bead. */
    bead: { from: 384, to: 428, height: 9, shade: 1.3 },
    /** The rosette on a low dome with shallow scallops, one per petal. */
    dome: { from: 160, to: 378, height: 11, scallop: 0.14, shade: 4 },
    /** The centre is a lens. */
    lens: { radius: 150, height: 12, shade: 4.5 },
  },
  edge: { count: 300, weight: 1 },
  reeding: { r0: 486.5, r1: 495.5, count: 300, weight: 1.1 },
  /** Plain rims: radius, weight, the window they are cut in. */
  rims: [
    { r: 497, weight: 2.2, engrave: 'rim', unwind: 'outer' },
    { r: 484, weight: 1.5, engrave: 'rim', unwind: 'outer' },
    { r: 456, weight: 1.1, engrave: 'rim', unwind: 'outer' },
    { r: 430, weight: 1.1, engrave: 'outer', unwind: 'outer' },
    { r: 382, weight: 1.2, engrave: 'outer', unwind: 'outer' },
    { r: 157, weight: 1.8, engrave: 'centre', unwind: 'centre' },
  ],
  /**
   * The microprint band, between the rims at 456 and 484. The stage draws the live text there (src/site/webgl/
   * microtext.ts): Plex Mono 500, capitals standing outward, reading clockwise from twelve o'clock.
   */
  microtext: { inner: 459, outer: 481, capHeight: 9.5 },
  braid: { radius: 443, amplitude: 8.5, waves: 60, lines: 6, weight: 0.9 },
  rope: { radius: 406, amplitude: 18.5, waves: 40, lines: 12, weight: 1 },
  /** guilloche.ts rosette(): 30 petals, both twists. `lines` per twist. */
  rosette: { r: 372, petals: 30, lines: 24, inner: 0.45, twist: 0.16, weight: 1 },
  /**
   * The amber boss. Concentric rules on the lens; around the bitcoin sign, echo lines at these distances from it,
   * so the sign stands in a clean amber keyline; the rules stop beyond the last echo.
   */
  centre: {
    r: 146,
    capHeight: 128,
    rules: { first: 9, pitch: 4.4, weight: 1.3 },
    echoes: { levels: [1.7, 3.6, 5.5], weight: 1.5 },
    /** Rules stop this far from the sign. */
    clear: 8.6,
  },
  /** The width law (src/site/webgl/thread.vert.glsl uses the same numbers): CSS px from light, 0–1. */
  width: { min: 0.35, max: 1.4, gamma: 1.5 },
  /** The light at rest, from the upper left and in front (unit; y down). The stage drifts it and follows a pointer. */
  light: [-0.55, -0.62, 0.56] as const,
  /** The pose at rest: a slight turn so the edge shows, as if the coin lay on the note at an angle (radians). */
  pose: { yaw: -0.2, pitch: 0.12 },
} as const

export type EngraveWindow = keyof typeof COIN.engrave
export type UnwindWindow = Exclude<keyof typeof COIN.unwind, 'stagger'>

/** The engraving law: a line's width in CSS px from the light on it (0–1). Line density is light. */
export function engravedWidth(light: number): number {
  const { min, max, gamma } = COIN.width
  const l = Math.min(1, Math.max(0, light))
  return min + (max - min) * l ** gamma
}

// -------------------------------------------------------------------------------------------------
// Relief
// -------------------------------------------------------------------------------------------------

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** sin² across [a, b]: a bump with zero slope at both feet, so normals stay continuous. */
function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0
  const s = Math.sin((Math.PI * (x - a)) / (b - a))
  return s * s
}

/** d/dx of smoothstep(a, b, x). */
function smoothstepSlope(a: number, b: number, x: number): number {
  const t = (x - a) / (b - a)
  return t <= 0 || t >= 1 ? 0 : (6 * t * (1 - t)) / (b - a)
}

/** d/dx of bump(x, a, b). */
function bumpSlope(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0
  return (Math.PI * Math.sin((2 * Math.PI * (x - a)) / (b - a))) / (b - a)
}

/**
 * The relief at x, y: [height, ∂h/∂x, ∂h/∂y, and the shading slope sx, sy (each part's slope times its `shade`
 * gain)]. Written out by hand, so a normal costs no extra samples.
 */
function relief(x: number, y: number): [number, number, number, number, number] {
  const { rim, bead, dome, lens } = COIN.relief
  const r = Math.hypot(x, y)
  const petals = COIN.rosette.petals
  const theta = Math.atan2(y, x)
  const scallop = 1 + dome.scallop * Math.cos(petals * theta)
  const domeBump = bump(r, dome.from, dome.to)
  // Each part's height, radial slope and angular slope.
  const rimH =
    rim.height * smoothstep(rim.from, rim.to, r) -
    rim.round * smoothstep(rim.roundFrom, COIN.radius, r)
  const rimR =
    rim.height * smoothstepSlope(rim.from, rim.to, r) -
    rim.round * smoothstepSlope(rim.roundFrom, COIN.radius, r)
  const beadH = bead.height * bump(r, bead.from, bead.to)
  const beadR = bead.height * bumpSlope(r, bead.from, bead.to)
  const domeH = dome.height * domeBump * scallop
  const domeR = dome.height * bumpSlope(r, dome.from, dome.to) * scallop
  const domeT = dome.height * domeBump * -dome.scallop * petals * Math.sin(petals * theta)
  let lensH = 0
  let lensR = 0
  const k = r / lens.radius
  if (k < 1) {
    const s = Math.sqrt(1 - k * k)
    lensH = lens.height * s * s * s
    lensR = (-3 * lens.height * k * s) / lens.radius
  }
  const h = rimH + beadH + domeH + lensH
  const hr = rimR + beadR + domeR + lensR
  const sr = rim.shade * rimR + bead.shade * beadR + dome.shade * domeR + lens.shade * lensR
  const st = dome.shade * domeT
  if (r < 1e-6) return [h, 0, 0, 0, 0]
  const c = x / r
  const sn = y / r
  return [
    h,
    hr * c - (domeT / r) * sn,
    hr * sn + (domeT / r) * c,
    sr * c - (st / r) * sn,
    sr * sn + (st / r) * c,
  ]
}

/** The face's height at x, y (coin units, towards the viewer). */
export function reliefHeight(x: number, y: number): number {
  return relief(x, y)[0]
}

/** The face's unit normal at x, y, for the engraving law: from the relief's shading slope. */
export function reliefNormal(x: number, y: number): [number, number, number] {
  const [, , , sx, sy] = relief(x, y)
  const len = Math.hypot(sx, sy, 1)
  return [-sx / len, -sy / len, 1 / len]
}

/** The light on a normal from the rest light: what the poster engraves with. */
export function restLight(normal: readonly [number, number, number]): number {
  const [lx, ly, lz] = COIN.light
  const len = Math.hypot(lx, ly, lz)
  return Math.max(0, (normal[0] * lx + normal[1] * ly + normal[2] * lz) / len)
}

// -------------------------------------------------------------------------------------------------
// Timelines
// -------------------------------------------------------------------------------------------------

/** Clockwise share of a turn from twelve o'clock (0–1) for a point at `theta`. */
function fromTwelve(theta: number): number {
  return ((((theta - TWELVE) % TAU) + TAU) % TAU) / TAU
}

/** Clockwise share of a turn from six o'clock (0–1) for a point at `theta`. */
function fromSix(theta: number): number {
  return ((((theta - SIX) % TAU) + TAU) % TAU) / TAU
}

function lerp(w: Window, t: number): number {
  return w[0] + (w[1] - w[0]) * t
}

/** The radii the outer family's stagger runs across (its innermost rim to the edge). */
export const OUTER_SPAN = [382, 500] as const

/** The outer family's radial share for a radius: 0 at its innermost rim, 1 at the edge. */
export function outerRadial(r: number): number {
  return (r - OUTER_SPAN[0]) / (OUTER_SPAN[1] - OUTER_SPAN[0])
}

/**
 * When a point leaves the coin: its family's window, swept clockwise from six o'clock (`sweep`, 0–1), with outer
 * lines (`radial` near 1) a little ahead of inner ones. The microtext ring's shader repeats this formula.
 */
export function unwindAt(window: UnwindWindow, sweep: number, radial: number): number {
  const s = COIN.unwind.stagger
  return lerp(COIN.unwind[window], (1 - s) * sweep + s * (1 - radial))
}

// -------------------------------------------------------------------------------------------------
// Strokes
// -------------------------------------------------------------------------------------------------

interface StrokeMeta {
  family: CoinFamily
  ink: CoinInk
  weight: number
  tier: CoinTier
  edge?: boolean
}

class Builder {
  readonly p: number[] = []
  readonly n: number[] = []
  readonly o: number[] = []
  readonly t: number[] = []

  push(
    x: number,
    y: number,
    z: number,
    normal: readonly [number, number, number],
    order: number,
    tau: number,
  ) {
    this.p.push(x, y, z)
    this.n.push(normal[0], normal[1], normal[2])
    this.o.push(order)
    this.t.push(tau)
  }

  get length(): number {
    return this.o.length
  }

  finish(meta: StrokeMeta): CoinStroke {
    return {
      family: meta.family,
      ink: meta.ink,
      weight: meta.weight,
      tier: meta.tier,
      edge: meta.edge ?? false,
      points: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      order: new Float32Array(this.o),
      tau: new Float32Array(this.t),
    }
  }
}

interface PolarSpec extends StrokeMeta {
  /** Radius at angle theta. */
  radius: (theta: number) => number
  /** Points per full turn. */
  samples: number
  /** Normal at a point (default: the relief's). */
  normal?: (x: number, y: number, theta: number) => readonly [number, number, number]
  /** Engraving time from the clockwise share of a turn from twelve o'clock, 0–1. */
  order: (fromTwelve: number) => number
  /** Unwind time from the clockwise share of a turn from six o'clock, 0–1. */
  tau: (fromSix: number) => number
}

/**
 * A closed curve around the centre, as two open strokes: six o'clock → twelve and twelve → six (clockwise). Both
 * timelines then run one way along each stroke: the unwind starts and ends at six, the burin at twelve, and the
 * shared point at twelve is drawn by both halves, so nothing shows where they meet.
 */
function polar(spec: PolarSpec): CoinStroke[] {
  const half = Math.max(2, Math.ceil(spec.samples / 2))
  const out: CoinStroke[] = []
  for (const part of [0, 1]) {
    const b = new Builder()
    for (let i = 0; i <= half; i++) {
      const s = (part + i / half) / 2 // 0–1 around the turn from six o'clock
      const theta = SIX + TAU * s
      const r = spec.radius(theta)
      const x = r * Math.cos(theta)
      const y = r * Math.sin(theta)
      const normal = spec.normal ? spec.normal(x, y, theta) : reliefNormal(x, y)
      // From twelve: the first half (six → twelve) is the second half of the burin's turn.
      const twelve = part === 0 ? 0.5 + s : s - 0.5
      b.push(x, y, reliefHeight(x, y), normal, spec.order(twelve), spec.tau(s))
    }
    out.push(b.finish(spec))
  }
  return out
}

/**
 * The normal of a strand of a twisted cord: the strand runs round the cord's core, so it faces out of the coin on
 * its pass over (cos φ > 0) and into it on its pass under. φ is the strand's phase across the cord.
 */
function cordNormal(theta: number, phi: number): [number, number, number] {
  const s = Math.sin(phi)
  const c = Math.cos(phi)
  // Mostly the cord's own roundness, a little of the face's tilt so the cord still sits on the coin.
  const nx = s * Math.cos(theta)
  const ny = s * Math.sin(theta)
  const len = Math.hypot(nx, ny, c) || 1
  return [nx / len, ny / len, c / len]
}

function ringStrokes(
  family: 'braid' | 'rope',
  ink: CoinInk,
  spec: {
    radius: number
    amplitude: number
    waves: number
    lines: number
    weight: number
  },
  perWave: number,
  detail: CoinDetail,
  engrave: Window,
  inner: number,
  outer: number,
): CoinStroke[] {
  const out: CoinStroke[] = []
  for (let i = 0; i < spec.lines; i++) {
    const tier: CoinTier = i % 2 === 0 ? 'core' : 'fine'
    if (detail === 'core' && tier === 'fine') continue
    const shift = (TAU * i) / spec.lines
    const phase = (theta: number) => spec.waves * theta + shift
    out.push(
      ...polar({
        family,
        ink,
        weight: spec.weight,
        tier,
        samples: spec.waves * perWave,
        radius: (theta) => spec.radius + spec.amplitude * Math.sin(phase(theta)),
        normal: (_x, _y, theta) => cordNormal(theta, phase(theta)),
        order: (t) => lerp(engrave, t),
        tau: (t) => {
          const r = spec.radius + spec.amplitude * Math.sin(phase(SIX + TAU * t))
          return unwindAt('outer', t, (r - inner) / (outer - inner))
        },
      }),
    )
  }
  return out
}

function rosetteStrokes(
  detail: CoinDetail,
  perPetal: number,
  turns: readonly number[],
): CoinStroke[] {
  const k = COIN.rosette
  const r0 = k.r * k.inner
  const spacing = (k.r - r0) / (k.lines - 1)
  const amp = Math.min(spacing * 2.5, (k.r - r0) / 3)
  const out: CoinStroke[] = []
  const engrave = COIN.engrave.rosette
  for (const turn of turns) {
    for (let i = 0; i < k.lines; i++) {
      const tier: CoinTier = i % 2 === 0 ? 'core' : 'fine'
      if (detail === 'core' && tier === 'fine') continue
      const t = i / (k.lines - 1)
      const base = r0 + amp + (k.r - r0 - 2 * amp) * t
      const a = amp * Math.sin(Math.PI * (0.15 + 0.7 * t))
      const shift = turn * i * k.twist
      out.push(
        ...polar({
          family: 'rosette',
          ink: 'guilloche',
          weight: k.weight,
          tier,
          samples: k.petals * perPetal,
          radius: (theta) => base + a * Math.sin(k.petals * theta + shift),
          // The two twists are cut by two burins running opposite ways from twelve, which meet at six.
          order: (u) => lerp(engrave, turn > 0 ? u : 1 - u),
          tau: (u) => unwindAt('rosette', u, t),
        }),
      )
    }
  }
  return out
}

// -------------------------------------------------------------------------------------------------
// The bitcoin sign
// -------------------------------------------------------------------------------------------------

/**
 * Bodoni Moda's capital B (opsz 11, wght 700; OFL-1.1), the bitcoin sign's letter, in em with y down and the pen at
 * the origin on the baseline. A copy of `bitcoinB` in scripts/brand/data/outlines.json (written by
 * outline-fonts.py); scripts/brand/render-coin.mjs fails if the two drift apart.
 */
export const BITCOIN_B = {
  advance: 0.71,
  bounds: [0.0227, -0.75, 0.663, 0],
  capHeight: 0.75,
  stem: [0.113, 0.2682],
  commands: [
    ['M', 0.0227, 0],
    ['L', 0.0227, -0.0195],
    ['L', 0.353, -0.0195],
    ['Q', 0.3935, -0.0195, 0.4251, -0.0423],
    ['Q', 0.4567, -0.065, 0.4749, -0.1077],
    ['Q', 0.493, -0.1505, 0.493, -0.21],
    ['Q', 0.493, -0.2695, 0.4749, -0.3059],
    ['Q', 0.4567, -0.3422, 0.4251, -0.3588],
    ['Q', 0.3935, -0.3753, 0.353, -0.3753],
    ['L', 0.243, -0.3753],
    ['L', 0.243, -0.388],
    ['L', 0.3833, -0.388],
    ['Q', 0.4612, -0.388, 0.5246, -0.3701],
    ['Q', 0.588, -0.3523, 0.6255, -0.3111],
    ['Q', 0.663, -0.27, 0.663, -0.2],
    ['Q', 0.663, -0.0912, 0.5893, -0.0456],
    ['Q', 0.5155, 0, 0.3833, 0],
    ['Z'],
    ['M', 0.113, -0.009],
    ['L', 0.113, -0.741],
    ['L', 0.2682, -0.741],
    ['L', 0.2682, -0.009],
    ['Z'],
    ['M', 0.243, -0.382],
    ['L', 0.243, -0.395],
    ['L', 0.343, -0.395],
    ['Q', 0.3785, -0.395, 0.4081, -0.41],
    ['Q', 0.4378, -0.425, 0.4555, -0.46],
    ['Q', 0.4733, -0.495, 0.4733, -0.5545],
    ['Q', 0.4733, -0.614, 0.4555, -0.653],
    ['Q', 0.4378, -0.692, 0.4081, -0.7113],
    ['Q', 0.3785, -0.7305, 0.343, -0.7305],
    ['L', 0.0227, -0.7305],
    ['L', 0.0227, -0.75],
    ['L', 0.3633, -0.75],
    ['Q', 0.4878, -0.75, 0.5605, -0.7063],
    ['Q', 0.6332, -0.6625, 0.6332, -0.565],
    ['Q', 0.6332, -0.4715, 0.5644, -0.4268],
    ['Q', 0.4955, -0.382, 0.3633, -0.382],
    ['Z'],
  ] as ReadonlyArray<ReadonlyArray<string | number>>,
} as const

type Poly = [number, number][]

/** An outline's contours as closed polygons, mapped by x' = s·x + ox, y' = s·y + oy (Q curves flattened). */
function outlinePolygons(
  commands: ReadonlyArray<ReadonlyArray<string | number>>,
  s: number,
  ox: number,
  oy: number,
  steps = 10,
): Poly[] {
  const polys: Poly[] = []
  let poly: Poly = []
  let x = 0
  let y = 0
  for (const [op, ...rest] of commands) {
    const v = rest.map(Number)
    if (op === 'M') {
      poly = [[ox + s * (v[0] ?? 0), oy + s * (v[1] ?? 0)]]
      polys.push(poly)
      x = v[0] ?? 0
      y = v[1] ?? 0
    } else if (op === 'L') {
      poly.push([ox + s * (v[0] ?? 0), oy + s * (v[1] ?? 0)])
      x = v[0] ?? 0
      y = v[1] ?? 0
    } else if (op === 'Q') {
      const [cx, cy, ex, ey] = v as [number, number, number, number]
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        const px = u * u * x + 2 * u * t * cx + t * t * ex
        const py = u * u * y + 2 * u * t * cy + t * t * ey
        poly.push([ox + s * px, oy + s * py])
      }
      x = ex
      y = ey
    }
  }
  // Drop a closing point that repeats the first.
  for (const p of polys) {
    const a = p[0]
    const b = p[p.length - 1]
    if (p.length > 1 && a && b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9)
      p.pop()
  }
  return polys
}

/** Where the vertical line x = c runs inside polygons (nonzero winding): sorted [from, to] spans along y. */
function spansY(polys: readonly Poly[], c: number): [number, number][] {
  const hits: { at: number; turn: number }[] = []
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as [number, number]
      const q = poly[(i + 1) % poly.length] as [number, number]
      if ((p[0] <= c && q[0] > c) || (q[0] <= c && p[0] > c)) {
        const t = (c - p[0]) / (q[0] - p[0])
        hits.push({ at: p[1] + t * (q[1] - p[1]), turn: q[0] > p[0] ? 1 : -1 })
      }
    }
  }
  hits.sort((a, b) => a.at - b.at)
  const result: [number, number][] = []
  let winding = 0
  let start = 0
  for (const hit of hits) {
    const before = winding
    winding += hit.turn
    if (before === 0 && winding !== 0) start = hit.at
    else if (before !== 0 && winding === 0) result.push([start, hit.at])
  }
  return result
}

export interface BitcoinSign {
  /** The letter's contours (each a simple polygon; their union is the B). */
  readonly letter: readonly Poly[]
  /** The four bars, as [x0, y0, x1, y1] boxes. */
  readonly bars: readonly (readonly [number, number, number, number])[]
  /** The sign's box: [x0, y0, x1, y1]. */
  readonly box: readonly [number, number, number, number]
}

/**
 * The bitcoin sign at (cx, cy): the B with two bars through its head and foot. Each bar ends inside the hairline it
 * crosses, never in a counter, as in scripts/brand/render-assets.mjs (bitcoinSign).
 */
export function bitcoinSign(cx: number, cy: number, capHeight: number): BitcoinSign {
  const b = BITCOIN_B
  const s = capHeight / b.capHeight
  const [x0, , x1] = b.bounds
  const ox = cx - ((x0 + x1) / 2) * s
  const oy = cy + (b.capHeight / 2) * s
  const top = oy - b.capHeight * s
  const letter = outlinePolygons(b.commands, s, ox, oy, 8)
  const [stemL, stemR] = b.stem
  const stem = stemR - stemL
  const barW = stem * 0.44 * s
  const reach = b.capHeight * 0.15 * s
  const deepest = b.capHeight * 0.05 * s
  const lefts = [stemL + stem * 0.55, stemL + stem * 2.15].map((mid) => ox + mid * s - barW / 2)
  const bars: [number, number, number, number][] = []
  for (const left of lefts) {
    const runs = Array.from({ length: 9 }, (_, i) => spansY(letter, left + (barW * i) / 8))
    const first = (r: [number, number][]) => r[0] ?? [0, 0]
    const last = (r: [number, number][]) => r[r.length - 1] ?? [0, 0]
    const outerTop = Math.max(...runs.map((r) => first(r)[0]))
    const innerTop = Math.min(...runs.map((r) => first(r)[1]))
    const innerFoot = Math.max(...runs.map((r) => last(r)[0]))
    const outerFoot = Math.min(...runs.map((r) => last(r)[1]))
    if (!(outerTop < innerTop && innerFoot < outerFoot)) {
      throw new Error('bitcoin sign: a bar does not land in a hairline')
    }
    const endTop = Math.min((outerTop + innerTop) / 2, outerTop + deepest)
    const endFoot = Math.max((innerFoot + outerFoot) / 2, outerFoot - deepest)
    bars.push([left, top - reach, left + barW, endTop])
    bars.push([left, endFoot, left + barW, oy + reach])
  }
  const xs = [...letter.flat().map((p) => p[0]), ...bars.flatMap((r) => [r[0], r[2]])]
  const ys = [...letter.flat().map((p) => p[1]), ...bars.flatMap((r) => [r[1], r[3]])]
  return {
    letter,
    bars,
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  }
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.min(1, Math.max(0, t))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** Signed distance to a simple polygon: negative inside. */
function polygonDistance(poly: Poly, x: number, y: number): number {
  let d = Number.POSITIVE_INFINITY
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as [number, number]
    const b = poly[j] as [number, number]
    const seg = segmentDistance(x, y, a[0], a[1], b[0], b[1])
    if (seg < d) d = seg
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside ? -d : d
}

function boxDistance(box: readonly [number, number, number, number], x: number, y: number): number {
  const cx = (box[0] + box[2]) / 2
  const cy = (box[1] + box[3]) / 2
  const hx = (box[2] - box[0]) / 2
  const hy = (box[3] - box[1]) / 2
  const qx = Math.abs(x - cx) - hx
  const qy = Math.abs(y - cy) - hy
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
}

/** The sign's signed distance field: negative inside the sign, positive outside it (and in its counters). */
export function signDistance(sign: BitcoinSign, x: number, y: number): number {
  let d = Number.POSITIVE_INFINITY
  for (const bar of sign.bars) d = Math.min(d, boxDistance(bar, x, y))
  for (const poly of sign.letter) d = Math.min(d, polygonDistance(poly, x, y))
  return d
}

/** The sign's distance field sampled on a grid, for clipping rules and tracing echo lines. */
interface Field {
  readonly x0: number
  readonly y0: number
  readonly step: number
  readonly w: number
  readonly h: number
  readonly v: Float32Array
}

/**
 * The sign's distance field on a grid, exact within `cap` of the outline and clamped to ±cap beyond it (all the
 * echo lines and the rules' clearance need). Edges are bucketed so each grid point measures only the edges near it,
 * and inside-ness comes from one scanline per row: a few milliseconds instead of tens.
 */
function* signFieldSteps(
  sign: BitcoinSign,
  margin: number,
  step: number,
  cap: number,
  rowsPerStep = 18,
): Generator<CoinStroke[], Field> {
  const [bx0, by0, bx1, by1] = sign.box
  const x0 = bx0 - margin
  const y0 = by0 - margin
  const w = Math.ceil((bx1 - bx0 + 2 * margin) / step) + 1
  const h = Math.ceil((by1 - by0 + 2 * margin) / step) + 1
  const v = new Float32Array(w * h)
  const polys = sign.letter
  // Edge buckets: cell → [component, ax, ay, bx, by, …].
  const cell = cap / 2
  const cols = Math.ceil((w * step) / cell) + 1
  const rows = Math.ceil((h * step) / cell) + 1
  const buckets: number[][] = Array.from({ length: cols * rows }, () => [])
  polys.forEach((poly, k) => {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j] as [number, number]
      const b = poly[i] as [number, number]
      const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - x0) / cell))
      const c1 = Math.min(cols - 1, Math.floor((Math.max(a[0], b[0]) - x0) / cell))
      const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - y0) / cell))
      const r1 = Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) - y0) / cell))
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) buckets[r * cols + c]?.push(k, a[0], a[1], b[0], b[1])
    }
  })
  const near = new Float64Array(polys.length)
  for (let j = 0; j < h; j++) {
    const y = y0 + j * step
    // Each polygon's crossings of this row, for even–odd inside tests.
    const crossings = polys.map((poly) => {
      const xs: number[] = []
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const a = poly[i] as [number, number]
        const b = poly[k] as [number, number]
        if (a[1] > y !== b[1] > y) xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      }
      return xs.sort((p, q) => p - q)
    })
    const cr = Math.floor((y - y0) / cell)
    for (let i = 0; i < w; i++) {
      const x = x0 + i * step
      near.fill(cap)
      const cc = Math.floor((x - x0) / cell)
      for (let r = Math.max(0, cr - 2); r <= Math.min(rows - 1, cr + 2); r++) {
        for (let c = Math.max(0, cc - 2); c <= Math.min(cols - 1, cc + 2); c++) {
          const list = buckets[r * cols + c] ?? []
          for (let e = 0; e < list.length; e += 5) {
            const k = list[e] as number
            const d = segmentDistance(
              x,
              y,
              list[e + 1] as number,
              list[e + 2] as number,
              list[e + 3] as number,
              list[e + 4] as number,
            )
            if (d < (near[k] as number)) near[k] = d
          }
        }
      }
      let d = cap
      for (const bar of sign.bars) d = Math.min(d, boxDistance(bar, x, y))
      for (let k = 0; k < polys.length; k++) {
        const xs = crossings[k] as number[]
        let left = 0
        while (left < xs.length && (xs[left] as number) < x) left++
        const signed = left % 2 === 1 ? -(near[k] as number) : (near[k] as number)
        if (signed < d) d = signed
      }
      v[j * w + i] = Math.max(-cap, Math.min(cap, d))
    }
    // A pause for the caller every few rows (an empty batch: nothing to draw yet).
    if (j % rowsPerStep === rowsPerStep - 1) yield []
  }
  return { x0, y0, step, w, h, v }
}

/** Bilinear sample of the field; +∞ outside it. */
function sampleField(f: Field, x: number, y: number): number {
  const gx = (x - f.x0) / f.step
  const gy = (y - f.y0) / f.step
  if (gx < 0 || gy < 0 || gx > f.w - 1 || gy > f.h - 1) return Number.POSITIVE_INFINITY
  const i = Math.min(f.w - 2, Math.floor(gx))
  const j = Math.min(f.h - 2, Math.floor(gy))
  const tx = gx - i
  const ty = gy - j
  const a = f.v[j * f.w + i] ?? 0
  const b = f.v[j * f.w + i + 1] ?? 0
  const c = f.v[(j + 1) * f.w + i] ?? 0
  const d = f.v[(j + 1) * f.w + i + 1] ?? 0
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/**
 * The iso-lines of a field at `level` (marching squares), joined into polylines. Closed loops repeat their first
 * point at the end.
 */
function isoLines(f: Field, level: number): [number, number][][] {
  const { w, h, v, x0, y0, step } = f
  const val = (i: number, j: number) => (v[j * w + i] ?? 0) - level
  // Edge ids: horizontal edge (i, j)–(i+1, j) is 2·(j·w + i); vertical edge (i, j)–(i, j+1) is 2·(j·w + i) + 1.
  const point = new Map<number, [number, number]>()
  const at = (id: number): [number, number] => {
    const cached = point.get(id)
    if (cached) return cached
    const cell = id >> 1
    const i = cell % w
    const j = (cell - i) / w
    const a = val(i, j)
    let p: [number, number]
    if (id & 1) {
      const b = val(i, j + 1)
      const t = a / (a - b || 1)
      p = [x0 + i * step, y0 + (j + t) * step]
    } else {
      const b = val(i + 1, j)
      const t = a / (a - b || 1)
      p = [x0 + (i + t) * step, y0 + j * step]
    }
    point.set(id, p)
    return p
  }
  const links = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    const la = links.get(a)
    if (la) la.push(b)
    else links.set(a, [b])
    const lb = links.get(b)
    if (lb) lb.push(a)
    else links.set(b, [a])
  }
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = val(i, j)
      const b = val(i + 1, j)
      const c = val(i + 1, j + 1)
      const d = val(i, j + 1)
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (code === 0 || code === 15) continue
      const top = 2 * (j * w + i)
      const left = top + 1
      const bottom = 2 * ((j + 1) * w + i)
      const right = 2 * (j * w + i + 1) + 1
      switch (code) {
        case 1:
        case 14:
          link(left, top)
          break
        case 2:
        case 13:
          link(top, right)
          break
        case 3:
        case 12:
          link(left, right)
          break
        case 4:
        case 11:
          link(right, bottom)
          break
        case 6:
        case 9:
          link(top, bottom)
          break
        case 7:
        case 8:
          link(left, bottom)
          break
        case 5:
        case 10: {
          // Saddle: the centre decides which corners join.
          const centre = (a + b + c + d) / 4
          if (centre > 0 === (code === 5)) {
            link(left, bottom)
            link(top, right)
          } else {
            link(left, top)
            link(right, bottom)
          }
          break
        }
      }
    }
  }
  const lines: [number, number][][] = []
  const used = new Set<number>()
  const walk = (start: number) => {
    const ids = [start]
    used.add(start)
    let prev = -1
    let cur = start
    for (;;) {
      const next = (links.get(cur) ?? []).find((n) => n !== prev && !used.has(n))
      if (next === undefined) {
        if ((links.get(cur) ?? []).includes(start) && ids.length > 2) ids.push(start)
        break
      }
      used.add(next)
      ids.push(next)
      prev = cur
      cur = next
    }
    return ids
  }
  // Open lines first (from an end), then loops.
  for (const [id, ns] of links) if (ns.length === 1 && !used.has(id)) lines.push(walk(id).map(at))
  for (const id of links.keys()) if (!used.has(id)) lines.push(walk(id).map(at))
  return lines
}

/** The bitcoin sign's distance field, built once: the echo lines trace it and the rules are cut back by it. */
let signFieldCache: Field | undefined

/** The sign's field, from the cache or built in steps (each step yields an empty batch). */
function* centreSign(): Generator<CoinStroke[], Field> {
  if (signFieldCache) return signFieldCache
  const k = COIN.centre
  const field = yield* signFieldSteps(bitcoinSign(0, 0, k.capHeight), k.clear + 6, 1.6, k.clear + 4)
  signFieldCache = field
  return field
}

/** The centre's echo lines: the keyline round the bitcoin sign. */
function centreEchoes(field: Field): CoinStroke[] {
  const k = COIN.centre
  const engrave = COIN.engrave.centre
  const out: CoinStroke[] = []
  const levels = k.echoes.levels

  // Echo lines around the sign: the burin traces each one along its length, the closest first, so the bitcoin sign
  // is drawn before the rules ripple out from it.
  const echoShare = 0.45
  levels.forEach((level, e) => {
    for (const line of isoLines(field, level)) {
      if (line.length < 3) continue
      let total = 0
      const along = [0]
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as [number, number]
        const b = line[i] as [number, number]
        total += Math.hypot(b[0] - a[0], b[1] - a[1])
        along.push(total)
      }
      if (total < 6) continue
      const start = (0.1 * e) / levels.length
      const orderAt = (i: number) =>
        lerp(engrave, start + (echoShare - start) * ((along[i] ?? 0) / total))
      for (const piece of sweepPieces(line)) {
        const b = new Builder()
        for (const [x, y, sweep, i] of piece) {
          b.push(
            x,
            y,
            reliefHeight(x, y),
            reliefNormal(x, y),
            orderAt(i),
            unwindAt('centre', sweep, 0.5),
          )
        }
        if (b.length > 1) {
          out.push(
            b.finish({ family: 'centre', ink: 'amber', weight: k.echoes.weight, tier: 'core' }),
          )
        }
      }
    }
  })

  return out
}

/** The centre's concentric rules, cut back round the sign. */
function centreRules(detail: CoinDetail, field: Field): CoinStroke[] {
  const k = COIN.centre
  const engrave = COIN.engrave.centre
  const echoShare = 0.45
  const out: CoinStroke[] = []
  // Concentric rules on the lens, cut back around the sign. Once the sign's outline is cut, the rules ripple out from
  // the middle to the rim. The innermost rule is the last line to leave the coin (its radial share is 0).
  const rules = Math.floor((k.r - k.rules.first) / k.rules.pitch) + 1
  const span = Math.max(1, (rules - 1) * k.rules.pitch)
  for (let i = 0; i < rules; i++) {
    const tier: CoinTier = i % 2 === 0 ? 'core' : 'fine'
    if (detail === 'core' && tier === 'fine') continue
    const r = k.rules.first + i * k.rules.pitch
    const radial = (r - k.rules.first) / span
    const order = lerp(engrave, echoShare * 0.6 + (1 - echoShare * 0.6) * radial)
    const samples = Math.max(48, Math.ceil(r * 2.4))
    const pointAt = (sweep: number): [number, number, number] => {
      const theta = SIX + TAU * sweep
      const x = r * Math.cos(theta)
      const y = r * Math.sin(theta)
      return [x, y, sampleField(field, x, y)]
    }
    let b: Builder | undefined
    const add = (sweep: number, x: number, y: number) => {
      b ??= new Builder()
      b.push(x, y, reliefHeight(x, y), reliefNormal(x, y), order, unwindAt('centre', sweep, radial))
    }
    const flush = () => {
      if (b && b.length > 1) {
        out.push(b.finish({ family: 'centre', ink: 'amber', weight: k.rules.weight, tier }))
      }
      b = undefined
    }
    let prev: [number, number, number, number] | undefined // sweep, x, y, d
    for (let s = 0; s <= samples; s++) {
      const sweep = s / samples
      const [x, y, d] = pointAt(sweep)
      const clear = d >= k.clear
      if (prev && clear !== prev[3] >= k.clear) {
        // The arc meets the clearance between the two samples: end (or start) it exactly there.
        const t = (prev[3] - k.clear) / (prev[3] - d || 1)
        const cs = prev[0] + (sweep - prev[0]) * t
        const [cx, cy] = pointAt(cs)
        add(cs, cx, cy)
        if (!clear) flush()
      }
      if (clear) add(sweep, x, y)
      prev = [sweep, x, y, d]
    }
    flush()
  }
  return out
}

/**
 * Splits a polyline (around the centre) where it crosses the six o'clock ray, where the unwind sweep wraps from 1 to
 * 0, so each piece unwinds one way. The crossing point ends one piece and starts the next. Each point comes back as
 * [x, y, sweep, index of the source point].
 */
function sweepPieces(line: readonly [number, number][]): [number, number, number, number][][] {
  const pieces: [number, number, number, number][][] = []
  let piece: [number, number, number, number][] = []
  let prev: { x: number; y: number; sweep: number } | undefined
  line.forEach(([x, y], i) => {
    const sweep = fromSix(Math.atan2(y, x))
    if (prev && Math.abs(sweep - prev.sweep) > 0.5) {
      // Where the segment crosses x = 0 (the ray straight down from the centre).
      const t = prev.x / (prev.x - x || 1)
      const cx = prev.x + (x - prev.x) * t
      const cy = prev.y + (y - prev.y) * t
      piece.push([cx, cy, prev.sweep > 0.5 ? 1 : 0, i - 1])
      pieces.push(piece)
      piece = [[cx, cy, sweep > 0.5 ? 1 : 0, i]]
    }
    piece.push([x, y, sweep, i])
    prev = { x, y, sweep }
  })
  if (piece.length > 1) pieces.push(piece)
  return pieces.filter((p) => p.length > 1)
}

// -------------------------------------------------------------------------------------------------
// The coin
// -------------------------------------------------------------------------------------------------

export interface CoinStrokesOptions {
  /** `full` (default) or `core`: core omits the fine strokes. */
  detail?: CoinDetail
  /** Sampling density: 1 is enough for a coin up to about 900 CSS px across; lower for small coins. */
  density?: number
}

/**
 * The coin's strokes in batches, a family (or half of one) at a time, so a caller can yield to the main thread
 * between them (the WebGL stage does, to keep every task short on a slow phone). coinStrokes() collects them.
 */
export function* coinStrokeBatches(options: CoinStrokesOptions = {}): Generator<CoinStroke[]> {
  const detail = options.detail ?? 'full'
  const q = options.density ?? 1
  const R = COIN.radius
  const crown = reliefHeight(R - 0.01, 0)
  const back = crown - COIN.thickness

  // The edge: reeding across the cylinder, and the back rim, both seen only where they face the viewer.
  {
    const k = COIN.edge
    const batch: CoinStroke[] = []
    for (let i = 0; i < k.count; i++) {
      const theta = SIX + (TAU * (i + 0.5)) / k.count
      const x = R * Math.cos(theta)
      const y = R * Math.sin(theta)
      const n = [Math.cos(theta), Math.sin(theta), 0] as const
      const order = lerp(COIN.engrave.rim, fromTwelve(theta))
      const tau = unwindAt('outer', fromSix(theta), 1)
      const b = new Builder()
      b.push(x, y, crown, n, order, tau)
      b.push(x, y, back, n, order, tau)
      batch.push(
        b.finish({ family: 'edge', ink: 'guilloche', weight: k.weight, tier: 'core', edge: true }),
      )
    }
    batch.push(
      ...polar({
        family: 'edge',
        ink: 'guilloche',
        weight: 1.6,
        tier: 'core',
        edge: true,
        samples: Math.ceil(360 * q),
        radius: () => R,
        normal: (_x, _y, theta) => [Math.cos(theta), Math.sin(theta), 0],
        order: (t) => lerp(COIN.engrave.rim, t),
        tau: (t) => unwindAt('outer', t, 1),
      }).map((s) => {
        // The back rim lies at the back of the edge.
        const p = s.points.slice()
        for (let i = 2; i < p.length; i += 3) p[i] = back
        return { ...s, points: p }
      }),
    )
    yield batch
  }

  // Reeding on the face's border.
  {
    const k = COIN.reeding
    const batch: CoinStroke[] = []
    for (let i = 0; i < k.count; i++) {
      const theta = SIX + (TAU * (i + 0.5)) / k.count
      const order = lerp(COIN.engrave.rim, fromTwelve(theta))
      const tau = unwindAt('outer', fromSix(theta), 1)
      const b = new Builder()
      for (const r of [k.r0, k.r1]) {
        const x = r * Math.cos(theta)
        const y = r * Math.sin(theta)
        b.push(x, y, reliefHeight(x, y), reliefNormal(x, y), order, tau)
      }
      batch.push(b.finish({ family: 'reeding', ink: 'guilloche', weight: k.weight, tier: 'core' }))
    }
    yield batch
  }

  // Rims.
  yield COIN.rims.flatMap((rim) => {
    const engrave = COIN.engrave[rim.engrave]
    return polar({
      family: 'rim',
      ink: 'guilloche',
      weight: rim.weight,
      tier: 'core',
      samples: Math.ceil(Math.max(96, rim.r * 0.8) * q),
      radius: () => rim.r,
      order: (t) => lerp(engrave, t),
      tau: (t) => unwindAt(rim.unwind, t, rim.unwind === 'centre' ? 1 : outerRadial(rim.r)),
    })
  })

  // The braid and the rope, as twisted cords.
  const [inner, outer] = OUTER_SPAN
  yield ringStrokes(
    'braid',
    'guilloche',
    COIN.braid,
    Math.ceil(8 * q),
    detail,
    COIN.engrave.outer,
    inner,
    outer,
  )
  yield ringStrokes(
    'rope',
    'note',
    COIN.rope,
    Math.ceil(10 * q),
    detail,
    COIN.engrave.outer,
    inner,
    outer,
  )

  // The woven rosette, one twist at a time.
  yield rosetteStrokes(detail, Math.ceil(12 * q), [1])
  yield rosetteStrokes(detail, Math.ceil(12 * q), [-1])

  // The amber centre: the sign's distance field (in steps), its keyline, then the rules.
  const field = yield* centreSign()
  yield centreEchoes(field)
  yield centreRules(detail, field)
}

/**
 * Every stroke of the coin, core strokes first (so a renderer can draw a prefix for less detail), each family in
 * unwind order. Deterministic: the same options give the same numbers everywhere.
 */
export function coinStrokes(options: CoinStrokesOptions = {}): CoinStroke[] {
  const all: CoinStroke[] = []
  for (const batch of coinStrokeBatches(options)) all.push(...batch)
  return [...all.filter((s) => s.tier === 'core'), ...all.filter((s) => s.tier === 'fine')]
}
