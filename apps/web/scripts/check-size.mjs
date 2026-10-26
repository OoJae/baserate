#!/usr/bin/env node
// Size budgets for the web bundle (docs: the Intaglio landing plan, section 11). Fails (exit 1) when a budget or a
// package rule is broken. Reads the report vite.config.ts writes next to the build:
//
//   node apps/web/scripts/check-size.mjs [distDir]      (default apps/web/dist; run after `vite build`)
//
// Sizes are gzip bytes at zlib's default level (what Vite prints), 1 KB = 1000 bytes. Fonts are woff2 (already
// compressed), so they count as bytes. "Initial" means what an HTML shell loads before any lazy import: its module
// scripts, their static imports, its stylesheets and its font preloads.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const dist = resolve(process.argv[2] ?? join(webRoot, 'dist'))
const reportFile = join(dist, '.bundle-report.json')

const KB = 1000

// The app (app.html's entry, the app layout and /borrow) must not outgrow the single-bundle app it replaced.
// Recorded 26 Oct 2026 before the entry split: one 1,391,249-byte entry (index + 2 preloads), 391,940 bytes gzip.
const BORROW_BASELINE_GZIP = 391_940

const BUDGETS = {
  landingJs: 140 * KB,
  initialCss: 20 * KB,
  preloadedFonts: 75 * KB,
  appBorrowJs: BORROW_BASELINE_GZIP,
}

/** Lazy site chunks, found by the module they are built from; each budget is what loading it adds to the landing. */
const LAZY = [
  {
    name: 'motion (Lenis + ScrollTrigger + scenes)',
    facade: /src\/site\/motion\/motion\.tsx?$/,
    max: 60 * KB,
  },
  { name: 'WebGL stage (three.js)', facade: /src\/site\/webgl\/stage\.tsx?$/, max: 160 * KB },
  { name: 'live reads (viem client)', facade: /src\/site\/data\/reads\.tsx?$/, max: 55 * KB },
]

/** Never in the landing's initial JS: the wallet stack, viem, the SDK's ABIs, and the motion and WebGL libraries. */
const LANDING_FORBIDDEN = [
  /^npm:three$/,
  /^npm:gsap$/,
  /^npm:lenis$/,
  /^npm:wagmi$/,
  /^npm:@wagmi\//,
  /^npm:@rainbow-me\//,
  /^npm:@walletconnect\//,
  /^npm:@metamask\//,
  /^npm:@reown\//,
  /^npm:viem$/,
  /^packages\/sdk\/src\/(abis|generated)\.ts$/,
]

/** The app never loads the landing's motion and WebGL libraries. */
const APP_FORBIDDEN = [/^npm:three$/, /^npm:gsap$/, /^npm:lenis$/]

if (!existsSync(reportFile)) {
  console.error(
    `check-size: ${reportFile} does not exist. Build first (pnpm --filter web build); vite.config.ts writes it.`,
  )
  process.exit(2)
}

const report = JSON.parse(readFileSync(reportFile, 'utf8'))
const chunkByFile = new Map(report.chunks.map((c) => [c.file, c]))
const assetByFile = new Map(report.assets.map((a) => [a.file, a]))
const strip = (url) => url.replace(/^\//, '')

/** The chunk files a set of chunks loads statically (themselves included). */
function closure(files) {
  const seen = new Set()
  const queue = [...files]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    for (const dep of chunkByFile.get(file)?.imports ?? []) queue.push(dep)
  }
  return seen
}

const gzipOf = (files) => [...files].reduce((sum, f) => sum + (chunkByFile.get(f)?.gzip ?? 0), 0)

function modulesOf(files) {
  const modules = new Map()
  for (const f of files)
    for (const [key, size] of Object.entries(chunkByFile.get(f)?.modules ?? {}))
      modules.set(key, (modules.get(key) ?? 0) + size)
  return modules
}

function chunkFor(facade) {
  return report.chunks.find((c) => c.facade && facade.test(c.facade))
}

function initialOf(htmlFile) {
  const html = report.html[htmlFile]
  if (!html) return null
  const js = closure(
    [...html.scripts, ...html.modulepreload].map(strip).filter((f) => f.endsWith('.js')),
  )
  const css = html.stylesheets.map(strip)
  const fonts = html.fontPreloads.map(strip)
  return { js, css, fonts }
}

const rows = []
const failures = []

function check(name, actual, max, detail) {
  const ok = actual <= max
  rows.push({ name, actual, max, ok, detail })
  if (!ok) failures.push(name)
}

function forbid(name, files, rules) {
  const hits = [...modulesOf(files).keys()].filter((key) => rules.some((re) => re.test(key)))
  rows.push({ name, ok: hits.length === 0, detail: hits.length ? hits.join(', ') : 'none' })
  if (hits.length) failures.push(name)
}

const site = initialOf('index.html')
const app = initialOf('app.html') ?? site
if (!site) {
  console.error('check-size: the report has no index.html entry. Is this a Vite build of apps/web?')
  process.exit(2)
}

// Landing (index.html).
check(
  'Landing JS (index.html initial)',
  gzipOf(site.js),
  BUDGETS.landingJs,
  `${site.js.size} chunks`,
)
check(
  'Initial CSS (index.html)',
  site.css.reduce((sum, f) => sum + (assetByFile.get(f)?.gzip ?? 0), 0),
  BUDGETS.initialCss,
  site.css.join(', '),
)
check(
  'Preloaded fonts (index.html, bytes)',
  site.fonts.reduce((sum, f) => sum + (assetByFile.get(f)?.bytes ?? 0), 0),
  BUDGETS.preloadedFonts,
  `${site.fonts.length} files`,
)
forbid(
  'Landing JS holds no wallet, viem, SDK ABIs, three, gsap or lenis',
  site.js,
  LANDING_FORBIDDEN,
)

// Lazy site chunks: what each adds on top of the landing.
for (const lazy of LAZY) {
  const chunk = chunkFor(lazy.facade)
  if (!chunk) {
    rows.push({ name: `Lazy: ${lazy.name}`, ok: true, detail: 'not built yet (skipped)' })
    continue
  }
  const extra = new Set([...closure([chunk.file])].filter((f) => !site.js.has(f)))
  check(`Lazy: ${lazy.name}`, gzipOf(extra), lazy.max, chunk.file)
}

// The app: app.html's entry + the app layout + /borrow.
const appLayout = chunkFor(/src\/app\/AppLayout\.tsx$/)
const borrowPage = chunkFor(/src\/pages\/BorrowPage\.tsx$/)
if (!appLayout || !borrowPage) {
  rows.push({ name: 'App: /borrow', ok: false, detail: 'AppLayout or BorrowPage chunk not found' })
  failures.push('App: /borrow')
} else {
  const borrow = closure([...app.js, appLayout.file, borrowPage.file])
  check(
    'App JS: entry + app layout + /borrow',
    gzipOf(borrow),
    BUDGETS.appBorrowJs,
    `${borrow.size} chunks; baseline ${BORROW_BASELINE_GZIP} B`,
  )
  forbid('/borrow loads no three, gsap or lenis', borrow, APP_FORBIDDEN)
}

const kb = (n) => `${(n / KB).toFixed(1)} KB`
for (const r of rows) {
  const mark = r.ok ? 'ok  ' : 'FAIL'
  const size =
    r.actual === undefined ? '' : `${kb(r.actual).padStart(9)} / ${kb(r.max).padStart(9)}`
  console.log(`${mark} ${r.name.padEnd(62)} ${size.padEnd(21)} ${r.detail ?? ''}`)
}

if (failures.length) {
  console.error(`\ncheck-size: ${failures.length} budget(s) broken.`)
  // Show what fills the landing entry when it is the one over budget, largest first.
  if (failures.some((f) => f.startsWith('Landing'))) {
    const top = [...modulesOf(site.js).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    console.error('Largest modules in the landing JS (rendered bytes, before minification):')
    for (const [key, size] of top) console.error(`  ${String(size).padStart(8)}  ${key}`)
  }
  process.exit(1)
}
console.log('\ncheck-size: OK')
