import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Route, test } from '@playwright/test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * A confirmed transaction's toast, end to end in the real app with nothing sent anywhere: a stand-in wallet answers
 * eth_sendTransaction with a fixed hash (it signs nothing and broadcasts nothing), and the test answers that hash's
 * transaction and receipt on the RPC route. Everything else (simulation, reads) is the live testnet.
 *
 * Checks the toast contract the journey relies on (region "Notifications" → status → exact title, message <p>),
 * the fixed icon slot, the text-free seal, the pending hairline, and that a dismissed toast leaves at once.
 */

const RPC = /^https:\/\/rpc\.test\.mezo\.org\/?(\?.*)?$/
const RPC_URL = 'https://rpc.test.mezo.org'
const HASH = `0x${'5e'.repeat(32)}`

interface RpcCall {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown[]
}

/** The stand-in wallet (runs in the page): EIP-6963 + window.ethereum, reads forwarded, sends never broadcast. */
function standInWallet(cfg: { account: string; hash: string; rpc: string }) {
  // Remembered across reloads, as a real wallet remembers a site it is connected to.
  const KEY = 'baserate-uitest-authorized'
  let authorized = localStorage.getItem(KEY) === '1'
  let id = 0
  const listeners = new Map<string, Set<(data: unknown) => void>>()
  const emit = (event: string, data: unknown) => {
    for (const fn of listeners.get(event) ?? []) fn(data)
  }
  const refuse = (method: string) =>
    Object.assign(new Error(`${method} is not available in the UI test wallet`), { code: 4200 })
  const forward = async (method: string, params: unknown[]) => {
    const res = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    const json = (await res.json()) as {
      result?: unknown
      error?: { code: number; message: string }
    }
    if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code })
    return json.result
  }
  const provider = {
    async request({ method, params = [] }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_chainId':
          return '0x7b7b'
        case 'net_version':
          return '31611'
        case 'eth_accounts':
          return authorized ? [cfg.account] : []
        case 'eth_requestAccounts':
        case 'wallet_requestPermissions':
          if (!authorized) {
            authorized = true
            localStorage.setItem(KEY, '1')
            setTimeout(() => emit('accountsChanged', [cfg.account]))
          }
          return method === 'eth_requestAccounts'
            ? [cfg.account]
            : [{ parentCapability: 'eth_accounts' }]
        case 'wallet_getPermissions':
          return authorized ? [{ parentCapability: 'eth_accounts' }] : []
        case 'wallet_switchEthereumChain':
          return null
        // Never broadcast: a fixed hash, whose receipt the test answers.
        case 'eth_sendTransaction':
          return cfg.hash
        case 'eth_sendRawTransaction':
        case 'eth_sign':
        case 'eth_signTransaction':
        case 'eth_signTypedData_v4':
        case 'personal_sign':
          throw refuse(method)
        default:
          if (method.startsWith('wallet_')) throw refuse(method)
          return forward(method, params)
      }
    },
    on(event: string, fn: (data: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(fn)
      return provider
    },
    removeListener(event: string, fn: (data: unknown) => void) {
      listeners.get(event)?.delete(fn)
      return provider
    },
  }
  const info = {
    uuid: crypto.randomUUID(),
    name: 'Baserate UI Test Wallet',
    rdns: 'org.baserate.uitest',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/%3E',
  }
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true })
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }),
    )
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
}

test('a confirmed transaction stamps the seal onto its toast; dismissing it is instant', async ({
  context,
}, testInfo) => {
  const account = privateKeyToAccount(generatePrivateKey()).address
  const shots = process.env.UI_SHOTS_DIR
  if (shots) mkdirSync(shots, { recursive: true })
  const shot = (name: string) =>
    shots ? join(shots, `toast-${name}-${testInfo.project.name}.png`) : undefined

  const headRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  const head = ((await headRes.json()) as { result: string }).result
  let minedAt = Number.POSITIVE_INFINITY
  const mined = () => Date.now() >= minedAt

  const fake = (call: RpcCall): { result: unknown } | undefined => {
    const first = call.params?.[0]
    const ours = typeof first === 'string' && first.toLowerCase() === HASH
    if (
      call.method === 'eth_estimateGas' &&
      (first as { from?: string })?.from?.toLowerCase() === account.toLowerCase()
    )
      return { result: '0x30d40' }
    if (call.method === 'eth_getTransactionByHash' && ours)
      return {
        result: {
          hash: HASH,
          from: account,
          to: account,
          input: '0x',
          value: '0x0',
          nonce: '0x0',
          gas: '0x30d40',
          gasPrice: '0x1',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1',
          type: '0x2',
          chainId: '0x7b7b',
          accessList: [],
          v: '0x0',
          r: '0x1',
          s: '0x1',
          blockHash: mined() ? `0x${'ab'.repeat(32)}` : null,
          blockNumber: mined() ? head : null,
          transactionIndex: mined() ? '0x0' : null,
        },
      }
    if (call.method === 'eth_getTransactionReceipt' && ours)
      return {
        result: mined()
          ? {
              transactionHash: HASH,
              blockHash: `0x${'ab'.repeat(32)}`,
              blockNumber: head,
              transactionIndex: '0x0',
              from: account,
              to: account,
              contractAddress: null,
              cumulativeGasUsed: '0x5208',
              effectiveGasPrice: '0x1',
              gasUsed: '0x5208',
              logs: [],
              logsBloom: `0x${'0'.repeat(512)}`,
              status: '0x1',
              type: '0x2',
            }
          : null,
      }
    return undefined
  }

  await context.addInitScript(standInWallet, { account, hash: HASH, rpc: RPC_URL })
  await context.route(RPC, async (route: Route) => {
    const request = route.request()
    let body: RpcCall | RpcCall[]
    try {
      body = JSON.parse(request.postData() ?? '')
    } catch {
      return route.continue()
    }
    const calls = Array.isArray(body) ? body : [body]
    if (!calls.some((c) => fake(c))) return route.continue()
    const rest = calls.filter((c) => !fake(c))
    let answers: { id: RpcCall['id'] }[] = []
    if (rest.length) {
      const res = await route.fetch({ postData: JSON.stringify(rest) })
      const json = (await res.json()) as { id: RpcCall['id'] } | { id: RpcCall['id'] }[]
      answers = Array.isArray(json) ? json : [json]
    }
    const out = calls.map(
      (c) =>
        (fake(c)
          ? { jsonrpc: '2.0', id: c.id, ...fake(c) }
          : answers.find((a) => a.id === c.id)) ?? {
          jsonrpc: '2.0',
          id: c.id,
          error: { code: -32603, message: 'no answer' },
        },
    )
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(Array.isArray(body) ? out : out[0]),
    })
  })

  const page = await context.newPage()
  await page.goto('/save')
  await page.evaluate(() =>
    (
      window as unknown as { ethereum: { request: (a: { method: string }) => Promise<unknown> } }
    ).ethereum.request({ method: 'eth_requestAccounts' }),
  )
  await page.reload()
  await expect(page.getByTestId('rk-account-button')).toContainText(account.slice(0, 4), {
    timeout: 30_000,
  })

  const pool = page.getByRole('region', { name: 'Pool' })
  const sync = pool.getByRole('button', { name: 'Sync yield', exact: true })
  await expect(sync).toBeEnabled({ timeout: 60_000 })
  minedAt = Date.now() + 5_000
  await sync.click()

  // Pending: the rosette in the button and the toast, the hairline under the button.
  const notifications = page.getByRole('region', { name: 'Notifications' })
  const pending = notifications.getByRole('status').filter({ hasText: 'Syncing wsMUSD' })
  await expect(pending.getByText('Syncing wsMUSD', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(pool.locator('.tx-progress')).toBeVisible()
  await expect(pool.getByRole('button', { name: 'Waiting for confirmation…' })).toBeDisabled()
  const slot = pending.locator(':scope > span[aria-hidden="true"]').first()
  const pendingSlot = await slot.boundingBox()
  const p = shot('pending')
  if (p) await page.screenshot({ path: p, animations: 'disabled' })

  // Confirmed: same toast, same slot size, title and message as the journey reads them, a text-free seal.
  const done = notifications.getByRole('status').filter({ hasText: 'Yield synced' })
  await expect(done.getByText('Yield synced', { exact: true })).toBeVisible({ timeout: 60_000 })
  const m = shot('stamping')
  if (m) await done.screenshot({ path: m, animations: 'allow' })
  await expect(done.getByText(/^Included in block \d+\.$/)).toBeVisible()
  const seal = done.locator('svg').first()
  await expect(seal).toHaveAttribute('aria-hidden', 'true')
  expect(await seal.evaluate((el) => el.textContent ?? '')).toBe('')
  expect(await seal.locator('title, text').count()).toBe(0)
  const doneSlot = await done.locator(':scope > span[aria-hidden="true"]').first().boundingBox()
  expect(doneSlot?.width).toBe(pendingSlot?.width)
  expect(doneSlot?.height).toBe(32)
  await page.waitForTimeout(900)
  const s = shot('confirmed')
  if (s) await done.screenshot({ path: s, animations: 'disabled' })

  // The button is back to its label: labels never change to show success.
  await expect(pool.getByRole('button', { name: 'Sync yield', exact: true })).toBeVisible()

  // Dismissed: gone at once (no exit animation), so two toasts with one title never overlap.
  await done.getByRole('button', { name: 'Dismiss notification' }).click()
  expect(await notifications.getByRole('status').filter({ hasText: 'Yield synced' }).count()).toBe(
    0,
  )
})
