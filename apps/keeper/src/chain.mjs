import { createPublicClient, createWalletClient, defineChain, http, nonceManager } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { CHAIN_ID, env, IS_MAINNET, LIMITS, RPC_URL } from './config.mjs'
import { log } from './log.mjs'
import { recordAction } from './store.mjs'

export const chain = defineChain({
  id: CHAIN_ID,
  name: IS_MAINNET ? 'Mezo' : 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const transport = http(RPC_URL, { retryCount: 3, retryDelay: 1_000, timeout: 20_000 })
export const pub = createPublicClient({ chain, transport })

/**
 * One EOA per role (design: KEEPER, SENTINEL, CANARY, SIM). Every call the KEEPER makes is permissionless; SENTINEL
 * can only decrease limits; CANARY runs the team's canary positions; SIM funds the testnet yield simulation. A role
 * whose key is unset leaves its jobs disabled.
 */
const ROLE_KEYS = {
  keeper: 'KEEPER_PRIVATE_KEY',
  sentinel: 'SENTINEL_PRIVATE_KEY',
  canary: 'CANARY_PRIVATE_KEY',
  sim: 'SIM_PRIVATE_KEY',
}
export const signers = {}
for (const [role, name] of Object.entries(ROLE_KEYS)) {
  const key = env(name)
  if (!key) continue
  const account = privateKeyToAccount(key, { nonceManager })
  signers[role] = {
    account,
    wallet: createWalletClient({ chain, transport, account }),
    // Sends from one key run one at a time, so jobs sharing a key never race for a nonce.
    queue: Promise.resolve(),
  }
}
if (!signers.keeper) {
  console.error(JSON.stringify({ level: 'fatal', msg: 'KEEPER_PRIVATE_KEY is not set' }))
  process.exit(1)
}

export const hasRole = (role) => Boolean(signers[role])
export const addressOf = (role) => signers[role]?.account.address

function serial(role, fn) {
  const s = signers[role]
  const run = s.queue.then(fn, fn)
  s.queue = run.catch(() => {})
  return run
}

/**
 * Simulates, sends with padded gas and waits for the receipt. Returns `{ receipt, result }`, or null when the call
 * would revert (the reason is logged at debug: most skips are expected, e.g. a cooldown). With `onlyIf`, a call whose
 * simulated result fails the test is not sent and `{ skipped: true, result }` comes back.
 */
export function send(role, job, request, { idemKey, note, onlyIf } = {}) {
  return serial(role, async () => {
    const s = signers[role]
    try {
      const { request: simulated, result } = await pub.simulateContract({
        ...request,
        account: s.account,
      })
      if (onlyIf && !onlyIf(result)) return { skipped: true, result }
      const estimate = await pub.estimateGas({ ...simulated, account: s.account })
      const padded = (estimate * LIMITS.gasMultiplierPct) / 100n
      const hash = await s.wallet.writeContract({
        ...simulated,
        gas: padded > LIMITS.gasFloor ? padded : LIMITS.gasFloor,
      })
      const receipt = await pub.waitForTransactionReceipt({
        hash,
        pollingInterval: 1_000,
        timeout: 120_000,
      })
      await recordAction({
        job,
        role,
        fn: request.functionName,
        tx: hash,
        status: receipt.status,
        block: Number(receipt.blockNumber),
        idemKey,
        note,
      })
      log('info', `${job}: ${request.functionName} sent`, { tx: hash, status: receipt.status })
      return { receipt, result }
    } catch (err) {
      const reason = err?.shortMessage ?? err?.message ?? String(err)
      log('debug', `${job}: ${request.functionName} skipped`, { reason: reason.slice(0, 240) })
      return null
    }
  })
}

/** Reads a contract and returns `fallback` instead of throwing (views that may not exist on every deployment). */
export async function tryRead(request, fallback = null) {
  try {
    return await pub.readContract(request)
  } catch {
    return fallback
  }
}
