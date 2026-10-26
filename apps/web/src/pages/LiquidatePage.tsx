import {
  explorerAddressUrl,
  flashLiquidatorAbi,
  formatBps,
  formatBtc,
  formatDuration,
  formatMusd,
  formatPercentWad,
  formatUsd,
  formatWad,
  liquidationBtcUsd,
  ltv as ltvOf,
  minProfitFor,
  oraclePriceToWad,
  shortAddress,
  VENUE_LABEL,
  Venue,
  type VenueId,
  WAD,
} from '@baserate/sdk'
import { useMemo, useState } from 'react'
import { type Address, isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem'
import { IconLiquidate } from '../components/icons'
import { BackstopCard } from '../components/liquidate/BackstopCard'
import { TxButton } from '../components/TxButton'
import {
  AddressLink,
  Badge,
  Card,
  CardHeader,
  cx,
  Notice,
  PageHeader,
  ReadError,
  Row,
  Skeleton,
  Stat,
  type Tone,
  Value,
} from '../components/ui'
import {
  type CanaryGrant,
  type LiquidationPreview,
  type M1Position,
  positionDebt,
  useCanaryGrant,
  useLiquidationPreviews,
  useLiquidatorConfig,
  useM1Positions,
  useVenueQuotes,
} from '../hooks/useLiquidations'
import { useMarket } from '../hooks/useMarket'
import { useOracle } from '../hooks/useOracle'
import { useWallet } from '../hooks/useWallet'
import { formatUtc } from '../lib/time'
import { useNow } from '../lib/useNow'
import { appChain, deployed, registry } from '../wagmi'

const FLASH = registry.contracts.flashLiquidator.address

/** One row of the positions table: the on-chain position plus its preview when it has loaded. */
interface Row_ extends M1Position {
  debt?: bigint
  ltv?: bigint
  /** collateral × price × LLTV / debt (WAD); null with no debt. */
  health?: bigint | null
  /** BTC/USD at or below which it becomes liquidatable. */
  liqBtcUsd?: bigint | null
  preview?: LiquidationPreview
  previewError?: boolean
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  brand: 'text-brand',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  btc: 'text-btc',
}

function healthTone(h: bigint | null | undefined, liquidatable?: boolean): Tone {
  if (liquidatable) return 'bad'
  if (h === null || h === undefined) return 'neutral'
  if (h < 1_020_000_000_000_000_000n) return 'bad'
  if (h < 1_200_000_000_000_000_000n) return 'warn'
  return 'good'
}

export function LiquidatePage() {
  const wallet = useWallet()
  const oracle = useOracle()
  const market = useMarket()
  const positions = useM1Positions()
  const [showClosed, setShowClosed] = useState(false)
  const [selected, setSelected] = useState<Address | null>(null)

  const all = positions.data ?? []
  const open = all.filter((p) => p.collateral > 0n || p.borrowShares > 0n)
  const canaryOpen = open.some((p) => p.canary)
  // Only needed while no canary is open: when its 48 h operator grant clears (audit fix D-7).
  const grant = useCanaryGrant(!!positions.data && !canaryOpen)
  const previews = useLiquidationPreviews(open.map((p) => p.account))
  const price = oracle.status?.ok ? oracle.status.price : undefined
  const skip = oracle.status?.skipPrice
  const lltv = market.lltv

  const rows: Row_[] = useMemo(() => {
    const byAccount = new Map(open.map((p, i) => [p.account, previews[i]]))
    return all
      .map((p) => {
        const q = byAccount.get(p.account)
        const preview = q?.data
        const debt = preview?.debt ?? positionDebt(p.borrowShares, market.state, market.borrowRate)
        const ltv = preview?.oracleOk
          ? preview.ltvWad
          : debt !== undefined && price
            ? (ltvOf(debt, p.collateral, price) ?? undefined)
            : undefined
        const health =
          debt === undefined || debt === 0n
            ? null
            : ltv !== undefined && ltv > 0n
              ? (lltv * WAD) / ltv
              : undefined
        const liqBtcUsd =
          debt !== undefined
            ? liquidationBtcUsd(debt, p.collateral, lltv, oracle.musdUsed)
            : undefined
        return { ...p, debt, ltv, health, liqBtcUsd, preview, previewError: q?.isError }
      })
      .sort((a, b) => {
        // Liquidatable first, then by health (lowest first), closed positions last.
        const la = a.preview?.liquidatable ? 0 : 1
        const lb = b.preview?.liquidatable ? 0 : 1
        if (la !== lb) return la - lb
        const ha = a.health ?? (a.debt === 0n ? 10n ** 30n : 10n ** 29n)
        const hb = b.health ?? (b.debt === 0n ? 10n ** 30n : 10n ** 29n)
        return ha < hb ? -1 : ha > hb ? 1 : 0
      })
  }, [all, open, previews, market.state, market.borrowRate, price, lltv, oracle.musdUsed])

  const openRows = rows.filter((r) => r.collateral > 0n || r.borrowShares > 0n)
  const closedRows = rows.filter((r) => !(r.collateral > 0n || r.borrowShares > 0n))
  const shown = showClosed ? rows : openRows
  const current =
    rows.find((r) => selected && isAddressEqual(r.account, selected)) ??
    openRows.find((r) => r.canary) ??
    openRows[0]
  const liquidatableCount = rows.filter((r) => r.preview?.liquidatable).length
  const previewsSettled = previews.every((q) => q.data !== undefined || q.isError)

  return (
    <>
      <PageHeader
        eyebrow="Liquidate"
        title="Zero-capital liquidations for M1"
        lede="FlashLiquidator liquidates through Morpho’s callback: it sells the seized BTC to the backstop or the Tigris vAMM, repays the debt from the proceeds and pays you the rest. You need no MUSD, only gas."
      />

      <CanaryNotice loaded={!!positions.data} open={canaryOpen} grant={grant} lltv={lltv} />
      {positions.isError ? (
        <ReadError className="mb-5" what="M1 positions" onRetry={() => void positions.refetch()} />
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <Card aria-labelledby="positions-title">
            <CardHeader
              id="positions-title"
              icon={<IconLiquidate className="size-4" />}
              title="Positions"
              subtitle="Every Baserate borrow account in M1, riskiest first"
              action={
                liquidatableCount > 0 ? (
                  <Badge tone="bad">{liquidatableCount} liquidatable</Badge>
                ) : positions.data && previewsSettled ? (
                  <Badge tone="good">All healthy</Badge>
                ) : null
              }
            />
            {positions.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : shown.length === 0 ? (
              <p className="rounded-[4px] border border-dashed border-line-strong p-5 text-center text-sm text-muted">
                No open positions right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((r) => (
                  <PositionRow
                    key={r.account}
                    row={r}
                    me={wallet.address}
                    skip={skip}
                    active={!!current && isAddressEqual(current.account, r.account)}
                    onSelect={() => setSelected(r.account)}
                  />
                ))}
              </ul>
            )}
            {closedRows.length > 0 ? (
              <button
                type="button"
                className="mt-3 rounded-[2px] text-sm font-medium text-brand underline-offset-[3px] hover:underline"
                onClick={() => setShowClosed((s) => !s)}
              >
                {showClosed ? 'Hide' : 'Show'} {closedRows.length} closed position
                {closedRows.length === 1 ? '' : 's'}
              </button>
            ) : null}
          </Card>
          {current && (current.collateral > 0n || current.borrowShares > 0n) ? (
            <LiquidationCard row={current} skip={skip} />
          ) : null}
        </div>
        <div className="space-y-5 lg:col-span-5">
          <BackstopCard />
          <HowItWorks lltv={lltv} />
        </div>
      </div>
    </>
  )
}

/**
 * Whether there is a canary to liquidate. With one open, how long the keeper leaves it to others; without one, when
 * it comes back: since audit fix D-7 the canary-operator grant is a 48-hour timelocked raise, so a fresh deployment
 * has no canary until the grant clears and the keeper opens one.
 */
function CanaryNotice({
  loaded,
  open,
  grant,
  lltv,
}: {
  loaded: boolean
  open: boolean
  grant: CanaryGrant
  lltv: bigint
}) {
  const now = Math.floor(useNow(1_000) / 1000)
  if (!loaded) return null
  if (open)
    return (
      <Notice tone="brand" className="mb-5" title="A live canary is on the book">
        The team keeps a small canary position just under the {formatPercentWad(lltv, 0)}{' '}
        liquidation LTV. When BTC dips and it becomes liquidatable, the keeper leaves it to anyone
        for 6 hours (or until its health falls below 0.98) before taking it itself, so you have time
        to liquidate it from this page.
      </Notice>
    )
  const op = grant.operator
  if (!op)
    return (
      <Notice className="mb-5" title="No canary is open">
        There is no canary position on this network right now.
      </Notice>
    )
  if (grant.isOperator === undefined || grant.executableAt === undefined)
    return grant.isError ? <ReadError className="mb-5" what="the canary grant" /> : null
  const operator = (
    <AddressLink href={explorerAddressUrl(appChain.id, op)} address={op} label="keeper key" />
  )
  if (grant.isOperator)
    return (
      <Notice tone="brand" className="mb-5" title="The canary re-opens shortly">
        The canary operator grant for {operator} has cleared. The keeper opens a new canary just
        under the {formatPercentWad(lltv, 0)} liquidation LTV about 30 minutes after the grant
        clears or the last canary is liquidated.
      </Notice>
    )
  const at = grant.executableAt
  if (at === 0)
    return (
      <Notice className="mb-5" title="No canary is open">
        No canary operator grant is queued for {operator}. Granting one is a 48-hour timelocked
        raise (audit fix D-7), so there is no canary to liquidate until one is queued and clears.
      </Notice>
    )
  const left = at - now
  return (
    <Notice
      tone="brand"
      className="mb-5"
      title="The canary re-arms after its 48-hour operator grant clears (audit fix D-7)"
    >
      Granting the canary operator role is a timelocked raise. The grant for {operator}{' '}
      {left > 0 ? (
        <>
          becomes executable <span className="num">{formatUtc(at)}</span> (in{' '}
          <span className="num">{formatDuration(left)}</span>)
        </>
      ) : (
        <>
          has been executable since <span className="num">{formatUtc(at)}</span>
        </>
      )}
      ; the keeper then executes it and opens a new canary about 30 minutes later. Until then there
      is no canary to liquidate.
    </Notice>
  )
}

function PositionRow({
  row,
  me,
  skip,
  active,
  onSelect,
}: {
  row: Row_
  me: Address | undefined
  skip: bigint | undefined
  active: boolean
  onSelect: () => void
}) {
  const liquidatable = row.preview?.liquidatable
  const closed = row.collateral === 0n && row.borrowShares === 0n
  const drop =
    row.liqBtcUsd && skip && skip > 0n
      ? Number(((skip - row.liqBtcUsd) * 10_000n) / skip) / 100
      : null
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cx(
          'w-full rounded-[4px] border p-3 text-left transition-colors',
          active
            ? 'border-brand bg-brand-soft/45 shadow-[inset_3px_0_0_var(--brand)]'
            : 'border-line hover:border-line-strong hover:bg-raised/60',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="num font-mono text-[13px] tracking-[0.02em] text-ink">
            {shortAddress(row.account, 5)}
          </span>
          {row.canary ? <Badge tone="btc">Canary</Badge> : null}
          {me && isAddressEqual(me, row.owner) ? <Badge tone="brand">Yours</Badge> : null}
          <span className="ml-auto">
            {closed ? (
              <Badge>Closed</Badge>
            ) : liquidatable ? (
              <Badge tone="bad">Liquidatable</Badge>
            ) : row.preview ? (
              <Badge tone={healthTone(row.health)}>Healthy</Badge>
            ) : row.previewError ? (
              <Badge tone="warn">Preview failed</Badge>
            ) : (
              <Skeleton className="h-5 w-16" />
            )}
          </span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="serial text-[10px] text-muted">Collateral</dt>
            <dd className="num text-btc">{formatBtc(row.collateral)} BTC</dd>
          </div>
          <div>
            <dt className="serial text-[10px] text-muted">Debt</dt>
            <dd className="num text-ink">
              {row.debt !== undefined ? `${formatMusd(row.debt, { mode: 'up' })} MUSD` : '—'}
            </dd>
          </div>
          <div>
            <dt className="serial text-[10px] text-muted">LTV · health</dt>
            <dd className={cx('num', TONE_TEXT[healthTone(row.health, liquidatable)])}>
              {row.ltv !== undefined ? formatPercentWad(row.ltv) : '—'}
              {row.health ? ` · ${formatWad(row.health, 3)}` : ''}
            </dd>
          </div>
          <div>
            <dt className="serial text-[10px] text-muted">Liquidatable if BTC ≤</dt>
            <dd className="num text-ink">
              {row.liqBtcUsd ? formatUsd(row.liqBtcUsd, 0) : '—'}
              {drop !== null ? (
                <span className="ml-1 text-xs text-muted">
                  ({drop > 0 ? `−${drop.toFixed(2)}` : `+${(-drop).toFixed(2)}`}%)
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </button>
    </li>
  )
}

function LiquidationCard({ row, skip }: { row: Row_; skip: bigint | undefined }) {
  const cfg = useLiquidatorConfig()
  const p = row.preview
  const [picked, setPicked] = useState<VenueId | null>(null)
  // Before liquidation, show what each venue would pay for the whole collateral right now.
  const whatIf = useVenueQuotes(p && !p.liquidatable ? row.collateral : undefined)
  const clAvailable = cfg.data?.clAvailable ?? false
  const venues: VenueId[] = [Venue.BACKSTOP, Venue.CL200, Venue.VAMM]
  const best = p?.liquidatable
    ? venues
        .filter((v) => p.quotes[v].ok)
        .sort((a, b) => (p.quotes[b].profit > p.quotes[a].profit ? 1 : -1))[0]
    : undefined
  const venue: VenueId = picked ?? best ?? Venue.VAMM
  const quote = p?.quotes[venue]
  const minProfit = quote?.ok ? minProfitFor(quote.profit) : 0n

  let reason: string | null = null
  if (!deployed.flashLiquidator) reason = 'FlashLiquidator is not deployed on this network.'
  else if (!p) reason = 'Loading the liquidation preview…'
  else if (!p.oracleOk) reason = 'The oracle is down, so Morpho cannot liquidate right now.'
  else if (!p.liquidatable)
    reason = `Healthy: liquidatable once BTC is at or below ${row.liqBtcUsd ? formatUsd(row.liqBtcUsd, 0) : '—'}.`
  else if (venue === Venue.CL200 && !clAvailable)
    reason = 'There is no CL200 pool on testnet. Pick the backstop or the vAMM.'
  else if (!quote?.ok)
    reason = `${VENUE_LABEL[venue]} cannot clear this size: it would pay ${formatMusd(quote?.proceeds ?? 0n)} MUSD against a ${formatMusd(p.minProceeds)} MUSD floor.`

  const oracleValue = p?.oracleOk ? (p.seizable * p.price) / 10n ** 36n : undefined
  return (
    <Card aria-labelledby="liq-title">
      <CardHeader
        id="liq-title"
        title="Liquidation preview"
        subtitle={
          <>
            <AddressLink
              href={explorerAddressUrl(appChain.id, row.account)}
              address={row.account}
              label={row.canary ? 'Canary' : 'Account'}
            />{' '}
            · FlashLiquidator.previewLiquidation, simulated live
          </>
        }
        action={
          p ? (
            <Badge tone={p.liquidatable ? 'bad' : 'good'}>
              {p.liquidatable ? 'Liquidatable' : 'Healthy'}
            </Badge>
          ) : null
        }
      />
      {row.previewError && !p ? (
        <ReadError what="the liquidation preview" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label="Loan-to-value"
            value={<Value loading={!p}>{p ? formatPercentWad(p.ltvWad) : null}</Value>}
            sub={`liquidation above ${formatPercentWad(registry.lltv, 0)}`}
            tone={p?.liquidatable ? 'bad' : undefined}
          />
          <Stat
            label="Collateral"
            value={
              <Value loading={!p}>
                {p ? <span className="text-btc">{formatBtc(p.collateral)}</span> : null}
              </Value>
            }
            sub="BTC"
          />
          <Stat
            label="Debt"
            value={<Value loading={!p}>{p ? formatMusd(p.debt, { mode: 'up' }) : null}</Value>}
            sub="MUSD incl. interest"
          />
          <Stat
            label="Seizable"
            value={<Value loading={!p}>{p?.liquidatable ? formatBtc(p.seizable) : null}</Value>}
            sub={
              p?.liquidatable && oracleValue !== undefined
                ? `BTC ≈ ${formatMusd(oracleValue)} MUSD`
                : 'BTC, once liquidatable'
            }
          />
          <Stat
            label="Repaid"
            value={<Value loading={!p}>{p?.liquidatable ? formatMusd(p.repaid) : null}</Value>}
            sub="MUSD to Morpho"
          />
          <Stat
            label="Bad debt"
            value={<Value loading={!p}>{p?.liquidatable ? formatMusd(p.badDebt) : null}</Value>}
            sub="MUSD socialised"
            tone={p && p.badDebt > 0n ? 'bad' : undefined}
          />
        </div>
      )}
      {p ? (
        <dl className="mt-4 divide-y divide-line border-t border-line pt-2">
          <Row
            label="Oracle price"
            tip="The M1 oracle price Morpho sizes the seizure with (Skip BTC/USD over the clamped MUSD leg)."
            value={
              p.oracleOk ? `${formatMusd(oraclePriceToWad(p.price))} MUSD per BTC` : 'Unavailable'
            }
            hint={skip ? `Skip ${formatUsd(skip)}` : undefined}
          />
          <Row
            label="Sale floor"
            tip={`max(seized value × (1 − ${cfg.data ? formatBps(cfg.data.maxImpactBps) : 'MAX_IMPACT'}), repaid). A venue paying less reverts the liquidation.`}
            value={p.liquidatable ? `${formatMusd(p.minProceeds)} MUSD` : '—'}
            hint={
              cfg.data
                ? `max impact ${formatBps(cfg.data.maxImpactBps)} · incentive ${formatPercentWad(cfg.data.incentive - WAD)}`
                : undefined
            }
          />
        </dl>
      ) : null}

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink">Sell the seized BTC through</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {venues.map((v) => {
            const q = p?.quotes[v]
            const disabled = v === Venue.CL200 && !clAvailable
            const info = p && !p.liquidatable ? whatIf.data : undefined
            const impact =
              info && info.oracleValue > 0n
                ? Number(((info.oracleValue - info.proceeds[v]) * 10_000n) / info.oracleValue) / 100
                : null
            return (
              <label
                key={v}
                className={cx(
                  'flex cursor-pointer flex-col rounded-[4px] border p-3 text-sm transition-colors',
                  venue === v
                    ? 'border-brand bg-brand-soft/45'
                    : 'border-line hover:border-line-strong',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="radio"
                    name="venue"
                    className="accent-[var(--brand)]"
                    checked={venue === v}
                    disabled={disabled}
                    onChange={() => setPicked(v)}
                  />
                  {VENUE_LABEL[v]}
                </span>
                <span className="num mt-1 text-xs text-muted">
                  {disabled
                    ? 'No CL200 pool on testnet'
                    : p?.liquidatable && q
                      ? q.ok
                        ? `pays ${formatMusd(q.proceeds)} MUSD · profit ${formatMusd(q.profit, { dp: 4 })} MUSD`
                        : `${formatMusd(q.proceeds)} MUSD: below the floor`
                      : info
                        ? info.proceeds[v] > 0n
                          ? `would pay ${formatMusd(info.proceeds[v])} MUSD for all ${formatBtc(row.collateral)} BTC${impact !== null ? ` (${impact.toFixed(2)}% under oracle)` : ''}`
                          : v === Venue.BACKSTOP
                            ? 'not enough free cash for this size'
                            : 'no quote'
                        : '—'}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <TxButton
          variant="danger"
          sealTone="seal"
          label={
            p?.liquidatable && quote?.ok
              ? `Liquidate for ≈ ${formatMusd(quote.profit, { dp: 4 })} MUSD profit`
              : 'Liquidate'
          }
          disabledReason={reason}
          request={{
            address: FLASH,
            abi: flashLiquidatorAbi,
            functionName: 'liquidate',
            args: [row.account, 0n, venue, minProfit],
          }}
          pendingTitle="Liquidating"
          successTitle="Liquidated"
          successMessage={liquidatedMessage}
        />
        {p?.liquidatable && quote?.ok ? (
          <p className="mt-2 text-center text-xs text-muted">
            Reverts unless you receive at least {formatMusd(minProfit, { dp: 4 })} MUSD (90% of the
            preview), so a moved price cannot leave you worse off.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

function liquidatedMessage(receipt: TransactionReceipt): string {
  const logs = receipt.logs.filter((l) => isAddressEqual(l.address, FLASH))
  const [e] = parseEventLogs({ abi: flashLiquidatorAbi, logs, eventName: 'Liquidated' })
  if (!e) return `Included in block ${receipt.blockNumber}.`
  return `Seized ${formatBtc(e.args.seized)} BTC, repaid ${formatMusd(e.args.repaid)} MUSD; ${formatMusd(e.args.profit, { dp: 4 })} MUSD profit sent to you.`
}

function HowItWorks({ lltv }: { lltv: bigint }) {
  // Morpho's incentive at this LLTV: min(1.15, 1 / (0.3·LLTV + 0.7)) − 1.
  const incentive = (WAD * WAD) / ((3n * lltv) / 10n + (7n * WAD) / 10n) - WAD
  return (
    <Card aria-labelledby="how-liq-title">
      <CardHeader id="how-liq-title" title="How a liquidation pays" />
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/90 marker:font-mono marker:text-xs marker:text-muted">
        <li>
          Morpho seizes BTC worth the debt plus a{' '}
          <span className="num font-medium">{formatPercentWad(incentive)}</span> incentive, once LTV
          passes <span className="num">{formatPercentWad(lltv, 0)}</span>.
        </li>
        <li>
          In the callback, FlashLiquidator unwraps it to native BTC and sells it: to the backstop at
          the oracle price less half the incentive, or on the vAMM within a price-impact bound.
        </li>
        <li>The proceeds repay the debt; the surplus is your profit, all in one transaction.</li>
      </ol>
      <p className="mt-3 text-xs text-muted">
        Testnet offers the backstop and the vAMM; the CL200 venue switches on where Tigris has a
        BTC/MUSD concentrated pool (mainnet). The minimum profit defaults to 90% of the preview.
      </p>
    </Card>
  )
}
