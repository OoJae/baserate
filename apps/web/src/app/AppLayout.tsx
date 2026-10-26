import '@rainbow-me/rainbowkit/styles.css'

import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { AppShell } from '../components/AppShell'
import { ToastProvider } from '../components/Toaster'
import { useZone } from '../RootLayout'
import { rainbowTheme } from '../theme/rainbow'
import { appChain, wagmiConfig } from '../wagmi'

/**
 * The app layout route (/borrow … /evidence), loaded lazily: the wallet stack (wagmi, RainbowKit and its styles), the
 * toasts and the app shell download only when someone opens the app, never on the landing. The QueryClientProvider
 * sits above it in main.tsx, so the site and the app share one cache. The e2e wallet answers EIP-6963's
 * requestProvider, so a wagmi config created this late still discovers it.
 */
export function AppLayout() {
  useZone('app')
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider
        initialChain={appChain}
        theme={rainbowTheme}
        modalSize="compact"
        appInfo={{ appName: 'Baserate' }}
      >
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  )
}
