import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mezoTestnet } from '@baserate/sdk'
import { expect, type Page, test } from '@playwright/test'
import { generatePrivateKey } from 'viem/accounts'
import { parseUiNumber } from '../chain'
import { E2EWallet } from '../wallet'

/**
 * The app's e2e-protected surface (the Intaglio app plan, section 1), checked against a production build with no
 * funded key and no transaction. The live judge journey (e2e/journey.spec.ts) drives these exact headings, region
 * names, test ids, input ids and texts on Mezo testnet; a restyle that breaks one fails here first, in seconds.
 *
 * Matching follows the journey: role names are case-insensitive substrings unless `exact`, and `getByText`, CSS and
 * test-id locators also see hidden elements, so a duplicate anywhere in the DOM is a strict-mode failure there.
 */

type RegionName = string | { name: string; exact: true }

interface AppPage {
  h1: string
  /** Regions the journey resolves on this page that render without a wallet: each exactly once. */
  regions: RegionName[]
  /** Regions that depend on the wallet or on chain state: never more than once. */
  maybe?: RegionName[]
}

const APP: Record<string, AppPage> = {
  '/borrow': {
    h1: 'MUSD against your BTC, with no redemption queue',
    regions: ['Borrow MUSD against BTC', 'Oracle', 'Redemption risk: none', 'Get test funds'],
    maybe: ['Your position', 'Your walkthrough'],
  },
  '/save': {
    h1: 'wsMUSD: sMUSD savings as an ERC-4626 token',
    regions: ['Get test funds'],
    maybe: ['Your savings'],
  },
  '/lend': {
    h1: 'vMUSD: lend MUSD to BTC borrowers',
    regions: [{ name: 'Vault', exact: true }, 'Get test funds'],
    maybe: ['Your position'],
  },
  '/liquidate': {
    h1: 'Zero-capital liquidations for M1',
    regions: ['Positions', 'Backstop'],
    maybe: ['Liquidation preview'],
  },
  '/risk': {
    h1: 'RiskLens: the whole risk picture in one call',
    regions: ['Sources', 'Liquidation depth', 'MUSD redemption queue', 'Oracle'],
  },
  '/fees': {
    h1: 'Origination fees go back to Mezo',
    regions: ['Next distribution', 'Distributions', 'Pending governance: fee switch'],
  },
  '/evidence': {
    h1: 'Don’t trust the UI. Check the chain.',
    regions: ['On-chain evidence', { name: 'Keeper', exact: true }, 'Contracts'],
  },
}

const PATHS = Object.keys(APP)

/** The journey's screenshot settle wait: no skeleton left in <main>. Evidence verifies every tx 3 at a time. */
const settleTimeout = (path: string) => (path === '/evidence' ? 120_000 : 60_000)

function region(page: Page, r: RegionName) {
  return typeof r === 'string'
    ? page.getByRole('region', { name: r })
    : page.getByRole('region', { name: r.name, exact: true })
}

const label = (r: RegionName) => (typeof r === 'string' ? r : `${r.name} (exact)`)

async function settle(page: Page, path: string) {
  await expect(page.locator('main [aria-hidden].animate-pulse')).toHaveCount(0, {
    timeout: settleTimeout(path),
  })
}

/** Non-empty ::before/::after content on anything that carries an accessible name (names include it). */
async function pseudoContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const named =
      'h1, h2, h3, h4, button, [role="tab"], [role="button"], a[href], label, dt, summary'
    const found: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(named))) {
      if (el.closest('[data-rk]')) continue // RainbowKit's own markup is not ours to restyle
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(el, pseudo).content
        if (content && content !== 'none' && content !== 'normal' && content !== '""')
          found.push(
            `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 40)}" ${pseudo} ${content}`,
          )
      }
    }
    return found
  })
}

/** Decorative SVGs inside named elements must be aria-hidden and carry no <title> or <text>. */
async function namedSvgs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    for (const svg of Array.from(
      document.querySelectorAll<SVGSVGElement>(
        'main svg, header svg, nav svg, aside svg, section[aria-label] svg',
      ),
    )) {
      if (svg.closest('[data-rk]')) continue
      const host = svg.closest('button, a[href], h1, h2, h3, [role="tab"], label')
      if (!host) continue
      if (svg.getAttribute('aria-hidden') !== 'true' || svg.querySelector('title, text'))
        found.push(`${host.tagName.toLowerCase()} "${host.textContent?.trim().slice(0, 40)}"`)
    }
    return found
  })
}

test.describe('app pages keep the journey’s surface (no wallet)', () => {
  for (const path of PATHS) {
    const spec = APP[path] as AppPage
    test(`${path}: one h1, every region once, one Connect button, settles`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(path)

      // Exactly one level-1 heading, with the exact text, and it is the page's own (inside <main>).
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(spec.h1)
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator('main h1')).toHaveCount(1)

      // The stock RainbowKit button, once, visible at this width.
      const connect = page.getByTestId('rk-connect-button')
      await expect(connect).toBeVisible({ timeout: 30_000 })
      await expect(connect).toHaveCount(1)

      // Every region the journey resolves on this page, exactly once; the toasts' region on every app page.
      for (const r of spec.regions)
        await expect(region(page, r), `region ${label(r)}`).toHaveCount(1, { timeout: 30_000 })
      await expect(page.getByRole('region', { name: 'Notifications' })).toHaveCount(1)
      for (const r of spec.maybe ?? [])
        expect(await region(page, r).count(), `region ${label(r)}`).toBeLessThanOrEqual(1)

      // Skeletons are text-free while they show, and all of them go once the reads land.
      const skeletonText = await page
        .locator('main [aria-hidden].animate-pulse')
        .evaluateAll((els) => els.map((e) => e.textContent ?? '').join(''))
      expect(skeletonText, 'skeletons carry no text').toBe('')
      await settle(page, path)
      await expect(page.locator('main .animate-pulse:not([aria-hidden])')).toHaveCount(0)

      // "Max" is clicked page-wide with exact: true, so there is never more than one.
      expect(
        await page.getByRole('button', { name: 'Max', exact: true }).count(),
      ).toBeLessThanOrEqual(1)

      // No dialog unless one was opened (the journey picks the wallet from RainbowKit's dialog).
      await expect(page.getByRole('dialog')).toHaveCount(0)

      expect(await pseudoContent(page), 'non-empty pseudo content on named elements').toEqual([])
      expect(await namedSvgs(page), 'decorative SVGs that could join a name').toEqual([])

      // No horizontal scroll at any width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(0)
      expect(errors, 'page errors').toEqual([])
    })
  }

  test('/borrow: the LTV slider starts at 30% and the card has no alert', async ({ page }) => {
    await page.goto('/borrow')
    const card = page.getByRole('region', { name: 'Borrow MUSD against BTC' })
    await expect(card).toBeVisible()
    await expect(page.locator('#ltv')).toHaveValue('3000')
    await expect(card.getByText('30.0%', { exact: true })).toBeVisible()
    await expect(page.locator('#btc-in')).toHaveCount(1)
    await expect(card.locator('span:text-is("You receive") + span')).toHaveCount(1)
    await expect(card.locator('dt:has-text("Debt") + dd')).toHaveText('0.00 MUSD', {
      timeout: 30_000,
    })
    await expect(card.getByText(/^Reverts instead of borrowing if the price moves/)).toHaveCount(0)
    await expect(card.getByRole('alert')).toHaveCount(0)
  })

  test('/save and /lend: the action tabs are a tablist with Deposit selected', async ({ page }) => {
    await page.goto('/save')
    await expect(page.getByRole('tab', { name: 'Deposit' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('#ws-deposit')).toHaveCount(1)
    await page.getByRole('tab', { name: 'Redeem' }).click()
    await expect(page.getByRole('tab', { name: 'Redeem' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#ws-redeem')).toHaveCount(1)
    // The native checkbox, visible and named by its label.
    await expect(page.getByRole('checkbox', { name: /Redeem in kind/ })).toBeVisible()

    await page.goto('/lend')
    await expect(page.getByRole('tab', { name: 'Deposit' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('#vault-deposit')).toHaveCount(1)
    await page.getByRole('tab', { name: 'Withdraw' }).click()
    await expect(page.getByRole('tab', { name: 'Withdraw' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('/risk: the depth table keeps 8 rows and the vAMM column third', async ({ page }) => {
    await page.goto('/risk')
    const depth = page.getByRole('region', { name: 'Liquidation depth' })
    await expect(depth.locator('tbody tr')).toHaveCount(8, { timeout: 60_000 })
    await expect(depth.locator('thead th').nth(2)).toHaveText('vAMM pays')
    expect(
      parseUiNumber(await depth.locator('tbody tr').first().locator('td').nth(2).textContent()),
    ).toBeGreaterThan(0)
    await expect(page.getByRole('region', { name: 'Sources' })).toContainText(
      'MUSD/USD pool: not on this network',
      { timeout: 60_000 },
    )
    await expect(page.getByRole('region', { name: 'Oracle' })).toContainText(
      /Price OK|Guard active/,
    )
  })

  test('/evidence: every Baserate contract row says Verified, each entry is verified live', async ({
    page,
  }) => {
    await page.goto('/evidence')
    const list = page.getByRole('region', { name: 'On-chain evidence' })
    const badge = list.getByText(/^\d+ recorded$/)
    await expect(badge).toBeVisible()
    const entries = parseUiNumber(await badge.textContent())
    await expect(list.getByText('Verified live', { exact: true })).toHaveCount(entries, {
      timeout: 120_000,
    })
    // Page-wide too: the serial strip and the chrome repeat none of it.
    await expect(page.getByText('Verified live', { exact: true })).toHaveCount(entries)
    const ours = page
      .getByRole('region', { name: 'Contracts' })
      .locator('tr', { hasText: 'Baserate' })
    expect(await ours.count()).toBeGreaterThan(0)
    for (let i = 0; i < (await ours.count()); i++)
      await expect(ours.nth(i)).toContainText(/Verified/, { timeout: 60_000 })
  })

  test('the press ring plays from the pointer, and not under reduced motion', async ({ page }) => {
    await page.goto('/borrow')
    const button = page
      .getByRole('region', { name: 'Borrow MUSD against BTC' })
      .getByRole('button', { name: 'Connect wallet', exact: true })
    await expect(button).toBeVisible()
    await button.dispatchEvent('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
    })
    await expect(button).toHaveClass(/\bis-ringing\b/)
    const ring = await button.evaluate((el) => getComputedStyle(el, '::after').animationName)
    expect(ring).toBe('btn-ring')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await expect(button).toBeVisible()
    await button.dispatchEvent('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
    })
    await expect(button).not.toHaveClass(/\bis-ringing\b/)
  })

  test('the More sheet is a dialog only while open, and gives focus back', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'the tab bar is the phone layout')
    await page.goto('/borrow')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const more = page.getByRole('button', { name: 'More', exact: true })
    await more.click()
    const sheet = page.getByRole('dialog', { name: 'More' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-autofocus]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(more).toBeFocused()

    await more.click()
    await sheet.getByRole('link', { name: /^Risk/ }).click()
    await expect(page).toHaveURL(/\/risk$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'RiskLens: the whole risk picture in one call',
    )
  })
})

test.describe('connected (a fresh, unfunded key; nothing is signed or sent)', () => {
  test('the account button shows the address, and the Borrow preview names its button', async ({
    context,
  }) => {
    const wallet = new E2EWallet({ privateKey: generatePrivateKey(), chain: mezoTestnet })
    await wallet.install(context)
    const page = await context.newPage()
    await page.goto('/borrow')
    await expect(page.getByTestId('rk-connect-button')).toBeVisible({ timeout: 30_000 })
    // Authorise the injected provider the way RainbowKit's Connect would, then let wagmi reconnect on load: no
    // clicks on the page.
    await page.evaluate(() =>
      (
        window as unknown as { ethereum: { request: (a: { method: string }) => Promise<unknown> } }
      ).ethereum.request({ method: 'eth_requestAccounts' }),
    )
    await page.reload()
    const account = page.getByTestId('rk-account-button')
    await expect(account).toBeVisible({ timeout: 30_000 })
    await expect(account).toContainText(wallet.address.slice(0, 4))
    await expect(page.getByTestId('rk-connect-button')).toHaveCount(0)
    await expect(page.getByText(/^Your wallet is on /)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Your walkthrough' })).toHaveCount(1)
    expect(
      await page.getByRole('button', { name: 'Max', exact: true }).count(),
    ).toBeLessThanOrEqual(1)

    // The borrow preview, typed the way the journey types it: the TxButton is named by its amount.
    const card = page.getByRole('region', { name: 'Borrow MUSD against BTC' })
    await page.locator('#btc-in').pressSequentially('0.0009', { delay: 40 })
    const receive = card.locator('span:text-is("You receive") + span')
    await expect(receive).toContainText(/\d/, { timeout: 30_000 })
    const button = card.getByRole('button', { name: /^Borrow [\d.,]+ MUSD$/ })
    await expect(button).toBeVisible({ timeout: 30_000 })
    await expect(button).toHaveText(
      `Borrow ${parseUiNumber(await receive.textContent()).toFixed(2)} MUSD`,
    )
    await expect(card.getByText(/^Reverts instead of borrowing if the price moves/)).toBeVisible()
    await expect(card.getByText('30.0%', { exact: true })).toBeVisible()
    await expect(card.getByRole('alert')).toHaveCount(0)

    for (const path of ['/save', '/lend', '/liquidate', '/risk', '/fees']) {
      await page.goto(path)
      await expect(page.getByTestId('rk-account-button'), path).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('rk-account-button')).toContainText(wallet.address.slice(0, 4))
      expect(
        await page.getByRole('button', { name: 'Max', exact: true }).count(),
        `${path}: Max`,
      ).toBeLessThanOrEqual(1)
    }
    await page.goto('/save')
    await expect(page.getByRole('region', { name: 'Your savings' })).toHaveCount(1)
    await page.goto('/lend')
    await expect(page.getByRole('region', { name: 'Your position' })).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Vault', exact: true })).toHaveCount(1)
    expect(wallet.sent, 'nothing sent').toEqual([])
  })
})

test.describe('screenshots (UI_SHOTS_DIR)', () => {
  const dir = process.env.UI_SHOTS_DIR
  for (const path of PATHS) {
    test(`${path}, light and dark`, async ({ page }, testInfo) => {
      test.skip(!dir, 'set UI_SHOTS_DIR to write screenshots')
      if (!dir) return
      mkdirSync(dir, { recursive: true })
      const width = page.viewportSize()?.width ?? 0
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(APP[path]?.h1 ?? '')
        await page.evaluate(() => document.fonts.ready)
        await settle(page, path)
        await page.waitForTimeout(800)
        await page.screenshot({
          path: join(dir, `${path.slice(1)}-${width}-${scheme}.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
      testInfo.annotations.push({ type: 'screenshots', description: dir })
    })
  }
})
