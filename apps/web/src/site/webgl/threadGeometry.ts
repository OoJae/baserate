/**
 * The thread: every stroke of the coin (or of the footer's emblem) joined into one polyline and packed into one
 * interleaved buffer, so the whole engraving is a single instanced draw of capsule quads.
 *
 * Vertex i of the buffer is a point of the thread. Instance i is the segment from vertex i to vertex i + 1: the
 * shader reads both ends from the same buffer (attributes at offsets 0 and STRIDE). Where one stroke ends and the
 * next begins, the joining segment is a pen-lift link: flagged, and never drawn on the coin. Core strokes come first,
 * so drawing a prefix (instanceCount) is the level of detail.
 *
 * Layout, STRIDE floats per vertex, coin units with y UP (WebGL's):
 *   0–2  position x, y, z
 *   3–5  relief normal nx, ny, nz
 *   6    order: engraving time, 0–1
 *   7    tau: unwind (or wind) time, 0–1
 *   8    weight: multiplies the width law
 *   9    flags: ink (0 Note, 1 Guilloche, 2 Amber, 3 Mint) + 4·edge + 8·link + 16·supply (the footer's feed)
 */

import {
  type CoinInk,
  type CoinStroke,
  coinStrokeBatches,
  engravedWidth,
  restLight,
} from '../../brand/coin'
import { type MarkDetail, markParts, PRESETS } from '../../brand/guilloche'

export const STRIDE = 10

export const INK = { note: 0, guilloche: 1, amber: 2, mint: 3 } as const
export type ThreadInk = CoinInk | 'mint'

const EDGE = 4
const LINK = 8
const SUPPLY = 16

export interface ThreadData {
  /** The interleaved vertices. */
  readonly data: Float32Array
  /** Vertices in the buffer. */
  readonly vertices: number
  /** Segments to draw at full detail (vertices − 1). */
  readonly full: number
  /** Segments to draw at core detail (the core prefix). */
  readonly core: number
}

/** A stroke as the thread needs it (the coin's, or the emblem's). */
export interface ThreadStroke {
  readonly ink: ThreadInk
  readonly weight: number
  readonly tier: 'core' | 'fine'
  readonly edge: boolean
  /** The footer's supply line: placed by the shader from uniforms, not by its points. */
  readonly supply?: boolean
  /** x, y, z per point, y DOWN (the brand's convention); flipped here. */
  readonly points: Float32Array
  readonly normals: Float32Array
  readonly order: Float32Array
  readonly tau: Float32Array
}

/** Packs strokes, core first, into one thread. `tauScale` rescales the unwind times (so the last is exactly 1). */
export function packThread(strokes: readonly ThreadStroke[], tauScale = 1): ThreadData {
  const ordered = [
    ...strokes.filter((s) => s.tier === 'core'),
    ...strokes.filter((s) => s.tier === 'fine'),
  ]
  let vertices = 0
  let coreVertices = 0
  for (const s of ordered) {
    const n = s.order.length
    vertices += n
    if (s.tier === 'core') coreVertices += n
  }
  const data = new Float32Array(vertices * STRIDE)
  let v = 0
  for (const s of ordered) {
    const n = s.order.length
    const ink = INK[s.ink]
    for (let i = 0; i < n; i++) {
      const o = v * STRIDE
      data[o] = s.points[i * 3] ?? 0
      data[o + 1] = -(s.points[i * 3 + 1] ?? 0)
      data[o + 2] = s.points[i * 3 + 2] ?? 0
      data[o + 3] = s.normals[i * 3] ?? 0
      data[o + 4] = -(s.normals[i * 3 + 1] ?? 0)
      data[o + 5] = s.normals[i * 3 + 2] ?? 1
      data[o + 6] = s.order[i] ?? 0
      data[o + 7] = Math.min(1, (s.tau[i] ?? 0) * tauScale)
      data[o + 8] = s.weight
      // The last point of a stroke starts the link to the next stroke.
      data[o + 9] = ink + (s.edge ? EDGE : 0) + (i === n - 1 ? LINK : 0) + (s.supply ? SUPPLY : 0)
      v++
    }
  }
  return {
    data,
    vertices,
    full: Math.max(0, vertices - 1),
    core: Math.max(0, coreVertices - 1),
  }
}

/**
 * The coin's thread. `core` builds only the core strokes, at a lower sampling density (small, slow screens). The
 * build yields between families (`pause`), so no single task runs long on a slow phone.
 */
export async function coinThread(
  detail: 'full' | 'core',
  pause: () => Promise<void> = () => Promise.resolve(),
): Promise<ThreadData> {
  const strokes: CoinStroke[] = []
  for (const batch of coinStrokeBatches({ detail, density: detail === 'core' ? 0.75 : 1 })) {
    strokes.push(...batch)
    await pause()
  }
  let maxTau = 0
  for (const s of strokes) for (const t of s.tau) if (t > maxTau) maxTau = t
  // The unwind's last point leaves at exactly 1, so the line stays pinned at the exit when the scroll ends.
  return packThread(strokes, maxTau > 0 ? 1 / maxTau : 1)
}

// -------------------------------------------------------------------------------------------------
// The footer's emblem: the mark the page shows there (components/Logo.tsx LogoMark, `fine` or `medium`) as line
// work the thread winds into. Mark units (100 × 100, centred on 50, 50), scaled by 10 to the coin's 1000-unit box.
// -------------------------------------------------------------------------------------------------

/** When each part of the emblem is wound in, in the footer's progress (0–1). The rate step comes last. */
export const SPOOL_WIND = {
  rims: [0.04, 0.34],
  rope: [0.18, 0.56],
  plate: [0.46, 0.84],
  step: [0.74, 0.97],
} as const

const MARK = 10
const TURN = Math.PI * 2

/**
 * The emblem's weights are mark units. The stage multiplies them by the emblem's px per mark unit and by this, the
 * inverse of the width law's result for a face-on line under the rest light (about 0.79 px), so a line drawn with
 * weight w is w mark units wide: the same as the SVG mark's strokes at that size.
 */
export const EMBLEM_WEIGHT = 1 / engravedWidth(restLight([0, 0, 1]))

/**
 * Where the line enters the emblem: from above (the rail runs into its top), or from the side the rail is on
 * (the rail turns along the emblem's middle into its rim). The winding starts there and runs clockwise.
 */
export type SpoolEntry = 'top' | 'left' | 'right'

/** The entry's angle on the emblem, radians clockwise from three o'clock (y down). */
export const ENTRY_ANGLE: Readonly<Record<SpoolEntry, number>> = {
  top: -Math.PI / 2,
  left: Math.PI,
  right: 0,
}

/** Parses path data made of M, L, H, V, A (circles only via `circle`) and Z into polylines of points. */
function polylinesOf(d: string, arcSteps = 96): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  const tokens = d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  let i = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const op = tokens[i++]
    if (op === 'M') {
      x = num()
      y = num()
      startX = x
      startY = y
      cur = [[x, y]]
      out.push(cur)
    } else if (op === 'L') {
      x = num()
      y = num()
      cur.push([x, y])
    } else if (op === 'H') {
      x = num()
      cur.push([x, y])
    } else if (op === 'V') {
      y = num()
      cur.push([x, y])
    } else if (op === 'A') {
      // circle() writes two half-circle arcs, clockwise (sweep 1): rx ry rot large sweep x y.
      const r = num()
      num()
      num()
      num()
      num()
      const ex = num()
      const ey = num()
      const cx = (x + ex) / 2
      const cy = (y + ey) / 2
      const a0 = Math.atan2(y - cy, x - cx)
      for (let k = 1; k <= arcSteps; k++) {
        const a = a0 + (Math.PI * k) / arcSteps
        cur.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      x = ex
      y = ey
    } else if (op === 'Z') {
      cur.push([startX, startY])
      x = startX
      y = startY
    }
  }
  return out.filter((p) => p.length > 1)
}

/** Path data of cubic Béziers (guilloche.ts trace: M, C, Z) flattened into polylines. */
function cubicLoops(d: string, steps = 6): [number, number][][] {
  const loops: [number, number][][] = []
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  let i = 0
  let cur: [number, number][] = []
  let x = 0
  let y = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const op = tokens[i++]
    if (op === 'M') {
      x = num()
      y = num()
      cur = [[x, y]]
      loops.push(cur)
    } else if (op === 'C') {
      const x1 = num()
      const y1 = num()
      const x2 = num()
      const y2 = num()
      const ex = num()
      const ey = num()
      for (let k = 1; k <= steps; k++) {
        const t = k / steps
        const u = 1 - t
        cur.push([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
        ])
      }
      x = ex
      y = ey
    }
  }
  return loops.filter((l) => l.length > 2)
}

/** Horizontal rules at `pitch` across polygons (even–odd), each run as a two-point line. */
function hatch(
  polygons: readonly [number, number][][],
  pitch: number,
  y0: number,
  y1: number,
): [number, number][][] {
  const runs: [number, number][][] = []
  for (let y = y0 + pitch / 2; y < y1; y += pitch) {
    const xs: number[] = []
    for (const poly of polygons) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i] as [number, number]
        const b = poly[j] as [number, number]
        if (a[1] > y !== b[1] > y) xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      }
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = xs[k] as number
      const xb = xs[k + 1] as number
      if (xb - xa > 0.2)
        runs.push([
          [xa, y],
          [xb, y],
        ])
    }
  }
  return runs
}

function emblemStroke(
  points: readonly [number, number][],
  ink: ThreadInk,
  weight: number,
  window: readonly [number, number],
  share: (x: number, y: number, i: number) => number,
): ThreadStroke {
  const n = points.length
  const p = new Float32Array(n * 3)
  const nr = new Float32Array(n * 3)
  const o = new Float32Array(n)
  const t = new Float32Array(n)
  points.forEach(([x, y], i) => {
    p[i * 3] = (x - 50) * MARK
    p[i * 3 + 1] = (y - 50) * MARK
    p[i * 3 + 2] = 0
    nr[i * 3 + 2] = 1
    o[i] = 1
    t[i] = window[0] + (window[1] - window[0]) * Math.min(1, Math.max(0, share(x, y, i)))
  })
  return { ink, weight, tier: 'core', edge: false, points: p, normals: nr, order: o, tau: t }
}

/** A point with its clockwise share of a turn from the entry angle. */
type Swept = [x: number, y: number, share: number]

/**
 * Splits a polyline around the centre where it crosses the entry's ray, so the winding sweeps one way along each
 * piece, clockwise from the entry. The crossing point ends one piece at share 1 and starts the next at share 0, so
 * nothing shows where they meet.
 */
function sweptFrom(line: readonly [number, number][], start: number): Swept[][] {
  const dx = Math.cos(start)
  const dy = Math.sin(start)
  const shareOf = (x: number, y: number) => {
    const a = Math.atan2(y - 50, x - 50) - start
    return (((a % TURN) + TURN) % TURN) / TURN
  }
  const pieces: Swept[][] = []
  let piece: Swept[] = []
  let prev: Swept | undefined
  for (const [x, y] of line) {
    const share = shareOf(x, y)
    if (prev && Math.abs(share - prev[2]) > 0.5) {
      // Where the segment crosses the entry's ray: the side of the ray changes sign there.
      const side = (px: number, py: number) => dx * (py - 50) - dy * (px - 50)
      const sa = side(prev[0], prev[1])
      const sb = side(x, y)
      const t = sa / (sa - sb || 1)
      const cx = prev[0] + (x - prev[0]) * t
      const cy = prev[1] + (y - prev[1]) * t
      const forward = prev[2] > share // clockwise across the ray: from near 1 to near 0
      piece.push([cx, cy, forward ? 1 : 0])
      if (piece.length > 1) pieces.push(piece)
      piece = [[cx, cy, forward ? 0 : 1]]
    }
    const point: Swept = [x, y, share]
    piece.push(point)
    prev = point
  }
  if (piece.length > 1) pieces.push(piece)
  return pieces
}

function swept(
  piece: readonly Swept[],
  ink: ThreadInk,
  weight: number,
  window: readonly [number, number],
): ThreadStroke {
  return emblemStroke(
    piece.map(([x, y]) => [x, y]),
    ink,
    weight,
    window,
    (_x, _y, i) => piece[i]?.[2] ?? 0,
  )
}

/**
 * The line's supply in the footer: three points the shader places from uniforms (the rail above the slot, the
 * rail's turn, and the entry on the emblem's rim), drawn in the rail's ink at every progress. It is the thread
 * feeding the spool, and it keeps the line whole when the HTML rail stands down.
 */
function supplyStroke(): ThreadStroke {
  const zero = new Float32Array(9)
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
  return {
    ink: 'note',
    weight: 1,
    tier: 'core',
    edge: false,
    supply: true,
    points: zero,
    normals,
    order: new Float32Array([0, 1, 2]),
    tau: new Float32Array([2, 2, 2]),
  }
}

/**
 * The footer emblem's thread: the mark's rims, its rope, the mint plate and the rate step as engraved line work,
 * wound clockwise from `entry`; then the supply.
 */
export function emblemThread(detail: MarkDetail, entry: SpoolEntry): ThreadData {
  const parts = markParts(detail)
  const start = ENTRY_ANGLE[entry]
  const strokes: ThreadStroke[] = []
  for (const rim of parts.rims) {
    for (const loop of polylinesOf(rim.d)) {
      for (const piece of sweptFrom(loop, start)) {
        strokes.push(swept(piece, 'guilloche', rim.width, SPOOL_WIND.rims))
      }
    }
  }
  if (parts.rope) {
    for (const loop of cubicLoops(parts.rope.d)) {
      for (const piece of sweptFrom(loop, start)) {
        strokes.push(swept(piece, 'guilloche', parts.rope.width, SPOOL_WIND.rope))
      }
    }
  }
  // The plate: mint rules across the disc, stopping short of the step; then the step and its base in Note rules.
  const cut = polylinesOf(parts.cut)
  const disc = polylinesOf(parts.disc)
  const plateRadius = PRESETS.mark[detail].plate
  const top = 50 - plateRadius
  const bottom = 50 + plateRadius
  for (const run of hatch([...disc, ...cut], 1.25, top, bottom)) {
    const y = run[0]?.[1] ?? 50
    strokes.push(
      emblemStroke(run, 'mint', 0.75, SPOOL_WIND.plate, () => (y - top) / (bottom - top)),
    )
  }
  const { step } = parts
  for (const run of hatch(cut, 1.1, step.top - 0.5, step.bottom + 0.5)) {
    // The rate step is wound left to right, base first: flat, rise, flat (the brand's line wipe).
    const y = run[0]?.[1] ?? 50
    const base = y > step.bottom - (step.bottom - step.top) * 0.28
    strokes.push(
      emblemStroke(run, 'note', 0.7, SPOOL_WIND.step, (x) => {
        const across = (x - step.left) / (step.right - step.left)
        return base ? across * 0.4 : 0.35 + across * 0.65
      }),
    )
  }
  let maxTau = 0
  for (const s of strokes) for (const t of s.tau) if (t > maxTau) maxTau = t
  const scale = maxTau > 0 ? 1 / maxTau : 1
  return packThread([...strokes.map((s) => scaled(s, scale)), supplyStroke()])
}

/** A stroke with its wind times scaled (so the last is exactly 1). */
function scaled(s: ThreadStroke, k: number): ThreadStroke {
  return { ...s, tau: s.tau.map((t) => Math.min(1, t * k)) }
}

/** The outer rim's radius of a mark detail, in mark units (where the line meets the emblem). */
export function emblemRim(detail: MarkDetail): number {
  return PRESETS.mark[detail].rims[0]?.r ?? 49
}
