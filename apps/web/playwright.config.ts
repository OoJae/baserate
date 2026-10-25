import { defineConfig } from '@playwright/test'

/**
 * Live judge-journey e2e (see e2e/journey.spec.ts). Runs against real Mezo testnet contracts with a funded
 * test key, so it is opt-in: `pnpm --filter web e2e`.
 *
 *   E2E_BASE_URL         site under test (default https://baserate-mezo.vercel.app; e.g. http://localhost:4173)
 *   E2E_WALLET_KEY_FILE  private key file of the funded test wallet (default ~/.baserate/e2e-wallet.key)
 *   E2E_MEDIA_DIR        when set, record one video per journey stage plus full-page screenshots there
 *   E2E_SLOWMO           ms between browser actions (default 150 when recording, else 0)
 *   E2E_START_CHAIN      chain the wallet starts on (default 1, so the add-network flow runs)
 *   E2E_SKIP_CLAIM=1     skip the once-a-day dispenser claim (debugging runs)
 *   E2E_HEADED=1         show the browser
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/.output/**',
  outputDir: './e2e/.output/test-results',
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: process.env.E2E_HEADED !== '1',
    launchOptions: {
      slowMo: Number(process.env.E2E_SLOWMO ?? (process.env.E2E_MEDIA_DIR ? 150 : 0)),
    },
  },
})
