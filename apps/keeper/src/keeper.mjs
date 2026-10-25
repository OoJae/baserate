// Baserate keeper for Mezo testnet. Every action it takes is permissionless, so the key only pays gas:
// - allocator: hourly `checkpoint()` and `rebalance()` on vMUSD's BaserateAllocator (skipped when they would revert);
// - liquidations: every 30 s, any M1 position above LLTV is liquidated through the FlashLiquidator (vAMM, then backstop);
// - fees: FeeRouter `distribute()` once it holds enough MUSD, outside the last hour of a Mezo Earn epoch.
// A small HTTP server exposes /healthz and /status (recent actions) for the app's Evidence page.

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const registry = JSON.parse(
  readFileSync(new URL('../registry.31611.json', import.meta.url), 'utf8'),
)

const env = (name, fallback) => process.env[name] ?? fallback
const RPC_URL = env('RPC_URL', 'https://rpc.test.mezo.org')
const PORT = Number(env('PORT', '8080'))
const LIQ_INTERVAL_MS = Number(env('LIQ_INTERVAL_MS', '30000'))
const ALLOCATOR_INTERVAL_MS = Number(env('ALLOCATOR_INTERVAL_MS', '3600000'))
const FEES_INTERVAL_MS = Number(env('FEES_INTERVAL_MS', '21600000'))
const FEES_MIN_MUSD = BigInt(env('FEES_MIN_MUSD', '10')) * 10n ** 18n
const GAS_MULTIPLIER_PCT = 140n // Mezo charges more on-chain than eth_estimateGas for some paths
const LOG_CHUNK = 9_000n // RPC eth_getLogs is capped at 10k blocks

const key = process.env.KEEPER_PRIVATE_KEY
if (!key) {
  console.error(JSON.stringify({ level: 'fatal', msg: 'KEEPER_PRIVATE_KEY is not set' }))
  process.exit(1)
}

const mezoTestnet = defineChain({
  id: 31_611,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.test.mezo.org' } },
})
const transport = http(RPC_URL, { retryCount: 3, retryDelay: 1_000, timeout: 20_000 })
const account = privateKeyToAccount(key)
const pub = createPublicClient({ chain: mezoTestnet, transport })
const wallet = createWalletClient({ chain: mezoTestnet, transport, account })

const abi = {
  allocator: parseAbi(['function rebalance()', 'function checkpoint()']),
  factory: parseAbi([
    'event AccountCreated(address indexed owner, address indexed account, uint8 profile)',
  ]),
  account: parseAbi([
    'function collateral() view returns (uint256)',
    'function debt() view returns (uint256)',
  ]),
  oracle: parseAbi(['function price() view returns (uint256)']),
  liquidator: parseAbi([
    'function liquidate(address borrower, uint256 seizedAssets, uint8 venue, uint256 minProfit)',
  ]),
  feeRouter: parseAbi(['function distribute()']),
  erc20: parseAbi(['function balanceOf(address) view returns (uint256)']),
}
const accountCreated = parseAbiItem(
  'event AccountCreated(address indexed owner, address indexed account, uint8 profile)',
)
const VENUE = { BACKSTOP: 0, CL200: 1, VAMM: 2 }

// ---- state for /status -------------------------------------------------------------------------------------------
const state = {
  startedAt: new Date().toISOString(),
  keeper: account.address,
  lastRun: {},
  actions: [],
  accounts: [],
}
const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }))
const record = (job, entry) => {
  state.actions.unshift({ t: new Date().toISOString(), job, ...entry })
  state.actions.length = Math.min(state.actions.length, 100)
}

/** Simulates, then sends with a padded gas limit, then waits for the receipt. Returns null if the call would revert. */
async function trySend(job, request) {
  try {
    const { request: simulated } = await pub.simulateContract({ ...request, account })
    const gas = await pub.estimateGas({ ...simulated, account })
    const hash = await wallet.writeContract({
      ...simulated,
      gas: (gas * GAS_MULTIPLIER_PCT) / 100n,
    })
    const receipt = await pub.waitForTransactionReceipt({
      hash,
      pollingInterval: 1_000,
      timeout: 120_000,
    })
    const entry = {
      fn: request.functionName,
      tx: hash,
      status: receipt.status,
      block: Number(receipt.blockNumber),
    }
    record(job, entry)
    log('info', `${job}: ${request.functionName} sent`, entry)
    return receipt
  } catch (err) {
    const reason = err?.shortMessage ?? err?.message ?? String(err)
    log('debug', `${job}: ${request.functionName} skipped`, { reason: reason.slice(0, 200) })
    return null
  }
}

// ---- jobs ----------------------------------------------------------------------------------------------------------
async function allocatorJob() {
  const allocator = registry.allocator
  await trySend('allocator', { address: allocator, abi: abi.allocator, functionName: 'rebalance' })
  await trySend('allocator', { address: allocator, abi: abi.allocator, functionName: 'checkpoint' })
  state.lastRun.allocator = new Date().toISOString()
}

let logCursor = BigInt(registry.deployBlock ?? 0)
const knownAccounts = new Set()
async function refreshAccounts() {
  const head = await pub.getBlockNumber()
  while (logCursor <= head) {
    // biome-ignore lint/complexity/useMathMinMax: BigInt block numbers; Math.min does not accept bigint
    const toBlock = logCursor + LOG_CHUNK > head ? head : logCursor + LOG_CHUNK
    const logs = await pub.getLogs({
      address: registry.factory,
      event: accountCreated,
      fromBlock: logCursor,
      toBlock,
    })
    for (const l of logs) knownAccounts.add(l.args.account)
    logCursor = toBlock + 1n
  }
}

async function liquidationJob() {
  await refreshAccounts()
  const price = await pub.readContract({
    address: registry.oracle,
    abi: abi.oracle,
    functionName: 'price',
  })
  const lltv = BigInt(registry.lltv)
  const snapshot = []
  for (const acct of knownAccounts) {
    const [collateral, debt] = await Promise.all([
      pub.readContract({ address: acct, abi: abi.account, functionName: 'collateral' }),
      pub.readContract({ address: acct, abi: abi.account, functionName: 'debt' }),
    ])
    if (debt === 0n) continue
    const maxBorrow = (((collateral * price) / 10n ** 36n) * lltv) / 10n ** 18n
    const ltvBps = collateral === 0n ? 99_999n : (debt * 10n ** 40n) / (collateral * price)
    snapshot.push({ account: acct, ltvPct: Number(ltvBps) / 100, liquidatable: debt > maxBorrow })
    if (debt <= maxBorrow) continue
    log('warn', 'liquidatable position', { account: acct, ltvPct: Number(ltvBps) / 100 })
    for (const venue of [VENUE.VAMM, VENUE.BACKSTOP]) {
      const receipt = await trySend('liquidation', {
        address: registry.flashLiquidator,
        abi: abi.liquidator,
        functionName: 'liquidate',
        args: [acct, 0n, venue, 0n],
      })
      if (receipt?.status === 'success') break
    }
  }
  state.accounts = snapshot.sort((a, b) => b.ltvPct - a.ltvPct)
  state.lastRun.liquidations = new Date().toISOString()
}

async function feesJob() {
  const epochSecond = Math.floor(Date.now() / 1000) % (7 * 24 * 3600)
  if (epochSecond >= 7 * 24 * 3600 - 3600) return // keep clear of the last hour of the epoch
  const balance = await pub.readContract({
    address: registry.musd,
    abi: abi.erc20,
    functionName: 'balanceOf',
    args: [registry.feeRouter],
  })
  if (balance >= FEES_MIN_MUSD) {
    await trySend('fees', {
      address: registry.feeRouter,
      abi: abi.feeRouter,
      functionName: 'distribute',
    })
  }
  state.lastRun.fees = new Date().toISOString()
  state.feeRouterMusd = formatUnits(balance, 18)
}

function every(name, ms, job) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await job()
    } catch (err) {
      log('error', `${name} failed`, {
        reason: (err?.shortMessage ?? err?.message ?? String(err)).slice(0, 300),
      })
    } finally {
      running = false
    }
  }
  tick()
  setInterval(tick, ms)
}

// ---- status server -------------------------------------------------------------------------------------------------
createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (req.url === '/status') {
    let gasBalance = null
    try {
      gasBalance = formatUnits(await pub.getBalance({ address: account.address }), 18)
    } catch {}
    res
      .writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
      .end(JSON.stringify({ chainId: 31_611, gasBalanceBtc: gasBalance, ...state }, null, 2))
    return
  }
  res.writeHead(404).end()
}).listen(PORT, () =>
  log('info', 'keeper started', { keeper: account.address, port: PORT, rpc: RPC_URL }),
)

every('liquidations', LIQ_INTERVAL_MS, liquidationJob)
every('allocator', ALLOCATOR_INTERVAL_MS, allocatorJob)
every('fees', FEES_INTERVAL_MS, feesJob)
