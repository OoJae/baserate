import './brand/tokens.css'
import './styles.css'
import './styles/motion.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { queryClient } from './queryClient'
import { router } from './router'

/*
 * The entry: styles, the shared QueryClient and the router. The wallet providers (wagmi, RainbowKit, toasts) live in
 * the lazily loaded app layout (src/app/AppLayout.tsx), so the landing never downloads them.
 */

/**
 * A deploy replaces the hashed chunks, so a tab opened before it can fail to load a lazy page. Reload once to pick
 * up the new build; a second failure within a minute is left to the router's error screen instead of looping.
 */
const RELOAD_KEY = 'baserate:preload-reload'
window.addEventListener('vite:preloadError', (event) => {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage blocked: never reload, or a missing chunk could reload forever.
    return
  }
  event.preventDefault()
  window.location.reload()
})

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
