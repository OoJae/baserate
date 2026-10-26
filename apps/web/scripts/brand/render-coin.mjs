#!/usr/bin/env node
// Writes public/brand/coin-engraved.svg: the hero coin's poster, drawn from the same strokes as the WebGL coin
// (src/brand/coin.ts) in the same rest pose, light and engraving law, so the poster and the canvas match:
//
//   node apps/web/scripts/brand/render-coin.mjs
//
// It is what the landing shows for reduced motion, without WebGL, and while WebGL is late (src/site/webgl).
//
// - Every line is an engraved stroke whose width comes from the light on its relief normal (coin.ts engravedWidth),
//   quantised to WIDTH_STEP px. Widths are in CSS px with vector-effect: non-scaling-stroke, exactly as the canvas
//   draws them, so the poster engraves the same at any size.
// - Below 560 px across, the fine strokes drop out (a media query inside the SVG): the core lines, as the low tier
//   draws them. Small sizes get fewer lines, never thinner ones.
// - The microprint carries only what is true without reading the chain (composeMicrotext with the chain id alone:
//   "MEZO TESTNET · CHAIN 31611 · NO REDEMPTION QUEUE"); the live block and rate appear on the canvas only.
// - Glyph outlines come from data/outlines.json (outline-fonts.py). coin.ts carries its own copy of the bitcoin B;
//   this script fails if the two differ.
//
// Needs Node 24+ (it imports the TypeScript sources directly).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BITCOIN_B, COIN, coinStrokes, engravedWidth } from '../../src/brand/coin.ts'
import { fmt, glyphPath } from '../../src/brand/guilloche.ts'
import tokens from '../../src/brand/tokens.json' with { type: 'json' }
import { layoutMicrotext } from '../../src/site/webgl/microtext.ts'
import { composeMicrotext, MICROTEXT_SEPARATOR } from '../../src/site/webgl/microtextLine.ts'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')
const outFile = join(web, 'public', 'brand', 'coin-engraved.svg')
const outlines = JSON.parse(readFileSync(join(here, 'data', 'outlines.json'), 'utf8'))

/** The chain the poster names (Mezo testnet). Live values never go into a static file. */
const CHAIN_ID = 31611
/** Widths are quantised to this many CSS px, so each (ink, width) is one path. */
const WIDTH_STEP = 0.2
/** Points closer than this (coin units) to the simplified line are dropped (Ramer–Douglas–Peucker). */
const TOLERANCE = 0.15
/** Coordinates are written as whole multiples of 1 / GRID coin units (the viewBox is scaled to match). */
const GRID = 4
/** The perspective the poster is drawn with: the camera's distance in coin units (the canvas uses about this). */
const DISTANCE = 3000
/** Below this many CSS px across, the poster draws the core lines only. */
const CORE_BELOW = 560

const P = Object.fromEntries(Object.entries(tokens.color.palette).map(([k, v]) => [k, v.hex]))
const INK = { note: P.note, guilloche: P.guilloche, amber: P.amber }

// -------------------------------------------------------------------------------------------------
// The bitcoin B in coin.ts must be the outline the brand renders from.
// -------------------------------------------------------------------------------------------------

{
  const source = outlines.bitcoinB
  const same =
    JSON.stringify(source.commands) === JSON.stringify(BITCOIN_B.commands) &&
    JSON.stringify(source.stem) === JSON.stringify(BITCOIN_B.stem) &&
    JSON.stringify(source.bounds) === JSON.stringify(BITCOIN_B.bounds) &&
    source.capHeight === BITCOIN_B.capHeight
  if (!same) {
    throw new Error(
      'coin.ts BITCOIN_B differs from scripts/brand/data/outlines.json bitcoinB: copy it again',
    )
  }
}

// -------------------------------------------------------------------------------------------------
// The rest pose: the stage's camera, in WebGL axes (y up), then to SVG (y down).
// -------------------------------------------------------------------------------------------------

const { yaw, pitch } = COIN.pose
const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)]

/** three.js Euler 'YXZ' (pitch, yaw, 0): R = Ry(yaw) · Rx(pitch). */
function rotate(x, y, z) {
  const y1 = y * cp - z * sp
  const z1 = y * sp + z * cp
  return [x * cy + z1 * sy, y1, -x * sy + z1 * cy]
}

/** A point of the coin (coin units, y down) to the poster (y down), in perspective. */
function project(x, yDown, z) {
  const [rx, ry, rz] = rotate(x, -yDown, z)
  const k = DISTANCE / (DISTANCE - rz)
  return [rx * k, -ry * k, rz]
}

const lightView = (() => {
  const [lx, ly, lz] = COIN.light
  const len = Math.hypot(lx, ly, lz)
  return [lx / len, -ly / len, lz / len]
})()

/** The light on a normal (coin axes, y down), after the pose. */
function lightOn(nx, nyDown, nz) {
  const [x, y, z] = rotate(nx, -nyDown, nz)
  const len = Math.hypot(x, y, z) || 1
  return Math.max(0, (x * lightView[0] + y * lightView[1] + z * lightView[2]) / len)
}

/** Whether an edge point faces the camera (the canvas culls the rest). */
function faces(x, yDown, z, nx, nyDown, nz) {
  const [px, py, pz] = rotate(x, -yDown, z)
  const [qx, qy, qz] = rotate(nx, -nyDown, nz)
  return qx * -px + qy * -py + qz * (DISTANCE - pz) > 0
}

// -------------------------------------------------------------------------------------------------
// Strokes → quantised runs
// -------------------------------------------------------------------------------------------------

/** groups: `${tier}|${ink}|${level}` → path data */
const groups = new Map()
let runs = 0
let points = 0

/** Ramer–Douglas–Peucker: the fewest points within `tolerance` of the polyline. */
function simplify(pts, tolerance) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()
    const [ax, ay] = pts[i0]
    const [bx, by] = pts[i1]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-9
    let worst = -1
    let far = 0
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i]
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (far > tolerance && worst > 0) {
      keep[worst] = 1
      stack.push([i0, worst], [worst, i1])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function emit(tier, ink, level, raw) {
  if (raw.length < 2) return
  const pts = simplify(raw, TOLERANCE)
  runs++
  points += pts.length
  const key = `${tier}|${ink}|${level}`
  let d = groups.get(key) ?? ''
  const q = (v) => Math.round(v * GRID)
  let px = q(pts[0][0])
  let py = q(pts[0][1])
  d += `M${px} ${py}l`
  for (let i = 1; i < pts.length; i++) {
    const x = q(pts[i][0])
    const y = q(pts[i][1])
    const dx = String(x - px)
    const dy = String(y - py)
    // Implicit l: a space between numbers unless the next one carries its own sign.
    d += `${i === 1 || dx.startsWith('-') ? '' : ' '}${dx}${dy.startsWith('-') ? '' : ' '}${dy}`
    px = x
    py = y
  }
  groups.set(key, d)
}

const strokes = coinStrokes({ detail: 'full' })
for (const s of strokes) {
  const n = s.order.length
  let run = []
  let runLevel = -1
  const flush = () => {
    if (run.length > 1) emit(s.tier, s.ink, runLevel, run)
    run = []
  }
  for (let i = 0; i < n; i++) {
    const x = s.points[i * 3]
    const y = s.points[i * 3 + 1]
    const z = s.points[i * 3 + 2]
    const nx = s.normals[i * 3]
    const ny = s.normals[i * 3 + 1]
    const nz = s.normals[i * 3 + 2]
    if (s.edge && !faces(x, y, z, nx, ny, nz)) {
      flush()
      runLevel = -1
      continue
    }
    const width = engravedWidth(lightOn(nx, ny, nz)) * s.weight
    const level = Math.max(1, Math.round(width / WIDTH_STEP))
    const [sx, sy2] = project(x, y, z)
    if (level !== runLevel && run.length) {
      // Close the run at this point so the next one starts where it ends: no gap at a change of width.
      run.push([sx, sy2])
      flush()
    }
    runLevel = level
    run.push([sx, sy2])
  }
  flush()
}

// -------------------------------------------------------------------------------------------------
// Microprint: Plex Mono outlines laid round the band, in perspective (each glyph mapped by its local Jacobian).
// -------------------------------------------------------------------------------------------------

function microprint() {
  const mono = outlines.mono
  const { inner, outer, capHeight } = COIN.microtext
  const ring = { radius: (inner + outer) / 2, band: outer - inner, capHeight }
  const layout = layoutMicrotext(composeMicrotext({ chainId: CHAIN_ID }), ring, MICROTEXT_SEPARATOR)
  const font = layout.fontSize
  const baseline = ring.radius - (font * mono.capHeight) / 2
  const chars = Array.from(layout.text)
  const defs = new Map()
  const uses = []
  const height = (x, y) => {
    // The ring sits on the rim's slope: lift glyphs onto the relief like the canvas's ring mesh.
    return reliefHeightAt(x, y) + 0.2
  }
  chars.forEach((ch, i) => {
    const glyph = mono.glyphs[ch]
    if (!glyph || ch === ' ') return
    const u = (i + 0.5) / chars.length
    const theta = -Math.PI / 2 + 2 * Math.PI * u
    const out = [Math.cos(theta), Math.sin(theta)]
    const tan = [-Math.sin(theta), Math.cos(theta)]
    const at = (along, inward) => {
      const x = baseline * out[0] + along * tan[0] - inward * out[0]
      const y = baseline * out[1] + along * tan[1] - inward * out[1]
      return project(x, y, height(x, y))
    }
    const c = at(0, 0)
    const t = at(1, 0)
    const n = at(0, 1)
    const a = (t[0] - c[0]) * font
    const b = (t[1] - c[1]) * font
    const cc = (n[0] - c[0]) * font
    const d = (n[1] - c[1]) * font
    const id = `g${ch.codePointAt(0).toString(16)}`
    if (!defs.has(id)) defs.set(id, glyphPath(glyph, [1, 0, 0, 1, -mono.advance / 2, 0], 3))
    const m = [a, b, cc, d, c[0], c[1]].map((v) => fmt(v * GRID, 2))
    uses.push(`<use href="#${id}" transform="matrix(${m.join(' ')})"/>`)
  })
  return {
    defs: [...defs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join(''),
    body: `<g fill="${P.note}">${uses.join('')}</g>`,
    text: layout.text,
  }
}

// coin.ts's relief, for the microprint's lift (imported lazily to keep the top of the file about the pose).
const { reliefHeight: reliefHeightAt } = await import('../../src/brand/coin.ts')

// -------------------------------------------------------------------------------------------------
// The file
// -------------------------------------------------------------------------------------------------

const micro = microprint()
const order = ['guilloche', 'note', 'amber']
let body = ''
for (const tier of ['core', 'fine']) {
  let layer = ''
  for (const ink of order) {
    const levels = [...groups.keys()]
      .filter((k) => k.startsWith(`${tier}|${ink}|`))
      .map((k) => Number(k.split('|')[2]))
      .sort((p, q) => p - q)
    if (!levels.length) continue
    layer += `<g class="e" stroke="${INK[ink]}">`
    for (const level of levels) {
      layer += `<path stroke-width="${fmt(level * WIDTH_STEP, 2)}" d="${groups.get(`${tier}|${ink}|${level}`)}"/>`
    }
    layer += '</g>'
  }
  body += tier === 'fine' ? `<g class="fine">${layer}</g>` : layer
}

const title = 'The Baserate coin: an engraved bitcoin coin'
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-500 * GRID} ${-500 * GRID} ${1000 * GRID} ${1000 * GRID}" ` +
  'width="1000" height="1000" ' +
  `role="img" aria-label="${title}"><title>${title}</title>` +
  '<style>.e path{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}' +
  `@media (max-width:${CORE_BELOW - 0.02}px){.fine{display:none}}</style>` +
  `<defs>${micro.defs}</defs>${body}${micro.body}</svg>\n`

writeFileSync(outFile, svg)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const { gzipSync } = await import('node:zlib')
console.log(
  `coin-engraved.svg: ${kb(svg.length)} (gzip ${kb(gzipSync(svg).length)}), ${strokes.length} strokes, ` +
    `${runs} runs, ${points} points, ${groups.size} paths; microprint "${micro.text.slice(0, 60)}…"`,
)
