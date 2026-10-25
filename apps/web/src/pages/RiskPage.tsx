import {
  explorerAddressUrl,
  formatBps,
  formatBtc,
  formatDuration,
  formatMusd,
  formatPercentWad,
  formatUsd,
  oraclePriceToWad,
  RiskSource,
  type RiskSourceState,
  riskSourceStates,
  shortAddress,
  toFixedDecimal,
  WAD,
} from '@baserate/sdk'
import { IconCheck, IconRisk, IconX } from '../components/icons'
import {
  AddressLink,
  Badge,
  Card,
  CardHeader,
  Dot,
  Notice,
  PageHeader,
  ReadError,
  Row,
  Skeleton,
  Stat,
  type Tone,
} from '../components/ui'
import { type RiskSnapshot, TROVE_COUNT, useRiskLens } from '../hooks/useRiskLens'
import { secondsSince, useNow } from '../lib/useNow'
import { appChain, deployed, registry } from '../wagmi'

const MAX_UINT = 2n ** 256n - 1n
const STATE_TONE: Record<RiskSourceState, Tone> = { ok: 'good', failed: 'bad', skipped: 'neutral' }
const STATE_LABEL: Record<RiskSourceState, string> = {
  ok: 'read',
  failed: 'failed',
  skipped: 'not on this network',
}

export function RiskPage() {
  const q = useRiskLens()
  const s = q.data
  const now = useNow()
  const age = s ? Math.max(0, Math.floor(now / 1000) - Number(s.timestamp)) : undefined

  return (
    <>
      <PageHeader
        eyebrow="Risk"
        title="RiskLens: the whole risk picture in one call"
        lede="Oracle health, market state, caps, how much seized BTC the venues can absorb, and the MUSD trove queue Baserate positions never join. One RiskLens.snapshot() eth_call, refreshed every 30 seconds."
      />
      {!deployed.riskLens ? (
        <Notice tone="brand" className="mb-5" title="RiskLens is not deployed on this network" />
      ) : null}
      {q.isError ? (
        <ReadError className="mb-5" what="the RiskLens snapshot" onRetry={() => void q.refetch()} />
      ) : null}

      <Card className="mb-5" aria-labelledby="sources-title">
        <CardHeader
          id="sources-title"
          icon={<IconRisk className="size-4" />}
          title="Sources"
          subtitle={
            s ? (
              <>
                Block <span className="num">{s.blockNumber.toLocaleString('en-US')}</span>
                {age !== undefined ? ` · ${formatDuration(age)} ago` : ''} ·{' '}
                <span className="num">{s.precompileCalls.toString()}</span> precompile call
                {s.precompileCalls === 1n ? '' : 's'} ·{' '}
                <AddressLink
                  href={explorerAddressUrl(appChain.id, registry.contracts.riskLens.address)}
                  address={registry.contracts.riskLens.address}
                  label="RiskLens"
                />
              </>
            ) : (
              'Loading the snapshot…'
            )
          }
        />
        {s ? (
          <ul className="flex flex-wrap gap-2">
            {riskSourceStates(s.failed, s.skipped).map((src) => (
              <li key={src.name}>
                <Badge tone={STATE_TONE[src.state]}>
                  {src.state === 'ok' ? (
                    <IconCheck className="size-3.5" />
                  ) : src.state === 'failed' ? (
                    <IconX className="size-3.5" />
                  ) : null}
                  {src.label}
                  <span className="sr-only">: {STATE_LABEL[src.state]}</span>
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton className="h-6 w-full" />
        )}
        {s && (s.skipped & (RiskSource.CL_DEPTH | RiskSource.MUSD_POOL)) !== 0n ? (
          <p className="mt-3 text-xs text-muted">
            Grey sources are not configured on testnet: it has no Slipstream CL200 BTC/MUSD pool,
            QuoterV2 or MUSD/USD CL pool. On mainnet they are read live.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <DepthCard s={s} />
          <TroveCard s={s} />
        </div>
        <div className="space-y-5 lg:col-span-5">
          <OracleCard s={s} updatedAt={q.dataUpdatedAt} />
          <PegCard s={s} />
          <MarketCard s={s} />
          <CapsCard s={s} />
          <BackstopLensCard s={s} />
        </div>
      </div>
    </>
  )
}

type Props = { s: RiskSnapshot | undefined }

function DepthCard({ s }: Props) {
  const failedVamm = s ? (s.failed & RiskSource.VAMM_DEPTH) !== 0n : false
  const clSkipped = s ? (s.skipped & RiskSource.CL_DEPTH) !== 0n : true
  const incentive = s ? s.market.liquidationIncentive - WAD : undefined
  const cleanMax = s?.depth.filter((d) => d.clean).at(-1)?.btcIn
  const cap = s?.factory.standardPositionCap
  return (
    <Card aria-labelledby="depth-title">
      <CardHeader
        id="depth-title"
        title="Liquidation depth"
        subtitle="Selling seized BTC for MUSD now, against its oracle value"
        action={failedVamm ? <Badge tone="bad">vAMM quote failed</Badge> : null}
      />
      {s ? (
        <>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium sm:pl-0">
                    BTC sold
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Oracle value
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    vAMM pays
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    CL200 pays
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Impact
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:pr-0">
                    Clean
                  </th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line">
                {s.depth.map((d) => (
                  <tr key={d.btcIn.toString()}>
                    <td className="px-4 py-2 text-btc sm:pl-0">
                      {formatBtc(d.btcIn, { minDp: 3 })}
                    </td>
                    <td className="px-2 py-2 text-right text-ink">{formatMusd(d.referenceOut)}</td>
                    <td className="px-2 py-2 text-right text-ink">
                      {d.vammOut > 0n ? formatMusd(d.vammOut) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-muted">
                      {clSkipped
                        ? 'n/a'
                        : d.clOut > 0n
                          ? `${formatMusd(d.clOut)}${d.clExhausted ? ' (partial)' : ''}`
                          : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-ink">{formatBps(d.impactBps)}</td>
                    <td className="px-4 py-2 text-right sm:pr-0">
                      {d.clean ? (
                        <Badge tone="good">
                          <IconCheck className="size-3.5" />
                          Yes
                        </Badge>
                      ) : (
                        <Badge tone="warn">Backstop</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Amounts in MUSD. “Clean” means the best venue loses less than the{' '}
            {incentive !== undefined ? formatPercentWad(incentive) : '—'} liquidation incentive, so
            a liquidation of that size pays without the backstop.{' '}
            {cleanMax !== undefined
              ? `Clean up to ${formatBtc(cleanMax, { minDp: 3 })} BTC${cap !== undefined && cap > 0n ? `; the per-position cap is ${formatBtc(cap, { minDp: 3 })} BTC${cleanMax >= cap ? ', inside clean depth' : ''}` : ''}.`
              : 'No size clears cleanly right now: liquidations lean on the backstop.'}
          </p>
        </>
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </Card>
  )
}

function TroveCard({ s }: Props) {
  const t = s?.troves
  const failed = s ? (s.failed & RiskSource.TROVES) !== 0n : false
  return (
    <Card aria-labelledby="troves-title">
      <CardHeader
        id="troves-title"
        title="MUSD redemption queue"
        subtitle={`The ${TROVE_COUNT.toString()} troves redeemed first (lowest collateral ratio). Baserate positions are never in this queue.`}
        action={
          t ? (
            t.recoveryMode ? (
              <Badge tone="bad">Recovery mode</Badge>
            ) : (
              <Badge tone="good">Normal mode</Badge>
            )
          ) : null
        }
      />
      {failed ? <ReadError className="mb-3" what="the trove queue" /> : null}
      {t ? (
        <>
          <div className="mb-3 grid grid-cols-3 gap-4">
            <Stat label="Troves" value={t.size.toLocaleString('en-US')} sub="in SortedTroves" />
            <Stat label="System TCR" value={formatPercentWad(t.tcr, 1)} sub="recovery below 150%" />
            <Stat label="BTC price" value={formatUsd(t.price, 0)} sub="Skip, used for ICR" />
          </div>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium sm:pl-0">
                    #
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Trove
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    ICR
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Collateral
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Debt
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:pr-0">
                    Debt ahead
                  </th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line">
                {t.entries.map((e, i) => (
                  <tr key={e.borrower}>
                    <td className="px-4 py-2 text-muted sm:pl-0">{i + 1}</td>
                    <td className="px-2 py-2">
                      <a
                        className="font-mono text-xs text-brand hover:underline"
                        href={explorerAddressUrl(appChain.id, e.borrower)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {shortAddress(e.borrower)}
                      </a>
                    </td>
                    <td className="px-2 py-2 text-right text-ink">
                      {formatPercentWad(e.icr, 1)}
                      <span className="block text-xs text-muted">
                        NICR {toFixedDecimal(e.nicr, 20, 8)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-btc">
                      {formatBtc(e.coll, { minDp: 4, maxDp: 4 })} BTC
                    </td>
                    <td className="px-2 py-2 text-right text-ink">
                      {formatMusd(e.principal + e.interest, { dp: 0 })} MUSD
                    </td>
                    <td className="px-4 py-2 text-right text-muted sm:pr-0">
                      {formatMusd(e.debtAhead, { dp: 0 })} MUSD
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            A redemption repays these troves’ debt at par and takes their BTC, starting from #1.
            “Debt ahead” is the MUSD that must be redeemed before a trove is reached. NICR, the
            queue’s sort key, is BTC of collateral per MUSD of debt.
          </p>
        </>
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </Card>
  )
}

function OracleCard({ s, updatedAt }: Props & { updatedAt: number }) {
  const now = useNow()
  const o = s?.oracle
  const tick = secondsSince(updatedAt, now)
  const skipAge = o && o.skipAge !== MAX_UINT ? Number(o.skipAge) + tick : undefined
  const pythAge = o && o.pythBtcAge !== MAX_UINT ? Number(o.pythBtcAge) + tick : undefined
  return (
    <Card aria-labelledby="lens-oracle-title">
      <CardHeader
        id="lens-oracle-title"
        title="Oracle"
        subtitle="BtcMusdOracle.status(), inside the snapshot"
        action={
          o ? (
            <Badge tone={o.ok ? 'good' : 'bad'}>{o.ok ? 'Price OK' : 'Guard active'}</Badge>
          ) : null
        }
      />
      {o ? (
        <dl className="divide-y divide-line">
          <Row
            label="M1 price"
            tip="What Morpho reads: Skip BTC/USD over the MUSD leg clamped to [1.00, 1.02], at the 1e36 scale."
            value={o.ok ? `${formatMusd(oraclePriceToWad(o.price))} MUSD per BTC` : 'Unavailable'}
          />
          <Row
            label="Skip BTC/USD"
            value={o.skipPrice > 0n ? formatUsd(o.skipPrice) : 'No price'}
            hint={
              skipAge !== undefined ? (
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone={skipAge <= 30 ? 'good' : skipAge <= 60 ? 'warn' : 'bad'} />
                  {formatDuration(skipAge)} old · limit 60s
                </span>
              ) : (
                'unreadable'
              )
            }
          />
          <Row
            label="Pyth BTC/USD"
            value={o.pythBtcPrice > 0n ? formatUsd(o.pythBtcPrice) : 'Unavailable'}
            hint={
              pythAge !== undefined
                ? `${formatDuration(pythAge)} old · band ${o.pythBtcFresh ? 'on' : 'off (stale)'}`
                : undefined
            }
          />
          <Row
            label="Skip vs Pyth"
            tip="The ±10% sanity band trips only while Pyth is fresh."
            value={formatBps(o.deviationBps)}
            hint="limit 10.00%"
          />
        </dl>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
    </Card>
  )
}

function PegCard({ s }: Props) {
  const m = s?.musd
  const poolSkipped = s ? (s.skipped & RiskSource.MUSD_POOL) !== 0n : false
  const floor = 992_500_000_000_000_000n
  return (
    <Card aria-labelledby="peg-title">
      <CardHeader
        id="peg-title"
        title="MUSD peg"
        subtitle="Redemptions pay below ≈ $0.9925 (0.75% fee)"
      />
      {m ? (
        <dl className="divide-y divide-line">
          <Row
            label="Pyth MUSD/USD"
            value={
              m.pythPrice > 0n ? (
                <span className={m.pythPrice < floor ? 'text-warn' : 'text-ink'}>
                  ${toFixedDecimal(m.pythPrice, 18, 4)}
                </span>
              ) : (
                'Unavailable'
              )
            }
            hint={
              m.pythAge !== MAX_UINT
                ? `${formatDuration(Number(m.pythAge))} old · ${m.pythFresh ? 'fresh' : 'stale: the oracle uses $1.00'}`
                : undefined
            }
          />
          <Row
            label={`CL pool TWAP (${formatDuration(m.twapWindow)})`}
            value={
              poolSkipped
                ? 'n/a on testnet'
                : m.twapPrice > 0n
                  ? `$${toFixedDecimal(m.twapPrice, 18, 4)}`
                  : '—'
            }
            hint={poolSkipped ? 'mainnet: CL10 mUSDC/MUSD' : `tick ${m.twapTick}`}
          />
          <Row
            label="CL pool spot"
            value={
              poolSkipped
                ? 'n/a on testnet'
                : m.spotPrice > 0n
                  ? `$${toFixedDecimal(m.spotPrice, 18, 4)}`
                  : '—'
            }
          />
        </dl>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </Card>
  )
}

function MarketCard({ s }: Props) {
  const m = s?.market
  return (
    <Card aria-labelledby="lens-market-title">
      <CardHeader
        id="lens-market-title"
        title="Market M1"
        subtitle="Interest accrued to the snapshot block"
        action={
          m ? (
            <Badge tone={m.created ? 'brand' : 'bad'}>{m.created ? 'Live' : 'Not created'}</Badge>
          ) : null
        }
      />
      {m ? (
        <dl className="divide-y divide-line">
          <Row label="Supplied" value={`${formatMusd(m.totalSupplyAssets)} MUSD`} />
          <Row
            label="Borrowed"
            value={`${formatMusd(m.totalBorrowAssets)} MUSD`}
            hint={`utilisation ${formatPercentWad(m.utilization, 1)}`}
          />
          <Row label="Liquidity" value={`${formatMusd(m.liquidity)} MUSD`} />
          <Row
            label="Borrow APR"
            value={formatPercentWad(m.borrowApr)}
            hint={`supply APR ${formatPercentWad(m.supplyApr)} · fee ${formatPercentWad(m.fee, 0)}`}
          />
          <Row
            label="LLTV · incentive"
            value={`${formatPercentWad(m.lltv, 0)} · ${formatPercentWad(m.liquidationIncentive - WAD)}`}
          />
        </dl>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
    </Card>
  )
}

function CapsCard({ s }: Props) {
  const f = s?.factory
  return (
    <Card aria-labelledby="lens-caps-title">
      <CardHeader
        id="lens-caps-title"
        title="Caps and switches"
        subtitle="BorrowAccountFactory, governed behind a 48-hour timelock"
        action={
          f ? (
            f.borrowPaused ? (
              <Badge tone="warn">Borrowing paused</Badge>
            ) : (
              <Badge tone="good">Borrowing open</Badge>
            )
          ) : null
        }
      />
      {f ? (
        <dl className="divide-y divide-line">
          <Row
            label="Global borrow cap"
            value={`${formatMusd(f.globalBorrowCap, { dp: 0 })} MUSD`}
            hint={`${formatMusd(f.borrowHeadroom, { dp: 0 })} MUSD of headroom`}
          />
          <Row
            label="Standard position"
            value={`${formatBtc(f.standardPositionCap, { minDp: 3 })} BTC`}
            hint={`opening limit ${formatBps(f.standardCeilingBps, 0)} LTV`}
          />
          <Row
            label="Canary position"
            value={`${formatBtc(f.canaryPositionCap, { minDp: 3 })} BTC`}
            hint={`opening limit ${formatBps(f.canaryCeilingBps, 0)} LTV (max ${formatBps(f.maxCeilingBps, 0)})`}
          />
          <Row
            label="Origination fee"
            value={formatBps(f.originationFeeBps)}
            hint={
              <>
                to{' '}
                <a
                  className="font-mono text-brand hover:underline"
                  href={explorerAddressUrl(appChain.id, f.feeRecipient)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {shortAddress(f.feeRecipient)}
                </a>
              </>
            }
          />
          <Row label="Credit lines" value={f.creditPaused ? 'Paused' : 'Open'} />
        </dl>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
    </Card>
  )
}

function BackstopLensCard({ s }: Props) {
  const b = s?.backstop
  const failed = s ? (s.failed & RiskSource.BACKSTOP) !== 0n : false
  return (
    <Card aria-labelledby="lens-backstop-title">
      <CardHeader
        id="lens-backstop-title"
        title="Backstop solvency"
        subtitle="Free MUSD the backstop can pay for seized BTC"
        action={failed ? <Badge tone="bad">Read failed</Badge> : null}
      />
      {b ? (
        <dl className="divide-y divide-line">
          <Row label="Free MUSD" value={`${formatMusd(b.freeMusd)} MUSD`} strong />
          <Row
            label="Held as"
            value={`${formatMusd(b.musd)} MUSD + ${formatMusd(b.wsMusdAssets)} MUSD in wsMUSD`}
          />
          <Row
            label="BTC held"
            value={<span className="text-btc">{formatBtc(b.nativeBtc)} BTC</span>}
          />
          <Row
            label="Total assets"
            value={b.vaultRead ? `${formatMusd(b.vaultTotalAssets)} MUSD` : 'Unreadable'}
          />
        </dl>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </Card>
  )
}
