import '@rainbow-me/rainbowkit/styles.css'
import './styles.css'

import { darkTheme, lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { ToastProvider } from './components/Toaster'
import { router } from './router'
import { appChain, queryClient, wagmiConfig } from './wagmi'

const rkCommon = { borderRadius: 'medium', fontStack: 'system', overlayBlur: 'small' } as const

const rainbowTheme = {
  lightMode: lightTheme({ ...rkCommon, accentColor: '#0b6e5f', accentColorForeground: '#ffffff' }),
  darkMode: darkTheme({ ...rkCommon, accentColor: '#3cc2a6', accentColorForeground: '#04201a' }),
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={appChain}
          theme={rainbowTheme}
          modalSize="compact"
          appInfo={{ appName: 'Baserate' }}
        >
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
