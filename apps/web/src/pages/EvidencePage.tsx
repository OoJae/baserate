import {
  explorerAddressUrl,
  explorerBlockUrl,
  explorerTxUrl,
  formatBtc,
  isDeployed,
  shortAddress,
} from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { IconCheck, IconEvidence } from '../components/icons'
import {
  Badge,
  Card,
  CardHeader,
  CopyButton,
  ExternalLink,
  Notice,
  PageHeader,
  Skeleton,
  type Tone,
} from '../components/ui'
import {
  type EvidenceEntry,
  evidence,
  fetchAddressInfo,
  type TxVerification,
  verifyTx,
} from '../lib/evidence'
import { NEXT_RELEASE } from '../lib/roadmap'
import { appChain, registry } from '../wagmi'

const CHAIN_NAME: Record<number, string> = { 31611: 'Testnet', 31612: 'Mainnet' }

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
        <div className="rounded-xl border border-dashed border-line-strong p-6 text-center">
          <p className="font-medium text-ink">No evidence recorded yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            The team’s first testnet borrow (BTC sent as msg.value to openAndBorrow) is recorded
            here right after deployment, alongside the repay-and-withdraw exit and wsMUSD deposits.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <EvidenceRow key={`${e.chainId}-${e.tx}-${e.block}-${e.kind}`} entry={e} />
          ))}
        </ul>
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
  const q = useQuery({
    queryKey: ['evidence', entry.chainId, entry.tx, entry.block],
    queryFn: ({ signal }) => verifyTx(entry, signal),
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const v = q.data
  const verdict = v ? VERDICT[v.state] : undefined
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">{entry.kind}</Badge>
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
          className="hover:underline"
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

interface ContractRow {
  name: string
  role: string
  address: Address
  ours: boolean
  precompile?: boolean
}

function contractRows(): ContractRow[] {
  const c = registry.contracts
  const x = registry.external
  return [
    {
      name: 'BorrowAccountFactory',
      role: 'Opens accounts, enforces caps',
      address: c.factory.address,
      ours: true,
    },
    {
      name: 'BorrowAccount (impl)',
      role: 'Per-user clone logic',
      address: c.borrowAccountImpl.address,
      ours: true,
    },
    {
      name: 'CollateralBTC (bcBTC)',
      role: 'Gated 1:1 BTC receipt',
      address: c.collateral.address,
      ours: true,
    },
    {
      name: 'BtcMusdOracle',
      role: 'Skip price, Pyth band, MUSD clamp',
      address: c.oracle.address,
      ours: true,
    },
    { name: 'WsMUSD', role: 'ERC-4626 over sMUSD', address: c.wsMusd.address, ours: true },
    { name: 'MusdDispenser', role: 'Test MUSD faucet', address: c.dispenser.address, ours: true },
    { name: 'Morpho Blue', role: 'Mezo’s official lending core', address: x.morpho, ours: false },
    { name: 'AdaptiveCurveIrm', role: 'Interest rate model', address: x.irm, ours: false },
    { name: 'MUSD', role: 'Loan token', address: x.musd, ours: false },
    { name: 'sMUSD', role: 'MUSD savings rate', address: x.smusd, ours: false },
    {
      name: 'Skip BTC/USD',
      role: 'Primary price (precompile)',
      address: x.skipBtcUsd,
      ours: false,
      precompile: true,
    },
    { name: 'Pyth', role: 'Sanity band and MUSD price', address: x.pyth, ours: false },
    { name: 'SortedTroves', role: 'MUSD redemption queue', address: x.sortedTroves, ours: false },
    { name: 'TroveManager', role: 'Trove ratios', address: x.troveManager, ours: false },
  ]
}

function VerifiedBadge({ row }: { row: ContractRow }) {
  const deployedHere = isDeployed(row.address)
  const q = useQuery({
    queryKey: ['blockscout-address', appChain.id, row.address],
    queryFn: () => fetchAddressInfo(appChain.id, row.address),
    enabled: deployedHere && !row.precompile,
    staleTime: 10 * 60_000,
    retry: 1,
  })
  if (!deployedHere) return <Badge>Not deployed yet</Badge>
  if (row.precompile) return <Badge tone="brand">Precompile</Badge>
  if (q.isLoading) return <Skeleton className="h-5 w-16" />
  if (q.isError) return <Badge tone="warn">Explorer unreachable</Badge>
  if (!q.data?.isContract) return <Badge tone="bad">No code</Badge>
  return q.data.isVerified ? (
    <Badge tone="good">
      <IconCheck className="size-3.5" />
      Verified source
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
        subtitle={`${appChain.name} · source-verification status read live from Blockscout`}
      />
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-medium sm:pl-0">
                Contract
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Address
              </th>
              <th scope="col" className="px-4 py-2 font-medium sm:pr-0">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
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
    'Get test funds: faucet link, dispenser claim, add MUSD to wallet',
    'Evidence: live Blockscout verification of every recorded transaction',
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-good">
            In this release
          </h3>
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Coming in the next release
          </h3>
          <ul className="space-y-2 text-sm">
            {NEXT_RELEASE.map((n) => (
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
