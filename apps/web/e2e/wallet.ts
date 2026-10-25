import { randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  hexToBigInt,
  hexToNumber,
  http,
  isAddressEqual,
  numberToHex,
  type PublicClient,
  type TypedDataDefinition,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

/**
 * An EIP-1193 browser wallet for Playwright, backed by a viem local account.
 *
 * The page sees `window.ethereum` plus an EIP-6963 announcement ("Baserate E2E Wallet"), so RainbowKit lists it
 * under Installed like any extension wallet. Every request crosses into Node through one exposed binding:
 * accounts, chain switching and signing are handled here; all other JSON-RPC calls are forwarded to the RPC.
 * Nothing prompts: requests are approved as a user clicking "Confirm" would.
 */

export interface RpcErrorShape {
  code: number
  message: string
  data?: unknown
}

interface WalletRequest {
  method: string
  params?: unknown[]
}

interface WalletResponse {
  result?: unknown
  error?: RpcErrorShape
  /** Provider events to emit in the page (before the request resolves). */
  events?: { event: 'accountsChanged' | 'chainChanged'; data: unknown }[]
  /** One-line description of what the wallet just did, for the on-screen HUD. */
  hud?: string
}

export interface SentTx {
  hash: Hex
  to: Address | null
  data: Hex | null
  value: bigint
  gas: bigint | undefined
  sentAt: number
}

export interface SignedTypedData {
  primaryType: string
  domainName?: string
  message: Record<string, unknown>
}

export interface E2EWalletOptions {
  privateKey: Hex
  /** The chain the wallet signs for; its first RPC URL backs reads and broadcasts. */
  chain: Chain
  /**
   * Chain the wallet reports before the dapp asks to switch. A chain other than `chain` exercises the
   * "wrong network → wallet_switchEthereumChain → 4902 → wallet_addEthereumChain" path a fresh wallet takes.
   */
  startChainId?: number
  /** Show a small overlay describing each wallet action (handy in recorded footage). */
  hud?: boolean
}

const WALLET_INFO = {
  name: 'Baserate E2E Wallet',
  rdns: 'org.baserate.e2e',
  icon: `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b6e5f"/><path d="M9 17l5 5 9-12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ).toString('base64')}`,
}

export class E2EWallet {
  readonly account: PrivateKeyAccount
  readonly chain: Chain
  readonly publicClient: PublicClient
  readonly sent: SentTx[] = []
  readonly signedTypedData: SignedTypedData[] = []
  readonly addedChains: unknown[] = []
  readonly calls: { method: string; at: number }[] = []
  private readonly rpcUrl: string
  private readonly walletClient
  private readonly hud: boolean
  private authorized = false
  private currentChainId: number
  private readonly knownChains = new Set<number>()
  private rpcId = 0

  constructor(opts: E2EWalletOptions) {
    this.account = privateKeyToAccount(opts.privateKey)
    this.chain = opts.chain
    const rpcUrl = opts.chain.rpcUrls.default.http[0]
    if (!rpcUrl) throw new Error(`Chain ${opts.chain.id} has no RPC URL`)
    this.rpcUrl = rpcUrl
    // The single public testnet RPC drops connections in bursts; retry patiently (re-broadcasting the same
    // signed transaction is idempotent).
    const transport = http(rpcUrl, { retryCount: 6, retryDelay: 1_000 })
    this.publicClient = createPublicClient({ chain: opts.chain, transport })
    this.walletClient = createWalletClient({ account: this.account, chain: opts.chain, transport })
    this.currentChainId = opts.startChainId ?? opts.chain.id
    this.knownChains.add(this.currentChainId)
    this.hud = opts.hud ?? false
  }

  get address(): Address {
    return this.account.address
  }

  get chainId(): number {
    return this.currentChainId
  }

  /** Inject the provider into every page of `context` (call before opening pages). */
  async install(context: BrowserContext): Promise<void> {
    await context.exposeBinding('__baserateE2EWallet', (_source, req: WalletRequest) =>
      this.handle(req),
    )
    await context.addInitScript(injectProvider, {
      info: { ...WALLET_INFO, uuid: randomUUID() },
      hud: this.hud,
    })
  }

  /** Waits for the next transaction sent after `count` transactions, i.e. the one a click just triggered. */
  async nextTx(count: number, timeoutMs = 120_000): Promise<SentTx> {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const tx = this.sent[count]
      if (tx) return tx
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`The dapp did not send a transaction within ${timeoutMs / 1000}s`)
  }

  private async handle(req: WalletRequest): Promise<WalletResponse> {
    const method = req.method
    const params = req.params ?? []
    this.calls.push({ method, at: Date.now() })
    try {
      return await this.dispatch(method, params)
    } catch (e) {
      const err = e as Partial<RpcErrorShape> & { shortMessage?: string; details?: string }
      return {
        error: {
          code: typeof err.code === 'number' ? err.code : -32603,
          message: err.shortMessage ?? err.message ?? String(e),
          data: err.data,
        },
      }
    }
  }

  private async dispatch(method: string, params: unknown[]): Promise<WalletResponse> {
    const me = this.address
    switch (method) {
      case 'eth_chainId':
        return { result: numberToHex(this.currentChainId) }
      case 'net_version':
        return { result: String(this.currentChainId) }
      case 'eth_accounts':
        return { result: this.authorized ? [me] : [] }
      case 'eth_requestAccounts': {
        const changed = !this.authorized
        this.authorized = true
        return {
          result: [me],
          events: changed ? [{ event: 'accountsChanged', data: [me] }] : [],
          hud: changed ? 'Connected' : undefined,
        }
      }
      case 'wallet_requestPermissions':
        this.authorized = true
        return { result: this.permissions(), hud: 'Connected' }
      case 'wallet_getPermissions':
        return { result: this.authorized ? this.permissions() : [] }
      case 'wallet_revokePermissions':
        this.authorized = false
        return { result: null, events: [{ event: 'accountsChanged', data: [] }] }
      case 'wallet_switchEthereumChain': {
        const id = hexToNumber((params[0] as { chainId: Hex }).chainId)
        if (!this.knownChains.has(id))
          throw rpcError(4902, `Unrecognized chain ID ${numberToHex(id)}. Try adding the chain.`)
        return this.switchTo(id)
      }
      case 'wallet_addEthereumChain': {
        const p = params[0] as { chainId: Hex; rpcUrls?: string[]; chainName?: string }
        const id = hexToNumber(p.chainId)
        if (id !== this.chain.id)
          throw rpcError(4901, `This test wallet only signs for chain ${this.chain.id}`)
        this.addedChains.push(p)
        this.knownChains.add(id)
        // Like MetaMask, adding a network also switches to it.
        const switched = this.switchTo(id)
        return { ...switched, hud: `Added network ${p.chainName ?? id} and switched` }
      }
      case 'wallet_watchAsset':
        return { result: true, hud: 'Token added to wallet' }
      case 'eth_sendTransaction':
        return this.sendTransaction(params[0] as RpcTx)
      case 'eth_signTypedData_v4':
        return this.signTypedData(params[0] as Address, params[1] as string)
      case 'personal_sign': {
        this.requireAuthorized()
        const [message, from] = params as [Hex, Address]
        this.requireSelf(from)
        return {
          result: await this.account.signMessage({ message: { raw: message } }),
          hud: 'Signed a message',
        }
      }
      case 'eth_sign':
      case 'eth_signTransaction':
      case 'wallet_sendCalls':
      case 'wallet_getCapabilities':
      case 'wallet_showCallsStatus':
        throw rpcError(4200, `${method} is not supported by this wallet`)
      default:
        return { result: await this.forward(method, params) }
    }
  }

  private switchTo(id: number): WalletResponse {
    const changed = this.currentChainId !== id
    this.currentChainId = id
    return {
      result: null,
      events: changed ? [{ event: 'chainChanged', data: numberToHex(id) }] : [],
      hud: changed ? `Switched to chain ${id}` : undefined,
    }
  }

  private permissions() {
    return [
      {
        parentCapability: 'eth_accounts',
        caveats: [{ type: 'restrictReturnedAccounts', value: [this.address] }],
        date: Date.now(),
      },
    ]
  }

  private requireAuthorized() {
    if (!this.authorized) throw rpcError(4100, 'The requested account has not been authorized')
  }

  private requireSelf(from: Address | undefined) {
    if (from && !isAddressEqual(from, this.address))
      throw rpcError(4100, `This wallet does not control ${from}`)
  }

  private async sendTransaction(tx: RpcTx): Promise<WalletResponse> {
    this.requireAuthorized()
    this.requireSelf(tx.from)
    if (this.currentChainId !== this.chain.id)
      throw rpcError(4901, `Wallet is on chain ${this.currentChainId}, not ${this.chain.id}`)
    const value = tx.value ? hexToBigInt(tx.value) : 0n
    // Respect the gas limit the dapp set (Baserate sends estimate × 1.3); only estimate when it is missing.
    const gas = tx.gas ? hexToBigInt(tx.gas) : undefined
    const nonce = await this.publicClient.getTransactionCount({
      address: this.address,
      blockTag: 'pending',
    })
    const fees =
      tx.maxFeePerGas !== undefined
        ? {
            maxFeePerGas: hexToBigInt(tx.maxFeePerGas),
            maxPriorityFeePerGas:
              tx.maxPriorityFeePerGas !== undefined
                ? hexToBigInt(tx.maxPriorityFeePerGas)
                : undefined,
          }
        : tx.gasPrice !== undefined
          ? { gasPrice: hexToBigInt(tx.gasPrice) }
          : {}
    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      chain: this.chain,
      to: tx.to ?? null,
      data: tx.data ?? tx.input,
      value,
      gas,
      nonce,
      ...fees,
    } as never)
    this.sent.push({
      hash,
      to: tx.to ?? null,
      data: tx.data ?? tx.input ?? null,
      value,
      gas,
      sentAt: Date.now(),
    })
    return { result: hash, hud: `Sent transaction ${hash.slice(0, 10)}…` }
  }

  private async signTypedData(from: Address, json: string): Promise<WalletResponse> {
    this.requireAuthorized()
    this.requireSelf(from)
    const parsed = JSON.parse(json) as {
      domain: Record<string, unknown>
      types: Record<string, unknown>
      primaryType: string
      message: Record<string, unknown>
    }
    const { EIP712Domain: _domainTypes, ...types } = parsed.types
    const domain = parsed.domain as { chainId?: number | string; name?: string }
    if (domain.chainId !== undefined && Number(domain.chainId) !== this.currentChainId)
      throw rpcError(
        -32602,
        `Typed data is for chain ${domain.chainId}, wallet is on ${this.chainId}`,
      )
    const signature = await this.account.signTypedData({
      domain: parsed.domain,
      types,
      primaryType: parsed.primaryType,
      message: parsed.message,
    } as TypedDataDefinition)
    this.signedTypedData.push({
      primaryType: parsed.primaryType,
      domainName: domain.name,
      message: parsed.message,
    })
    return {
      result: signature,
      hud: `Signed ${parsed.primaryType}${domain.name ? ` (${domain.name})` : ''}`,
    }
  }

  /** Forwards a read to the RPC, retrying transport failures; a JSON-RPC error is the node's answer. */
  private async forward(method: string, params: unknown[]): Promise<unknown> {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      let body: { result?: unknown; error?: RpcErrorShape }
      try {
        const res = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method, params }),
        })
        if (!res.ok) throw new Error(`RPC HTTP ${res.status} for ${method}`)
        body = (await res.json()) as typeof body
      } catch (e) {
        lastError = e
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)))
        continue
      }
      if (body.error) throw rpcError(body.error.code, body.error.message, body.error.data)
      return body.result
    }
    throw rpcError(-32603, `RPC unreachable for ${method}: ${String(lastError)}`)
  }
}

interface RpcTx {
  from?: Address
  to?: Address
  data?: Hex
  input?: Hex
  value?: Hex
  gas?: Hex
  gasPrice?: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
}

function rpcError(code: number, message: string, data?: unknown): RpcErrorShape & Error {
  return Object.assign(new Error(message), { code, data })
}

/**
 * Runs in the page before any app script. Must be self-contained: Playwright serialises it.
 */
function injectProvider(cfg: {
  info: { uuid: string; name: string; icon: string; rdns: string }
  hud: boolean
}) {
  type Listener = (data: unknown) => void
  type Bridge = (req: { method: string; params?: unknown[] }) => Promise<{
    result?: unknown
    error?: { code: number; message: string; data?: unknown }
    events?: { event: string; data: unknown }[]
    hud?: string
  }>
  const w = window as unknown as { __baserateE2EWallet: Bridge; ethereum?: unknown }
  const listeners = new Map<string, Set<Listener>>()
  const emit = (event: string, data: unknown) => {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try {
        fn(data)
      } catch (e) {
        console.error('[e2e-wallet] listener failed', e)
      }
    }
  }

  let hudEl: HTMLDivElement | null = null
  let hudTimer: ReturnType<typeof setTimeout> | undefined
  const showHud = (text: string) => {
    if (!cfg.hud || !document.body) return
    if (!hudEl) {
      hudEl = document.createElement('div')
      hudEl.setAttribute('data-e2e-hud', '')
      hudEl.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:2147483647;pointer-events:none;' +
        'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;' +
        'background:rgba(13,16,19,.88);color:#fff;font:600 13px/1.2 system-ui,sans-serif;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.25);transition:opacity .3s;opacity:0'
      document.body.appendChild(hudEl)
    }
    hudEl.innerHTML = `<img src="${cfg.info.icon}" width="18" height="18" alt=""/><span></span>`
    const span = hudEl.querySelector('span')
    if (span) span.textContent = `Wallet · ${text}`
    hudEl.style.opacity = '1'
    clearTimeout(hudTimer)
    hudTimer = setTimeout(() => {
      if (hudEl) hudEl.style.opacity = '0'
    }, 3500)
  }

  const provider = {
    isBaserateE2E: true,
    isMetaMask: false,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      const res = await w.__baserateE2EWallet({ method, params: params ?? [] })
      if (res.hud) showHud(res.hud)
      for (const ev of res.events ?? []) emit(ev.event, ev.data)
      if (res.error) {
        throw Object.assign(new Error(res.error.message), {
          code: res.error.code,
          data: res.error.data,
        })
      }
      return res.result
    },
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(fn)
      return provider
    },
    removeListener(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn)
      return provider
    },
    off(event: string, fn: Listener) {
      return provider.removeListener(event, fn)
    },
  }

  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true })
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: cfg.info, provider }),
      }),
    )
  window.addEventListener('eip6963:requestProvider', announce)
  announce()

  if (cfg.hud) {
    // A visible cursor and click ripple, since recorded videos do not show the pointer.
    const addCursor = () => {
      const dot = document.createElement('div')
      dot.setAttribute('data-e2e-cursor', '')
      dot.style.cssText =
        'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
        'background:rgba(11,110,95,.35);border:2px solid #0b6e5f;z-index:2147483647;pointer-events:none;' +
        'transition:transform .12s ease;transform:translate(-100px,-100px)'
      document.body.appendChild(dot)
      let x = -100
      let y = -100
      document.addEventListener(
        'mousemove',
        (e) => {
          x = e.clientX
          y = e.clientY
          dot.style.transform = `translate(${x}px,${y}px)`
        },
        true,
      )
      document.addEventListener(
        'mousedown',
        () => {
          dot.style.transform = `translate(${x}px,${y}px) scale(.7)`
        },
        true,
      )
      document.addEventListener(
        'mouseup',
        () => {
          dot.style.transform = `translate(${x}px,${y}px)`
        },
        true,
      )
    }
    if (document.body) addCursor()
    else document.addEventListener('DOMContentLoaded', addCursor)
  }
}
