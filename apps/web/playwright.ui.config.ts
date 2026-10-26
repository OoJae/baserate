import { defineConfig, devices } from '@playwright/test'

/**
 * UI contract checks (e2e/ui): the app pages keep the surface the live judge journey (e2e/journey.spec.ts) drives,
 * checked in seconds with no funded key and no transaction. Runs against a production build served by
 * `vite preview`; nothing here signs or sends anything (the connected checks use a fresh, unfunded key).
 *
 *   pnpm --filter web build && pnpm --filter web exec playwright test -c playwright.ui.config.ts
 *
 *   UI_BASE_URL   test a running server instead (e.g. a preview on another port); no local preview is started
 *   UI_PORT       local preview port (default 4305)
 *   UI_SHOTS_DIR  also write screenshots of the 7 app pages, light and dark, for each project's viewport
 *
 * Projects: desktop-1440 and mobile-375 (touch). Kept out of `pnpm --filter web e2e`: playwright.config.ts ignores
 * e2e/ui.
 */
const port = Number(process.env.UI_PORT ?? 4305)
const baseURL = process.env.UI_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e/ui',
  outputDir: './e2e/.output/ui-results',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'mobile-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.UI_BASE_URL
    ? undefined
    : {
        command: `./node_modules/.bin/vite preview --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
})
