#!/usr/bin/env node
// Fails (exit 1) unless subgraph.yaml and src/config.ts match the Mezo testnet registry the web app uses
// (packages/sdk/src/deployments/31611.json) and, when present, contracts/deployments/31611.json.
//
//   pnpm --filter @baserate/subgraph check-config     (also the first step of `pnpm build`)
//   pnpm --filter @baserate/subgraph sync-config      (= check-config --write)
//
// With --write it first rewrites every data source's address and startBlock in subgraph.yaml, and the constants in
// src/config.ts, from the SDK registry (after a redeploy), then verifies as usual. Nothing else in those files changes.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const repo = resolve(pkg, '..', '..')
const NETWORK = 'mezo-testnet'
const WRITE = process.argv.includes('--write')
/** Blocks of M1's CreateMarket on Morpho, by market id (0xadd5…: tx 0x4810d361…). */
const M1_CREATED_BLOCKS = {
  '0xadd5f62435744e4fe91c94212024eba66fe93af38824bf264dee64258aebb13b': 16364340,
}

const registry = JSON.parse(
  readFileSync(join(repo, 'packages', 'sdk', 'src', 'deployments', '31611.json'), 'utf8'),
)
const c = registry.contracts
// Where the Morpho data source starts: M1's CreateMarket block. Deploy.s.sol creates M1 right after deploying the
// factory in the same broadcast, so for a market this script does not know (a redeploy), the factory's block is a
// safe start (Morpho events of other markets in between are skipped by the mappings).
const m1Id = registry.markets.M1.id.toLowerCase()
const m1Block = registry.markets.M1.block ?? M1_CREATED_BLOCKS[m1Id] ?? c.factory.block
const expected = {
  BorrowAccountFactory: { address: c.factory.address, startBlock: c.factory.block },
  Morpho: { address: registry.external.morpho, startBlock: m1Block },
  WsMUSD: { address: c.wsMusd.address, startBlock: c.wsMusd.block },
  VMUSD: { address: c.vMusd.address, startBlock: c.vMusd.block },
  BaserateAllocator: { address: c.allocator.address, startBlock: c.allocator.block },
  Backstop: { address: c.backstop.address, startBlock: c.backstop.block },
  FlashLiquidator: { address: c.flashLiquidator.address, startBlock: c.flashLiquidator.block },
  FeeRouter: { address: c.feeRouter.address, startBlock: c.feeRouter.block },
}
const constants = {
  M1_MARKET_ID: registry.markets.M1.id,
  WS_MUSD: c.wsMusd.address,
  WS_MUSD_ADAPTER: c.wsMusdAdapter.address,
  M1_ADAPTER: c.m1Adapter.address,
}

const problems = []
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const manifestPath = join(pkg, 'subgraph.yaml')
const configPath = join(pkg, 'src', 'config.ts')
const DATA_SOURCE = /(\n {2}- kind: ethereum\n)/

if (WRITE) {
  // subgraph.yaml: per data source, its `address:` and `startBlock:` lines (templates have neither).
  const before = readFileSync(manifestPath, 'utf8')
  const parts = before.split(DATA_SOURCE)
  for (let i = 2; i < parts.length; i += 2) {
    const name = parts[i].match(/^ {4}name: (\S+)/m)?.[1]
    const want = name && expected[name]
    if (!want) continue
    parts[i] = parts[i]
      .replace(/^( {6}address: )["']?0x[0-9a-fA-F]{40}["']?$/m, `$1"${want.address}"`)
      .replace(/^( {6}startBlock: )\d+$/m, `$1${want.startBlock}`)
  }
  const after = parts.join('')
  if (after !== before) writeFileSync(manifestPath, after)

  // src/config.ts: the lowercase constants.
  const configBefore = readFileSync(configPath, 'utf8')
  let configAfter = configBefore
  for (const [key, value] of Object.entries(constants)) {
    configAfter = configAfter.replace(
      new RegExp(`(export const ${key} = ')0x[0-9a-fA-F]+(')`),
      `$1${value.toLowerCase()}$2`,
    )
  }
  if (configAfter !== configBefore) writeFileSync(configPath, configAfter)
  console.log(
    `sync-config: subgraph.yaml ${after === before ? 'unchanged' : 'updated'}, src/config.ts ${
      configAfter === configBefore ? 'unchanged' : 'updated'
    } (from packages/sdk/src/deployments/31611.json)`,
  )
}

// subgraph.yaml: one block per data source / template, split on the list markers.
const manifest = readFileSync(manifestPath, 'utf8')
const blocks = manifest.split(/\n {2}- kind: ethereum\n/).slice(1)
const seen = new Set()
for (const block of blocks) {
  const name = block.match(/^ {4}name: (\S+)/m)?.[1]
  const network = block.match(/^ {4}network: (\S+)/m)?.[1]
  const address = block.match(/^ {6}address: ["']?(0x[0-9a-fA-F]{40})["']?/m)?.[1]
  const startBlock = block.match(/^ {6}startBlock: (\d+)/m)?.[1]
  if (!name) continue
  seen.add(name)
  if (network !== NETWORK) problems.push(`${name}: network ${network}, expected ${NETWORK}`)
  if (name === 'BorrowAccount') continue // template: no address
  const want = expected[name]
  if (!want) {
    problems.push(`${name}: not in the expected data source list`)
    continue
  }
  if (!same(address, want.address))
    problems.push(`${name}: address ${address}, registry ${want.address}`)
  if (Number(startBlock) !== want.startBlock)
    problems.push(`${name}: startBlock ${startBlock}, expected ${want.startBlock}`)
}
for (const name of [...Object.keys(expected), 'BorrowAccount']) {
  if (!seen.has(name)) problems.push(`subgraph.yaml has no ${name} data source`)
}

// src/config.ts
const config = readFileSync(configPath, 'utf8')
for (const [key, value] of Object.entries(constants)) {
  const actual = config.match(new RegExp(`export const ${key} = '(0x[0-9a-fA-F]+)'`))?.[1]
  if (actual !== value.toLowerCase())
    problems.push(`src/config.ts ${key} = ${actual}, expected ${value.toLowerCase()} (lowercase)`)
}

// contracts/deployments/31611.json, the deploy scripts' output, must agree with the SDK registry.
const deployments = join(repo, 'contracts', 'deployments', '31611.json')
if (existsSync(deployments)) {
  const d = JSON.parse(readFileSync(deployments, 'utf8'))
  const pairs = [
    ['factory', c.factory.address],
    ['wsMusd', c.wsMusd.address],
    ['vMusd', c.vMusd.address],
    ['allocator', c.allocator.address],
    ['backstop', c.backstop.address],
    ['flashLiquidator', c.flashLiquidator.address],
    ['feeRouter', c.feeRouter.address],
    ['morpho', registry.external.morpho],
    ['marketId', registry.markets.M1.id],
    ['m1Adapter', c.m1Adapter.address],
    ['wsMusdAdapter', c.wsMusdAdapter.address],
  ]
  for (const [key, value] of pairs) {
    if (d[key] !== undefined && !same(d[key], value))
      problems.push(`contracts/deployments/31611.json ${key} = ${d[key]}, SDK registry ${value}`)
  }
}

if (problems.length) {
  console.error(`check-config: ${problems.length} mismatch(es):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(
  `check-config: OK (${seen.size} data sources on ${NETWORK}, ${Object.keys(constants).length} constants)`,
)
