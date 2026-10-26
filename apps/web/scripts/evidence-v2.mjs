// Rebuilds src/evidence.json after the v2 (post-audit) testnet redeploy:
//  - v2 deploy and setup transactions from the forge broadcasts of the addresses in contracts/deployments/31611.json;
//  - the judge journey from the latest e2e journey log (apps/web/e2e/.output/journey-*.json);
//  - extra entries from a JSON file (role grants, the vault deposit, keeper actions): [{area, kind, tx, summary, proves}];
//  - every existing entry that is not a v2 transaction moves to the "v1" area, unchanged.
// Blocks come from the broadcast receipts or, for extras, from the RPC.
// Usage: node scripts/evidence-v2.mjs [--journey <file>] [--extra <file>] [--dry]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--'))
      acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)])
    return acc
  }, []),
)
const root = new URL('../../../', import.meta.url)
const evidencePath = new URL('apps/web/src/evidence.json', root)
const reg = JSON.parse(readFileSync(new URL('contracts/deployments/31611.json', root), 'utf8'))
const RPC = 'https://rpc.test.mezo.org'
const lc = (a) => a?.toLowerCase()

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result
}
const blockOf = async (tx) =>
  Number(BigInt((await rpc('eth_getTransactionReceipt', [tx])).blockNumber))

// ---------------------------------------------------------------------------------------------------------- broadcasts
const txs = []
for (const script of ['Deploy', 'DeployLiquidation', 'DeployPeriphery', 'DeployVault']) {
  const dir = new URL(`contracts/broadcast/${script}.s.sol/31611/`, root)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)
    .filter((n) => /^run-\d+\.json$/.test(n))
    .sort()) {
    const run = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const blocks = new Map(
      (run.receipts ?? []).map((r) => [r.transactionHash, Number(BigInt(r.blockNumber))]),
    )
    for (const t of run.transactions ?? []) {
      if (!blocks.has(t.hash)) continue
      txs.push({
        script,
        hash: t.hash,
        block: blocks.get(t.hash),
        type: t.transactionType,
        to: lc(t.contractAddress),
        fn: t.function ?? '',
        created: [
          ...(t.transactionType === 'CREATE' || t.transactionType === 'CREATE2'
            ? [lc(t.contractAddress)]
            : []),
          ...(t.additionalContracts ?? []).map((c) => lc(c.address)),
        ],
      })
    }
  }
}
const createdIn = (addr) => txs.find((t) => t.created.includes(lc(addr)))
const callTo = (addr, fnPrefix) =>
  txs.filter((t) => t.type === 'CALL' && t.to === lc(addr) && t.fn.startsWith(fnPrefix))

const v2 = []
const add = (area, kind, t, summary, proves) => {
  if (!t) {
    console.warn(`missing: ${area}/${kind}`)
    return
  }
  v2.push({ chainId: 31611, area, kind, tx: t.hash, block: t.block, summary, proves })
}

add(
  'core',
  'deploy-oracle',
  createdIn(reg.oracle),
  'BtcMusdOracle v2 deployed: Skip BTC/USD (≤60 s), a Pyth ±10% band that only gates while Pyth is under 10 minutes old, and the MUSD leg clamped to $1.00–1.02.',
  'The audited oracle (round-2 fix R2X-2: a stalled Pyth can no longer freeze liquidations for an hour) prices the new market.',
)
add(
  'core',
  'wsmusd-seed',
  callTo(reg.wsMusd, 'deposit')[0],
  'wsMUSD v2 seeded with 1 MUSD of dead shares, deposited into the real sMUSD.',
  'The ERC-4626 wrapper composes with Mezo’s live sMUSD; vesting has no instant part, so its share price never falls (round-1 B-3).',
)
add(
  'core',
  'deploy',
  createdIn(reg.factory),
  'BorrowAccountFactory v2 deployed with the bcBTC receipt and the BorrowAccount implementation in one transaction.',
  'The audited core (top-ups never capped, stale timelock raises invalidated, timelocked canary grants) fits Mezo’s 10M block gas limit.',
)
add(
  'core',
  'create-market',
  txs.find((t) => t.fn.startsWith('createMarket(')),
  'Market M1 v2 created on Mezo’s official testnet Morpho Blue: MUSD loan, bcBTC collateral, BtcMusdOracle v2, AdaptiveCurveIrm, LLTV 0.77.',
  'The redemption-free BTC→MUSD market is recreated permissionlessly on Mezo’s own Morpho for the audited contracts.',
)
add(
  'core',
  'supply',
  txs.find((t) => t.script === 'Deploy' && t.fn.startsWith('supply(')),
  'Team supplied MUSD liquidity to M1 v2.',
  'Borrowers can draw MUSD from the new market from its first block.',
)
add(
  'core',
  'canary-grant-submit',
  callTo(reg.factory, 'submit(')[0],
  'Governor queued setCanaryOperator for the keeper’s canary key behind the factory’s 48-hour timelock.',
  'Granting a canary operator is a timelocked raise since round-1 fix D-7; anyone executes it once due, and the keeper does.',
)

add(
  'lend',
  'create-vmusd',
  createdIn(reg.vMusd),
  'vMUSD v2 created through Mezo’s own VaultV2Factory (Morpho Vault V2, MUSD asset).',
  'The lending vault is a stock Morpho Vault V2 from Mezo’s factory, configured by the audited deploy script.',
)
add(
  'lend',
  'deploy-ws-adapter',
  createdIn(reg.wsMusdAdapter),
  'WsMusdLiquidityAdapter v2 deployed: parks idle vault MUSD in wsMUSD and refuses free force-deallocation (round-2 R2X-4).',
  'Nobody can strip vMUSD’s share of wsMUSD yield by force-deallocating it for free.',
)
add(
  'lend',
  'deploy-allocator',
  createdIn(reg.allocator),
  'BaserateAllocator v2 deployed: owner-less, trailing-APY decisions with a same-block guard, one buffer top-up per block, idle parked during the cooldown.',
  'Round-1 B-1 and round-2 R2V-3/R2X-3 fixes are live: same-block state can no longer steer the vault.',
)
add(
  'lend',
  'vmusd-seed',
  callTo(reg.vMusd, 'deposit')[0],
  'vMUSD v2 seeded with 100 MUSD of dead shares, allocated straight into wsMUSD.',
  'The vault is protected against first-depositor inflation from its first block.',
)

add(
  'liquidations',
  'deploy-backstop',
  createdIn(reg.backstop),
  'Backstop v2 (bMUSD) deployed: deposits close while it holds BTC, exits pay partially or in kind, dust never ties exits to the oracle.',
  'Round-1 C-1/C-3 and round-2 R2V-1/R2V-7 fixes are live: no buying in below a sale, no frozen exits.',
)
add(
  'liquidations',
  'backstop-seed',
  callTo(reg.backstop, 'deposit')[0],
  'Backstop v2 seeded with 1 MUSD of dead shares (mandatory since round-2 R2V-2).',
  'Gross-priced deposits can’t be skewed by a donation into an empty backstop.',
)
add(
  'liquidations',
  'deploy-flash-liquidator',
  createdIn(reg.flashLiquidator),
  'FlashLiquidator v2 deployed, bound to M1 v2 and the backstop, forwarding only each liquidation’s own proceeds (round-1 C-2).',
  'Zero-capital liquidations for the new market; a 1-wei donation can’t brick contract liquidators.',
)

add(
  'fees',
  'deploy-fee-router',
  createdIn(reg.feeRouter),
  'FeeRouter v2 deployed: an ownerless 40/40/20 splitter that survives an sMUSD failure and carries bribes it can’t post (round-1 D-2/D-3).',
  'Fees reach sMUSD holders, veBTC voters and the treasury without any admin, even if sMUSD changes.',
)
add(
  'risk',
  'deploy-risk-lens',
  createdIn(reg.riskLens),
  'RiskLens v2 deployed: one eth_call for oracle, market, caps, backstop solvency (available cash), liquidation depth and the redemption queue.',
  'The risk dashboard reads the audited contracts; reserved exit cash is no longer counted as free (round-1 D-5).',
)

// ------------------------------------------------------------------------------------------------------- the journey
const journeyFile =
  args.journey && args.journey !== true
    ? args.journey
    : (() => {
        const dir = new URL('apps/web/e2e/.output/', root)
        const files = readdirSync(dir)
          .filter((n) => /^journey-.*\.json$/.test(n))
          .sort()
        return files.length ? new URL(files.at(-1), dir).pathname : null
      })()
const JOURNEY_TEXT = {
  'dispenser-claim': [
    'Judge journey (e2e harness, real signing wallet): claimed test MUSD from the dispenser.',
    'A judge can top up interest with test MUSD from inside the app.',
  ],
  borrow: [
    'Judge journey: openAndBorrow with BTC sent as msg.value; MUSD borrowed in one transaction on M1 v2.',
    'The core flow works end to end on the audited contracts through the real UI.',
  ],
  'wsmusd-deposit': [
    'Judge journey: one MUSD permit signature, then depositWithPermit into wsMUSD v2.',
    'Saving in wsMUSD takes one signature and one transaction.',
  ],
  'wsmusd-redeem': [
    'Judge journey: redeemed wsMUSD for MUSD.',
    'wsMUSD exits pay MUSD at the previewed amount.',
  ],
  'wsmusd-redeem-in-kind': [
    'Judge journey: redeemInKind paid sMUSD straight to the wallet.',
    'The in-kind exit works without touching sMUSD’s withdraw.',
  ],
  'repay-exit': [
    'Judge journey: one permit, then repayAndWithdrawWithPermit repaid the exact debt and returned native BTC.',
    'The oracle-free exit closes a position in one transaction.',
  ],
  'vmusd-approve': [
    'Judge journey: approved MUSD for vMUSD (Morpho Vault V2 has no permit deposit).',
    'Lending through vMUSD from the real UI.',
  ],
  'vmusd-deposit': [
    'Judge journey: deposited MUSD into vMUSD v2; the liquidity adapter parked it in wsMUSD in the same transaction.',
    'Lenders earn at least wsMUSD while the allocator lends to M1 when it pays more.',
  ],
  'vmusd-withdraw': [
    'Judge journey: withdrew everything from vMUSD v2.',
    'Lenders exit with no penalty.',
  ],
}
if (journeyFile) {
  const j = JSON.parse(readFileSync(journeyFile, 'utf8'))
  for (const s of j.steps) {
    const text = JOURNEY_TEXT[s.step]
    if (!text) continue
    v2.push({
      chainId: 31611,
      area: 'judge-journey',
      kind: s.step,
      tx: s.tx,
      block: Number(s.block),
      summary: text[0],
      proves: text[1],
    })
  }
} else console.warn('no journey log')

// ------------------------------------------------------------------------------------------------------------ extras
if (args.extra && args.extra !== true) {
  for (const e of JSON.parse(readFileSync(args.extra, 'utf8'))) {
    v2.push({
      chainId: 31611,
      area: e.area,
      kind: e.kind,
      tx: e.tx,
      block: e.block ?? (await blockOf(e.tx)),
      summary: e.summary,
      proves: e.proves,
    })
  }
}

// --------------------------------------------------------------------------------------------------------------- v1
const v2Hashes = new Set(v2.map((e) => lc(e.tx)))
const existing = JSON.parse(readFileSync(evidencePath, 'utf8'))
const v1 = existing.entries
  .filter((e) => !v2Hashes.has(lc(e.tx)))
  .map((e) => ({ ...e, area: 'v1' }))

const out = { ...existing, entries: [...v2, ...v1] }
console.log(`v2 entries: ${v2.length}, v1 entries: ${v1.length}`)
if (args.dry) console.log(JSON.stringify(v2.slice(0, 3), null, 2))
else writeFileSync(evidencePath, `${JSON.stringify(out, null, 2)}\n`)
