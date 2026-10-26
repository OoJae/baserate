#!/usr/bin/env node
// WCAG 2.2 contrast of the brand's colour pairs, from src/brand/tokens.json. Prints the Markdown table that
// docs/brand/BRAND.md carries and exits 1 if any pair misses its bar (4.5:1 for text, 3:1 for large text and for
// graphics and control borders).
//
//   node apps/web/scripts/brand/contrast.mjs

import tokens from '../../src/brand/tokens.json' with { type: 'json' }

const hex = Object.fromEntries(
  [...Object.entries(tokens.color.palette), ...Object.entries(tokens.color.support)].map(
    ([k, v]) => [k, v.hex],
  ),
)

function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(color.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
const LARGE = 3
const GRAPHIC = 3

// [foreground, background, use, bar]
const PAIRS = [
  ['intaglio', 'note', 'Body text on paper', TEXT],
  ['intaglio', 'noteRaised', 'Body text on raised paper', TEXT],
  ['intaglio', 'noteSunken', 'Text in inputs on paper', TEXT],
  ['inkMuted', 'note', 'Secondary text on paper', TEXT],
  ['inkFaint', 'note', 'Captions on paper', TEXT],
  ['inkFaint', 'noteSunken', 'Placeholders in inputs on paper', TEXT],
  ['mint', 'note', 'Links and brand text on paper', TEXT],
  ['note', 'mint', 'Labels on mint buttons and the emblem cut', TEXT],
  ['amberInk', 'note', 'BTC figures on paper, 24 px and up', LARGE],
  ['amberInk', 'noteRaised', 'BTC text on raised paper, any size', TEXT],
  ['amberInkStrong', 'note', 'BTC text on paper below 24 px', TEXT],
  ['seal', 'note', 'Liquidation text on paper', TEXT],
  ['note', 'seal', 'The seal stamp: paper on Seal Red', TEXT],
  ['ruleStrong', 'note', 'Control borders on paper', GRAPHIC],
  ['note', 'intaglio', 'Body text on ink', TEXT],
  ['note', 'intaglioRaised', 'Body text on raised ink', TEXT],
  ['paperMuted', 'intaglio', 'Secondary text on ink', TEXT],
  ['paperMuted', 'intaglioRaised', 'Secondary text on raised ink', TEXT],
  ['paperFaint', 'intaglio', 'Captions on ink', TEXT],
  ['paperFaint', 'intaglioRaised', 'Captions on raised ink', TEXT],
  ['amber', 'intaglio', 'BTC text on ink', TEXT],
  ['sealOnIntaglio', 'intaglio', 'Liquidation text on ink', TEXT],
  ['seal', 'intaglio', 'Seal Red fills and large type on ink', LARGE],
  ['guilloche', 'intaglio', 'Engraved line work on ink (never text)', GRAPHIC],
  ['mint', 'intaglio', 'Mint plates and buttons on ink', GRAPHIC],
  ['ruleStrong', 'intaglio', 'Control borders on ink', GRAPHIC],
  ['intaglio', 'amber', 'The bitcoin sign on the amber centre', TEXT],
]

const rows = PAIRS.map(([fg, bg, use, bar]) => {
  const value = ratio(hex[fg], hex[bg])
  return { fg, bg, use, bar, value, ok: value >= bar }
})

const label = (k) => `${k} \`${hex[k]}\``
console.log('| Foreground | Background | Ratio | Bar | Use |')
console.log('| --- | --- | ---: | ---: | --- |')
for (const r of rows) {
  const mark = r.ok ? '' : ' **fails**'
  console.log(
    `| ${label(r.fg)} | ${label(r.bg)} | ${r.value.toFixed(2)}:1${mark} | ${r.bar}:1 | ${r.use} |`,
  )
}

const failed = rows.filter((r) => !r.ok)
if (failed.length) {
  console.error(`\n${failed.length} pair(s) under their bar.`)
  process.exit(1)
}
