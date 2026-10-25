// Rewrites src/deployments/<chainId>.json from contracts/deployments/<chainId>.json and the forge broadcasts after a
// deploy: every Baserate contract's address, deploy tx and block (contracts created inside another deploy, such as
// bcBTC, the BorrowAccount implementation, vMUSD and its adapters, are matched through `additionalContracts`), the M1
// market params and its creation block, and the registry's start block. External addresses, feeds and other fields
// are kept.
// Usage: node scripts/sync-registry.mjs [chainId=31611]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const chainId = Number(process.argv[2] ?? 31611)
const contractsDir = new URL('../../../contracts/', import.meta.url)
const target = new URL(`../src/deployments/${chainId}.json`, import.meta.url)
const scripts = ['Deploy', 'DeployLiquidation', 'DeployPeriphery', 'DeployVault']

const deployed = JSON.parse(
  readFileSync(new URL(`deployments/${chainId}.json`, contractsDir), 'utf8'),
)
const sdk = JSON.parse(readFileSync(target, 'utf8'))

/** address (lower case) → { tx, block } from every script's latest broadcast. */
const created = new Map()
let marketBlock = null
for (const script of scripts) {
  // Every run, oldest first, so a contract from an interrupted run that a later run reused is still found.
  const dir = new URL(`broadcast/${script}.s.sol/${chainId}/`, contractsDir)
  if (!existsSync(dir)) continue
  const runs = readdirSync(dir)
    .filter((f) => /^run-\d+\.json$/.test(f))
    .sort()
  for (const f of runs) {
    const run = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const blockOf = new Map(
      (run.receipts ?? []).map((r) => [r.transactionHash, Number(BigInt(r.blockNumber))]),
    )
    for (const t of run.transactions ?? []) {
      const block = blockOf.get(t.hash)
      if (block === undefined) continue
      // `contractAddress` is the callee for plain calls: only creations count, plus contracts created inside a call.
      const addresses = (t.additionalContracts ?? []).map((c) => c.address)
      if (t.transactionType === 'CREATE' || t.transactionType === 'CREATE2')
        addresses.push(t.contractAddress)
      for (const a of addresses) {
        if (a && !created.has(a.toLowerCase())) created.set(a.toLowerCase(), { tx: t.hash, block })
      }
      if (t.function?.startsWith('createMarket(')) marketBlock = block
    }
  }
}

const missing = []
for (const key of Object.keys(sdk.contracts)) {
  const address = deployed[key]
  if (!address) {
    missing.push(`${key} (not in contracts/deployments)`)
    continue
  }
  const hit = created.get(address.toLowerCase())
  if (!hit) missing.push(`${key} ${address} (no broadcast record; tx/block left as before)`)
  sdk.contracts[key] = {
    address,
    tx: hit?.tx ?? sdk.contracts[key].tx,
    block: hit?.block ?? sdk.contracts[key].block,
  }
}

const m1 = sdk.markets.M1
m1.id = deployed.marketId
m1.collateralToken = deployed.collateral
m1.oracle = deployed.oracle
if (marketBlock !== null) m1.block = marketBlock
const blocks = Object.values(sdk.contracts)
  .map((c) => c.block)
  .filter((b) => b > 0)
sdk.startBlock = Math.min(...blocks) - 10

writeFileSync(target, `${JSON.stringify(sdk, null, 2)}\n`)
console.log(
  `wrote ${target.pathname}: ${Object.keys(sdk.contracts).length} contracts, M1 block ${m1.block ?? '?'}`,
)
if (missing.length) console.log(`check by hand:\n  ${missing.join('\n  ')}`)
