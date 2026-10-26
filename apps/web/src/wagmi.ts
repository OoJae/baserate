import { mezoLocalFork, mezoTestnet, transportFor } from '@baserate/sdk'
import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit'
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createPublicClient } from 'viem'
import { createConfig } from 'wagmi'
import { appChain } from './chain'
import { env } from './env'

/*
 * Wallet wiring (wagmi + RainbowKit connectors). Only the lazily loaded app imports this module, so the landing never
 * downloads wallet code. The chain, the registry and the QueryClient live in light modules of their own and are
 * re-exported here, so app imports from './wagmi' keep working.
 */
export { type AppChain, appChain, deployed, registry } from './chain'
export { queryClient } from './queryClient'

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

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
