import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Secrets never reach the bundle: only BASERATE_PUBLIC_* variables are exposed through import.meta.env.
// Do not add `define` for env values and never call loadEnv(mode, cwd, '') here (see scripts/check-bundle.mjs).
export default defineConfig({
  envPrefix: 'BASERATE_PUBLIC_',
  plugins: [react(), tailwindcss()],
  resolve: {
    // One copy of each web3 runtime, so `instanceof` checks in @baserate/sdk see wagmi's errors.
    dedupe: ['viem', 'wagmi', '@tanstack/react-query', 'react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
  },
})
