import {
  type BaserateRegistry,
  getRegistry,
  isDeployed,
  isMarketKnown,
  mezoLocalFork,
  mezoTestnet,
  transportFor,
} from '@baserate/sdk'
import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit'
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { QueryClient } from '@tanstack/react-query'
import { createPublicClient } from 'viem'
import { createConfig } from 'wagmi'
import { hashFn } from 'wagmi/query'
import { env } from './env'

/** Wave 1 runs on Mezo testnet only (or a local fork of it for development). */
export const appChain = env.localFork ? mezoLocalFork : mezoTestnet
export type AppChain = typeof appChain

export const registry: BaserateRegistry = getRegistry(appChain.id)

/** Which Baserate contracts are live on the app chain. */
export const deployed = {
  oracle: isDeployed(registry.contracts.oracle.address),
  factory: isDeployed(registry.contracts.factory.address),
  wsMusd: isDeployed(registry.contracts.wsMusd.address),
  dispenser: isDeployed(registry.contracts.dispenser.address),
  market: isMarketKnown(registry.markets.M1.id),
  backstop: isDeployed(registry.contracts.backstop.address),
  flashLiquidator: isDeployed(registry.contracts.flashLiquidator.address),
  feeRouter: isDeployed(registry.contracts.feeRouter.address),
  riskLens: isDeployed(registry.contracts.riskLens.address),
  vault:
    isDeployed(registry.contracts.vMusd.address) &&
    isDeployed(registry.contracts.allocator.address) &&
    isDeployed(registry.contracts.wsMusdAdapter.address),
} as const

const appInfo = {
  appName: 'Baserate',
  appDescription: 'Redemption-free BTC → MUSD credit on Mezo',
  appUrl: 'https://baserate-mezo.vercel.app',
}

/**
 * With a Reown project id we offer the usual wallets including WalletConnect. Without one, only injected
 * wallets (plus anything announced over EIP-6963) are offered, so the app still works with zero config.
 */
const walletList: WalletList = env.walletConnectProjectId
  ? [
      { groupName: 'Popular', wallets: [metaMaskWallet, rabbyWallet, okxWallet] },
      { groupName: 'More', wallets: [walletConnectWallet, injectedWallet] },
    ]
  : [{ groupName: 'Browser wallets', wallets: [injectedWallet, rabbyWallet] }]

const connectors = connectorsForWallets(walletList, {
  ...appInfo,
  projectId: env.walletConnectProjectId ?? '',
})

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors,
  transports: {
    [mezoTestnet.id]: transportFor(mezoTestnet),
    [mezoLocalFork.id]: transportFor(mezoLocalFork),
  },
  multiInjectedProviderDiscovery: true,
  ssr: false,
})

/**
 * A public client with no multicall batching, for calls that spend Skip precompile reads (RiskLens.snapshot,
 * FlashLiquidator previews). Mezo allows 20 precompile calls per eth_call, so these must never be aggregated with
 * other reads into one Multicall3 call the way wagmi batches `useReadContract`. JSON-RPC batching (several eth_calls
 * in one HTTP request) is fine: the limit is per call.
 */
export const directClient = createPublicClient({
  chain: appChain,
  transport: transportFor(appChain),
  batch: { multicall: false },
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: hashFn,
      staleTime: 4_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
