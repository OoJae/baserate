#!/usr/bin/env node
// The security ledger as data for the /security page: docs/audit/FINDINGS.md → src/site/content/findings.gen.json.
//
//   node apps/web/scripts/gen-findings.mjs            write the JSON (then formats it with Biome when available)
//   node apps/web/scripts/gen-findings.mjs --check    exit 1 if the JSON is missing or out of date (for CI)
//
// The page imports the JSON, so the ledger is baked into the build: the site never fetches the repository at runtime.
// Every finding, round, table and paragraph comes from FINDINGS.md; nothing is typed here. Inline markdown becomes
// tokens ({ t: 'text' | 'code' | 'strong' | 'link' }), relative links become GitHub links, and any full 0x + 64-hex
// value (a transaction hash) is shortened and unlinked so scripts/check-bundle.mjs stays green.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const repoRoot = resolve(webRoot, '..', '..')
const SOURCE = 'docs/audit/FINDINGS.md'
const OUT = join(webRoot, 'src', 'site', 'content', 'findings.gen.json')
const REPO_BLOB = 'https://github.com/OoJae/baserate/blob/main'

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info']
const STATES = [
  // [prefix in the Status column, state]; the longest prefix first. Anything else is 'other', labelled with its
  // own leading words, so a new kind of status never breaks the build (the page shows it as written).
  ['Fixed and deployed', 'deployed'],
  ['Deployed', 'deployed'],
  ['Mitigated', 'mitigated'],
  ['Known limitation', 'known'],
  ['Documented', 'documented'],
  ['Open', 'open'],
  ['Fixed', 'fixed'],
]
const STATE_ORDER = ['deployed', 'fixed', 'mitigated', 'known', 'documented', 'open', 'other']
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const HEX64 = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g
const hasHex64 = (text) => /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(text)

function fail(message) {
  console.error(`gen-findings: ${message}`)
  process.exit(2)
}

/** Shortens any full 32-byte hex value (a tx hash) to its first 8 digits. */
function scrub(text) {
  return text.replace(HEX64, (m) => `${m.slice(0, 10)}…`)
}

/** A link target as an absolute URL: repository paths resolve against the ledger's folder, onto GitHub. */
function resolveHref(href) {
  if (/^https?:\/\//.test(href)) return href
  const [path, hash] = href.split('#')
  const target = posix.normalize(posix.join(posix.dirname(SOURCE), path ?? ''))
  return `${REPO_BLOB}/${target}${hash ? `#${hash}` : ''}`
}

/** Inline markdown → tokens: `code`, **strong**, [text](href) and plain text. */
function inline(source) {
  const out = []
  const push = (token) => {
    if (!token.v) return
    const last = out.at(-1)
    if (token.t === 'text' && last?.t === 'text') last.v += token.v
    else out.push(token)
  }
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (const m of source.matchAll(re)) {
    push({ t: 'text', v: scrub(source.slice(last, m.index)) })
    if (m[1] !== undefined) push({ t: 'code', v: scrub(m[1]) })
    else if (m[2] !== undefined) push({ t: 'strong', v: scrub(m[2]) })
    else if (m[3] !== undefined && m[4] !== undefined) {
      // A link whose target carries a full hash is kept as text: the hash never reaches the bundle.
      if (hasHex64(m[4])) push({ t: 'text', v: scrub(m[3]) })
      else push({ t: 'link', v: scrub(m[3]), href: resolveHref(m[4]) })
    }
    last = (m.index ?? 0) + m[0].length
  }
  push({ t: 'text', v: scrub(source.slice(last)) })
  return out
}

/** The plain text of a token list. */
function plain(tokens) {
  return tokens.map((t) => t.v).join('')
}

/** Splits markdown into blocks: headings, paragraphs, tables (rows of cells) and lists (items). */
function blocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        const raw = (lines[i] ?? '').trim()
        i++
        if (/^\|[\s:|-]+\|$/.test(raw)) continue // the |---| separator
        rows.push(
          raw
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim()),
        )
      }
      const [header, ...body] = rows
      out.push({ kind: 'table', header: header ?? [], rows: body })
      continue
    }
    if (/^\s*- /.test(line)) {
      const items = []
      while (i < lines.length && /^\s*- /.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*- /, '').trim())
        i++
      }
      out.push({ kind: 'list', items })
      continue
    }
    const para = []
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|\||\s*- )/.test(lines[i] ?? '')
    ) {
      para.push((lines[i] ?? '').trim())
      i++
    }
    out.push({ kind: 'paragraph', text: para.join(' ') })
  }
  return out
}

/** Sections by level-2 heading, each with its blocks (level-3 headings stay inside, as blocks). */
function sections(all) {
  const out = []
  let current = { title: '', blocks: [] }
  for (const block of all) {
    if (block.kind === 'heading' && block.level <= 2) {
      if (current.title || current.blocks.length) out.push(current)
      current = { title: block.text, level: block.level, blocks: [] }
    } else current.blocks.push(block)
  }
  out.push(current)
  return out
}

const headerIs = (table, ...names) =>
  names.every((name, k) => (table.header[k] ?? '').toLowerCase().startsWith(name.toLowerCase()))

function severityOf(label) {
  const found = SEVERITIES.filter((s) => new RegExp(`\\b${s}\\b`).test(label))
  if (!found.length) fail(`unknown severity "${label}"`)
  // "Info / Low" counts at its higher severity.
  const severity = found.sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0]
  const qualifier = /\(([^)]+)\)/.exec(label)?.[1] ?? null
  return { severity, qualifier }
}

function stateOf(statusTokens) {
  const text = plain(statusTokens)
  const known = STATES.find(([prefix]) => text.startsWith(prefix))
  const own = /^[^:;.,(]+/.exec(text)?.[0]?.trim() ?? text
  if (!known) console.warn(`gen-findings: unrecognised status "${own}", kept as written`)
  const [prefix, state] = known ?? [own, 'other']
  // The note: the status without its leading state words ("Deployed: deposits close…" → "Deposits close…").
  const note = statusTokens.map((t) => ({ ...t }))
  const first = note[0]
  if (first?.t === 'text') {
    first.v = first.v.slice(prefix.length).replace(/^[\s,:;.]+/, '')
    first.v = first.v.charAt(0).toUpperCase() + first.v.slice(1)
    if (!first.v) note.shift()
  }
  return { state, label: prefix, note }
}

function finding(cells) {
  const [id = '', severityCell = '', title = '', location = '', status = ''] = cells
  const statusTokens = inline(status)
  const { state, label, note } = stateOf(statusTokens)
  return {
    id: scrub(id),
    ids: scrub(id)
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean),
    ...severityOf(severityCell),
    severityLabel: severityCell,
    title: inline(title),
    location: inline(location),
    state,
    stateLabel: label,
    note,
  }
}

function isoDate(text) {
  const m = /(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})/.exec(text)
  if (!m?.[1] || !m[2] || !m[3]) return null
  const month = MONTHS.indexOf(m[2]) + 1
  if (!month) return null
  return {
    label: `${Number(m[1])} ${m[2]} ${m[3]}`,
    iso: `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
  }
}

function round(section) {
  const n = Number(/^Round\s+(\d+)/.exec(section.title)?.[1])
  const date = isoDate(section.title)
  if (!n || !date) fail(`cannot read the round heading "${section.title}"`)
  const r = {
    n,
    title: `Round ${n}`,
    date: date.label,
    dateIso: date.iso,
    reviewers: null,
    intro: [],
    limits: null,
    areas: [],
    findings: [],
    notes: null,
    sound: [],
    confirmed: [],
  }
  let afterFindings = false
  let pendingNote = null
  let inSound = false
  for (const block of section.blocks) {
    if (block.kind === 'heading') {
      inSound = /found sound/i.test(block.text)
      continue
    }
    if (block.kind === 'paragraph') {
      if (/^\*\*Mezo limits, measured\*\*/.test(block.text)) {
        r.limits = inline(block.text.replace(/^\*\*Mezo limits, measured\*\*\s*/, ''))
        continue
      }
      if (/:$/.test(block.text)) {
        pendingNote = block.text
        continue
      }
      if (afterFindings) r.confirmed.push(inline(block.text))
      else r.intro.push(inline(block.text))
      if (r.reviewers === null) {
        const word = /^(\w+)\s+(?:fresh\s+|independent\s+)?reviewers/i.exec(block.text)?.[1]
        if (word) r.reviewers = NUMBER_WORDS[word.toLowerCase()] ?? (Number(word) || null)
      }
      continue
    }
    if (block.kind === 'list') {
      r.notes = { intro: inline(pendingNote ?? ''), items: block.items.map(inline) }
      pendingNote = null
      continue
    }
    if (block.kind === 'table') {
      if (headerIs(block, 'ID', 'Severity')) {
        r.findings.push(...block.rows.map(finding))
        afterFindings = true
      } else if (headerIs(block, 'Area', 'Scope')) {
        r.areas = block.rows.map(([area = '', scope = '', poc = '']) => ({
          area: inline(area),
          scope: inline(scope),
          poc: inline(poc),
        }))
      } else if (inSound || headerIs(block, 'Area', 'Verified')) {
        r.sound = block.rows.map(([area = '', verified = '']) => ({
          area: inline(area),
          verified: inline(verified),
        }))
      } else fail(`unexpected table in ${section.title}: ${block.header.join(' | ')}`)
    }
  }
  if (!r.findings.length) fail(`${section.title} has no findings table`)
  return r
}

function staticAnalysis(section) {
  const intro = section.blocks.filter((b) => b.kind === 'paragraph').map((b) => inline(b.text))
  const table = section.blocks.find((b) => b.kind === 'table')
  if (!table) fail('the static analysis section has no triage table')
  const head = /^(\d[\d,]*)\s+results\s+across\s+(\d+)\s+detectors/.exec(plain(intro[0] ?? []))
  return {
    title: inline(section.title),
    tool: /^Static analysis:\s*([^(]+?)\s*\(/.exec(section.title)?.[1] ?? null,
    results: head?.[1] ? Number(head[1].replace(/,/g, '')) : null,
    detectors: head?.[2] ? Number(head[2]) : null,
    intro,
    rows: table.rows.map(([detector = '', verdict = '']) => {
      const tokens = inline(verdict)
      const lead = tokens[0]?.t === 'strong' ? tokens[0].v.replace(/\.$/, '') : null
      const rest = (lead ? tokens.slice(1) : tokens)
        .map((t, k) => (k === 0 && t.t === 'text' ? { ...t, v: t.v.replace(/^\s+/, '') } : t))
        .filter((t) => t.v)
      return { detector: inline(detector), verdict: lead, note: rest }
    }),
  }
}

function secretScanning(section) {
  const list = section.blocks.find((b) => b.kind === 'list')
  if (!list) fail('the secret scanning section has no list')
  return {
    title: inline(section.title),
    tool: /^Secret scanning:\s*(.+)$/.exec(section.title)?.[1] ?? null,
    items: list.items.map(inline),
  }
}

function build() {
  const file = join(repoRoot, SOURCE)
  if (!existsSync(file)) fail(`${SOURCE} not found`)
  const all = sections(blocks(readFileSync(file, 'utf8')))
  const top = all.find((s) => s.level === 1)
  const rounds = all.filter((s) => /^Round\s+\d+/.test(s.title)).map(round)
  const sa = all.find((s) => /^Static analysis/i.test(s.title))
  const ss = all.find((s) => /^Secret scanning/i.test(s.title))
  if (!rounds.length || !sa || !ss)
    fail('the ledger is missing rounds, static analysis or secret scanning')

  const findings = rounds.flatMap((r) => r.findings)
  const count = (key, values) =>
    Object.fromEntries(values.map((v) => [v, findings.filter((f) => f[key] === v).length]))
  const ids = findings.flatMap((f) => f.ids)
  const dup = ids.find((id, k) => ids.indexOf(id) !== k)
  if (dup) fail(`finding id ${dup} appears twice`)

  return {
    $comment: `Generated by apps/web/scripts/gen-findings.mjs from ${SOURCE}. Do not edit; run the script.`,
    source: SOURCE,
    title: top?.title ?? 'Security findings ledger',
    intro: (top?.blocks ?? []).filter((b) => b.kind === 'paragraph').map((b) => inline(b.text)),
    totals: {
      rounds: rounds.length,
      findings: findings.length,
      bySeverity: count('severity', SEVERITIES),
      byState: count('state', STATE_ORDER),
    },
    rounds: rounds.map((r) => ({
      ...r,
      counts: {
        findings: r.findings.length,
        bySeverity: Object.fromEntries(
          SEVERITIES.map((s) => [s, r.findings.filter((f) => f.severity === s).length]),
        ),
        byState: Object.fromEntries(
          STATE_ORDER.map((s) => [s, r.findings.filter((f) => f.state === s).length]),
        ),
      },
    })),
    staticAnalysis: staticAnalysis(sa),
    secretScanning: secretScanning(ss),
  }
}

const data = build()
const text = `${JSON.stringify(data, null, 2)}\n`
const rel = relative(repoRoot, OUT)

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`gen-findings: ${rel} is missing. Run node apps/web/scripts/gen-findings.mjs`)
    process.exit(1)
  }
  // Compare the data, not the text, so formatting the file (Biome) never fails the check.
  const current = JSON.stringify(JSON.parse(readFileSync(OUT, 'utf8')))
  if (current !== JSON.stringify(data)) {
    console.error(
      `gen-findings: ${rel} is out of date with ${SOURCE}. Run node apps/web/scripts/gen-findings.mjs`,
    )
    process.exit(1)
  }
  if (hasHex64(current)) {
    console.error(`gen-findings: ${rel} contains a full 0x + 64-hex value`)
    process.exit(1)
  }
  console.log(`gen-findings: ${rel} is up to date (${data.totals.findings} findings)`)
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  const biome = join(repoRoot, 'node_modules', '.bin', 'biome')
  if (existsSync(biome)) {
    try {
      execFileSync(biome, ['format', '--write', OUT], { cwd: repoRoot, stdio: 'ignore' })
    } catch {
      // Unformatted JSON is still valid; --check compares data, not text.
    }
  }
  const t = data.totals
  console.log(
    `gen-findings: wrote ${rel}: ${t.rounds} rounds, ${t.findings} findings (${SEVERITIES.map((s) => `${t.bySeverity[s]} ${s}`).join(', ')}; ${t.byState.open} open)`,
  )
}
