import {
  EPOCH_SECONDS,
  epochStart,
  explorerAddressUrl,
  explorerTxUrl,
  FEE_SPLIT_BPS,
  feeRouterAbi,
  formatBps,
  formatDuration,
  formatMusd,
  isDeployed,
  nextEpochFlip,
  shortAddress,
} from '@baserate/sdk'
import { isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem'
import { IconClock, IconFees } from '../components/icons'
import { TxButton } from '../components/TxButton'
import {
  AddressLink,
  Badge,
  Card,
  CardHeader,
  ExternalLink,
  Notice,
  PageHeader,
  ReadError,
  Row,
  Skeleton,
  SplitBar,
  Stat,
  Value,
} from '../components/ui'
import {
  type CarryReason,
  type Distribution,
  type TimelockStatus,
  useDistributions,
  useFeeRouter,
  useFeeSwitchSubmission,
} from '../hooks/useFeeRouter'
import { formatUtc } from '../lib/time'
import { useNow } from '../lib/useNow'
import { appChain, deployed, registry } from '../wagmi'

const ROUTER = registry.contracts.feeRouter.address
const MEZO_EARN = 'https://mezo.org/earn'
const MEZO_EARN_DOCS = 'https://mezo.org/docs/users/mezo-earn'
/** FeeRouter.BRIBE_CUTOFF: no bribe is posted in the last hour of an epoch (Mezo's Voter closes voting then). */
const BRIBE_CUTOFF = 3_600

/** Mirrors the pure FeeRouter.bribeWindowOpen(timestamp): false in the last hour of an epoch. */
function bribeWindowOpen(timestamp: number): boolean {
  return timestamp % EPOCH_SECONDS <= EPOCH_SECONDS - BRIBE_CUTOFF
}

export function FeesPage() {
  const fr = useFeeRouter()
  return (
    <>
      <PageHeader
        eyebrow="Fees"
        title="Origination fees go back to Mezo"
        lede="Every borrow pays a 0.10% origination fee. The FeeRouter splits it: 40% to sMUSD holders as yield, 40% as MUSD bribes for veBTC voters on the BTC/MUSD pool gauge, 20% to the treasury. Anyone can trigger the split."
      />
      {!deployed.feeRouter ? (
        <Notice
          tone="brand"
          className="mb-5"
          title="The FeeRouter is not deployed on this network"
        />
      ) : null}
      {fr.isError ? <ReadError className="mb-5" what="the FeeRouter" onRetry={fr.refetch} /> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <DistributeCard fr={fr} />
          <HistoryCard />
        </div>
        <div className="space-y-5 lg:col-span-5">
          <FeeSwitchCard fr={fr} />
          <EpochCard />
          <ExplainerCard />
        </div>
      </div>
    </>
  )
}

type FeeRouterView = ReturnType<typeof useFeeRouter>

function DistributeCard({ fr }: { fr: FeeRouterView }) {
  const now = Math.floor(useNow(1_000) / 1000)
  const p = fr.plan
  const loading = fr.isLoading
  const target = fr.targets?.[0]
  const posted = p ? p.bribeAmounts.reduce((a, b) => a + b, 0n) : undefined
  const empty = p !== undefined && p.total === 0n
  const dead = p ? p.gaugeAlive.some((alive) => !alive) : false
  const windowOpen = bribeWindowOpen(now)
  const flip = nextEpochFlip(now)
  // The sMUSD leg is donated only when sMUSD accepts it; below its dust floor it stays here with any carried bribe.
  const toSmusd = p ? (p.smusdAccepts ? p.toSmusd : 0n) : undefined
  const carried = p ? p.bribesCarried + p.smusdCarried : undefined
  const paidOut = p && carried !== undefined ? p.total - carried : undefined
  // Nothing would leave the router: all it holds is a carry that would wait again.
  const stuck = p !== undefined && !empty && paidOut === 0n
  const bribeCarryIn = (fr.bribeCarry[0] ?? 0n) + (fr.bribeCarry[1] ?? 0n)
  const carriedIn =
    fr.smusdCarry !== undefined && fr.bribeCarry[0] !== undefined
      ? fr.smusdCarry + bribeCarryIn
      : undefined
  const failingSince = fr.smusdFailingSince !== undefined ? Number(fr.smusdFailingSince) : 0
  const graceEpochs = fr.smusdGraceEpochs !== undefined ? Number(fr.smusdGraceEpochs) : 2
  // Once a failure streak spans the grace epochs, a failing donation pays the sMUSD leg to the treasury instead.
  const toTreasuryFrom =
    failingSince > 0 ? epochStart(failingSince) + graceEpochs * EPOCH_SECONDS : 0
  const bribeCarried = p !== undefined && !empty && p.bribesCarried > 0n
  // An empty router still shows the fixed 40/40/20 split.
  const share = (bps: bigint, amount: bigint | undefined) => (empty ? bps : (amount ?? 0n))

  let reason: string | null = null
  if (!deployed.feeRouter) reason = 'The FeeRouter is not deployed on this network.'
  else if (empty)
    reason =
      'Nothing to distribute: the router holds 0 MUSD. Fees arrive once the factory points at it (see the pending switch).'
  else if (stuck)
    reason =
      p.bribesCarried === 0n
        ? 'Nothing would leave the router: it only holds sMUSD dust below sMUSD’s minimum donation, kept until more fees arrive.'
        : windowOpen
          ? 'Nothing would leave the router: it only holds a carried bribe share, which waits until the bribe contract has votes.'
          : `Nothing would leave the router: it only holds a carried bribe share, which waits for the epoch flip in ${formatDuration(flip - now)}.`

  return (
    <Card aria-labelledby="distribute-title">
      <CardHeader
        id="distribute-title"
        icon={<IconFees className="size-4" />}
        title="Next distribution"
        subtitle={
          <AddressLink
            href={explorerAddressUrl(appChain.id, ROUTER)}
            address={ROUTER}
            label="FeeRouter"
          />
        }
        action={<Badge>Permissionless</Badge>}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Waiting in the router"
          value={<Value loading={loading}>{p ? formatMusd(p.total) : null}</Value>}
          sub="MUSD"
        />
        <Stat
          label="Bribe epoch"
          value={
            <Value loading={loading}>
              {p ? formatUtc(Number(p.epochStart), { dateOnly: true }) : null}
            </Value>
          }
          sub="Thursday 00:00 UTC start"
        />
        <Stat
          label="Origination fee"
          value={
            <Value loading={loading}>{fr.feeBps !== undefined ? formatBps(fr.feeBps) : null}</Value>
          }
          sub="of each borrow"
        />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium text-ink">
          {empty ? 'The fixed split' : 'Where this distribution goes'}
        </p>
        {p ? (
          <SplitBar
            label="Fee split"
            segments={[
              {
                key: 'smusd',
                label: 'sMUSD yield',
                value: share(FEE_SPLIT_BPS.smusd, toSmusd),
                tone: 'brand',
                detail: empty ? undefined : `${formatMusd(toSmusd ?? 0n)} MUSD`,
              },
              {
                key: 'bribes',
                label: 'BTC/MUSD gauge bribe',
                value: share(FEE_SPLIT_BPS.bribes, posted),
                tone: 'brand',
                soft: true,
                detail: empty ? undefined : `${formatMusd(posted ?? 0n)} MUSD`,
              },
              {
                key: 'treasury',
                label: 'Treasury',
                value: share(FEE_SPLIT_BPS.treasury, p.toTreasury),
                tone: 'neutral',
                detail: empty ? undefined : `${formatMusd(p.toTreasury)} MUSD`,
              },
              ...(!empty && carried !== undefined && carried > 0n
                ? [
                    {
                      key: 'carried',
                      label: 'Kept for a later distribution',
                      value: carried,
                      tone: 'warn' as const,
                      soft: true,
                      detail: `${formatMusd(carried)} MUSD`,
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </div>
      <dl className="mt-4 divide-y divide-line border-t border-line pt-2">
        <Row
          label="sMUSD"
          tip="Donated with sMUSD.receiveProtocolYield, so every sMUSD (and wsMUSD) holder earns it. If the donation fails, the share stays in the router for the next distribution; once failures span two epoch flips it goes to the treasury instead."
          value={
            fr.smusd ? (
              <AddressLink href={explorerAddressUrl(appChain.id, fr.smusd)} address={fr.smusd} />
            ) : (
              <Value loading={loading}>{null}</Value>
            )
          }
          hint={
            failingSince > 0 ? (
              <span className="text-warn">
                donations failing since {formatUtc(failingSince)}:{' '}
                {now >= toTreasuryFrom
                  ? 'a failing donation now goes to the treasury'
                  : `kept here, to the treasury from ${formatUtc(toTreasuryFrom)}`}
              </span>
            ) : p && !empty && !p.smusdAccepts ? (
              'below sMUSD’s dust floor: kept for next time'
            ) : undefined
          }
        />
        <Row
          label="Gauge → bribe"
          tip="The PoolsVoter’s BribeVotingReward for the BTC/MUSD pool gauge. A gauge the voter reports dead gets nothing; its share goes to sMUSD. In the last hour of an epoch, or while the bribe contract has no votes, the share is kept for a later distribution to the same gauge."
          value={
            target ? (
              <span className="inline-flex flex-wrap justify-end gap-x-1">
                <AddressLink
                  href={explorerAddressUrl(appChain.id, target.gauge)}
                  address={target.gauge}
                />
                <span className="text-muted">→</span>
                <AddressLink
                  href={explorerAddressUrl(appChain.id, target.bribe)}
                  address={target.bribe}
                />
              </span>
            ) : (
              <Value loading={loading}>{null}</Value>
            )
          }
          hint={
            p ? (
              dead ? (
                <span className="text-warn">gauge reported dead: share goes to sMUSD</span>
              ) : bribeCarried ? (
                <span className="text-warn">
                  {windowOpen ? 'no votes on the bribe yet' : 'last hour of the epoch'}: share
                  carried
                </span>
              ) : (
                'gauge alive'
              )
            ) : undefined
          }
        />
        <Row
          label="Treasury"
          value={
            fr.treasury ? (
              <AddressLink
                href={explorerAddressUrl(appChain.id, fr.treasury)}
                address={fr.treasury}
              />
            ) : (
              <Value loading={loading}>{null}</Value>
            )
          }
          hint="testnet: the deployer; mainnet: a Safe"
        />
        {carriedIn !== undefined && carriedIn > 0n ? (
          <Row
            label="Carried from earlier"
            tip="MUSD an earlier distribution kept back. It is part of the balance above and goes back to its own leg (a bribe share to the same gauge, the sMUSD share to sMUSD); it is never split again."
            value={`${formatMusd(carriedIn)} MUSD`}
            hint={`bribe ${formatMusd(bribeCarryIn)} · sMUSD ${formatMusd(fr.smusdCarry ?? 0n)}`}
          />
        ) : null}
      </dl>
      {bribeCarried && !windowOpen ? (
        <Notice tone="warn" className="mt-4" title="Bribes wait for the epoch flip">
          In the last hour of an epoch Mezo’s voter only takes votes from whitelisted veNFTs, so a
          bribe posted now could not win votes. The router keeps the bribe share and posts it with
          the first distribution after the flip, in {formatDuration(flip - now)}. The sMUSD and
          treasury shares are paid as usual.
        </Notice>
      ) : bribeCarried ? (
        <Notice className="mt-4" title="The bribe has no votes yet">
          The gauge’s bribe contract has no votes, so a bribe posted now could never be claimed. The
          router keeps the share and adds it to the gauge’s next bribe once it has votes.
        </Notice>
      ) : null}
      <div className="mt-4">
        <TxButton
          variant="secondary"
          size="md"
          label={
            p && !empty && paidOut !== undefined
              ? `Distribute ${formatMusd(paidOut)} MUSD`
              : 'Distribute'
          }
          disabledReason={reason}
          request={{ address: ROUTER, abi: feeRouterAbi, functionName: 'distribute' }}
          pendingTitle="Distributing fees"
          successTitle="Fees distributed"
          successMessage={distributedMessage}
        />
        {!empty && !stuck && carried !== undefined && carried > 0n ? (
          <p className="mt-2 text-center text-xs text-muted">
            {formatMusd(carried)} MUSD stays in the router for a later distribution.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

function distributedMessage(receipt: TransactionReceipt): string {
  const logs = receipt.logs.filter((l) => isAddressEqual(l.address, ROUTER))
  const [e] = parseEventLogs({ abi: feeRouterAbi, logs, eventName: 'Distributed' })
  if (!e) return `Included in block ${receipt.blockNumber}.`
  const kept =
    e.args.retained > 0n
      ? ` ${formatMusd(e.args.retained)} MUSD kept for the next distribution.`
      : ''
  return `${formatMusd(e.args.toSmusd)} MUSD to sMUSD, ${formatMusd(e.args.toBribes)} MUSD in bribes, ${formatMusd(e.args.toTreasury)} MUSD to the treasury.${kept}`
}

function HistoryCard() {
  const q = useDistributions()
  const now = Math.floor(useNow(30_000) / 1000)
  return (
    <Card aria-labelledby="history-title">
      <CardHeader
        id="history-title"
        title="Distributions"
        subtitle="From the FeeRouter’s Distributed and BribePosted events"
        action={q.data ? <Badge>{q.data.length} so far</Badge> : null}
      />
      {q.isError ? <ReadError what="FeeRouter events" onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : q.data && q.data.length > 0 ? (
        <ul className="divide-y divide-line">
          {q.data.slice(0, 8).map((d) => (
            <li key={d.tx} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="num font-semibold text-ink">{formatMusd(d.total)} MUSD split</span>
                <span className="num text-xs text-muted">
                  <ExternalLink href={explorerTxUrl(appChain.id, d.tx)}>
                    {d.timestamp ? `${formatDuration(now - d.timestamp)} ago` : `block ${d.block}`}
                  </ExternalLink>
                </span>
              </div>
              <dl className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-4">
                <div>
                  <dt className="serial text-[10px] text-muted">sMUSD</dt>
                  <dd className="text-ink">{formatMusd(d.toSmusd)} MUSD</dd>
                </div>
                <div>
                  <dt className="serial text-[10px] text-muted">Bribes</dt>
                  <dd className="text-ink">{formatMusd(d.toBribes)} MUSD</dd>
                </div>
                <div>
                  <dt className="serial text-[10px] text-muted">Treasury</dt>
                  <dd className="text-ink">{formatMusd(d.toTreasury)} MUSD</dd>
                </div>
                <div>
                  <dt className="serial text-[10px] text-muted">Epoch</dt>
                  <dd className="text-ink">
                    {formatUtc(Number(d.epochStart), { dateOnly: true })}
                  </dd>
                </div>
              </dl>
              {d.bribes.map((b) => (
                <p key={b.bribe} className="mt-1 text-xs text-muted">
                  Bribe {formatMusd(b.amount)} MUSD on gauge{' '}
                  <span className="font-mono">{shortAddress(b.gauge)}</span>, claimable by its veBTC
                  voters from {formatUtc(Number(d.epochStart) + 7 * 86_400)}
                </p>
              ))}
              {/* At most one carry per gauge per distribution. */}
              {d.bribeCarries.map((c) => (
                <p key={c.gauge} className="mt-1 text-xs text-muted">
                  Bribe {formatMusd(c.amount)} MUSD for gauge{' '}
                  <span className="font-mono">{shortAddress(c.gauge)}</span> carried to the next
                  distribution ({CARRY_LABEL[c.reason]})
                </p>
              ))}
              <SmusdOutcomeLine d={d} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[4px] border border-dashed border-line-strong p-5 text-center text-sm text-muted">
          No distributions yet.
        </p>
      )}
    </Card>
  )
}

const CARRY_LABEL: Record<CarryReason, string> = {
  VOTE_WINDOW_CLOSED: 'last hour of the epoch',
  NO_VOTES: 'no votes on the bribe yet',
}

/** What happened to a distribution's sMUSD leg when it was not simply donated. */
function SmusdOutcomeLine({ d }: { d: Distribution }) {
  const since = d.smusdFailingSince ? ` (failing since ${formatUtc(d.smusdFailingSince)})` : ''
  if (d.smusdOutcome === 'DEFERRED')
    return (
      <p className="mt-1 text-xs text-muted">
        sMUSD share of {formatMusd(d.smusdCarried)} MUSD was below sMUSD’s dust floor: carried to
        the next distribution
      </p>
    )
  if (d.smusdOutcome === 'FAILED')
    return (
      <p className="mt-1 text-xs text-warn">
        sMUSD donation failed: {formatMusd(d.smusdCarried)} MUSD carried to the next distribution
        {since}
      </p>
    )
  if (d.smusdOutcome === 'TO_TREASURY')
    return (
      <p className="mt-1 text-xs text-warn">
        sMUSD kept failing{since}: {formatMusd(d.smusdToTreasury)} MUSD of its share went to the
        treasury instead
      </p>
    )
  return null
}

const LAPSED_LABEL: Record<TimelockStatus, string> = {
  PENDING: 'Expired',
  ACCEPTED: 'Executed earlier',
  REVOKED: 'Revoked',
  INVALIDATED: 'Invalidated',
  EXPIRED: 'Expired',
}

function FeeSwitchCard({ fr }: { fr: FeeRouterView }) {
  const now = Math.floor(useNow(1_000) / 1000)
  const sub = useFeeSwitchSubmission()
  const at = fr.switchExecutableAt !== undefined ? Number(fr.switchExecutableAt) : undefined
  const done = !!fr.feeRecipient && isAddressEqual(fr.feeRecipient, ROUTER)
  const left = at !== undefined && at > now ? at - now : 0
  const execWindow = fr.executionWindow !== undefined ? Number(fr.executionWindow) : 14 * 86_400
  // executableAt reads 0 once a submission is executed, revoked, invalidated by a cut or expired.
  const lapsed = !done && at === 0 && !!sub.data
  let status: { tone: 'good' | 'warn' | 'brand' | 'neutral'; label: string }
  if (done) status = { tone: 'good', label: 'Executed' }
  else if (at === undefined) status = { tone: 'neutral', label: 'Loading' }
  else if (lapsed)
    status = {
      tone: 'neutral',
      label: sub.data?.status ? LAPSED_LABEL[sub.data.status] : 'No longer queued',
    }
  else if (at === 0) status = { tone: 'neutral', label: 'Not submitted' }
  else if (left > 0) status = { tone: 'warn', label: 'Timelocked' }
  else status = { tone: 'brand', label: 'Executable' }

  return (
    <Card aria-labelledby="switch-title">
      <CardHeader
        id="switch-title"
        icon={<IconClock className="size-4" />}
        title="Pending governance: fee switch"
        subtitle="The factory’s setFeeRecipient(FeeRouter), behind its 48-hour timelock"
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      {at !== undefined && at > 0 && !done ? (
        <div className="mb-3 rounded-[3px] border border-line bg-raised/60 p-3 text-center">
          <p className="numeral text-[28px] leading-tight font-medium text-ink">
            {left > 0 ? formatDuration(left) : 'Ready'}
          </p>
          <p className="num text-xs text-muted">
            {left > 0 ? `executable ${formatUtc(at)}` : `executable since ${formatUtc(at)}`}, until{' '}
            {formatUtc(at + execWindow)}
          </p>
        </div>
      ) : null}
      <dl className="divide-y divide-line">
        <Row
          label="Fees go to now"
          value={
            fr.feeRecipient ? (
              isDeployed(fr.feeRecipient) ? (
                <AddressLink
                  href={explorerAddressUrl(appChain.id, fr.feeRecipient)}
                  address={fr.feeRecipient}
                  label={
                    done
                      ? 'FeeRouter'
                      : fr.treasury && isAddressEqual(fr.feeRecipient, fr.treasury)
                        ? 'Treasury'
                        : undefined
                  }
                />
              ) : (
                'Nobody (fee off)'
              )
            ) : (
              <Value loading={fr.isLoading}>{null}</Value>
            )
          }
        />
        <Row
          label="Submitted"
          value={
            sub.data ? (
              <ExternalLink href={explorerTxUrl(appChain.id, sub.data.tx)}>
                <span className="num font-mono text-xs">{shortAddress(sub.data.tx, 6)}</span>
              </ExternalLink>
            ) : sub.isLoading ? (
              <Skeleton />
            ) : (
              '—'
            )
          }
          hint={
            sub.data
              ? `block ${sub.data.block.toLocaleString('en-US')}${lapsed ? ': no longer executable' : ''}`
              : undefined
          }
        />
        <Row
          label="Timelock"
          value={
            fr.timelock !== undefined ? (
              formatDuration(Number(fr.timelock))
            ) : (
              <Value loading={fr.isLoading}>{null}</Value>
            )
          }
          hint="read from executableAt on the factory"
        />
      </dl>
      <p className="mt-3 text-xs text-muted">
        {done
          ? 'Every new borrow’s fee now lands in the FeeRouter.'
          : 'Until it is executed after the timelock, fees go to the treasury. Nothing can shorten the timelock, and a queued call lapses 14 days after it becomes executable.'}
      </p>
    </Card>
  )
}

function EpochCard() {
  const now = Math.floor(useNow(1_000) / 1000)
  const start = epochStart(now)
  const flip = nextEpochFlip(now)
  return (
    <Card aria-labelledby="epoch-title">
      <CardHeader
        id="epoch-title"
        title="Bribe epoch"
        subtitle="Mezo Earn epochs flip every Thursday 00:00 UTC"
      />
      <dl className="divide-y divide-line">
        <Row
          label="Current epoch"
          value={`from ${formatUtc(start)}`}
          hint="bribes posted now are credited here"
        />
        <Row
          label="Next flip"
          tip="Bribes posted during this epoch become claimable by the gauge’s veBTC voters at the flip."
          value={<span className="num">in {formatDuration(flip - now)}</span>}
          hint={formatUtc(flip)}
        />
        <Row
          label="Bribe window"
          tip="The FeeRouter posts no bribe in the last hour of an epoch, when Mezo’s voter only takes votes from whitelisted veNFTs. The bribe share is kept for the first distribution after the flip."
          value={bribeWindowOpen(now) ? 'Open' : <span className="text-warn">Closed</span>}
          hint={
            bribeWindowOpen(now)
              ? `closes ${formatUtc(flip - BRIBE_CUTOFF)}`
              : `reopens at the flip, in ${formatDuration(flip - now)}`
          }
        />
      </dl>
    </Card>
  )
}

function ExplainerCard() {
  return (
    <Card aria-labelledby="explainer-title">
      <CardHeader id="explainer-title" title="Why bribe the BTC/MUSD gauge" />
      <div className="space-y-2 text-sm text-ink/90">
        <p>
          veBTC holders vote each epoch on which pools get MEZO emissions. A MUSD bribe on the
          BTC/MUSD gauge pays the voters who back that pool, pro rata to their votes, once the epoch
          ends.
        </p>
        <p>
          More emissions there mean deeper BTC/MUSD liquidity, and deeper liquidity is exactly what
          lets FlashLiquidator sell seized BTC cleanly. Borrowers’ fees buy the depth that keeps
          their market safe.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <ExternalLink href={MEZO_EARN}>Vote with veBTC on Mezo Earn</ExternalLink>
        <ExternalLink href={MEZO_EARN_DOCS}>How Mezo Earn works</ExternalLink>
      </div>
    </Card>
  )
}
