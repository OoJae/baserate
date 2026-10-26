/**
 * Guilloche: deterministic, dependency-free generators of engraved line work as SVG path data, and the presets the
 * logo, the coin fallback image and the social images are drawn from.
 *
 * Pure arithmetic with no imports, so a call returns the same path data in the browser, in Node (the render scripts
 * import this file directly) and in the film. Units are the caller's viewBox units, y grows downwards, and angles are
 * radians measured clockwise on screen from three o'clock.
 *
 *   rosette(r, petals, phase, lines)       stacked waving lines twisted into petals: the engine-turned rosette
 *   ring(radius, amplitude, waves, lines)  a woven rope around a circle: a rosette's rim
 *   band(width, height, waves, lines)      a woven wave band, as on a note's border or security thread
 *   hypotrochoid(R, r, d)                  a spirograph curve
 *   microtextRing(text, radius)            microprint around a circle, for <textPath> or as outlines
 *   fibres(size)                           paper fibre: short curved hairlines on a seamless tile
 *   markParts(detail)                      the Baserate emblem: rims, rope, plate, rate step and base
 *   markDetailFor(size, dpr)               the level of detail a mark can carry at a size
 *
 * Line i of ring() is line 0 turned by a fixed step, so a file can draw line 0 once and repeat it with <use>: see
 * ringStep().
 *
 * The line rule: wherever engraving is authored and shown in the product, every line is at least MIN_LINE_PX device
 * pixels wide. Small sizes get fewer, heavier lines, never thinner ones. Thumbnails of a larger asset may resolve to
 * tone.
 */

const TAU = Math.PI * 2

/** The narrowest an engraved line may render, in device pixels, at the size it is authored and shown. */
export const MIN_LINE_PX = 0.5

export type Point = readonly [x: number, y: number]

/** [multiple, share]: a second wave `multiple` times as fast that takes `share` of the depth or amplitude. */
export type Braid = readonly [multiple: number, share: number]

export interface DrawOptions {
  /** Centre of the figure. Default 0, 0. */
  cx?: number
  cy?: number
  /** Decimal places in the path data. Default 2. */
  precision?: number
  /** Bézier segments per petal, wave or lobe. Default 4. */
  segments?: number
}

/** Mulberry32: a tiny seeded PRNG. The same seed gives the same sequence in every runtime. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A path-data number: fixed precision, no trailing zeros, never "-0". */
export function fmt(value: number, precision = 2): string {
  const text = value.toFixed(precision)
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}

function xy(p: Point, precision: number): string {
  return `${fmt(p[0], precision)} ${fmt(p[1], precision)}`
}

function polar(cx: number, cy: number, r: number, angle: number): Point {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

/**
 * Traces a smooth parametric curve as cubic Béziers. Each segment is the Hermite cubic through its end points with
 * the curve's own tangents, so four segments per wave are visually exact.
 */
export function trace(
  curve: (t: number) => Point,
  t0: number,
  t1: number,
  segments: number,
  closed: boolean,
  precision = 2,
): string {
  const dt = (t1 - t0) / segments
  const h = dt * 1e-3
  const velocity = (t: number): Point => {
    const a = curve(t - h)
    const b = curve(t + h)
    return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)]
  }
  const k = dt / 3
  const start = curve(t0)
  const startV = velocity(t0)
  let prev = start
  let prevV = startV
  let d = `M${xy(start, precision)}`
  for (let i = 1; i <= segments; i++) {
    const last = closed && i === segments
    const cur = last ? start : curve(t0 + i * dt)
    const v = last ? startV : velocity(t0 + i * dt)
    const c1: Point = [prev[0] + prevV[0] * k, prev[1] + prevV[1] * k]
    const c2: Point = [cur[0] - v[0] * k, cur[1] - v[1] * k]
    d += `C${xy(c1, precision)} ${xy(c2, precision)} ${xy(cur, precision)}`
    prev = cur
    prevV = v
  }
  return closed ? `${d}Z` : d
}

/** A full circle as two arcs, clockwise from `start`. */
export function circle(
  cx: number,
  cy: number,
  r: number,
  precision = 2,
  start = -Math.PI / 2,
): string {
  const a = polar(cx, cy, r, start)
  const b = polar(cx, cy, r, start + Math.PI)
  const rr = fmt(r, precision)
  return `M${xy(a, precision)}A${rr} ${rr} 0 1 1 ${xy(b, precision)}A${rr} ${rr} 0 1 1 ${xy(a, precision)}Z`
}

// -------------------------------------------------------------------------------------------------
// Rosette, ring, band, hypotrochoid
// -------------------------------------------------------------------------------------------------

export interface RosetteOptions extends DrawOptions {
  /** Where the stack of lines starts, as a fraction of r. Default 0.45. */
  inner?: number
  /** Wave amplitude in user units. Default 2.5 line spacings, so each line crosses its neighbours. */
  amplitude?: number
  /** Phase added per line (radians): the twist that lines the crests up into turning petals. Default π / 10. */
  twist?: number
  /** Also draw the counter-twisted family, which weaves a basket lattice. Default false. */
  weave?: boolean
  /** Picks the twist and amplitude deterministically when they are not given (0: the defaults). */
  seed?: number
}

/**
 * Rosette: `lines` closed lines stacked from inner·r out to r, each waving `petals` times around and shifted a
 * further `twist` along, so the crests line up into turning petals: the engine-turned rosette of a note or a watch
 * dial. `phase` turns the waves (animate it and the rosette breathes). The amplitude swells through the middle of the
 * stack and settles towards its edges, so the rosette sits cleanly between rims at inner·r and r.
 */
export function rosette(
  r: number,
  petals: number,
  phase: number,
  lines: number,
  options: RosetteOptions = {},
): string {
  const { cx = 0, cy = 0, inner = 0.45, segments = 4, precision = 2, weave = false } = options
  const rand = options.seed ? seeded(options.seed) : undefined
  const r0 = r * inner
  const spacing = (r - r0) / Math.max(1, lines - 1)
  const twist = options.twist ?? (rand ? 0.15 + rand() * 0.35 : Math.PI / 10)
  const amp = Math.min(options.amplitude ?? spacing * (rand ? 1.5 + rand() * 2 : 2.5), (r - r0) / 3)
  let d = ''
  for (const turn of weave ? [1, -1] : [1]) {
    for (let i = 0; i < lines; i++) {
      const t = lines === 1 ? 0.5 : i / (lines - 1)
      const base = r0 + amp + (r - r0 - 2 * amp) * t
      const a = amp * Math.sin(Math.PI * (0.15 + 0.7 * t))
      const shift = phase + turn * i * twist
      const curve = (u: number) => polar(cx, cy, base + a * Math.sin(petals * u + shift), u)
      d += trace(curve, 0, TAU, petals * segments, true, precision)
    }
  }
  return d
}

export interface RingOptions extends DrawOptions {
  /** A second wave braided in. Default none. */
  braid?: Braid
}

/**
 * Ring: `lines` closed curves that wave `waves` times around a circle, between radius ± amplitude, each a further
 * 1/lines of a wave along: a woven rope.
 */
export function ring(
  radius: number,
  amplitude: number,
  waves: number,
  lines: number,
  options: RingOptions = {},
): string {
  const { cx = 0, cy = 0, segments = 4, precision = 2, braid } = options
  const [multiple, share] = braid ?? [1, 0]
  const count = waves * segments * Math.max(1, Math.ceil(multiple))
  let d = ''
  for (let i = 0; i < lines; i++) {
    const shift = (TAU * i) / lines
    const r = (t: number) => {
      const u = waves * t + shift
      return radius + amplitude * ((1 - share) * Math.sin(u) + share * Math.sin(multiple * u))
    }
    d += trace((t) => polar(cx, cy, r(t), t), 0, TAU, count, true, precision)
  }
  return d
}

/** Degrees between neighbouring lines of ring(radius, amplitude, waves, lines). */
export function ringStep(waves: number, lines: number): number {
  return -360 / (waves * lines)
}

export interface BandOptions extends Omit<DrawOptions, 'cx' | 'cy'> {
  /** Top-left corner. Default 0, 0. */
  x?: number
  y?: number
  /** A second wave braided in, running against the first. Default [2, 0.3]. */
  braid?: Braid
  /** A slow swell of the amplitude: [count, depth]; the waves pinch to (1 − depth) at `count` + 1 nodes. */
  swell?: readonly [count: number, depth: number]
}

/**
 * Band: `lines` open curves across a width × height strip, each waving `waves` times and shifted a further 1/lines
 * of a wave, with a braid running against them: the woven band on a note's border.
 */
export function band(
  width: number,
  height: number,
  waves: number,
  lines: number,
  options: BandOptions = {},
): string {
  const { x = 0, y = 0, segments = 4, precision = 2, braid = [2, 0.3], swell } = options
  const [multiple, share] = braid
  const count = Math.ceil(waves * segments * Math.max(1, multiple))
  const half = height / 2
  let d = ''
  for (let i = 0; i < lines; i++) {
    const shift = (TAU * i) / lines
    const curve = (t: number): Point => {
      const u = (TAU * waves * t) / width + shift
      const wave = (1 - share) * Math.sin(u) + share * Math.sin(multiple * (u - shift) - shift)
      const envelope = swell
        ? 1 - swell[1] * (0.5 - 0.5 * Math.cos((TAU * swell[0] * t) / width))
        : 1
      return [x + t, y + half - half * envelope * wave]
    }
    d += trace(curve, 0, width, count, false, precision)
  }
  return d
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const rest = x % y
    x = y
    y = rest
  }
  return x || 1
}

export interface HypotrochoidOptions extends DrawOptions {
  /** Outer radius of the drawn curve (R − r + d maps to it). Default R − r + d. */
  size?: number
  /** Turns the curve (radians). Default 0. */
  rotate?: number
}

/**
 * Hypotrochoid: the path of a pen at distance d from the centre of a circle of radius r rolling inside one of radius
 * R (whole numbers). It closes after r / gcd(R, r) turns and has R / gcd(R, r) lobes.
 */
export function hypotrochoid(
  R: number,
  r: number,
  d: number,
  options: HypotrochoidOptions = {},
): string {
  const { cx = 0, cy = 0, segments = 4, precision = 2, rotate = 0 } = options
  const g = gcd(R, r)
  const turns = Math.round(r) / g
  const lobes = Math.round(R) / g
  const reach = Math.abs(R - r) + Math.abs(d)
  const scale = (options.size ?? reach) / reach
  const k = (R - r) / r
  const cos = Math.cos(rotate)
  const sin = Math.sin(rotate)
  const curve = (t: number): Point => {
    const px = ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * scale
    const py = ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * scale
    return [cx + px * cos - py * sin, cy + px * sin + py * cos]
  }
  return trace(curve, 0, TAU * turns, Math.ceil((lobes + turns) * segments * 2), true, precision)
}

// -------------------------------------------------------------------------------------------------
// Engraver's details: ruling, reeding
// -------------------------------------------------------------------------------------------------

/** Parallel rules across a disc at `spacing`, turned by `angle`: an engraver's flat tint. */
export function ruling(
  cx: number,
  cy: number,
  r: number,
  spacing: number,
  angle = 0,
  precision = 2,
): string {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let d = ''
  for (let o = -r + spacing / 2; o < r; o += spacing) {
    const half = Math.sqrt(r * r - o * o)
    const a: Point = [cx - half * cos - o * sin, cy - half * sin + o * cos]
    const b: Point = [cx + half * cos - o * sin, cy + half * sin + o * cos]
    d += `M${xy(a, precision)}L${xy(b, precision)}`
  }
  return d
}

/** `count` radial ticks between radii r0 and r1: a coin's milled edge. */
export function reeding(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  count: number,
  precision = 2,
): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const t = (TAU * i) / count
    d += `M${xy(polar(cx, cy, r0, t), precision)}L${xy(polar(cx, cy, r1, t), precision)}`
  }
  return d
}

// -------------------------------------------------------------------------------------------------
// Microtext
// -------------------------------------------------------------------------------------------------

/** Glyph outlines for microtext (scripts/brand/data/outlines.json "mono"): em units, y down, pen at the origin. */
export interface GlyphTable {
  /** Advance of every glyph in em (a monospaced face). */
  readonly advance: number
  readonly capHeight: number
  /** ["M", x, y], ["L", x, y], ["Q", x1, y1, x, y], ["C", x1, y1, x2, y2, x, y], ["Z"] */
  readonly glyphs: Readonly<Record<string, ReadonlyArray<ReadonlyArray<string | number>>>>
}

export interface MicrotextOptions extends Omit<DrawOptions, 'segments'> {
  /** Where the text starts. Default −π/2 (twelve o'clock); it runs clockwise. */
  start?: number
  /** Font size wanted. The ring rounds the number of repeats, then fits the size exactly. Default radius / 28. */
  fontSize?: number
  /** Advance per character in em. Default the glyph table's, else 0.6 (IBM Plex Mono). */
  advance?: number
  /** Extra space per character in em. Default 0.12, as on the serial strip. */
  tracking?: number
  /** Joins the repeats. Default " · ". */
  separator?: string
  /** Follow each repeat with a running serial number of this many digits ("BASERATE 000001 · BASERATE 000002"). */
  numbered?: number
  /** Outline the text with this table instead of leaving it to a font. */
  glyphs?: GlyphTable
}

export interface MicrotextRing {
  /** A circle through the baseline, clockwise from `start`: the path for <textPath>. */
  readonly d: string
  /** The text repeated with the separator so that it wraps the circle exactly once. */
  readonly text: string
  readonly fontSize: number
  /** Letter spacing in user units for the <text> element. */
  readonly letterSpacing: number
  /** The circumference: use it as textLength with lengthAdjust="spacing" so the ring closes exactly. */
  readonly textLength: number
  /**
   * Where each character sits: the middle of its advance on the baseline circle, and the rotation (degrees) that
   * stands it outward. A file can define each glyph once (glyphPath) and place it with <use>.
   */
  readonly chars: readonly {
    readonly char: string
    readonly x: number
    readonly y: number
    readonly rotate: number
  }[]
  /** The text as outlines (only with `glyphs`). */
  readonly outline?: string
}

/** Affine map [a, b, c, d, e, f], as in SVG's matrix(): x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

/** A glyph from a GlyphTable as path data, mapped through `m` (em units in, user units out). */
export function glyphPath(
  commands: ReadonlyArray<ReadonlyArray<string | number>>,
  m: Matrix,
  precision = 2,
): string {
  const [a, b, c, d, e, f] = m
  const at = (x = 0, y = 0) => xy([a * x + c * y + e, b * x + d * y + f], precision)
  let out = ''
  for (const [op, ...rest] of commands) {
    const v = rest.map(Number)
    if (op === 'Z') out += 'Z'
    else if (op === 'M' || op === 'L') out += `${op}${at(v[0], v[1])}`
    else if (op === 'Q') out += `Q${at(v[0], v[1])} ${at(v[2], v[3])}`
    else if (op === 'C') out += `C${at(v[0], v[1])} ${at(v[2], v[3])} ${at(v[4], v[5])}`
  }
  return out
}

/** Microprint around a circle: the text repeats until it wraps the ring once, letters standing outward. */
export function microtextRing(
  text: string,
  radius: number,
  options: MicrotextOptions = {},
): MicrotextRing {
  const {
    cx = 0,
    cy = 0,
    precision = 2,
    start = -Math.PI / 2,
    tracking = 0.12,
    numbered = 0,
  } = options
  const separator = options.separator ?? ' · '
  const advance = options.advance ?? options.glyphs?.advance ?? 0.6
  const slot = advance + tracking
  const circumference = TAU * radius
  const repeat = (i: number) =>
    Array.from(
      numbered
        ? `${text} ${String(i + 1).padStart(numbered, '0')}${separator}`
        : `${text}${separator}`,
    )
  const wanted = options.fontSize ?? radius / 28
  const repeats = Math.max(1, Math.round(circumference / (wanted * slot * repeat(0).length)))
  const letters = Array.from({ length: repeats }, (_, i) => repeat(i)).flat()
  const full = letters.join('')
  const fontSize = circumference / (letters.length * slot)
  const step = TAU / letters.length
  const chars = letters.map((char, i) => {
    const angle = start + (i + 0.5) * step
    const [x, y] = polar(cx, cy, radius, angle)
    return { char, x, y, rotate: (angle * 180) / Math.PI + 90 }
  })
  const result: MicrotextRing = {
    d: circle(cx, cy, radius, precision, start),
    text: full,
    fontSize,
    letterSpacing: tracking * fontSize,
    textLength: circumference,
    chars,
  }
  const table = options.glyphs
  if (!table) return result

  let outline = ''
  for (const { char, x, y, rotate } of chars) {
    const glyph = table.glyphs[char]
    if (!glyph) continue
    const t = (rotate * Math.PI) / 180
    const cos = Math.cos(t) * fontSize
    const sin = Math.sin(t) * fontSize
    // Rotate about the character's centre on the baseline, after centring the glyph on its advance.
    const ox = (-advance / 2) * cos
    const oy = (-advance / 2) * sin
    outline += glyphPath(glyph, [cos, sin, -sin, cos, x + ox, y + oy], precision)
  }
  return { ...result, outline }
}

// -------------------------------------------------------------------------------------------------
// Paper
// -------------------------------------------------------------------------------------------------

export interface FibreOptions {
  /** Fibres per tile. Default 200. */
  count?: number
  /** Shortest and longest fibre, in user units. Default 6 to 20. */
  length?: readonly [min: number, max: number]
  /** Stroke widths to choose from: one path per width. Default 0.5, 0.65 and 0.8. */
  widths?: readonly number[]
  /** How far a fibre bows, as a share of its length. Default 0.3. */
  bend?: number
  /** Seeds the scatter. Default 1. */
  seed?: number
  precision?: number
}

/** Fibres of one stroke width, as one path. */
export interface FibreGroup {
  readonly width: number
  readonly d: string
}

/**
 * Paper fibre: `count` short curved hairlines scattered at random angles over a size × size tile. A fibre that crosses
 * an edge is drawn again on the far side, so the tile repeats without a seam. Deterministic for a given seed.
 */
export function fibres(size: number, options: FibreOptions = {}): FibreGroup[] {
  const {
    count = 200,
    length = [6, 20],
    widths = [0.5, 0.65, 0.8],
    bend = 0.3,
    seed = 1,
    precision = 1,
  } = options
  const rand = seeded(seed)
  const groups = widths.map((width) => ({ width, d: '' }))
  for (let i = 0; i < count; i++) {
    const x = rand() * size
    const y = rand() * size
    const angle = rand() * Math.PI
    const len = length[0] + rand() * (length[1] - length[0])
    const bow = (rand() * 2 - 1) * bend * len
    const group = groups[Math.floor(rand() * groups.length)]
    const ux = Math.cos(angle) * (len / 2)
    const uy = Math.sin(angle) * (len / 2)
    const nx = -Math.sin(angle) * bow
    const ny = Math.cos(angle) * bow
    const reach = len / 2 + Math.abs(bow)
    const shiftsX = [0, x - reach < 0 ? size : 0, x + reach > size ? -size : 0].filter(
      (s, k) => k === 0 || s,
    )
    const shiftsY = [0, y - reach < 0 ? size : 0, y + reach > size ? -size : 0].filter(
      (s, k) => k === 0 || s,
    )
    for (const sx of shiftsX) {
      for (const sy of shiftsY) {
        const at = (px: number, py: number) => xy([px + sx, py + sy], precision)
        if (group) group.d += `M${at(x - ux, y - uy)}Q${at(x + nx, y + ny)} ${at(x + ux, y + uy)}`
      }
    }
  }
  return groups.filter((g) => g.d)
}

// -------------------------------------------------------------------------------------------------
// The mark
// -------------------------------------------------------------------------------------------------

/**
 * How much engraving the mark carries. Each level starts where its thinnest line reaches MIN_LINE_PX (markFloor):
 * fine from 168 device px, medium from 32, small (the favicon's) from 16. markDetailFor() picks one for a size.
 */
export type MarkDetail = 'fine' | 'medium' | 'small'

interface MarkPreset {
  /** Plain rims: radius and stroke width. */
  readonly rims: readonly { readonly r: number; readonly width: number }[]
  /** The woven rope between the rims, if any. */
  readonly rope?: {
    readonly radius: number
    readonly amplitude: number
    readonly waves: number
    readonly lines: number
    readonly width: number
  }
  /** Radius of the solid plate the rate step is cut from. */
  readonly plate: number
  /** The rate step: overall width, line weight, base weight. */
  readonly step: { readonly width: number; readonly stroke: number; readonly base: number }
}

/**
 * The presets the brand assets are drawn from: the mark (a 100 × 100 box centred on 50, 50), the coin (1000 × 1000,
 * centred on 500, 500), the woven band and the paper grain. Line widths are in those units; markFloor() turns the
 * mark's into the smallest size each level of detail may be shown at.
 */
export const PRESETS = {
  mark: {
    /** 168 px and up (35 mm in print): mark.svg and the mono marks. */
    fine: {
      rims: [
        { r: 49.35, width: 1.1 },
        { r: 47.7, width: 0.35 },
        { r: 36.75, width: 0.6 },
      ],
      rope: { radius: 42.25, amplitude: 4.5, waves: 24, lines: 9, width: 0.3 },
      plate: 34.6,
      step: { width: 44, stroke: 7.15, base: 8.6 },
    },
    /** 32 to 168 px: the app header, the lockups, the app icons. Three heavy lines that read as a rope at 1x. */
    medium: {
      rims: [
        { r: 48.6, width: 2.8 },
        { r: 37.4, width: 1.6 },
      ],
      rope: { radius: 42.4, amplitude: 3.4, waves: 12, lines: 3, width: 1.6 },
      plate: 34.5,
      step: { width: 44, stroke: 7.4, base: 8.8 },
    },
    /** 16 to 32 px: one rim, no rope. The favicon redraws it on a 16-pixel grid. */
    small: {
      rims: [{ r: 48.4, width: 3.2 }],
      plate: 42.4,
      step: { width: 54, stroke: 10, base: 11.5 },
    },
  } satisfies Record<MarkDetail, MarkPreset>,
  /**
   * The coin: the bitcoin coin in Baserate's engraving. From the edge in: reeding, numbered microprint, a fine braid,
   * the rope, a woven rosette, and an amber centre engraved with concentric rules, the bitcoin sign struck in ink.
   * Its thinnest lines (the ropes and the rosette, 1 unit) hold MIN_LINE_PX from 500 px across: coin.png, and the
   * Open Graph card (520 px). In a feed thumbnail the engraving resolves to tone.
   */
  coin: {
    size: 1000,
    reeding: { r0: 486, r1: 499, count: 300, width: 1.6 },
    rims: [
      { r: 482, width: 2.6 },
      { r: 466, width: 1.3 },
      { r: 437, width: 1.3 },
      { r: 383, width: 1.3 },
      { r: 157, width: 2.4 },
    ],
    /** Microprint: a textured line at arm's length, "BASERATE 000001 · BASERATE 000002 · …" under a loupe. */
    microtext: { radius: 471, fontSize: 7, text: 'BASERATE', numbered: 6 },
    /** A fine braid in Guilloche between the microprint and the rope. */
    braid: { radius: 451.5, amplitude: 9.5, waves: 60, lines: 6, width: 1 },
    rope: { radius: 410, amplitude: 19, waves: 40, lines: 12, width: 1 },
    /** Woven: both twists, so the petals cross into a lattice instead of sweeping one way. */
    rosette: {
      r: 372,
      petals: 30,
      lines: 18,
      inner: 0.45,
      twist: 0.16,
      weave: true,
      segments: 3,
      width: 1,
    },
    /**
     * The amber underprint with ink rules struck over it (a third of the area, so the amber stays bright), cut back
     * by a keyline around the sign; the sign's counters stay clean amber.
     */
    centre: {
      r: 146,
      capHeight: 128,
      rules: { first: 8, pitch: 5.2, width: 1.7 },
      keyline: 0.14,
    },
  },
  /** The woven band (band.svg, band-on-note.svg): a 1500 × 64 strip that tiles; 0.55 px lines at 28 px tall. */
  band: {
    width: 1500,
    height: 64,
    waves: 12,
    lines: 6,
    braid: [2, 0.3] as Braid,
    swell: [4, 0.45] as const,
    stroke: 1.25,
  },
  /**
   * Paper fibre (grain.svg, and --grain in tokens.css): a 240 px tile of short Intaglio hairlines at 3.5 % with a few
   * Mint security fibres, for light grounds only.
   */
  grain: {
    tile: 240,
    fibres: {
      count: 200,
      length: [6, 20] as const,
      widths: [0.5, 0.65, 0.8] as const,
      seed: 7,
      opacity: 0.035,
    },
    security: {
      count: 5,
      length: [12, 26] as const,
      widths: [0.7] as const,
      seed: 1007,
      opacity: 0.1,
    },
  },
} as const

/** The smallest size, in device pixels, at which every line of a level of detail is MIN_LINE_PX or wider. */
export function markFloor(detail: MarkDetail): number {
  const preset: MarkPreset = PRESETS.mark[detail]
  const widths = preset.rims.map((rim) => rim.width)
  if (preset.rope) widths.push(preset.rope.width)
  return (MIN_LINE_PX * 100) / Math.min(...widths)
}

/** The richest level of detail a mark `size` CSS px across can carry on a screen of `dpr` device pixels per px. */
export function markDetailFor(size: number, dpr = 1): MarkDetail {
  const px = size * dpr
  if (px >= markFloor('fine')) return 'fine'
  if (px >= markFloor('medium')) return 'medium'
  return 'small'
}

function stepOutline(
  cx: number,
  cy: number,
  spec: MarkPreset['step'],
): { line: Point[]; base: Point[]; box: StepBox } {
  // Proportions of the original 32-unit mark: flat 6.2, rise 3.6 across and 5 up, flat 6.2; base 4.5 below.
  const { width: w, stroke, base } = spec
  const half = stroke / 2
  const rise = (5 / 16) * w
  const gap = (4.5 / 16) * w
  const height = half + rise + gap + base / 2
  const top = cy - height / 2
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y2 = top + half
  const y1 = y2 + rise
  const yb = y1 + gap
  const r0 = x0 + (6.2 / 16) * w
  const r1 = r0 + (3.6 / 16) * w
  // Miter joins on a polyline of three segments: flat, rise, flat. Butt ends.
  const len = Math.hypot(r1 - r0, y2 - y1)
  const n: Point = [-(y2 - y1) / len, (r1 - r0) / len]
  const m1: Point = [n[0] / (1 + n[1]), (1 + n[1]) / (1 + n[1])]
  const along = (p: Point, v: Point, s: number): Point => [p[0] + v[0] * s, p[1] + v[1] * s]
  const b: Point = [r0, y1]
  const c: Point = [r1, y2]
  const line: Point[] = [
    [x0, y1 + half],
    along(b, m1, half),
    along(c, m1, half),
    [x1, y2 + half],
    [x1, y2 - half],
    along(c, m1, -half),
    along(b, m1, -half),
    [x0, y1 - half],
  ]
  const baseRect: Point[] = [
    [x0, yb - base / 2],
    [x1, yb - base / 2],
    [x1, yb + base / 2],
    [x0, yb + base / 2],
  ]
  return { line, base: baseRect, box: { left: x0, right: x1, top, bottom: yb + base / 2 } }
}

/** The bounding box of the rate step and its base, in the mark's 100 × 100 box. */
export interface StepBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function polygon(points: readonly Point[], precision: number): string {
  return `${points.map((p, i) => `${i ? 'L' : 'M'}${xy(p, precision)}`).join('')}Z`
}

export interface MarkParts {
  readonly viewBox: '0 0 100 100'
  /** Plain rims: stroke these. */
  readonly rims: readonly { readonly d: string; readonly width: number }[]
  /** The woven rope: `d` holds every line; `line` is line 0, and line i is it turned by i × `step` degrees. */
  readonly rope?: {
    readonly d: string
    readonly line: string
    readonly step: number
    readonly lines: number
    readonly width: number
  }
  /** The plate with the base and the rate step cut out: fill it with fill-rule="evenodd". */
  readonly plate: string
  /** The plate as a solid disc, for two-colour marks with `cut` filled on top. */
  readonly disc: string
  /** The rate step and the base on their own. */
  readonly cut: string
  /** Where the step sits: lockups set the wordmark's capital height from its top to its base's foot. */
  readonly step: StepBox
}

const markCache = new Map<MarkDetail, MarkParts>()

/**
 * The Baserate emblem at one level of detail: the rate step and its base cut from a mint plate, ringed by plain rims
 * and (fine, medium) a woven guilloche rope.
 */
export function markParts(detail: MarkDetail = 'fine'): MarkParts {
  const cached = markCache.get(detail)
  if (cached) return cached
  const preset: MarkPreset = PRESETS.mark[detail]
  const p = 2
  const { line, base, box } = stepOutline(50, 50, preset.step)
  const cut = polygon(line, p) + polygon(base, p)
  const disc = circle(50, 50, preset.plate, p)
  const rope = preset.rope
  const parts: MarkParts = {
    viewBox: '0 0 100 100',
    rims: preset.rims.map(({ r, width }) => ({ d: circle(50, 50, r, p), width })),
    rope: rope && {
      d: ring(rope.radius, rope.amplitude, rope.waves, rope.lines, {
        cx: 50,
        cy: 50,
        precision: p,
      }),
      line: ring(rope.radius, rope.amplitude, rope.waves, 1, { cx: 50, cy: 50, precision: p }),
      step: ringStep(rope.waves, rope.lines),
      lines: rope.lines,
      width: rope.width,
    },
    plate: disc + cut,
    disc,
    cut,
    step: box,
  }
  markCache.set(detail, parts)
  return parts
}
