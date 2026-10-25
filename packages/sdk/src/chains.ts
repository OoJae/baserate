import {
  type Chain,
  defineChain,
  type FallbackTransport,
  fallback,
  type HttpTransport,
  http,
} from 'viem'

/**
 * Mezo chain definitions.
 *
 * Defined by hand on purpose: viem 2.57.11's built-in `mezo` chain still points at the dead
 * `https://rpc.mezo.org` and has no multicall3 entry. The values below were verified against the live
 * networks (see docs/design/offchain.md §0 and §1).
 */

/** Multicall3, deployed at the canonical address on both Mezo networks. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export const MEZO_TESTNET_ID = 31_611 as const
export const MEZO_MAINNET_ID = 31_612 as const
/** Local anvil fork of Mezo testnet (`anvil --fork-url https://rpc.test.mezo.org --chain-id 31337`). */
export const MEZO_LOCAL_FORK_ID = 31_337 as const

const nativeCurrency = { name: 'Bitcoin', symbol: 'BTC', decimals: 18 } as const

/** Mezo testnet. A single public RPC: the app shows a banner when it stops answering. */
export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_ID,
  name: 'Mezo Testnet',
  nativeCurrency,
  rpcUrls: {
    default: { http: ['https://rpc.test.mezo.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Mezo Explorer',
      url: 'https://explorer.test.mezo.org',
      apiUrl: 'https://api.explorer.test.mezo.org/api',
    },
  },
  contracts: {
    // Creation tx 0x07471adf…84ed1 (Blockscout).
    multicall3: { address: MULTICALL3, blockCreated: 3_669_328 },
  },
  testnet: true,
})

/** Mezo mainnet with every RPC verified live (CORS `*`, JSON-RPC batching). `rpc.mezo.org` is dead. */
export const mezo = defineChain({
  id: MEZO_MAINNET_ID,
  name: 'Mezo',
  nativeCurrency,
  rpcUrls: {
    default: {
      http: [
        'https://mezo-mainnet.boar.network',
        'https://rpc-internal.mezo.org',
        'https://mainnet.mezo.public.validationcloud.io',
        'https://jsonrpc-mezo.boar.network',
        'https://mezo.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Mezo Explorer',
      url: 'https://explorer.mezo.org',
      apiUrl: 'https://api.explorer.mezo.org/api',
    },
  },
  contracts: {
    multicall3: { address: MULTICALL3, blockCreated: 351_760 },
  },
})

/** Local development: an anvil fork of Mezo testnet with chain id 31337 and the Skip mock etched in. */
export const mezoLocalFork = defineChain({
  id: MEZO_LOCAL_FORK_ID,
  name: 'Mezo Testnet (local fork)',
  nativeCurrency,
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
  testnet: true,
})

export const supportedChains = [mezoTestnet, mezo, mezoLocalFork] as const
export type SupportedChain = (typeof supportedChains)[number]
export type SupportedChainId = SupportedChain['id']

export function isSupportedChainId(id: number | undefined): id is SupportedChainId {
  return supportedChains.some((c) => c.id === id)
}

export function chainById(id: SupportedChainId): SupportedChain {
  const chain = supportedChains.find((c) => c.id === id)
  if (!chain) throw new Error(`Unsupported chain ${id}`)
  return chain
}

/**
 * A fallback transport over every RPC of the chain, with JSON-RPC batching and two retries each.
 * Mezo RPCs cap `eth_getLogs` at 10,000 blocks; use chunked log reads for history.
 */
export function transportFor(chain: Chain): FallbackTransport<HttpTransport[]> {
  return fallback(
    chain.rpcUrls.default.http.map((url) => http(url, { batch: true, retryCount: 2 })),
  )
}

/** Gas reserve kept back by "Max" buttons so the user can still pay for the transaction. */
export function gasReserveWei(chainId: number): bigint {
  // 0.00001 BTC on mainnet, 0.000001 BTC on testnet (offchain.md §2).
  return chainId === MEZO_MAINNET_ID ? 10_000_000_000_000n : 1_000_000_000_000n
}

/** Mezo enforces at most 20 precompile calls per transaction (Skip reads count); keep a margin. */
export const MAX_PRECOMPILE_CALLS_PER_MULTICALL = 15
