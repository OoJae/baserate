#!/usr/bin/env node
// Writes the event fragments of every indexed contract's ABI to abis/<Name>.json.
//
//   cd contracts && FOUNDRY_OUT=out-subgraph FOUNDRY_CACHE_PATH=cache-subgraph forge build \
//     src/account/BorrowAccountFactory.sol src/account/BorrowAccount.sol src/savings/WsMUSD.sol \
//     src/vault/BaserateAllocator.sol src/liquidation/Backstop.sol src/liquidation/FlashLiquidator.sol \
//     src/fees/FeeRouter.sol lib/morpho-blue/src/Morpho.sol lib/vault-v2/src/VaultV2.sol
//   pnpm --filter @baserate/subgraph abis [foundryOutDir]     # default: contracts/out-subgraph
//
// Artifacts are found by compilation target (source path + contract name), not by output path, because forge
// disambiguates same-named files (morpho-blue and vault-v2 both ship a libraries/EventsLib.sol). Morpho Blue is
// compiled with solc 0.8.19, which leaves library events out of the contract ABI, so its events come from
// morpho-blue's EventsLib. Only events are kept: the mappings make no contract calls.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const contracts = resolve(pkg, '..', '..', 'contracts')
const outDir = resolve(process.argv[2] ?? join(contracts, 'out-subgraph'))

/** abis/<name>.json ← events of `contract` compiled from `source`. */
const TARGETS = [
  { name: 'BorrowAccountFactory', source: 'src/account/BorrowAccountFactory.sol' },
  { name: 'BorrowAccount', source: 'src/account/BorrowAccount.sol' },
  { name: 'WsMUSD', source: 'src/savings/WsMUSD.sol' },
  { name: 'BaserateAllocator', source: 'src/vault/BaserateAllocator.sol' },
  { name: 'Backstop', source: 'src/liquidation/Backstop.sol' },
  { name: 'FlashLiquidator', source: 'src/liquidation/FlashLiquidator.sol' },
  { name: 'FeeRouter', source: 'src/fees/FeeRouter.sol' },
  { name: 'VaultV2', source: 'lib/vault-v2/src/VaultV2.sol' },
  { name: 'Morpho', source: 'lib/morpho-blue/src/libraries/EventsLib.sol', contract: 'EventsLib' },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== 'build-info') out.push(...walk(p))
    } else if (entry.endsWith('.json')) out.push(p)
  }
  return out
}

if (!existsSync(outDir)) {
  console.error(`extract-abis: ${outDir} does not exist; run the forge build in the header first.`)
  process.exit(2)
}

/** "source:Contract" → artifact path */
const index = new Map()
for (const file of walk(outDir)) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const target = json.metadata?.settings?.compilationTarget
  if (!target || !Array.isArray(json.abi)) continue
  for (const [source, contract] of Object.entries(target)) index.set(`${source}:${contract}`, file)
}

let failed = false
for (const t of TARGETS) {
  const key = `${t.source}:${t.contract ?? t.name}`
  const file = index.get(key)
  if (!file) {
    console.error(`extract-abis: no artifact for ${key} in ${outDir}`)
    failed = true
    continue
  }
  const abi = JSON.parse(readFileSync(file, 'utf8')).abi
  const events = abi
    .filter((item) => item.type === 'event')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  writeFileSync(join(pkg, 'abis', `${t.name}.json`), `${JSON.stringify(events, null, 2)}\n`)
  console.log(`abis/${t.name}.json  ${events.length} events  (${key})`)
}
if (failed) process.exit(1)
