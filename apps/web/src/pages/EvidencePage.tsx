import {
  explorerAddressUrl,
  explorerBlockUrl,
  explorerTxUrl,
  formatBtc,
  formatDuration,
  formatPercentWad,
  isDeployed,
  shortAddress,
} from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import { IconCheck, IconClock, IconEvidence } from '../components/icons'
import {
  AddressLink,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  ExternalLink,
  Notice,
  PageHeader,
  Skeleton,
  Stat,
  type Tone,
} from '../components/ui'
import { env } from '../env'
import { type ContractRow, contractRows } from '../lib/contracts'
import {
  EVIDENCE_AREAS,
  type EvidenceArea,
  type EvidenceEntry,
  evidence,
  type TxVerification,
} from '../lib/evidence'
import { addressInfoQuery, evidenceTxQuery, keeperStatusQuery } from '../lib/evidenceQueries'
import { type KeeperHealthState, type KeeperJob, keeperHealth } from '../lib/keeper'
import { NEXT_RELEASE, PLANNED_INFRA } from '../lib/roadmap'
import { useNow } from '../lib/useNow'
import { appChain, registry } from '../wagmi'

const CHAIN_NAME: Record<number, string> = { 31611: 'Testnet', 31612: 'Mainnet' }

const AREA_TITLE: Record<EvidenceArea, { title: string; blurb: string }> = {
  core: { title: 'Borrow and save', blurb: 'Wave 1 core: deploys, M1, the first borrow and exit' },
  'judge-journey': {
    title: 'Judge journey',
    blurb: 'Recorded by the e2e harness clicking through the deployed UI with a real wallet',
  },
  lend: { title: 'Lend: vMUSD', blurb: 'Morpho Vault V2, its adapters and the allocator' },
  liquidations: { title: 'Liquidations', blurb: 'Backstop, FlashLiquidator and the live canary' },
  fees: {
    title: 'Fees and governance',
    blurb: 'FeeRouter, the first distribution, the fee switch',
  },
  risk: { title: 'Risk', blurb: 'RiskLens' },
  keeper: {
    title: 'Keeper actions',
    blurb: 'Autonomous upkeep by the Railway keeper: liquidations, the canary, vault and yield',
  },
  v1: {
    title: 'v1 (pre-audit) deployment',
    blurb: 'Live activity on the first deployment, retired after the audit fixes',
  },
}

export function EvidencePage() {
  return (
    <>
      <PageHeader
        eyebrow="Evidence"
        title="Don’t trust the UI. Check the chain."
        lede="Every transaction listed here is re-verified live against Mezo’s Blockscout explorer when this page loads: it must exist, have succeeded and sit in the recorded block."
      />
      <div className="space-y-5">
        <EvidenceList />
        <KeeperCard />
        <ContractsTable />
        <BuiltVsPlanned />
      </div>
    </>
  )
}

function EvidenceList() {
  const { entries, errors } = evidence
  return (
    <Card aria-labelledby="evidence-title">
      <CardHeader
        id="evidence-title"
        icon={<IconEvidence className="size-4" />}
        title="On-chain evidence"
        subtitle="Curated in apps/web/src/evidence.json, verified live via the Blockscout API"
        action={
          <Badge tone={entries.length ? 'brand' : 'neutral'}>{entries.length} recorded</Badge>
        }
      />
      {errors.length ? (
        <Notice tone="bad" className="mb-3" title="Some evidence rows are malformed">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {entries.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-line-strong p-6 text-center">
          <p className="font-medium text-ink">No evidence recorded yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            The team’s first testnet borrow (BTC sent as msg.value to openAndBorrow) is recorded
            here right after deployment, alongside the repay-and-withdraw exit and wsMUSD deposits.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {EVIDENCE_AREAS.map((area) => {
            const rows = entries.filter((e) => (e.area ?? 'core') === area)
            if (rows.length === 0) return null
            return (
              <section key={area} aria-labelledby={`area-${area}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 border-b-[3px] border-double border-line-strong/50 pb-2">
                  <h3 id={`area-${area}`} className="serial text-[11px] text-ink">
                    {AREA_TITLE[area].title}
                  </h3>
                  <p className="text-xs text-muted">{AREA_TITLE[area].blurb}</p>
                </div>
                <ul className="divide-y divide-line">
                  {rows.map((e) => (
                    <EvidenceRow key={`${e.chainId}-${e.tx}-${e.block}-${e.kind}`} entry={e} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}

const VERDICT: Record<TxVerification['state'], { tone: Tone; label: string }> = {
  verified: { tone: 'good', label: 'Verified live' },
  failed: { tone: 'bad', label: 'Transaction failed' },
  mismatch: { tone: 'warn', label: 'Block mismatch' },
  'not-found': { tone: 'bad', label: 'Not found' },
  error: { tone: 'warn', label: 'Explorer unreachable' },
}

function EvidenceRow({ entry }: { entry: EvidenceEntry }) {
  const q = useQuery(evidenceTxQuery(entry))
  const v = q.data
  const verdict = v ? VERDICT[v.state] : undefined
  return (
    <li className="py-4 first:pt-2 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand" className="normal-case">
          {entry.kind}
        </Badge>
        <Badge>{CHAIN_NAME[entry.chainId]}</Badge>
        {q.isLoading ? (
          <Skeleton className="h-5 w-24" />
        ) : verdict ? (
          <Badge tone={verdict.tone}>
            {v?.state === 'verified' ? <IconCheck className="size-3.5" /> : null}
            {verdict.label}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 font-medium text-ink">{entry.summary}</p>
      <p className="mt-0.5 text-sm text-muted">
        <span className="font-medium text-ink/80">Proves: </span>
        {entry.proves}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <ExternalLink href={explorerTxUrl(entry.chainId, entry.tx)}>
          <span className="num font-mono">{shortAddress(entry.tx, 6)}</span>
        </ExternalLink>
        <a
          className="underline-offset-[3px] hover:underline"
          href={explorerBlockUrl(entry.chainId, entry.block)}
          target="_blank"
          rel="noreferrer noopener"
        >
          block <span className="num">{entry.block.toLocaleString('en-US')}</span>
        </a>
        {v?.method ? <span>method {v.method}</span> : null}
        {v?.value && v.value !== '0' ? (
          <span className="num">value {formatBtc(BigInt(v.value))} BTC</span>
        ) : null}
        {v?.events.length ? <span>events {v.events.join(', ')}</span> : null}
        {v?.timestamp ? <span>{new Date(v.timestamp).toUTCString()}</span> : null}
      </div>
      {v?.detail ? <p className="mt-1 text-xs text-warn">{v.detail}</p> : null}
    </li>
  )
}

/** Plain names for the keeper's jobs, in the order the card lists them. */
const KEEPER_JOBS: { job: string; label: string }[] = [
  { job: 'liquidations', label: 'Liquidation scan' },
  { job: 'allocator', label: 'vMUSD allocator' },
  { job: 'wsmusd.sync', label: 'wsMUSD harvest' },
  { job: 'fee.flush', label: 'Fee flush, once per epoch' },
  { job: 'backstop', label: 'Backstop upkeep' },
  { job: 'canary', label: 'Canary upkeep' },
  { job: 'caps.depth', label: 'Liquidation depth vs borrow cap' },
  { job: 'smusd.watch', label: 'sMUSD upgrade watch' },
  { job: 'yield.sim', label: 'Testnet yield simulator (labelled ~1% APR)' },
  { job: 'health', label: 'Oracle and balances' },
]

function cadenceLabel(seconds: number): string {
  if (seconds < 60) return `every ${seconds} s`
  if (seconds < 3_600) return `every ${Math.round(seconds / 60)} min`
  return seconds === 3_600 ? 'hourly' : `every ${Math.round(seconds / 3_600)} h`
}

const KEEPER_TONE: Record<KeeperHealthState, Tone> = {
  running: 'good',
  stalled: 'warn',
  unreachable: 'warn',
  checking: 'neutral',
}

function KeeperCard() {
  const now = useNow(1_000)
  const q = useQuery(keeperStatusQuery())
  const s = q.data
  const ageS = (iso?: string) => (iso ? Math.max(0, (now - Date.parse(iso)) / 1_000) : undefined)
  const health = keeperHealth(s, { isError: q.isError, now })
  const status: { tone: Tone; label: string } = {
    tone: KEEPER_TONE[health.state],
    label: health.label,
  }

  return (
    <Card aria-labelledby="keeper-title">
      <CardHeader
        id="keeper-title"
        icon={<IconClock className="size-4" />}
        title="Keeper"
        subtitle="apps/keeper on Railway. Every call it makes is permissionless; this is its public status, refreshed every 30 s"
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      {q.isError ? (
        <Notice tone="warn" title="The keeper’s status endpoint did not answer">
          Rebalances, liquidations and fee distributions stay open to anyone from the Lend,
          Liquidate and Fees pages.{' '}
          <ExternalLink href={`${env.keeperUrl}/status`}>Open /status</ExternalLink>
        </Notice>
      ) : !s ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Keeper address"
              value={
                <AddressLink
                  href={explorerAddressUrl(appChain.id, s.keeper)}
                  address={s.keeper}
                  chars={5}
                />
              }
            />
            <Stat
              label="Gas balance"
              value={s.gasBalanceBtc ? `${Number(s.gasBalanceBtc).toFixed(5)} BTC` : '—'}
            />
            <Stat
              label="Up for"
              value={formatDuration(ageS(s.startedAt) ?? 0)}
              sub={s.startedAt ? `since ${new Date(s.startedAt).toUTCString()}` : undefined}
            />
          </div>

          <div>
            <h3 className="serial mb-1 text-[10.5px] text-muted">Jobs</h3>
            <ul className="divide-y divide-line text-sm">
              {KEEPER_JOBS.filter((j) => s.jobs?.[j.job] ?? j.job in s.lastRun).map((j) => {
                const state = s.jobs?.[j.job]
                const off = state?.note?.startsWith('off:')
                const age = ageS(state?.lastRun ?? s.lastRun[j.job as KeeperJob])
                const stale =
                  !off &&
                  (age === undefined ||
                    (state ? age > state.cadenceS * 2.5 + 60 || state.failures >= 3 : age > 7_500))
                return (
                  <li key={j.job} className="py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="text-ink">
                        {j.label}
                        {state ? (
                          <span className="text-muted"> · {cadenceLabel(state.cadenceS)}</span>
                        ) : null}
                      </span>
                      <span className={`num text-xs ${stale ? 'text-warn' : 'text-muted'}`}>
                        {off
                          ? 'off'
                          : age === undefined
                            ? 'not run yet'
                            : `last run ${formatDuration(age)} ago`}
                      </span>
                    </div>
                    {state?.note ? (
                      <p className="mt-0.5 text-xs text-muted">
                        {off ? state.note.slice(4).trim() : state.note}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>

          <div>
            <h3 className="serial mb-1 text-[10.5px] text-muted">
              Positions it watches (liquidation above {formatPercentWad(registry.lltv, 0)} LTV)
            </h3>
            {s.accounts.length === 0 ? (
              <p className="py-2 text-sm text-muted">No open M1 positions right now.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {s.accounts.slice(0, 5).map((a) => (
                  <li key={a.account} className="flex items-center justify-between gap-3 py-2">
                    <AddressLink
                      href={explorerAddressUrl(appChain.id, a.account)}
                      address={a.account}
                    />
                    <span className="flex items-center gap-2">
                      <span className="num text-ink">{a.ltvPct.toFixed(2)}% LTV</span>
                      {a.liquidatable ? (
                        <Badge tone="bad">Liquidatable</Badge>
                      ) : (
                        <Badge tone="good">Healthy</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="serial mb-1 text-[10.5px] text-muted">Recent keeper transactions</h3>
            {s.actions.length === 0 ? (
              <p className="py-2 text-sm text-muted">
                None since the last restart: nothing has needed doing (calls that would revert are
                skipped, not sent).
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {s.actions.slice(0, 6).map((a) => (
                  <li
                    key={a.tx}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <Badge tone="brand" className="normal-case">
                        {a.job}
                      </Badge>
                      <span className="font-mono text-xs text-ink">{a.fn}()</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted">
                      <ExternalLink href={explorerTxUrl(appChain.id, a.tx)}>
                        <span className="num font-mono">{shortAddress(a.tx, 6)}</span>
                      </ExternalLink>
                      <Badge tone={a.status === 'success' ? 'good' : 'bad'}>{a.status}</Badge>
                      <span className="num">{formatDuration(ageS(a.t) ?? 0)} ago</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function VerifiedBadge({ row }: { row: ContractRow }) {
  const deployedHere = isDeployed(row.address)
  const q = useQuery(addressInfoQuery(row.address, { enabled: deployedHere && !row.precompile }))
  if (!deployedHere) return <Badge>Not deployed yet</Badge>
  if (row.precompile) return <Badge tone="brand">Precompile</Badge>
  if (q.isLoading) return <Skeleton className="h-5 w-16" />
  if (q.isError) return <Badge tone="warn">Explorer unreachable</Badge>
  if (!q.data?.isContract) return <Badge tone="bad">No code</Badge>
  return q.data.isVerified ? (
    <Badge tone="good">
      <IconCheck className="size-3.5" />
      {q.data.verifiedBy === 'sourcify'
        ? q.data.sourcifyMatch === 'partial'
          ? 'Verified (Sourcify, partial)'
          : 'Verified (Sourcify)'
        : 'Verified source'}
    </Badge>
  ) : (
    <Badge tone="warn">Unverified</Badge>
  )
}

function ContractsTable() {
  const rows = contractRows()
  return (
    <Card aria-labelledby="contracts-title">
      <CardHeader
        id="contracts-title"
        title="Contracts"
        subtitle={`${appChain.name} · source-verification status read live from Blockscout and Sourcify (a partial match reproduces the bytecode but not the metadata hash)`}
      />
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="ledger w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-4 pt-1 pb-2 sm:pl-0">
                Contract
              </th>
              <th scope="col" className="px-2 pt-1 pb-2">
                Address
              </th>
              <th scope="col" className="px-4 pt-1 pb-2 sm:pr-0">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2.5 sm:pl-0">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {r.name}
                    {r.ours ? <Badge tone="brand">Baserate</Badge> : <Badge>Mezo</Badge>}
                  </span>
                  <span className="text-xs text-muted">{r.role}</span>
                </td>
                <td className="px-2 py-2.5">
                  {isDeployed(r.address) ? (
                    <span className="inline-flex items-center gap-1">
                      <ExternalLink href={explorerAddressUrl(appChain.id, r.address)}>
                        <span className="num font-mono text-xs">{shortAddress(r.address, 5)}</span>
                      </ExternalLink>
                      <CopyButton value={r.address} label={`Copy ${r.name} address`} />
                    </span>
                  ) : (
                    <span className="text-xs text-faint">pending deployment</span>
                  )}
                </td>
                <td className="px-4 py-2.5 sm:pr-0">
                  <VerifiedBadge row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function BuiltVsPlanned() {
  const built = [
    'Borrow: openAndBorrow with BTC as msg.value, LTV preview, oracle and redemption panels',
    'Repay & withdraw with a MUSD permit (approve path for contract wallets)',
    'Save: wsMUSD deposit with permit, redeem, redeem in kind, permissionless sync',
    'Lend: vMUSD (Morpho Vault V2) deposit and withdraw, allocator path, permissionless rebalance',
    'Liquidate: positions by health, live previews, one-click FlashLiquidator, backstop deposits and exits',
    'Risk: RiskLens oracle, market, caps, liquidation depth and trove-queue dashboard',
    'Fees: FeeRouter preview and distribute, gauge bribes, the timelocked fee switch',
    'Get test funds: faucet link, dispenser claim, add MUSD to wallet',
    'Evidence: live Blockscout verification of every recorded transaction',
    'Keeper on Railway: liquidations, vault and wsMUSD upkeep, backstop, once-per-epoch fee flush, canaries, depth and sMUSD watch, public status',
  ]
  return (
    <Card aria-labelledby="built-title">
      <CardHeader
        id="built-title"
        title="Built vs planned"
        subtitle="What this release does, and what comes next"
      />
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="serial mb-2 text-[10.5px] text-good">In this release</h3>
          <ul className="space-y-2 text-sm">
            {built.map((b) => (
              <li key={b} className="flex gap-2">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-good" />
                <span className="text-ink">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="serial mb-2 text-[10.5px] text-muted">Coming in the next release</h3>
          <ul className="space-y-2 text-sm">
            {[...NEXT_RELEASE, ...PLANNED_INFRA].map((n) => (
              <li key={n.label}>
                <span className="font-medium text-ink">{n.label}</span>
                <span className="text-muted"> · {n.blurb}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
