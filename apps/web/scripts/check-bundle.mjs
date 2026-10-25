#!/usr/bin/env node
// Fails (exit 1) if the built web bundle contains anything that looks like a secret.
//
//   node apps/web/scripts/check-bundle.mjs [distDir]
//
// Checks every text file under apps/web/dist for:
//   - 0x + 64 hex (private-key shaped), unless allowlisted: bundle-allowlist.txt, bytes32 values in
//     packages/sdk/src/deployments/*.json (feed ids, market ids, deploy txs) and tx hashes in src/evidence.json
//   - PEM blocks, PRIVATE_KEY / SECRET_KEY assignments
//   - Telegram bot tokens, Discord bot tokens, Turnstile secrets (0x4AAAAAAA + 25 chars)
//   - GitHub tokens (ghp_ / gho_ / ghs_ / ghu_ / ghr_ / github_pat_), sk_ / sk- API keys, AWS access keys
// Never prints a full match: findings are redacted.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const repoRoot = resolve(webRoot, '..', '..')
const dist = resolve(process.argv[2] ?? join(webRoot, 'dist'))

const TEXT_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.txt',
  '.map',
  '.svg',
  '.webmanifest',
  '.xml',
])

const RULES = [
  { id: 'hex-64', re: /(?<![0-9a-fA-F])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, allowlisted: true },
  { id: 'pem-block', re: /-----BEGIN [A-Z0-9 ]*-----/g },
  { id: 'private-key-name', re: /PRIVATE_KEY/g },
  {
    id: 'secret-key-assignment',
    re: /\b[A-Z0-9_]*SECRET[A-Z0-9_]*\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/g,
  },
  { id: 'telegram-bot-token', re: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/g },
  {
    id: 'discord-bot-token',
    re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g,
  },
  { id: 'turnstile-secret', re: /0x4AAAAAAA[0-9A-Za-z_-]{25,}/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'sk-api-key', re: /\bsk[_-](?:live_|test_|proj-|ant-)?[A-Za-z0-9_-]{24,}\b/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (TEXT_EXT.has(extname(name).toLowerCase())) out.push(p)
  }
  return out
}

function collectBytes32(value, into) {
  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) into.add(value.toLowerCase())
  } else if (Array.isArray(value)) {
    for (const v of value) collectBytes32(v, into)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectBytes32(v, into)
  }
}

function loadAllowlist() {
  const allow = new Set()
  const file = join(webRoot, 'bundle-allowlist.txt')
  if (existsSync(file)) {
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.replace(/#.*/, '').trim()
      if (!line) continue
      if (!/^0x[0-9a-fA-F]{64}$/.test(line)) {
        console.error(`bundle-allowlist.txt: not a 0x + 64 hex value: ${line.slice(0, 12)}…`)
        process.exit(2)
      }
      allow.add(line.toLowerCase())
    }
  }
  // Public on-chain identifiers we ship on purpose.
  const deployments = join(repoRoot, 'packages', 'sdk', 'src', 'deployments')
  if (existsSync(deployments)) {
    for (const f of readdirSync(deployments).filter((n) => n.endsWith('.json'))) {
      collectBytes32(JSON.parse(readFileSync(join(deployments, f), 'utf8')), allow)
    }
  }
  const evidence = join(webRoot, 'src', 'evidence.json')
  if (existsSync(evidence)) collectBytes32(JSON.parse(readFileSync(evidence, 'utf8')), allow)
  return allow
}

function redact(s) {
  return s.length <= 14
    ? `${s.slice(0, 4)}…`
    : `${s.slice(0, 10)}…${s.slice(-4)} (${s.length} chars)`
}

if (!existsSync(dist)) {
  console.error(`check-bundle: ${dist} does not exist. Run \`pnpm --filter web build\` first.`)
  process.exit(2)
}

const allow = loadAllowlist()
const files = walk(dist)
const findings = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      if (rule.allowlisted && allow.has(m[0].toLowerCase())) continue
      const line = text.slice(0, m.index).split('\n').length
      findings.push({ file: relative(repoRoot, file), line, rule: rule.id, value: redact(m[0]) })
    }
  }
}

if (findings.length) {
  console.error(
    `check-bundle: ${findings.length} secret-looking string(s) in ${relative(repoRoot, dist)}:`,
  )
  for (const f of findings) console.error(`  ${f.rule.padEnd(22)} ${f.file}:${f.line}  ${f.value}`)
  console.error(
    '\nIf a 0x+64-hex value is a public constant (topic, typehash, feed id), add it with a comment to apps/web/bundle-allowlist.txt.',
  )
  process.exit(1)
}

console.log(`check-bundle: OK (${files.length} files scanned, ${allow.size} allowlisted values)`)
