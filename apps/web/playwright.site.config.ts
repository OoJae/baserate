import { defineConfig, devices } from '@playwright/test'

/**
 * Site checks (e2e/site): the landing, /how-it-works, /security, /brand and the 404, with no wallet. Runs against a
 * production build served by `vite preview`, which mirrors vercel.json's rewrites and headers; the CSP is enforcing
 * here (BASERATE_PREVIEW_CSP=enforce), so a violation fails loudly instead of only being reported.
 *
 *   pnpm --filter web build && pnpm --filter web exec playwright test -c playwright.site.config.ts
 *
 *   SITE_BASE_URL   test a running server instead (e.g. a Vercel preview); no local preview is started
 *   SITE_PORT       local preview port (default 4174, so it never collides with a dev preview on 4173)
 *
 * Projects: desktop-1440, mobile-375, webkit-375, reduced-1440, reduced-375 and nowebgl-375 (Chromium without
 * WebGL). Specs read `testInfo.project.name` for project-specific expectations.
 */
const port = Number(process.env.SITE_PORT ?? 4174)
const baseURL = process.env.SITE_BASE_URL ?? `http://localhost:${port}`

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
const mobile = {
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

export default defineConfig({
  testDir: './e2e/site',
  outputDir: './e2e/.output/site-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], ...mobile } },
    { name: 'webkit-375', use: { ...devices['iPhone 13'], ...mobile } },
    {
      name: 'reduced-1440',
      use: {
        ...devices['Desktop Chrome'],
        ...desktop,
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    {
      name: 'reduced-375',
      use: { ...devices['Desktop Chrome'], ...mobile, contextOptions: { reducedMotion: 'reduce' } },
    },
    {
      name: 'nowebgl-375',
      use: {
        ...devices['Desktop Chrome'],
        ...mobile,
        launchOptions: { args: ['--disable-3d-apis'] },
      },
    },
  ],
  webServer: process.env.SITE_BASE_URL
    ? undefined
    : {
        command: `./node_modules/.bin/vite preview --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        env: { BASERATE_PREVIEW_CSP: 'enforce' },
        timeout: 60_000,
      },
})
