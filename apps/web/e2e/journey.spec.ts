import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  backstopAbi,
  borrowAccountAbi,
  borrowAccountFactoryAbi,
  btcMusdOracleAbi,
  erc20PermitAbi,
  feeRouterAbi,
  flashLiquidatorAbi,
  formatBtc,
  formatMusd,
  impliedMusdLeg,
  liquidationBtcUsd,
  mezoTestnet,
  musdDispenserAbi,
  RiskSource,
  riskLensAbi,
  shortAddress,
  toFixedDecimal,
  Venue,
  vaultV2Abi,
  WAD,
  wsMusdAbi,
  wsMusdLiquidityAdapterAbi,
} from '@baserate/sdk'
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import {
  type Abi,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  isAddressEqual,
  parseEventLogs,
  type TransactionReceipt,
} from 'viem'
import evidenceJson from '../src/evidence.json' with { type: 'json' }
import { formatUtc } from '../src/lib/time'
import { Chain, canaryAccounts, fmt18, parseUiNumber, type Snapshot, uiNumberOrNaN } from './chain'
import { E2EWallet, type SentTx } from './wallet'

/**
 * The 5-minute judge journey (docs/JUDGES.md), end to end on Mezo testnet with a real signing wallet:
 * connect → borrow 0.0009 BTC at 30% LTV → claim test MUSD → wsMUSD deposit (permit), redeem, redeem in kind →
 * repay & withdraw → Evidence, then the Wave 2 pages: vMUSD deposit and withdrawal on Lend, and live reads on
 * Liquidate, Risk and Fees (a liquidation is sent only if a position is actually liquidatable). Each on-chain step
 * is confirmed from the RPC (and with `cast` when installed), never from the UI alone.
 */

const here = dirname(fileURLToPath(import.meta.url))
const BASE_URL = (process.env.E2E_BASE_URL ?? 'https://baserate-mezo.vercel.app').replace(/\/$/, '')
const KEY_FILE = process.env.E2E_WALLET_KEY_FILE ?? join(homedir(), '.baserate', 'e2e-wallet.key')
const MEDIA_DIR = process.env.E2E_MEDIA_DIR ? resolve(process.env.E2E_MEDIA_DIR) : null
/** Full-page screenshots only (no video): E2E_PHOTO_DIR, else alongside the videos in E2E_MEDIA_DIR. */
const PHOTO_DIR = process.env.E2E_PHOTO_DIR ? resolve(process.env.E2E_PHOTO_DIR) : MEDIA_DIR
const START_CHAIN = Number(process.env.E2E_START_CHAIN ?? 1)
/** The dispenser allows one claim per address per UTC day; debugging runs can save it for the real run. */
const SKIP_CLAIM = process.env.E2E_SKIP_CLAIM === '1'
const OUTPUT_DIR = join(here, '.output')
const VIEWPORT = { width: 1440, height: 900 }

const BTC_IN = 900_000_000_000_000n // 0.0009 BTC
const BTC_IN_TEXT = '0.0009'
const TARGET_LTV_BPS = 3_000n
const DEPOSIT_TEXT = '5'
const DEPOSIT = 5n * 10n ** 18n
const REDEEM_TEXT = '2'
const REDEEM = 2n * 10n ** 18n
const LEND_TEXT = '3'
const LEND = 3n * 10n ** 18n
const MOBILE = { width: 390, height: 844 }
/** Gas (in wei of BTC) the journey may spend; Mezo testnet fees are tiny, this is a generous ceiling. */
const GAS_BUDGET = 100_000_000_000_000n

interface StepRecord {
  step: string
  tx: Hex
  block: string
  gasUsed: string
  castStatus: string | null
  before: Snapshot
  after: Snapshot
  notes: Record<string, string>
}

const journey = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  wallet: '',
  steps: [] as StepRecord[],
  pageErrors: [] as string[],
  consoleErrors: [] as string[],
  skipped: [] as string[],
}

test.describe.configure({ mode: 'serial' })

test.describe('judge journey on Mezo testnet', () => {
  test.skip(
    !existsSync(KEY_FILE),
    `No e2e wallet key at ${KEY_FILE}. Create one (e.g. \`cast wallet new\`), store only the private key in that file (chmod 600), fund it with ~0.003 testnet BTC and ~20 MUSD, or point E2E_WALLET_KEY_FILE at another key.`,
  )

  let wallet: E2EWallet
  /** Same key, separate state: takes screenshots from unrecorded contexts without touching the journey's wallet. */
  let photoWallet: E2EWallet
  let chain: Chain
  let session: Session | null = null
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined

  test.beforeAll(async () => {
    const key = readFileSync(KEY_FILE, 'utf8').trim() as Hex
    if (!/^0x[0-9a-fA-F]{64}$/.test(key))
      throw new Error(`${KEY_FILE} must hold one 0x-prefixed private key`)
    wallet = new E2EWallet({
      privateKey: key,
      chain: mezoTestnet,
      startChainId: START_CHAIN,
      hud: !!MEDIA_DIR,
    })
    photoWallet = new E2EWallet({ privateKey: key, chain: mezoTestnet })
    chain = new Chain(wallet.publicClient, mezoTestnet.rpcUrls.default.http[0])
    journey.wallet = wallet.address
    const s = await chain.snapshot(wallet.address)
    console.log(
      `[e2e] ${BASE_URL} · wallet ${wallet.address} · ${fmt18(s.btc)} BTC · ${fmt18(s.musd, 2)} MUSD · cast ${chain.hasCast ? 'on' : 'off'}`,
    )
    const needBtc = (s.collateral > 0n ? 0n : BTC_IN) + GAS_BUDGET
    if (s.btc < needBtc)
      throw new Error(
        `Wallet ${wallet.address} has ${fmt18(s.btc)} BTC; the journey needs ${fmt18(needBtc)}. Fund it from the faucet or the deployer.`,
      )
    if (MEDIA_DIR) mkdirSync(MEDIA_DIR, { recursive: true })
    if (PHOTO_DIR) mkdirSync(PHOTO_DIR, { recursive: true })
    mkdirSync(OUTPUT_DIR, { recursive: true })
  })

  test.afterEach(async () => {
    await finishStage()
  })

  test.afterAll(() => {
    if (!wallet) return
    const file = join(OUTPUT_DIR, `journey-${journey.startedAt.replace(/[:.]/g, '-')}.json`)
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...journey,
          castLog: chain?.castLog ?? [],
          castUnavailable: chain?.unavailable ?? [],
          sent: wallet.sent,
          signed: wallet.signedTypedData,
        },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    )
    console.log(`[e2e] journey log: ${file}`)
    if (journey.pageErrors.length)
      console.log(`[e2e] page errors:\n${journey.pageErrors.join('\n')}`)
    for (const s of journey.steps)
      console.log(`[e2e] ${s.step.padEnd(22)} ${s.tx} block ${s.block}`)
  })

  // ---------------------------------------------------------------------------------------------------------
  // Helpers bound to the shared wallet/chain
  // ---------------------------------------------------------------------------------------------------------

  async function open(browser: Browser, name: string, path: string): Promise<Session> {
    session = await Session.open(browser, wallet, name, storageState)
    await session.page.goto(`${BASE_URL}${path}`)
    await ensureConnected(session.page)
    return session
  }

  /** Closes the recorded session (publishing its video) and keeps its wagmi session for the next stage. */
  async function finishStage() {
    if (!session) return
    storageState = await session.close()
    session = null
  }

  /**
   * Full-page screenshot from a separate, unrecorded context: a full-page capture briefly resizes the viewport,
   * which would show up as a glitch in the recorded video.
   */
  async function photograph(
    browser: Browser,
    name: string,
    path: string,
    ready: (page: Page) => Promise<void> = async () => {},
    viewport: { width: number; height: number } = VIEWPORT,
  ) {
    if (!PHOTO_DIR) return
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    })
    try {
      await photoWallet.install(context)
      const page = await context.newPage()
      await page.goto(`${BASE_URL}${path}`)
      await ensureConnected(page, photoWallet)
      await ready(page)
      // Let polled reads (balances, oracle ages, explorer badges) settle before the capture.
      await expect(page.locator('main [aria-hidden].animate-pulse'))
        .toHaveCount(0, { timeout: 30_000 })
        .catch(() => console.log(`[e2e] ${name}.png: some values were still loading`))
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: join(PHOTO_DIR, `${name}.png`), fullPage: true })
    } finally {
      await context.close()
    }
  }

  async function ensureConnected(page: Page, w: E2EWallet = wallet) {
    const account = page.getByTestId('rk-account-button')
    const connect = page.getByTestId('rk-connect-button')
    await expect(account.or(connect).first()).toBeVisible({ timeout: 30_000 })
    if (await connect.isVisible()) {
      await connect.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /Baserate E2E Wallet/ }).click()
    }
    await expect(account).toBeVisible({ timeout: 30_000 })
    // A wallet that starts on another chain either switches while connecting or gets the one-click banner.
    const switchBtn = page.getByRole('button', { name: /^Switch to Mezo Testnet$/ }).first()
    if (w.chainId !== mezoTestnet.id && (await switchBtn.isVisible().catch(() => false)))
      await switchBtn.click()
    await expect.poll(() => w.chainId, { timeout: 30_000 }).toBe(mezoTestnet.id)
    await expect(page.getByText(/^Your wallet is on /)).toHaveCount(0)
    await expect(account).toContainText(w.address.slice(0, 4))
  }

  /** Clicks a TxButton, waits for the wallet to send, for the receipt and for the success toast. */
  async function sendViaUi(
    page: Page,
    step: string,
    button: Locator,
    successToast: string,
    expectTo: Hex,
    successMessage?: RegExp,
  ): Promise<{ tx: SentTx; receipt: TransactionReceipt; before: Snapshot }> {
    const before = await chain.snapshot(wallet.address)
    await expect(button).toBeEnabled({ timeout: 60_000 })
    const n = wallet.sent.length
    const t0 = Date.now()
    await button.click()
    const tx = await wallet.nextTx(n)
    const tSent = Date.now()
    expect(tx.to && isAddressEqual(tx.to, expectTo), `${step} must call ${expectTo}`).toBe(true)
    // Watch for the 9-second success toast while independently waiting for the receipt: the RPC can serve
    // either side late, and the toast must not expire while the harness is still waiting.
    const toast = page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('status')
      .filter({ hasText: successToast })
    let tToast = 0
    let tMined = 0
    const [receipt] = await Promise.all([
      chain.receipt(tx.hash).then((r) => {
        tMined = Date.now()
        return r
      }),
      (async () => {
        await expect(toast.getByText(successToast, { exact: true })).toBeVisible({
          timeout: 120_000,
        })
        tToast = Date.now()
        if (successMessage) await expect(toast.getByText(successMessage)).toBeVisible()
      })(),
    ])
    expect(receipt.status, `${step} reverted on-chain (${tx.hash})`).toBe('success')
    const secs = (a: number, b: number) => ((b - a) / 1000).toFixed(1)
    console.log(
      `[e2e] ${step}: ${tx.hash} (block ${receipt.blockNumber}, gas ${receipt.gasUsed}) · click→sent ${secs(t0, tSent)}s, sent→receipt ${secs(tSent, tMined)}s, sent→toast ${secs(tSent, tToast)}s`,
    )
    return { tx, receipt, before }
  }

  async function record(
    step: string,
    r: { tx: SentTx; receipt: TransactionReceipt; before: Snapshot },
    after: Snapshot,
    notes: Record<string, string> = {},
  ) {
    journey.steps.push({
      step,
      tx: r.tx.hash,
      block: r.receipt.blockNumber.toString(),
      gasUsed: r.receipt.gasUsed.toString(),
      castStatus: await chain.castReceipt(r.tx.hash),
      before: r.before,
      after,
      notes,
    })
  }

  /** Waits until the chain reflects `ok` (the RPC can trail the receipt by a block), then cross-checks it. */
  async function settled(ok: (s: Snapshot) => boolean, label: string): Promise<Snapshot> {
    await expect
      .poll(async () => ok(await chain.snapshot(wallet.address, { crossCheck: false })), {
        timeout: 30_000,
        message: label,
      })
      .toBe(true)
    const s = await chain.snapshot(wallet.address)
    expect(ok(s), label).toBe(true)
    return s
  }

  function gasCost(r: TransactionReceipt): bigint {
    return r.gasUsed * r.effectiveGasPrice
  }

  async function repayAndExit(page: Page, step: string) {
    const position = page.getByRole('region', { name: 'Your position' })
    await expect(position).toBeVisible({ timeout: 30_000 })
    await expect(position.getByRole('tab', { name: 'Repay & withdraw' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const start = await chain.snapshot(wallet.address)
    await expect(position.locator('dt:has-text("BTC returned") + dd')).toContainText(
      `${formatBtc(start.collateral)} BTC`,
    )
    const button = position.getByRole('button', { name: /^Repay [\d.,]+ MUSD & withdraw BTC$/ })
    await expect(position.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await expect(position.getByRole('alert')).toHaveCount(0)
    await pause(page, 1_500)
    const signedBefore = wallet.signedTypedData.length
    const r = await sendViaUi(page, step, button, 'Position closed', start.account)
    // Permit path: one EIP-2612 signature over MUSD, then repayAndWithdrawWithPermit.
    expect(wallet.signedTypedData.length).toBe(signedBefore + 1)
    expect(wallet.signedTypedData.at(-1)?.domainName).toBe('Mezo USD')
    const call = decode(borrowAccountAbi, r.tx)
    expect(call.functionName).toBe('repayAndWithdrawWithPermit')
    const after = await settled((s) => s.collateral === 0n && s.debt === 0n, 'position closed')
    // Native BTC comes back: +collateral − gas, to the wei.
    expect(after.btc - r.before.btc).toBe(r.before.collateral - gasCost(r.receipt))
    const repaid = r.before.musd - after.musd
    expect(repaid >= r.before.debt, 'repaid at least the debt read before the tx').toBe(true)
    expect(repaid - r.before.debt < 10n ** 15n, 'interest between read and tx < 0.001 MUSD').toBe(
      true,
    )
    await expect(
      page.getByText(/^Position closed\. [\d.]+ BTC is back in your wallet\.$/),
    ).toBeVisible()
    await record(step, r, after, {
      btcReturned: fmt18(r.before.collateral, 8),
      musdRepaid: fmt18(repaid, 8),
      gasCost: gasCost(r.receipt).toString(),
    })
  }

  // ---------------------------------------------------------------------------------------------------------
  // The journey
  // ---------------------------------------------------------------------------------------------------------

  test('0 · close a leftover position from an earlier run', async ({ browser }) => {
    const s = await chain.snapshot(wallet.address)
    test.skip(!(s.accountDeployed && (s.collateral > 0n || s.debt > 0n)), 'No open position')
    const { page } = await open(browser, 'cleanup', '/borrow')
    await repayAndExit(page, 'cleanup-repay-exit')
  })

  test('1 · connect and borrow 0.0009 BTC at 30% LTV', async ({ browser }) => {
    await photograph(browser, 'borrow-preview', '/borrow', async (page) => {
      await page.locator('#btc-in').fill(BTC_IN_TEXT)
      await expect(page.getByRole('button', { name: /^Borrow [\d.,]+ MUSD$/ })).toBeEnabled({
        timeout: 60_000,
      })
    })
    const ses = await open(browser, '01-borrow', '/borrow')
    const { page } = ses
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'MUSD against your BTC, with no redemption queue',
    )
    // The add-network path really ran when the wallet started elsewhere.
    if (START_CHAIN !== mezoTestnet.id) {
      const added = wallet.addedChains[0] as {
        rpcUrls?: string[]
        nativeCurrency?: { symbol?: string }
      }
      expect(added?.rpcUrls?.[0]).toBe('https://rpc.test.mezo.org')
      expect(added?.nativeCurrency?.symbol).toBe('BTC')
    }

    const card = page.getByRole('region', { name: 'Borrow MUSD against BTC' })
    await expect(card).toBeVisible()
    await expect(page.locator('#ltv')).toHaveValue('3000')
    await expect(card.getByText('30.0%', { exact: true })).toBeVisible()
    const slippageNote = card.getByText(/^Reverts instead of borrowing if the price moves/)
    // Once the live quote has loaded (Debt reads 0.00), an empty form must not talk about reverting a borrow.
    await expect(card.locator('dt:has-text("Debt") + dd')).toHaveText('0.00 MUSD', {
      timeout: 30_000,
    })
    await expect(slippageNote).toHaveCount(0)
    await page.locator('#btc-in').pressSequentially(BTC_IN_TEXT, { delay: 90 })
    await expect(slippageNote).toBeVisible()

    // Preview vs an independent quote from the live oracle and factory config.
    const row = (label: string) => card.locator(`dt:has-text("${label}") + dd`)
    const receive = card.locator('span:text-is("You receive") + span')
    await expect(receive).toContainText(/\d/, { timeout: 30_000 })
    const button = card.getByRole('button', { name: /^Borrow [\d.,]+ MUSD$/ })
    await expect(button).toBeEnabled({ timeout: 60_000 })
    await expect(card.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await expect(card.getByRole('alert')).toHaveCount(0)

    const price = await wallet.publicClient.readContract({
      address: chain.registry.contracts.oracle.address,
      abi: btcMusdOracleAbi,
      functionName: 'price',
    })
    const feeBps = await wallet.publicClient.readContract({
      address: chain.registry.contracts.factory.address,
      abi: borrowAccountFactoryAbi,
      functionName: 'ORIGINATION_FEE_BPS',
    })
    const value = (BTC_IN * price) / 10n ** 36n
    const expectedOut =
      (((value * TARGET_LTV_BPS) / 10_000n) * 10_000n) / (10_000n + BigInt(feeBps))
    const ui = {
      receive: parseUiNumber(await receive.textContent()),
      fee: parseUiNumber(await row('Origination fee').textContent()),
      debt: parseUiNumber(await row('Debt').textContent()),
      ltv: parseUiNumber(await row('Loan-to-value').textContent()),
      hf: parseUiNumber(await row('Health factor').textContent()),
      liq: parseUiNumber(await row('Liquidation price').textContent()),
      rate: parseUiNumber(await row('Borrow rate').textContent()),
    }
    const expectOut = Number(fmt18(expectedOut, 4))
    const btcUsd = Number(fmt18(value, 4)) / Number(fmt18(BTC_IN, 8))
    console.log(
      `[e2e] preview ${JSON.stringify(ui)} · expected out ≈ ${expectOut} · BTC ${btcUsd.toFixed(2)}`,
    )
    expect(Math.abs(ui.receive - expectOut)).toBeLessThan(expectOut * 0.01 + 0.011)
    expect(ui.fee).toBeCloseTo(ui.receive * (Number(feeBps) / 10_000), 3)
    expect(ui.debt).toBeCloseTo(ui.receive + ui.fee, 1)
    expect(ui.ltv).toBeGreaterThan(29)
    expect(ui.ltv).toBeLessThanOrEqual(30)
    expect(ui.hf).toBeGreaterThan(2.5) // 0.77 / 0.30 ≈ 2.57
    expect(ui.hf).toBeLessThan(2.65)
    const expectLiq = ui.debt / (0.0009 * 0.77)
    expect(Math.abs(ui.liq - expectLiq) / expectLiq).toBeLessThan(0.02)
    expect(ui.rate).toBeGreaterThan(0)
    await expect(button).toHaveText(`Borrow ${ui.receive.toFixed(2)} MUSD`)
    const oraclePanel = page.getByRole('region', { name: 'Oracle' })
    const redemptionPanel = page.getByRole('region', { name: 'Redemption risk: none' })
    await expect(oraclePanel).toContainText('Price OK')
    await expect(redemptionPanel).toContainText('No queue')
    if (MEDIA_DIR) {
      // Point at what the demo narrates: the live oracle, then the absent redemption queue.
      await pause(page, 1_000)
      await oraclePanel.hover()
      await pause(page, 2_000)
      await redemptionPanel.hover()
      await pause(page, 2_000)
      await card.getByText('You receive').hover()
    }
    await pause(page, 1_500)

    const r = await sendViaUi(
      page,
      'borrow',
      button,
      'Borrowed',
      chain.registry.contracts.factory.address,
    )
    const call = decode(borrowAccountFactoryAbi, r.tx)
    expect(call.functionName).toBe('openAndBorrow')
    const [musdOut, maxLtvBps] = call.args as [bigint, bigint]
    expect(Number(fmt18(musdOut, 2))).toBe(ui.receive)
    expect(maxLtvBps).toBe(3_100n) // 30% target + 1% price-move tolerance
    expect(r.tx.value).toBe(BTC_IN)
    const after = await settled(
      (s) => s.accountDeployed && s.collateral === BTC_IN,
      'collateral posted',
    )
    expect(after.musd - r.before.musd).toBe(musdOut)
    expect(after.btc).toBe(r.before.btc - BTC_IN - gasCost(r.receipt))
    const fee = (musdOut * BigInt(feeBps) + 9_999n) / 10_000n
    expect(after.debt >= musdOut + fee).toBe(true)
    expect(after.debt - (musdOut + fee) < 10n ** 14n, 'debt ≈ borrowed + 0.10% fee').toBe(true)

    // The position card shows the same numbers.
    const position = page.getByRole('region', { name: 'Your position' })
    await expect(position).toBeVisible({ timeout: 30_000 })
    const stat = (label: string) => position.locator(`p:text-is("${label}") + p`)
    await expect(stat('Collateral')).toHaveText(`${formatBtc(BTC_IN)} BTC`)
    await expect
      .poll(async () => parseUiNumber(await stat('Debt').textContent()))
      .toBeCloseTo(Number(fmt18(after.debt, 4)), 1)
    const ltvNow = parseUiNumber(await stat('Loan-to-value').textContent())
    expect(ltvNow).toBeGreaterThan(29)
    expect(ltvNow).toBeLessThanOrEqual(30.2)
    await record('borrow', r, after, {
      musdOut: fmt18(musdOut, 2),
      debt: fmt18(after.debt, 8),
      account: after.account,
      uiPreview: JSON.stringify(ui),
    })
    await pause(page, 1_500)

    await pause(page, 1_500)
    await finishStage()
    await photograph(browser, 'borrow-position', '/borrow', async (page) => {
      await expect(page.getByRole('region', { name: 'Your position' })).toBeVisible()
    })
  })

  test('2 · claim test MUSD from the dispenser (Get test funds card)', async ({ browser }) => {
    const before = await chain.snapshot(wallet.address)
    if (SKIP_CLAIM) journey.skipped.push('dispenser claim: E2E_SKIP_CLAIM=1')
    test.skip(SKIP_CLAIM, 'E2E_SKIP_CLAIM=1')
    if (before.dispenserClaimable === 0n)
      journey.skipped.push('dispenser claim: already claimed today (resets 00:00 UTC)')
    test.skip(before.dispenserClaimable === 0n, 'Already claimed today; resets at 00:00 UTC')
    const ses = await open(browser, '02-claim', '/borrow')
    const { page } = ses
    const funds = page.getByRole('region', { name: 'Get test funds' })
    await funds.scrollIntoViewIfNeeded()
    await pause(page, 1_000)
    const claim = funds.getByRole('button', { name: /^Claim [\d.,]+ test MUSD$/ })
    await expect(claim).toHaveText(`Claim ${formatMusd(before.dispenserClaimable)} test MUSD`)
    await pause(page, 1_000)
    const c = await sendViaUi(
      page,
      'dispenser-claim',
      claim,
      'Test MUSD claimed',
      chain.registry.contracts.dispenser.address,
    )
    expect(decode(musdDispenserAbi, c.tx).functionName).toBe('claim')
    const claimed = await settled((s) => s.dispenserClaimable === 0n, 'claim recorded')
    expect(claimed.musd - c.before.musd).toBe(c.before.dispenserClaimable)
    await expect(funds.getByRole('button', { name: 'Nothing to claim today' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(funds.locator('p:text-is("Wallet MUSD") + p')).toHaveText(formatMusd(claimed.musd))
    await record('dispenser-claim', c, claimed, { claimed: fmt18(c.before.dispenserClaimable, 2) })
    await pause(page, 2_000)
  })

  test('3 · save: deposit 5 MUSD into wsMUSD with a permit, redeem, redeem in kind', async ({
    browser,
  }) => {
    const ses = await open(browser, '03-save', '/save')
    const { page } = ses
    const ws = chain.registry.contracts.wsMusd.address
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'wsMUSD: sMUSD savings as an ERC-4626 token',
    )
    await expect(page.getByRole('tab', { name: 'Deposit' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.locator('#ws-deposit').pressSequentially(DEPOSIT_TEXT, { delay: 90 })
    const expectedShares = await wallet.publicClient.readContract({
      address: ws,
      abi: wsMusdAbi,
      functionName: 'previewDeposit',
      args: [DEPOSIT],
    })
    await expect(page.getByText(/^You receive ≈ [\d.,]+ wsMUSD$/)).toBeVisible()
    const uiShares = parseUiNumber(
      await page.getByText(/^You receive ≈ [\d.,]+ wsMUSD$/).textContent(),
    )
    expect(uiShares).toBeCloseTo(Number(fmt18(expectedShares, 4)), 3)
    const deposit = page.getByRole('button', { name: /^Deposit [\d.,]+ MUSD$/ })
    await expect(page.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await pause(page, 1_500)
    const signedBefore = wallet.signedTypedData.length
    const d = await sendViaUi(page, 'wsmusd-deposit', deposit, 'Deposited', ws)
    expect(wallet.signedTypedData.length).toBe(signedBefore + 1)
    expect(wallet.signedTypedData.at(-1)?.primaryType).toBe('Permit')
    expect(decode(wsMusdAbi, d.tx).functionName).toBe('depositWithPermit')
    const deposited = await settled((s) => s.wsMusd > d.before.wsMusd, 'wsMUSD minted')
    expect(d.before.musd - deposited.musd).toBe(DEPOSIT)
    const minted = deposited.wsMusd - d.before.wsMusd
    // Shares minted at the tx block; the share price only rises, so at most what the preview promised.
    expect(minted <= expectedShares && expectedShares - minted < 10n ** 15n).toBe(true)
    const savings = page.getByRole('region', { name: 'Your savings' })
    await expect
      .poll(async () =>
        parseUiNumber(await savings.locator('p:text-is("wsMUSD") + p').textContent()),
      )
      .toBeCloseTo(Number(fmt18(deposited.wsMusd, 4)), 3)
    await record('wsmusd-deposit', d, deposited, { shares: fmt18(minted, 8) })
    await pause(page, 1_500)

    // Redeem 2 wsMUSD for MUSD.
    await page.getByRole('tab', { name: 'Redeem' }).click()
    await page.locator('#ws-redeem').pressSequentially(REDEEM_TEXT, { delay: 90 })
    const expectedAssets = await wallet.publicClient.readContract({
      address: ws,
      abi: wsMusdAbi,
      functionName: 'previewRedeem',
      args: [REDEEM],
    })
    const redeem = page.getByRole('button', { name: /^Redeem for [\d.,]+ MUSD$/ })
    await expect(redeem).toHaveText(
      `Redeem for ${Number(fmt18(expectedAssets, 2)).toFixed(2)} MUSD`,
    )
    await expect(page.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await pause(page, 1_200)
    const rd = await sendViaUi(
      page,
      'wsmusd-redeem',
      redeem,
      'Redeemed',
      ws,
      /^[\d.,]+ MUSD sent to your wallet\.$/,
    )
    expect(decode(wsMusdAbi, rd.tx).functionName).toBe('redeem')
    const redeemed = await settled((s) => s.wsMusd === rd.before.wsMusd - REDEEM, 'shares burned')
    const got = redeemed.musd - rd.before.musd
    expect(got >= expectedAssets && got - expectedAssets < 10n ** 15n).toBe(true)
    await record('wsmusd-redeem', rd, redeemed, { musdOut: fmt18(got, 8) })
    await pause(page, 1_200)

    // Redeem the rest in kind with Max: sMUSD 1:1 plus any vested MUSD, leaving no wsMUSD dust behind.
    await page.locator('#ws-redeem').fill('')
    // Max reads the refreshed balance (the UI refetches after the previous receipt).
    await expect(
      page.getByText(`Balance ${formatMusd(redeemed.wsMusd, { dp: 4 })} wsMUSD`, { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Max', exact: true }).click()
    await page.getByRole('checkbox', { name: /Redeem in kind/ }).check()
    const inKind = page.getByRole('button', { name: 'Redeem in kind', exact: true })
    await expect(page.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await pause(page, 1_200)
    const k = await sendViaUi(
      page,
      'wsmusd-redeem-in-kind',
      inKind,
      'Redeemed',
      ws,
      /^[\d.,]+ sMUSD( and [\d.,]+ MUSD)? sent to your wallet\.$/,
    )
    const inKindCall = decode(wsMusdAbi, k.tx)
    expect(inKindCall.functionName).toBe('redeemInKind')
    expect((inKindCall.args as readonly bigint[])[0], 'Max redeems every share').toBe(
      k.before.wsMusd,
    )
    const kind = await settled((s) => s.wsMusd === 0n, 'in-kind burn of every share')
    const smusdOut = kind.smusd - k.before.smusd
    expect(smusdOut > 0n, 'received sMUSD').toBe(true)
    // The payout stays visible: Your savings shows the sMUSD.
    await expect
      .poll(async () =>
        parseUiNumber(await savings.locator('p:text-is("Wallet sMUSD") + p').textContent()),
      )
      .toBeCloseTo(Number(fmt18(kind.smusd, 4)), 3)
    await record('wsmusd-redeem-in-kind', k, kind, {
      shares: fmt18(k.before.wsMusd, 8),
      smusdOut: fmt18(smusdOut, 8),
      musdOut: fmt18(kind.musd - k.before.musd, 8),
    })
    await pause(page, 1_500)
    await finishStage()
    await photograph(browser, 'save', '/save')
  })

  test('4 · repay & withdraw returns native BTC', async ({ browser }) => {
    const ses = await open(browser, '04-repay-exit', '/borrow')
    const { page } = ses
    await repayAndExit(page, 'repay-exit')
    await expect(page.getByRole('region', { name: 'Your position' })).toHaveCount(0)
    // Deposit → redeem everything still counts as "Save in wsMUSD" done: the whole walkthrough is ticked.
    await expect(page.getByRole('region', { name: 'Your walkthrough' })).toContainText(
      '4 of 4 done',
      {
        timeout: 30_000,
      },
    )
    await pause(page, 2_500)
    await finishStage()
    await photograph(browser, 'borrow-closed', '/borrow', async (page) => {
      await expect(page.getByRole('region', { name: 'Your walkthrough' })).toContainText('4 of 4')
    })
  })

  test('5 · evidence page re-verifies every recorded transaction live', async ({ browser }) => {
    const ses = await open(browser, '05-evidence', '/evidence')
    const { page } = ses
    const list = page.getByRole('region', { name: 'On-chain evidence' })
    const badge = list.getByText(/^\d+ recorded$/)
    await expect(badge).toBeVisible()
    const entries = parseUiNumber(await badge.textContent())
    // The deployed site may trail or lead this checkout's evidence.json; a local build must match it exactly.
    if (!BASE_URL.startsWith('https://')) expect(entries).toBe(evidenceJson.entries.length)
    expect(entries).toBeGreaterThan(0)
    await expect(list.getByText('Verified live', { exact: true })).toHaveCount(entries, {
      timeout: 90_000,
    })
    for (const bad of ['Not found', 'Transaction failed', 'Block mismatch', 'Explorer unreachable'])
      await expect(list.getByText(bad, { exact: true })).toHaveCount(0)
    // Calls into Baserate contracts show method names, not bare selectors Blockscout could not decode.
    await expect(list.getByText('method openAndBorrow', { exact: true })).toBeVisible()
    await expect(list.getByText(/^method 0x[0-9a-fA-F]{8}$/)).toHaveCount(0)
    // Every Baserate contract shows a source-verified badge (Sourcify exact match or Blockscout).
    const ours = page
      .getByRole('region', { name: 'Contracts' })
      .locator('tr', { hasText: 'Baserate' })
    const ourCount = Object.keys(chain.registry.contracts).length
    await expect(ours).toHaveCount(ourCount)
    for (let i = 0; i < ourCount; i++)
      await expect(ours.nth(i), 'Baserate contract verified').toContainText(/Verified/, {
        timeout: 60_000,
      })
    await pause(page, 1_500)
    await smoothScroll(page)
    await finishStage()
    await photograph(browser, 'evidence', '/evidence', async (page) => {
      await expect(page.getByText('Verified live', { exact: true })).toHaveCount(entries, {
        timeout: 90_000,
      })
    })
  })

  // ---------------------------------------------------------------------------------------------------------
  // Wave 2 pages
  // ---------------------------------------------------------------------------------------------------------

  test('6 · lend: deposit 3 MUSD into vMUSD, then withdraw it all', async ({ browser }) => {
    const r = chain.registry
    const vault = r.contracts.vMusd.address
    const adapter = r.contracts.wsMusdAdapter.address
    const c = wallet.publicClient
    const start = await chain.snapshot(wallet.address)
    if (start.musd < LEND) journey.skipped.push(`lend: wallet holds ${fmt18(start.musd, 2)} MUSD`)
    test.skip(start.musd < LEND, 'Not enough MUSD for the vMUSD deposit')

    const { page } = await open(browser, '06-lend', '/lend')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'vMUSD: lend MUSD to BTC borrowers',
    )
    // The vault card agrees with the chain.
    const vaultCard = page.getByRole('region', { name: 'Vault', exact: true })
    const totalAssets = await c.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'totalAssets',
    })
    await expect
      .poll(
        async () =>
          uiNumberOrNaN(await vaultCard.locator('p:text-is("Total assets") + p').textContent()),
        {
          timeout: 60_000,
        },
      )
      .toBeCloseTo(Number(fmt18(totalAssets, 2)), 0)

    // Deposit: approve (when needed), then deposit; the liquidity adapter parks it in wsMUSD in the same call.
    await page.locator('#vault-deposit').pressSequentially(LEND_TEXT, { delay: 90 })
    await expect(page.getByText(/^You receive ≈ [\d.,]+ vMUSD$/)).toBeVisible()
    const allowance = await c.readContract({
      address: r.external.musd,
      abi: erc20PermitAbi,
      functionName: 'allowance',
      args: [wallet.address, vault],
    })
    if (allowance < LEND) {
      const approve = page.getByRole('button', { name: /^1\. Approve [\d.,]+ MUSD$/ })
      const a = await sendViaUi(page, 'vmusd-approve', approve, 'MUSD approved', r.external.musd)
      const call = decode(erc20PermitAbi, a.tx)
      expect(call.functionName).toBe('approve')
      expect(call.args).toEqual([vault, LEND])
      await record('vmusd-approve', a, await chain.snapshot(wallet.address))
    }
    const deposit = page.getByRole('button', { name: /^Deposit [\d.,]+ MUSD$/ })
    await expect(page.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    await pause(page, 1_200)
    const expectedShares = await c.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'previewDeposit',
      args: [LEND],
    })
    const d = await sendViaUi(
      page,
      'vmusd-deposit',
      deposit,
      'Deposited',
      vault,
      /vMUSD minted for/,
    )
    const depCall = decode(vaultV2Abi, d.tx)
    expect(depCall.functionName).toBe('deposit')
    expect(depCall.args).toEqual([LEND, wallet.address])
    const deposited = await settled((s) => s.vMusd > d.before.vMusd, 'vMUSD minted')
    expect(d.before.musd - deposited.musd).toBe(LEND)
    const minted = deposited.vMusd - d.before.vMusd
    expect(minted <= expectedShares && expectedShares - minted < 10n ** 15n).toBe(true)
    const [allocated] = parseEventLogs({
      abi: wsMusdLiquidityAdapterAbi,
      logs: d.receipt.logs.filter((l) => isAddressEqual(l.address, adapter)),
      eventName: 'Allocated',
    })
    expect(allocated?.args.assets, 'deposit allocated to the wsMUSD adapter').toBe(LEND)
    const mine = page.getByRole('region', { name: 'Your position' })
    await expect
      .poll(async () => uiNumberOrNaN(await mine.locator('p:text-is("vMUSD") + p').textContent()))
      .toBeCloseTo(Number(fmt18(deposited.vMusd, 4)), 3)
    await record('vmusd-deposit', d, deposited, {
      shares: fmt18(minted, 8),
      wsMusdDeposited: fmt18(allocated?.args.deposited ?? 0n, 8),
    })
    await pause(page, 1_500)

    // Withdraw everything with Max: exact shares through vMUSD.redeem (idle + wsMUSD covers it, no allocator).
    await page.getByRole('tab', { name: 'Withdraw' }).click()
    await expect(
      page.getByText(
        new RegExp(`^${formatMusd(deposited.vMusd, { dp: 4 }).replace('.', '\\.')} vMUSD ≈`),
      ),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(page.getByText('Straight from vMUSD (redeem).')).toBeVisible()
    const withdraw = page.getByRole('button', { name: /^Withdraw [\d.,]+ MUSD$/ })
    await expect(page.getByText('Simulating on Mezo…')).toHaveCount(0, { timeout: 30_000 })
    const expectedAssets = await c.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'previewRedeem',
      args: [deposited.vMusd],
    })
    await pause(page, 1_200)
    const w = await sendViaUi(
      page,
      'vmusd-withdraw',
      withdraw,
      'Withdrawn',
      vault,
      /MUSD sent to your wallet/,
    )
    const wCall = decode(vaultV2Abi, w.tx)
    expect(wCall.functionName).toBe('redeem')
    expect(wCall.args).toEqual([w.before.vMusd, wallet.address, wallet.address])
    const out = await settled((s) => s.vMusd === 0n, 'every vMUSD share redeemed')
    const got = out.musd - w.before.musd
    // The share price only rises, so at least the preview; and the round trip loses at most rounding dust.
    expect(got >= expectedAssets && got - expectedAssets < 10n ** 15n).toBe(true)
    expect(LEND - got < 10n ** 15n, 'deposit → withdraw round trip').toBe(true)
    await record('vmusd-withdraw', w, out, { musdOut: fmt18(got, 8) })
    await pause(page, 1_500)
    await finishStage()
    await photograph(browser, 'lend', '/lend', async (p) => {
      await expect(p.getByText('MUSD per vMUSD')).toBeVisible()
    })
    await photograph(
      browser,
      'lend-mobile',
      '/lend',
      async (p) => {
        await expect(p.getByText('MUSD per vMUSD')).toBeVisible()
      },
      MOBILE,
    )
  })

  test('7 · liquidate: positions and previews match FlashLiquidator, canary badged', async ({
    browser,
  }) => {
    const r = chain.registry
    const flash = r.contracts.flashLiquidator.address
    const c = wallet.publicClient
    const canaries = await canaryAccounts(chain)
    expect(canaries.length, 'a canary account exists').toBeGreaterThan(0)
    const previews = await Promise.all(
      canaries.map(async (a) => {
        const { result } = await c.simulateContract({
          address: flash,
          abi: flashLiquidatorAbi,
          functionName: 'previewLiquidation',
          args: [a],
        })
        return { account: a, p: result }
      }),
    )
    const live = previews.find((x) => x.p.debt > 0n)
    expect(live, 'an open canary position').toBeTruthy()
    if (!live) return
    const sentBefore = wallet.sent.length

    const { page } = await open(browser, '07-liquidate', '/liquidate')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Zero-capital liquidations for M1',
    )
    const positions = page.getByRole('region', { name: 'Positions' })
    const row = positions.getByRole('button', { name: new RegExp(shortAddress(live.account, 5)) })
    await expect(row).toBeVisible({ timeout: 60_000 })
    await expect(row).toContainText('Canary')
    // LTV in the row vs previewLiquidation read directly (prices tick every few seconds: ±0.1 point).
    await expect(row).toContainText(/Healthy|Liquidatable/, { timeout: 60_000 })
    const ltvUi = parseUiNumber(await row.locator('dt:text-is("LTV · health") + dd').textContent())
    expect(Math.abs(ltvUi - Number(fmt18(live.p.ltvWad * 100n, 2)))).toBeLessThan(0.1)
    // "Liquidatable if BTC ≤ $X": debt / (collateral × LLTV), times the oracle's MUSD leg.
    const status = await c.readContract({
      address: r.contracts.oracle.address,
      abi: btcMusdOracleAbi,
      functionName: 'status',
    })
    const threshold = liquidationBtcUsd(
      live.p.debt,
      live.p.collateral,
      r.lltv,
      impliedMusdLeg(status) ?? WAD,
    )
    const thresholdUi = parseUiNumber(
      await row.locator('dt:text-is("Liquidatable if BTC ≤") + dd').textContent(),
    )
    expect(Math.abs(thresholdUi / Number(fmt18(threshold ?? 0n, 2)) - 1)).toBeLessThan(0.002)

    await row.click()
    const card = page.getByRole('region', { name: 'Liquidation preview' })
    await expect(card).toContainText(shortAddress(live.account))
    const backstopCard = page.getByRole('region', { name: 'Backstop' })
    const nav = await c.readContract({
      address: r.contracts.backstop.address,
      abi: backstopAbi,
      functionName: 'convertToAssets',
      args: [WAD],
    })
    await expect(backstopCard.locator('p:text-is("NAV") + p')).toHaveText(
      toFixedDecimal(nav, 18, 6),
    )

    const fresh = await c.simulateContract({
      address: flash,
      abi: flashLiquidatorAbi,
      functionName: 'previewLiquidation',
      args: [live.account],
    })
    if (fresh.result.liquidatable) {
      // A real liquidation, only because the position is liquidatable right now.
      const venue = [Venue.BACKSTOP, Venue.VAMM].find((v) => fresh.result.quotes[v].ok)
      test.skip(venue === undefined, 'Liquidatable, but no testnet venue can clear it')
      if (venue === undefined) return
      await card
        .getByRole('radio', { name: venue === Venue.VAMM ? /Tigris vAMM/ : /Backstop/ })
        .check()
      const button = card.getByRole('button', { name: /^Liquidate for ≈ [\d.,]+ MUSD profit$/ })
      const l = await sendViaUi(
        page,
        'liquidate',
        button,
        'Liquidated',
        flash,
        /profit sent to you/,
      )
      const call = decode(flashLiquidatorAbi, l.tx)
      expect(call.functionName).toBe('liquidate')
      const [ev] = parseEventLogs({
        abi: flashLiquidatorAbi,
        logs: l.receipt.logs,
        eventName: 'Liquidated',
      })
      expect(ev?.args.borrower).toBe(live.account)
      await record('liquidate', l, await chain.snapshot(wallet.address), {
        venue: String(venue),
        seized: fmt18(ev?.args.seized ?? 0n, 8),
        profit: fmt18(ev?.args.profit ?? 0n, 8),
      })
    } else {
      // Healthy: the button stays disabled with the threshold, and nothing is sent.
      await expect(card).toContainText('Healthy')
      await expect(card.getByRole('button', { name: 'Liquidate', exact: true })).toBeDisabled()
      await expect(
        card.getByText(/^Healthy: liquidatable once BTC is at or below \$[\d,]+\.$/),
      ).toBeVisible()
      // What the vAMM would pay for the whole collateral, against quoteVenues read directly.
      const { result: quote } = await c.simulateContract({
        address: flash,
        abi: flashLiquidatorAbi,
        functionName: 'quoteVenues',
        args: [live.p.collateral],
      })
      const vamm = card.getByText(/^would pay [\d.,]+ MUSD for all/)
      await expect(vamm.first()).toBeVisible({ timeout: 60_000 })
      const vammText = (await vamm.first().textContent()) ?? ''
      const vammUi = parseUiNumber(vammText.replace(/^would pay /, ''))
      expect(Math.abs(vammUi / Number(fmt18(quote[1][Venue.VAMM], 2)) - 1)).toBeLessThan(0.005)
      expect(wallet.sent.length, 'no transaction sent for a healthy position').toBe(sentBefore)
      journey.skipped.push(
        `liquidation: canary ${live.account} healthy at ${fmt18(fresh.result.ltvWad * 100n, 2)}% LTV`,
      )
    }
    await pause(page, 1_500)
    await finishStage()
    await photograph(browser, 'liquidate', '/liquidate', async (p) => {
      await expect(p.getByRole('region', { name: 'Liquidation preview' })).toBeVisible({
        timeout: 60_000,
      })
    })
    await photograph(
      browser,
      'liquidate-mobile',
      '/liquidate',
      async (p) => {
        await expect(p.getByRole('region', { name: 'Liquidation preview' })).toBeVisible({
          timeout: 60_000,
        })
      },
      MOBILE,
    )
  })

  test('8 · risk: the RiskLens dashboard shows the live snapshot', async ({ browser }) => {
    const r = chain.registry
    const { page } = await open(browser, '08-risk', '/risk')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'RiskLens: the whole risk picture in one call',
    )
    const snap = await wallet.publicClient.readContract({
      address: r.contracts.riskLens.address,
      abi: riskLensAbi,
      functionName: 'snapshot',
      args: [
        {
          backstop: r.contracts.backstop.address,
          btcSizes: [10n ** 15n],
          troveCount: 10n,
          twapWindow: 0,
        },
      ],
    })
    // Testnet has no MUSD/USD CL pool and no CL200 depth: skipped = 48, and nothing fails.
    expect(snap.skipped).toBe(RiskSource.MUSD_POOL | RiskSource.CL_DEPTH)
    expect(snap.failed).toBe(0n)
    const sources = page.getByRole('region', { name: 'Sources' })
    await expect(sources).toContainText('MUSD/USD pool: not on this network', { timeout: 60_000 })
    await expect(sources).toContainText('Oracle: read')
    await expect(sources).toContainText('vAMM depth: read')
    const depth = page.getByRole('region', { name: 'Liquidation depth' })
    await expect(depth.locator('tbody tr')).toHaveCount(8)
    const first = parseUiNumber(
      await depth.locator('tbody tr').first().locator('td').nth(2).textContent(),
    )
    expect(Math.abs(first / Number(fmt18(snap.depth[0]?.vammOut ?? 0n, 2)) - 1)).toBeLessThan(0.01)
    const troves = page.getByRole('region', { name: 'MUSD redemption queue' })
    await expect(troves.locator('tbody tr')).toHaveCount(Math.min(10, Number(snap.troves.size)))
    await expect(page.getByRole('region', { name: 'Oracle' })).toContainText(
      snap.oracle.ok ? 'Price OK' : 'Guard active',
    )
    await pause(page, 1_500)
    await smoothScroll(page)
    await finishStage()
    await photograph(browser, 'risk', '/risk', async (p) => {
      await expect(
        p.getByRole('region', { name: 'Liquidation depth' }).locator('tbody tr'),
      ).toHaveCount(8)
    })
  })

  test('9 · fees: FeeRouter preview, distributions and the timelocked fee switch', async ({
    browser,
  }) => {
    const r = chain.registry
    const c = wallet.publicClient
    const router = r.contracts.feeRouter.address
    const executableAt = await c.readContract({
      address: r.contracts.factory.address,
      abi: borrowAccountFactoryAbi,
      functionName: 'executableAt',
      args: [
        encodeFunctionData({
          abi: borrowAccountFactoryAbi,
          functionName: 'setFeeRecipient',
          args: [router],
        }),
      ],
    })
    const plan = await c.readContract({
      address: router,
      abi: feeRouterAbi,
      functionName: 'previewDistribute',
    })
    const { page } = await open(browser, '09-fees', '/fees')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Origination fees go back to Mezo',
    )
    const sw = page.getByRole('region', { name: 'Pending governance: fee switch' })
    if (executableAt > 0n) {
      await expect(sw).toContainText(formatUtc(Number(executableAt)), { timeout: 60_000 })
      if (Number(executableAt) > Date.now() / 1000) await expect(sw).toContainText('Timelocked')
    }
    await expect(sw.getByRole('link', { name: /0xeedbd3…/ })).toBeVisible({ timeout: 60_000 })
    const history = page.getByRole('region', { name: 'Distributions' })
    await expect(history).toContainText('20.00 MUSD split', { timeout: 60_000 })
    await expect(history).toContainText('Bribe 8.00 MUSD on gauge')
    const distribute = page.getByRole('region', { name: 'Next distribution' }).getByRole('button', {
      name: /^Distribute/,
    })
    if (plan.total === 0n) {
      await expect(distribute).toBeDisabled()
      await expect(page.getByText(/^Nothing to distribute: the router holds 0 MUSD/)).toBeVisible()
    }
    await pause(page, 1_500)
    await finishStage()
    await photograph(browser, 'fees', '/fees', async (p) => {
      await expect(p.getByRole('region', { name: 'Distributions' })).toContainText('MUSD split', {
        timeout: 60_000,
      })
    })
  })
})

// -------------------------------------------------------------------------------------------------------------
// Browser session with optional video, carrying the wagmi session (localStorage) from stage to stage
// -------------------------------------------------------------------------------------------------------------

class Session {
  private constructor(
    readonly name: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  static async open(
    browser: Browser,
    wallet: E2EWallet,
    name: string,
    storageState?: Awaited<ReturnType<BrowserContext['storageState']>>,
  ): Promise<Session> {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      storageState,
      recordVideo: MEDIA_DIR ? { dir: join(OUTPUT_DIR, 'video'), size: VIEWPORT } : undefined,
    })
    await wallet.install(context)
    const page = await context.newPage()
    page.on('pageerror', (e) => journey.pageErrors.push(`[${name}] ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') journey.consoleErrors.push(`[${name}] ${m.text().slice(0, 300)}`)
    })
    return new Session(name, context, page)
  }

  /** Closes the context, keeps its storage for the next stage and publishes the video. */
  async close() {
    const state = await this.context.storageState()
    const video = this.page.video()
    await this.context.close()
    if (video && MEDIA_DIR) {
      const webm = join(MEDIA_DIR, `${this.name}.webm`)
      await video.saveAs(webm)
      await video.delete()
      encodeMp4(webm)
    }
    return state
  }
}

/** webm → H.264 mp4 (small, plays everywhere) when ffmpeg is installed; keeps the webm otherwise. */
function encodeMp4(webm: string) {
  const mp4 = webm.replace(/\.webm$/, '.mp4')
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        webm,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        mp4,
      ],
      { stdio: 'inherit' },
    )
    rmSync(webm)
  } catch {
    console.log(`[e2e] ffmpeg unavailable or failed; kept ${webm}`)
  }
}

function decode(abi: Abi, tx: SentTx) {
  if (!tx.data) throw new Error(`Transaction ${tx.hash} has no calldata`)
  return decodeFunctionData({ abi, data: tx.data })
}

async function pause(page: Page, ms: number) {
  if (MEDIA_DIR) await page.waitForTimeout(ms)
}

async function smoothScroll(page: Page) {
  if (!MEDIA_DIR) return
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  for (let y = 0; y <= height; y += 220) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y)
    await page.waitForTimeout(420)
  }
  await page.waitForTimeout(1_500)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await page.waitForTimeout(1_500)
}
