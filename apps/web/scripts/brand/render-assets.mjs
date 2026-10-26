#!/usr/bin/env node
// Renders Baserate's brand assets into apps/web/public/brand, reproducibly:
//
//   node apps/web/scripts/brand/render-assets.mjs
//
// 1. Writes the SVGs from src/brand: the guilloche presets (guilloche.ts), the outlined wordmark (wordmark.ts) and
//    the colours (tokens.json). Marks, wordmarks, lockups, the favicon (copied to public/favicon.svg), the app icon,
//    the woven bands, the paper grain tile (also written into src/brand/tokens.css as --grain) and the coin.
// 2. Serves apps/web on 127.0.0.1 and screenshots the self-contained templates in this folder with Playwright's
//    Chromium: og.html (og.png, 1200 × 630), x-header.html (x-header.png, 1500 × 500), and asset.html for the PNG
//    icons and the coin (coin.png, and coin.webp encoded by the browser). Fonts come from node_modules/@fontsource*
//    through src/brand/tokens.css; any request that leaves 127.0.0.1 is blocked and fails the run.
//
// Needs Node 24+ (it imports the TypeScript sources directly) and Playwright's Chromium
// (`pnpm --filter web exec playwright install chromium`). Glyph outlines come from data/outlines.json, written by
// outline-fonts.py.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import {
  band,
  circle,
  fibres,
  fmt,
  glyphPath,
  markParts,
  microtextRing,
  PRESETS,
  reeding,
  ring,
  ringStep,
  rosette,
} from '../../src/brand/guilloche.ts'
import tokens from '../../src/brand/tokens.json' with { type: 'json' }
import { WORDMARK_DISPLAY, WORDMARK_FLOORS, WORDMARK_TEXT } from '../../src/brand/wordmark.ts'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')
const out = join(web, 'public', 'brand')
const tokensCss = join(web, 'src', 'brand', 'tokens.css')
const outlines = JSON.parse(readFileSync(join(here, 'data', 'outlines.json'), 'utf8'))

const P = Object.fromEntries(Object.entries(tokens.color.palette).map(([k, v]) => [k, v.hex]))

/** Colour schemes for the emblem: line work, plate, cut. */
const ON_NOTE = { line: P.mint, plate: P.mint, cut: P.note }
const ON_INTAGLIO = { line: P.guilloche, plate: P.mint, cut: P.note }

const range = (n) => Array.from({ length: n }, (_, i) => i)
const XMLNS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'

function svgDoc({ viewBox, width, title, defs = '', style = '', body }) {
  const [, , vw, vh] = viewBox.split(' ').map(Number)
  return (
    `<svg ${XMLNS} viewBox="${viewBox}" width="${fmt(width)}" height="${fmt((width * vh) / vw)}" role="img" ` +
    `aria-label="${title}"><title>${title}</title>${style ? `<style>${style}</style>` : ''}` +
    `${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`
  )
}

/** One line drawn once and repeated with <use>, turned `step` degrees each time about (cx, cy). */
function repeated(id, count, step, cx, cy) {
  return range(count)
    .map((i) => {
      const turn = i ? ` transform="rotate(${fmt(i * step, 4)} ${cx} ${cy})"` : ''
      return `<use xlink:href="#${id}"${turn}/>`
    })
    .join('')
}

/**
 * The emblem as SVG markup in its 100 × 100 box. `colors` is a two-colour scheme (plate with the cut filled on top)
 * or `mono`, one colour with the cut knocked out.
 */
function emblem(detail, { colors, mono, id = 'm' } = {}) {
  const parts = markParts(detail)
  const stroke = mono ?? colors.line
  let defs = ''
  let rope = ''
  if (parts.rope) {
    defs += `<path id="${id}-rope" d="${parts.rope.line}"/>`
    rope = `<g stroke-width="${parts.rope.width}">${repeated(`${id}-rope`, parts.rope.lines, parts.rope.step, 50, 50)}</g>`
  }
  const rims = parts.rims.map((r) => `<path d="${r.d}" stroke-width="${r.width}"/>`).join('')
  const plate = mono
    ? `<path fill="${mono}" fill-rule="evenodd" d="${parts.plate}"/>`
    : `<path fill="${colors.plate}" d="${parts.disc}"/><path fill="${colors.cut}" d="${parts.cut}"/>`
  return { defs, body: `<g fill="none" stroke="${stroke}">${rims}${rope}</g>${plate}`, parts }
}

function markSvg(detail, scheme, width = 256) {
  const e = emblem(detail, scheme)
  return svgDoc({ viewBox: '0 0 100 100', width, title: 'Baserate', defs: e.defs, body: e.body })
}

function wordmarkPath(cut, fill, x, y, scale) {
  const at = `translate(${fmt(x, 3)} ${fmt(y, 3)}) scale(${fmt(scale, 5)})`
  return `<path fill="${fill}" transform="${at}" d="${cut.d}"/>`
}

/**
 * The word alone, in the display cut: engraved (wordmark.svg, a capital height of 48 px and up: hero, film, deck) or
 * solid (wordmark-solid.svg, 24 px and up). The engraving is cut out with an evenodd clip of the box and its gaps.
 * Each file's own size keeps the capital height above its floor.
 */
function wordmarkSvg(fill, { engraved }) {
  const w = WORDMARK_DISPLAY
  const width = 420
  const cap = (width / w.width) * 100
  const floor = engraved ? WORDMARK_FLOORS.engraved : WORDMARK_FLOORS.display
  if (cap < floor) throw new Error(`wordmark: a ${fmt(cap)} px capital height is under ${floor} px`)
  if (!engraved) {
    return svgDoc({
      viewBox: `0 0 ${w.width} ${w.height}`,
      width,
      title: 'Baserate',
      body: `<path fill="${fill}" d="${w.d}"/>`,
    })
  }
  const box = `M-1 -1H${fmt(w.width + 1)}V${fmt(w.height + 1)}H-1Z`
  return svgDoc({
    viewBox: `0 0 ${w.width} ${w.height}`,
    width,
    title: 'Baserate',
    defs: `<clipPath id="engraving"><path clip-rule="evenodd" d="${box}${w.engraving}"/></clipPath>`,
    body: `<path fill="${fill}" clip-path="url(#engraving)" d="${w.d}"/>`,
  })
}

/**
 * Lockups (text cut, so they hold up small). The word's capital height runs from the top of the rate step to the
 * foot of its base, so it stands on the same base as the step. Horizontal: a gap of a fifth of the mark. Stacked:
 * the word centred a quarter of the mark below it.
 */
function lockupSvg(layout, scheme, wordFill) {
  const e = emblem('medium', { colors: scheme })
  const w = WORDMARK_TEXT
  const { top, bottom } = e.parts.step
  const k = (bottom - top) / 100
  const wordW = w.width * k
  if (layout === 'horizontal') {
    const gap = 20
    return svgDoc({
      viewBox: `0 0 ${fmt(100 + gap + wordW)} 100`,
      width: 400,
      title: 'Baserate',
      defs: e.defs,
      body: `<g>${e.body}</g>${wordmarkPath(w, wordFill, 100 + gap, top - w.capTop * k, k)}`,
    })
  }
  const gap = 25
  const width = Math.max(100, wordW)
  const height = 100 + gap + w.height * k
  return svgDoc({
    viewBox: `0 0 ${fmt(width)} ${fmt(height)}`,
    width: 280,
    title: 'Baserate',
    defs: e.defs,
    body:
      `<g transform="translate(${fmt((width - 100) / 2)} 0)">${e.body}</g>` +
      wordmarkPath(w, wordFill, (width - wordW) / 2, 100 + gap - w.capTop * k, k),
  })
}

/**
 * The favicon's step on a 16-pixel grid ([x, y, width, height] in pixels): the small mark's proportions with every
 * edge on a whole pixel, so it is crisp at 16 px and at 32 and 48. Lower flat on rows 7–8, a one-pixel stair, upper
 * flat on rows 4–5, a one-pixel gap, the base on rows 10–11.
 */
const FAVICON_STEP = [
  [3, 7, 4, 2],
  [7, 6, 1, 2],
  [8, 5, 1, 2],
  [9, 4, 4, 2],
  [3, 10, 10, 2],
]

/**
 * The favicon, a 16 × 16 master: a mint disc with the step cut in Note. Its outer pixel is a rim that matches the
 * disc on light chrome and turns Guilloche on dark chrome; the PNGs are rendered with the dark rim, which holds on
 * both.
 */
function faviconSvg() {
  const step = FAVICON_STEP.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}Z`).join('')
  return svgDoc({
    viewBox: '0 0 16 16',
    width: 32,
    title: 'Baserate',
    style: `@media (prefers-color-scheme:dark){.rim{fill:${P.guilloche}}}`,
    body:
      `<circle class="rim" cx="8" cy="8" r="8" fill="${P.mint}"/>` +
      `<circle cx="8" cy="8" r="7" fill="${P.mint}"/><path fill="${P.note}" d="${step}"/>`,
  })
}

/** App icon master (the PNG icons and apple-touch-icon): Intaglio tile, the mark inside the maskable safe zone. */
function iconSvg() {
  const e = emblem('medium', { colors: ON_INTAGLIO, id: 'i' })
  return svgDoc({
    viewBox: '0 0 100 100',
    width: 512,
    title: 'Baserate',
    defs: e.defs,
    body:
      `<rect width="100" height="100" fill="${P.intaglio}"/>` +
      `<g transform="translate(15 15) scale(0.7)">${e.body}</g>`,
  })
}

/** The woven band, which tiles horizontally: Guilloche lines for ink (band.svg), Mint for paper (band-on-note.svg). */
function bandSvg(color, title) {
  const k = PRESETS.band
  const d = band(k.width, k.height - 4, k.waves, k.lines, {
    y: 2,
    braid: k.braid,
    swell: k.swell,
    precision: 1,
  })
  return svgDoc({
    viewBox: `0 0 ${k.width} ${k.height}`,
    width: k.width,
    title,
    body: `<path fill="none" stroke="${color}" stroke-width="${k.stroke}" d="${d}"/>`,
  })
}

/** The paper fibre tile, single-quoted so it can sit in a CSS url("data:…"). */
function grainSvg() {
  const { tile, fibres: ink, security } = PRESETS.grain
  const layer = (spec, color) =>
    `<g fill='none' stroke='${color}' stroke-opacity='${spec.opacity}' stroke-linecap='round'>` +
    fibres(tile, spec)
      .map((f) => `<path stroke-width='${f.width}' d='${f.d}'/>`)
      .join('') +
    '</g>'
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}' viewBox='0 0 ${tile} ${tile}'>` +
    `${layer(ink, P.intaglio)}${layer(security, P.mint)}</svg>`
  )
}

/** Writes the grain tile into tokens.css as the --grain data URI, so the app needs no extra request for it. */
function writeGrainToken(svg) {
  const css = readFileSync(tokensCss, 'utf8')
  const declaration = /--grain: url\("data:image\/svg\+xml,[^"]*"\);/g
  const found = css.match(declaration)?.length ?? 0
  if (found !== 1) throw new Error(`tokens.css: expected one --grain data URI, found ${found}`)
  const data = svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
  writeFileSync(tokensCss, css.replace(declaration, `--grain: url("data:image/svg+xml,${data}");`))
}

// -------------------------------------------------------------------------------------------------
// The coin
// -------------------------------------------------------------------------------------------------

/** An outline (command arrays, em units, y down) as closed polylines, mapped by x' = s·x + ox, y' = s·y + oy. */
function polylines(commands, s, ox, oy, steps = 24) {
  const polys = []
  let poly = []
  let x = 0
  let y = 0
  const at = (px, py) => [ox + s * px, oy + s * py]
  for (const [op, ...v] of commands) {
    if (op === 'M') {
      poly = [at(v[0], v[1])]
      polys.push(poly)
      ;[x, y] = v
    } else if (op === 'L') {
      poly.push(at(v[0], v[1]))
      ;[x, y] = v
    } else if (op === 'Q' || op === 'C') {
      const pts = op === 'Q' ? [x, y, v[0], v[1], v[2], v[3]] : [x, y, ...v]
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        const w =
          op === 'Q' ? [u * u, 2 * u * t, t * t] : [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3]
        let px = 0
        let py = 0
        w.forEach((wk, k) => {
          px += wk * pts[2 * k]
          py += wk * pts[2 * k + 1]
        })
        poly.push(at(px, py))
      }
      ;[x, y] = pts.slice(-2)
    }
  }
  return polys
}

/**
 * Where a line runs inside a filled outline (nonzero winding), as sorted [from, to] spans: along x for the
 * horizontal line y = c, or along y for the vertical line x = c.
 */
function spans(polys, c, along = 'x') {
  const [fixed, free] = along === 'x' ? [1, 0] : [0, 1]
  const hits = []
  for (const poly of polys) {
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]
      if ((p[fixed] <= c && q[fixed] > c) || (q[fixed] <= c && p[fixed] > c)) {
        const t = (c - p[fixed]) / (q[fixed] - p[fixed])
        hits.push({ at: p[free] + t * (q[free] - p[free]), turn: q[fixed] > p[fixed] ? 1 : -1 })
      }
    })
  }
  hits.sort((a, b) => a.at - b.at)
  const result = []
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

const rect = (x0, y0, x1, y1) => `M${fmt(x0)} ${fmt(y0)}H${fmt(x1)}V${fmt(y1)}H${fmt(x0)}Z`

/**
 * The bitcoin sign: Bodoni Moda's capital B (text optical size, bold, so its hairlines survive) with two bars through
 * its head and foot. Each bar ends inside the hairline it crosses, never in a counter. Returns the sign and its cut:
 * the sign's silhouette with the counters filled and the waist bridged, plus a tab behind each pair of bars, for the
 * keyline that cuts the engraving back around the sign.
 */
function bitcoinSign(cx, cy, capHeight) {
  const b = outlines.bitcoinB
  const s = capHeight / b.capHeight
  const [x0, , x1] = b.bounds
  const ox = cx - ((x0 + x1) / 2) * s
  const oy = cy + (b.capHeight / 2) * s
  const top = oy - b.capHeight * s
  const polys = polylines(b.commands, s, ox, oy)
  const [stemL, stemR] = b.stem
  const stem = stemR - stemL
  const barW = stem * 0.44 * s
  const reach = b.capHeight * 0.15 * s
  const deepest = b.capHeight * 0.05 * s
  const lefts = [stemL + stem * 0.55, stemL + stem * 2.15].map((mid) => ox + mid * s - barW / 2)

  const bars = lefts.flatMap((left) => {
    // The solid runs at the top and the foot, sampled across the bar: end between their outer and inner edges.
    const runs = range(9).map((i) => spans(polys, left + (barW * i) / 8, 'y'))
    const outerTop = Math.max(...runs.map((r) => r[0][0]))
    const innerTop = Math.min(...runs.map((r) => r[0][1]))
    const innerFoot = Math.max(...runs.map((r) => r.at(-1)[0]))
    const outerFoot = Math.min(...runs.map((r) => r.at(-1)[1]))
    if (!(outerTop < innerTop && innerFoot < outerFoot)) {
      throw new Error('bitcoin sign: a bar does not land in a hairline')
    }
    const endTop = Math.min((outerTop + innerTop) / 2, outerTop + deepest)
    const endFoot = Math.max((innerFoot + outerFoot) / 2, outerFoot - deepest)
    return [
      rect(left, top - reach, left + barW, endTop),
      rect(left, endFoot, left + barW, oy + reach),
    ]
  })

  // The silhouette: each scanline from the leftmost to the rightmost ink, then a closing along y (grow, then shrink)
  // that fills the notch at the waist and keeps the bowls round.
  const rows = range(241)
    .map((i) => top + 1e-6 + ((oy - top - 2e-6) * i) / 240)
    .map((y) => ({ y, run: spans(polys, y) }))
    .filter(({ run }) => run.length)
    .map(({ y, run }) => ({ y, l: run[0][0], r: run.at(-1)[1] }))
  const span = capHeight * PRESETS.coin.centre.keyline
  const near = (list, y) => list.filter((row) => Math.abs(row.y - y) <= span)
  const grown = rows.map(({ y }) => {
    const n = near(rows, y)
    return { y, l: Math.min(...n.map((o) => o.l)), r: Math.max(...n.map((o) => o.r)) }
  })
  const closed = rows.map(({ y }) => {
    const n = near(grown, y)
    return { y, l: Math.max(...n.map((o) => o.l)), r: Math.min(...n.map((o) => o.r)) }
  })
  const edge = [...closed.map((o) => [o.l, o.y]), ...closed.reverse().map((o) => [o.r, o.y])]
  const silhouette = `M${edge.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`
  const right = lefts[1] + barW
  const tabs =
    rect(lefts[0], top - reach, right, top + 2) + rect(lefts[0], oy - 2, right, oy + reach)

  const glyph = glyphPath(b.commands, [s, 0, 0, s, ox, oy], 2)
  return { sign: glyph + bars.join(''), cut: silhouette + tabs }
}

/**
 * The coin, 1000 × 1000: reeded edge, numbered microprint, a fine braid, the rope, the woven rosette, and the amber
 * centre engraved with ink rules and struck with the bitcoin sign.
 */
function coinSvg() {
  const k = PRESETS.coin
  const c = k.size / 2
  const defs = []
  const body = []
  body.push(`<circle cx="${c}" cy="${c}" r="${c - 0.5}" fill="${P.intaglio}"/>`)
  body.push(
    `<path fill="none" stroke="${P.guilloche}" stroke-width="${k.reeding.width}" d="${reeding(c, c, k.reeding.r0, k.reeding.r1, k.reeding.count, 1)}"/>`,
  )
  body.push(
    `<g fill="none" stroke="${P.guilloche}">${k.rims.map((r) => `<path stroke-width="${r.width}" d="${circle(c, c, r.r, 1)}"/>`).join('')}</g>`,
  )

  // Microprint: each glyph defined once, centred on its advance, then placed around the ring with <use>.
  const mono = outlines.mono
  const micro = microtextRing(k.microtext.text, k.microtext.radius, {
    cx: c,
    cy: c,
    fontSize: k.microtext.fontSize,
    numbered: k.microtext.numbered,
    advance: mono.advance,
  })
  const glyphId = (ch) => `g${ch.codePointAt(0).toString(16)}`
  for (const ch of new Set(micro.text)) {
    if (!mono.glyphs[ch]) continue
    const f = micro.fontSize
    const m = [f, 0, 0, f, (-mono.advance / 2) * f, 0]
    defs.push(`<path id="${glyphId(ch)}" d="${glyphPath(mono.glyphs[ch], m, 2)}"/>`)
  }
  const letters = micro.chars
    .filter(({ char }) => mono.glyphs[char])
    .map(({ char, x, y, rotate }) => {
      const at = `translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(rotate)})`
      return `<use xlink:href="#${glyphId(char)}" transform="${at}"/>`
    })
  body.push(`<g fill="${P.note}">${letters.join('')}</g>`)

  // The braid and the rope (each one line, repeated), then the woven rosette.
  for (const [id, spec, color] of [
    ['braid', k.braid, P.guilloche],
    ['rope', k.rope, P.note],
  ]) {
    const line = ring(spec.radius, spec.amplitude, spec.waves, 1, { cx: c, cy: c, precision: 1 })
    defs.push(`<path id="${id}" d="${line}"/>`)
    body.push(
      `<g fill="none" stroke="${color}" stroke-width="${spec.width}">${repeated(id, spec.lines, ringStep(spec.waves, spec.lines), c, c)}</g>`,
    )
  }
  const ros = k.rosette
  const petals = rosette(ros.r, ros.petals, 0, ros.lines, {
    cx: c,
    cy: c,
    inner: ros.inner,
    twist: ros.twist,
    weave: ros.weave,
    segments: ros.segments,
    precision: 1,
  })
  body.push(`<path fill="none" stroke="${P.guilloche}" stroke-width="${ros.width}" d="${petals}"/>`)

  // The centre: amber underprint, concentric ink rules struck over it, the keyline cut back to clean amber around the
  // sign (an amber fill and stroke over the rules, so the counters stay clean), then the sign in ink.
  const { centre } = k
  const { first, pitch, width } = centre.rules
  const rules = range(Math.floor((centre.r - width / 2 - first) / pitch) + 1)
    .map((i) => circle(c, c, first + i * pitch, 1))
    .join('')
  const sign = bitcoinSign(c, c, centre.capHeight)
  body.push(`<circle cx="${c}" cy="${c}" r="${centre.r}" fill="${P.amber}"/>`)
  body.push(`<path fill="none" stroke="${P.intaglio}" stroke-width="${width}" d="${rules}"/>`)
  body.push(
    `<path fill="${P.amber}" stroke="${P.amber}" stroke-width="${fmt(centre.capHeight * centre.keyline)}" ` +
      `stroke-linejoin="round" d="${sign.cut}"/>`,
  )
  body.push(`<path fill="${P.intaglio}" d="${sign.sign}"/>`)

  return svgDoc({
    viewBox: `0 0 ${k.size} ${k.size}`,
    width: 512,
    title: 'Baserate coin: bitcoin at the base rate',
    defs: defs.join(''),
    body: body.join(''),
  })
}

function write(name, content) {
  writeFileSync(join(out, name), content)
  return name
}

// -------------------------------------------------------------------------------------------------
// Screenshots
// -------------------------------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
  '.json': 'application/json',
}

/** A read-only static server for apps/web on 127.0.0.1 (pnpm's node_modules symlinks are followed). */
async function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    const file = normalize(join(root, path))
    if (req.method !== 'GET' || !file.startsWith(root + sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

/** Opens a template at an exact size, waits for its images and fonts, and fails on any error or stray request. */
async function open(browser, origin, path, { width, height, fonts = [], colorScheme = 'light' }) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme,
  })
  const problems = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`))
  page.on('response', (response) => {
    if (!response.ok()) problems.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  await page.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  )
  await page.goto(`${origin}/${path}`, { waitUntil: 'load' })
  const missing = await page.evaluate(async (families) => {
    await Promise.all([...document.images].map((img) => img.decode()))
    await document.fonts.ready
    const failed = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family)
    return [...failed, ...families.filter((f) => !document.fonts.check(f))]
  }, fonts)
  if (missing.length) problems.push(`fonts did not load: ${missing.join(', ')}`)
  if (problems.length) throw new Error(`${path}:\n  ${problems.join('\n  ')}`)
  return page
}

async function shoot(browser, origin, path, name, options) {
  const page = await open(browser, origin, path, options)
  const file = join(out, name)
  const { width, height, transparent = false } = options
  await page.screenshot({
    path: file,
    omitBackground: transparent,
    clip: { x: 0, y: 0, width, height },
  })
  await page.close()
  return relative(web, file)
}

/** The coin as WebP, encoded by the browser from the SVG (Chromium screenshots only write PNG and JPEG). */
async function coinWebp(browser, origin, size) {
  const page = await open(browser, origin, 'scripts/brand/asset.html?src=coin.svg', {
    width: size,
    height: size,
  })
  const dataUrl = await page.evaluate((px) => {
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = px
    canvas.getContext('2d').drawImage(document.querySelector('img'), 0, 0, px, px)
    return canvas.toDataURL('image/webp', 0.86)
  }, size)
  await page.close()
  if (!dataUrl.startsWith('data:image/webp')) throw new Error('this Chromium cannot encode WebP')
  const file = join(out, 'coin.webp')
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return relative(web, file)
}

const TYPE_CHECK = [
  '64px "Bodoni Moda Variable"',
  'italic 64px "Bodoni Moda Variable"',
  '500 16px "IBM Plex Mono"',
  '500 16px "Public Sans Variable"',
]

async function main() {
  mkdirSync(out, { recursive: true })
  const grain = grainSvg()
  const written = [
    write('mark.svg', markSvg('fine', { colors: ON_NOTE })),
    write('mark-reverse.svg', markSvg('fine', { colors: ON_INTAGLIO })),
    write('mark-mono-ink.svg', markSvg('fine', { mono: P.intaglio })),
    write('mark-mono-paper.svg', markSvg('fine', { mono: P.note })),
    write('wordmark.svg', wordmarkSvg(P.intaglio, { engraved: true })),
    write('wordmark-reverse.svg', wordmarkSvg(P.note, { engraved: true })),
    write('wordmark-solid.svg', wordmarkSvg(P.intaglio, { engraved: false })),
    write('wordmark-solid-reverse.svg', wordmarkSvg(P.note, { engraved: false })),
    write('lockup-horizontal.svg', lockupSvg('horizontal', ON_NOTE, P.intaglio)),
    write('lockup-horizontal-reverse.svg', lockupSvg('horizontal', ON_INTAGLIO, P.note)),
    write('lockup-stacked.svg', lockupSvg('stacked', ON_NOTE, P.intaglio)),
    write('lockup-stacked-reverse.svg', lockupSvg('stacked', ON_INTAGLIO, P.note)),
    write('favicon.svg', faviconSvg()),
    write('icon.svg', iconSvg()),
    write('band.svg', bandSvg(P.guilloche, 'Guilloche band')),
    write('band-on-note.svg', bandSvg(P.mint, 'Guilloche band, on paper')),
    write('grain.svg', `${grain}\n`),
    write('coin.svg', coinSvg()),
  ]
  copyFileSync(join(out, 'favicon.svg'), join(web, 'public', 'favicon.svg'))
  writeGrainToken(grain)
  console.log(`svg: ${written.join(', ')} (+ public/favicon.svg, --grain in src/brand/tokens.css)`)

  const root = await realpath(web)
  const { server, origin } = await serve(root)
  const browser = await chromium.launch()
  try {
    const shots = [
      await shoot(browser, origin, 'scripts/brand/og.html', 'og.png', {
        width: 1200,
        height: 630,
        fonts: TYPE_CHECK,
      }),
      await shoot(browser, origin, 'scripts/brand/x-header.html', 'x-header.png', {
        width: 1500,
        height: 500,
        fonts: TYPE_CHECK,
      }),
    ]
    for (const [name, src, size] of [
      ['icon-512.png', 'icon.svg', 512],
      ['icon-192.png', 'icon.svg', 192],
      ['apple-touch-icon.png', 'icon.svg', 180],
    ]) {
      const path = `scripts/brand/asset.html?src=${src}`
      shots.push(await shoot(browser, origin, path, name, { width: size, height: size }))
    }
    // The favicon PNGs take the dark-chrome rim (Guilloche), which also holds on light chrome.
    for (const size of [16, 32]) {
      const path = 'scripts/brand/asset.html?src=favicon.svg'
      shots.push(
        await shoot(browser, origin, path, `favicon-${size}.png`, {
          width: size,
          height: size,
          transparent: true,
          colorScheme: 'dark',
        }),
      )
    }
    const coin = 'scripts/brand/asset.html?src=coin.svg'
    shots.push(
      await shoot(browser, origin, coin, 'coin.png', {
        width: 1024,
        height: 1024,
        transparent: true,
      }),
    )
    shots.push(await coinWebp(browser, origin, 1024))
    console.log(`raster: ${shots.join(', ')}`)
  } finally {
    await browser.close()
    server.close()
  }
}

await main()
