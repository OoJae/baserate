import {
  backstopAbi,
  erc20PermitAbi,
  erc4626ToAssets,
  erc4626ToShares,
  explorerAddressUrl,
  formatBtc,
  formatDuration,
  formatMusd,
  formatPercentWad,
  minBig,
  mulDivDown,
  parseAmount,
  toFixedDecimal,
  toInputString,
  WAD,
} from '@baserate/sdk'
import { useState } from 'react'
import { isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem'
import {
  type BackstopView,
  type RedeemRequestView,
  useBackstop,
  useRedeemRequests,
} from '../../hooks/useBackstop'
import { useOracle } from '../../hooks/useOracle'
import { useWallet } from '../../hooks/useWallet'
import { formatUtc } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { appChain, deployed, registry } from '../../wagmi'
import { IconShield } from '../icons'
import { TxButton } from '../TxButton'
import {
  AddressLink,
  AmountInput,
  Badge,
  Card,
  CardHeader,
  Notice,
  ReadError,
  Row,
  Segmented,
  Stat,
  Value,
} from '../ui'

const BACKSTOP = registry.contracts.backstop.address
const MUSD = registry.external.musd

type Wallet = ReturnType<typeof useWallet>

/** Inventory below `DUST_INVENTORY` counts as 0 in NAV, so it needs no oracle. */
function isDust(b: BackstopView): boolean {
  return (
    b.inventory !== undefined &&
    b.dustInventory !== undefined &&
    b.inventory > 0n &&
    b.inventory < b.dustInventory
  )
}

/** True when NAV depends on the oracle: at least `DUST_INVENTORY` of BTC is held. */
function holdsPricedBtc(b: BackstopView): boolean {
  return (
    b.inventory !== undefined && b.dustInventory !== undefined && b.inventory >= b.dustInventory
  )
}

/** The backstop (bMUSD): NAV, cash, inventory and auction, plus deposit and the 7-day exit queue. */
export function BackstopCard() {
  const wallet = useWallet()
  const b = useBackstop(wallet.address)
  const now = Math.floor(useNow(5_000) / 1000)
  const [tab, setTab] = useState<'deposit' | 'exit' | 'auction'>('deposit')
  const loading = b.isLoading
  const v = b.vesting
  const vestLeft = v && Number(v.periodEnd) > now ? Number(v.periodEnd) - now : 0

  return (
    <Card aria-labelledby="backstop-title">
      <CardHeader
        id="backstop-title"
        icon={<IconShield className="size-4" />}
        title="Backstop"
        subtitle={
          <AddressLink
            href={explorerAddressUrl(appChain.id, BACKSTOP)}
            address={BACKSTOP}
            label="bMUSD"
          />
        }
        action={
          b.depositsPaused ? (
            <Badge tone="warn">Deposits paused</Badge>
          ) : (
            <Badge tone="brand">Live</Badge>
          )
        }
      />
      <p className="mb-4 text-sm text-muted">
        MUSD that buys seized BTC at the oracle price less half the liquidation incentive
        {b.discount !== undefined ? ` (${formatPercentWad(b.discount)})` : ''} when DEX depth is
        thin, then sells it back through a Dutch auction.
      </p>
      {b.isError ? <ReadError className="mb-4" what="the backstop" onRetry={b.refetch} /> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="NAV"
          value={
            <Value loading={loading}>
              {b.sharePrice !== undefined ? toFixedDecimal(b.sharePrice, 18, 6) : null}
            </Value>
          }
          sub="MUSD per bMUSD"
        />
        <Stat
          label="Total assets"
          value={
            <Value loading={loading}>
              {b.totalAssets !== undefined ? formatMusd(b.totalAssets) : null}
            </Value>
          }
          sub="MUSD"
        />
        <Stat
          label="Inventory"
          value={
            <Value loading={loading}>
              {b.inventory !== undefined ? (
                <span className="text-btc">{formatBtc(b.inventory)}</span>
              ) : null}
            </Value>
          }
          sub={isDust(b) ? 'BTC: dust, valued at 0' : 'BTC for sale'}
        />
      </div>
      <dl className="mt-4 divide-y divide-line border-t border-line pt-2">
        <Row
          label="Free cash"
          tip="Cash (MUSD plus redeemable wsMUSD) minus MUSD reserved for queued exits: what the backstop can pay for collateral now."
          value={
            <Value loading={loading}>
              {b.availableCash !== undefined ? `${formatMusd(b.availableCash)} MUSD` : null}
            </Value>
          }
          hint={
            b.cash !== undefined && b.reservedAssets !== undefined
              ? `${formatMusd(b.cash)} MUSD cash · ${formatMusd(b.reservedAssets)} MUSD reserved for exits`
              : undefined
          }
        />
        <Row
          label="Realisable value"
          tip="Cash plus BTC inventory marked at the oracle price × 0.95 (0 while the oracle is down or the inventory is dust, under 0.00001 BTC). New deposits are priced at this value."
          value={
            <Value loading={loading}>
              {b.grossAssets !== undefined ? `${formatMusd(b.grossAssets)} MUSD` : null}
            </Value>
          }
        />
        <Row
          label="Vesting gains"
          tip="Premiums, auction gains and yield vest over 7 days, so a deposit just before a gain cannot capture it."
          value={
            <Value loading={loading}>
              {v ? `${formatMusd(v.unvested, { dp: 4 })} MUSD` : null}
            </Value>
          }
          hint={
            v
              ? vestLeft > 0
                ? `fully vested in ${formatDuration(vestLeft)}`
                : 'nothing vesting'
              : undefined
          }
        />
      </dl>

      <div className="mt-4 border-t border-line pt-4">
        <Segmented
          label="Backstop action"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'deposit', label: 'Deposit' },
            { value: 'exit', label: 'Exit' },
            { value: 'auction', label: 'Auction' },
          ]}
        />
        <div className="mt-4">
          {tab === 'deposit' ? (
            <BackstopDeposit b={b} wallet={wallet} />
          ) : tab === 'exit' ? (
            <BackstopExit b={b} wallet={wallet} now={now} />
          ) : (
            <Auction b={b} wallet={wallet} now={now} />
          )}
        </div>
      </div>
    </Card>
  )
}

function BackstopDeposit({ b, wallet }: { b: BackstopView; wallet: Wallet }) {
  const [input, setInput] = useState('')
  const owner = wallet.address
  const balance = wallet.musdBalance
  const amount = parseAmount(input) ?? 0n
  // Same as `previewDeposit`: deposits are priced at book + unvested gains (`grossAssets`), not at `totalAssets`.
  const shares =
    b.grossAssets !== undefined && b.totalSupply !== undefined
      ? erc4626ToShares(amount, b.grossAssets, b.totalSupply)
      : undefined
  // What those shares read at the recognised NAV until the gains still vesting are released.
  const readsAs =
    shares !== undefined && b.totalAssets !== undefined && b.totalSupply !== undefined
      ? erc4626ToAssets(shares, b.totalAssets, b.totalSupply)
      : undefined
  const unvested =
    b.grossAssets !== undefined && b.totalAssets !== undefined && b.grossAssets > b.totalAssets
      ? b.grossAssets - b.totalAssets
      : 0n
  const vestEnd = b.vesting ? Number(b.vesting.periodEnd) : 0
  const needsApproval = (b.musdAllowance ?? 0n) < amount
  let reason: string | null = null
  if (!deployed.backstop) reason = 'The backstop is not deployed on this network.'
  else if (b.depositsPaused) reason = 'The sentinel has paused deposits; exits still work.'
  else if (
    b.inventory !== undefined &&
    b.dustInventory !== undefined &&
    b.inventory >= b.dustInventory
  )
    reason =
      'Deposits are closed while the backstop holds BTC from a liquidation, so nobody can buy in below the sale price. They reopen once it is sold (usually within the 6-hour auction).'
  else if (amount === 0n) reason = 'Enter an amount of MUSD.'
  else if (balance !== undefined && amount > balance) reason = 'Not enough MUSD in your wallet.'

  return (
    <div className="space-y-3">
      <AmountInput
        id="backstop-deposit"
        label="Deposit MUSD"
        token="MUSD"
        value={input}
        onChange={setInput}
        invalid={!!reason && amount > 0n}
        onMax={balance !== undefined ? () => setInput(toInputString(balance, 18, 6)) : undefined}
        maxLabel={balance !== undefined ? `Balance ${formatMusd(balance)} MUSD` : undefined}
        footer={
          amount > 0n && shares !== undefined
            ? `You receive ≈ ${formatMusd(shares, { dp: 4 })} bMUSD`
            : 'Exits take 7 days and pay the lower of the NAV at request and at claim.'
        }
      />
      {amount > 0n && unvested > 0n && readsAs !== undefined ? (
        <Notice title="Priced at book plus unvested gains">
          {formatMusd(unvested)} MUSD of gains is still vesting, and a new share pays for its part
          of it, so your bMUSD will read ≈ {formatMusd(readsAs)} MUSD at first and rise toward what
          you paid as those gains vest
          {vestEnd > 0 ? ` (by ${formatUtc(vestEnd)})` : ''}. A deposit cannot capture gains made
          before it arrived.
        </Notice>
      ) : null}
      {needsApproval && owner ? (
        <TxButton
          variant="secondary"
          size="md"
          label={`1. Approve ${formatMusd(amount)} MUSD`}
          disabledReason={reason}
          request={{
            address: MUSD,
            abi: erc20PermitAbi,
            functionName: 'approve',
            args: [BACKSTOP, amount],
          }}
          pendingTitle="Approving MUSD"
          successTitle="MUSD approved"
        />
      ) : null}
      <TxButton
        size="md"
        label={
          needsApproval
            ? '2. Deposit'
            : amount > 0n
              ? `Deposit ${formatMusd(amount)} MUSD`
              : 'Deposit'
        }
        disabledReason={reason ?? (needsApproval ? 'Approve MUSD first.' : null)}
        request={
          owner
            ? {
                address: BACKSTOP,
                abi: backstopAbi,
                functionName: 'deposit',
                args: [amount, owner],
              }
            : undefined
        }
        pendingTitle="Depositing into the backstop"
        successTitle="Deposited"
        onConfirmed={() => setInput('')}
      />
    </div>
  )
}

function BackstopExit({ b, wallet, now }: { b: BackstopView; wallet: Wallet; now: number }) {
  const [input, setInput] = useState('')
  const owner = wallet.address
  const requests = useRedeemRequests(owner)
  const oracle = useOracle()
  // The backstop prices BTC with the M1 oracle; while it is down and BTC is held, `claimRedeem` cannot run.
  const oracleDown = oracle.status !== undefined && !oracle.status.ok && holdsPricedBtc(b)
  const max = b.shares
  const shares =
    max !== undefined && max > 0n && input === toInputString(max, 18, 8)
      ? max
      : (parseAmount(input) ?? 0n)
  let reason: string | null = null
  if (!deployed.backstop) reason = 'The backstop is not deployed on this network.'
  else if (shares === 0n) reason = 'Enter an amount of bMUSD.'
  else if (max !== undefined && shares > max)
    reason = `You hold ${formatMusd(max, { dp: 4 })} bMUSD.`
  const pending = (requests.data ?? []).filter((r) => r.pending)
  const delay = b.redeemDelay !== undefined ? Number(b.redeemDelay) : 7 * 86_400

  return (
    <div className="space-y-3">
      <AmountInput
        id="backstop-redeem"
        label="Request redeem"
        token="bMUSD"
        tokenTone="brand"
        value={input}
        onChange={setInput}
        invalid={!!reason && shares > 0n}
        onMax={max !== undefined ? () => setInput(toInputString(max, 18, 8)) : undefined}
        maxLabel={
          max !== undefined
            ? `${formatMusd(max, { dp: 4 })} bMUSD${b.sharesValue !== undefined ? ` ≈ ${formatMusd(b.sharesValue)} MUSD` : ''}`
            : undefined
        }
        footer={`Claimable in ${formatDuration(delay)}; your shares are escrowed until then. If cash is short at claim time, the claim pays what there is and the rest stays queued.`}
      />
      <TxButton
        size="md"
        variant="secondary"
        label="Request redeem"
        disabledReason={reason}
        request={
          owner
            ? {
                address: BACKSTOP,
                abi: backstopAbi,
                functionName: 'requestRedeem',
                args: [shares, owner, owner],
              }
            : undefined
        }
        pendingTitle="Queuing your exit"
        successTitle="Exit queued"
        onConfirmed={() => {
          setInput('')
          void requests.refetch()
        }}
      />
      {pending.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Your queued exits</p>
          <ul className="space-y-2">
            {pending.map((r) => (
              <QueuedExit
                key={r.id.toString()}
                r={r}
                b={b}
                now={now}
                oracleDown={oracleDown}
                onClaimed={() => void requests.refetch()}
              />
            ))}
          </ul>
        </div>
      ) : owner && requests.data ? (
        <p className="text-xs text-muted">No queued exits for this wallet.</p>
      ) : null}
    </div>
  )
}

/** One queued exit: its claim (in full or, when cash is short, in part) and, during an oracle outage, the owner's
 * claim with the BTC valued at 0. */
function QueuedExit({
  r,
  b,
  now,
  oracleDown,
  onClaimed,
}: {
  r: RedeemRequestView
  b: BackstopView
  now: number
  oracleDown: boolean
  onClaimed: () => void
}) {
  const left = r.claimableAt - now
  const matured = left <= 0
  // A claim pays min(NAV at request, NAV now) from cash (all of the cash when it falls short).
  const owed =
    b.sharePrice !== undefined
      ? minBig(r.assets, mulDivDown(r.shares, b.sharePrice, WAD))
      : r.assets
  const cash = b.cash
  const partial = matured && cash !== undefined && cash > 0n && cash < owed
  // claimRedeemWithoutOracle: shares × min(book, cash) / supply, capped at the request NAV.
  const withoutOracle =
    b.vesting && cash !== undefined && b.totalSupply !== undefined
      ? minBig(
          r.assets,
          mulDivDown(r.shares, minBig(b.vesting.book, cash) + 1n, b.totalSupply + 1n),
        )
      : undefined

  let reason: string | null = null
  if (!matured) reason = `Unlocks ${new Date(r.claimableAt * 1000).toUTCString()}.`
  else if (oracleDown)
    reason =
      'The oracle is down and the backstop holds BTC, so a claim cannot value it. Wait for the oracle, or claim without it below.'
  else if (cash === 0n)
    reason =
      'The backstop has no cash right now: its value is held as BTC. Claim again once an auction or a keeper sale refills cash.'

  return (
    <li className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="num text-ink">
          #{r.id.toString()} · {formatMusd(r.shares, { dp: 4 })} bMUSD
          {r.partlyPaid ? (
            <span className="text-muted">
              {' '}
              left of {formatMusd(r.requestedShares, { dp: 4 })} (partly paid)
            </span>
          ) : null}
        </span>
        <span className="num text-xs text-muted">up to {formatMusd(r.assets)} MUSD</span>
      </div>
      {r.partlyPaid && r.paidAssets ? (
        <p className="num mt-1 text-xs text-muted">
          {formatMusd(r.paidAssets)} MUSD paid so far
          {r.claimCount ? ` in ${r.claimCount} claim${r.claimCount === 1 ? '' : 's'}` : ''}; the
          rest is still owed at the request NAV.
        </p>
      ) : null}
      <div className="mt-2">
        <TxButton
          size="md"
          variant="secondary"
          label={
            !matured
              ? `Claimable in ${formatDuration(left)}`
              : partial && cash !== undefined
                ? `Claim ≈ ${formatMusd(cash)} MUSD now`
                : `Claim ≈ ${formatMusd(owed)} MUSD`
          }
          disabledReason={reason}
          request={{
            address: BACKSTOP,
            abi: backstopAbi,
            functionName: 'claimRedeem',
            args: [r.id],
          }}
          pendingTitle="Claiming"
          successTitle="Exit claimed"
          successMessage={claimedMessage}
          onConfirmed={onClaimed}
        />
        {partial && !oracleDown && cash !== undefined ? (
          <p className="mt-1.5 text-xs text-muted">
            Cash covers ≈ {formatMusd(cash)} of the ≈ {formatMusd(owed)} MUSD due. This claim pays
            it and keeps the rest queued at the same request NAV, claimable again as BTC sales
            refill cash.
          </p>
        ) : null}
      </div>
      {matured && oracleDown ? (
        <div className="mt-3 border-t border-line pt-3">
          <TxButton
            size="md"
            variant="secondary"
            label="Claim without the oracle"
            request={{
              address: BACKSTOP,
              abi: backstopAbi,
              functionName: 'claimRedeemWithoutOracle',
              args: [r.id],
            }}
            pendingTitle="Claiming without the oracle"
            successTitle="Exit claimed"
            successMessage={claimedMessage}
            onConfirmed={onClaimed}
          />
          <p className="mt-1.5 text-xs text-muted">
            Values the backstop’s BTC at 0 for your claim only, so it pays
            {withoutOracle !== undefined ? ` at most ≈ ${formatMusd(withoutOracle)} MUSD,` : ''}{' '}
            never more than a normal claim, all from cash. Only you can use it, and it lowers only
            your own payout.
          </p>
        </div>
      ) : null}
    </li>
  )
}

/** What a claim paid, and what stays queued after a partial one, from the backstop's events. */
function claimedMessage(receipt: TransactionReceipt): string {
  const logs = receipt.logs.filter((l) => isAddressEqual(l.address, BACKSTOP))
  const [paid] = parseEventLogs({ abi: backstopAbi, logs, eventName: 'RedeemClaimed' })
  const [rest] = parseEventLogs({ abi: backstopAbi, logs, eventName: 'RedeemPartiallyClaimed' })
  if (!paid) return `Included in block ${receipt.blockNumber}.`
  const sent = `${formatMusd(paid.args.assets)} MUSD sent.`
  return rest
    ? `${sent} ${formatMusd(rest.args.sharesLeft, { dp: 4 })} bMUSD (up to ${formatMusd(rest.args.assetsLeft)} MUSD) stays queued; claim it again as cash comes in.`
    : sent
}

function Auction({ b, wallet, now }: { b: BackstopView; wallet: Wallet; now: number }) {
  const owner = wallet.address
  const inventory = b.inventory ?? 0n
  const quote = b.auctionQuote
  // 0.5% headroom: the price only falls while the auction runs, so this covers a block of drift the other way.
  const maxIn = quote !== undefined ? (quote * 1_005n) / 1_000n : undefined
  const needsApproval = maxIn !== undefined && (b.musdAllowance ?? 0n) < maxIn
  const elapsed = b.auctionStart && b.auctionStart > 0n ? now - Number(b.auctionStart) : undefined
  let reason: string | null = null
  if (inventory === 0n)
    reason = 'No BTC inventory: the auction starts when the backstop buys seized BTC.'
  else if (quote === undefined) reason = 'Loading the auction price…'
  else if (wallet.musdBalance !== undefined && maxIn !== undefined && wallet.musdBalance < quote)
    reason = `This costs ${formatMusd(quote)} MUSD; your wallet holds ${formatMusd(wallet.musdBalance)}.`

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line">
        <Row
          label="Price factor"
          tip="Starts at 100% of the oracle price and falls linearly to 95% over 6 hours; more BTC arriving pulls the clock back."
          value={
            <Value loading={b.isLoading}>
              {b.auctionFactor !== undefined
                ? `${formatPercentWad(b.auctionFactor)} of oracle`
                : null}
            </Value>
          }
          hint={
            elapsed !== undefined && inventory > 0n ? `running ${formatDuration(elapsed)}` : 'idle'
          }
        />
        <Row
          label="All inventory"
          value={
            inventory > 0n ? <span className="text-btc">{formatBtc(inventory)} BTC</span> : '0 BTC'
          }
          hint={quote !== undefined && inventory > 0n ? `for ${formatMusd(quote)} MUSD` : undefined}
        />
      </dl>
      {inventory === 0n ? (
        <Notice title="Nothing to buy">
          The backstop holds no BTC, so there is no auction to take. It fills when a liquidation
          sells seized BTC to it.
        </Notice>
      ) : null}
      {needsApproval && owner && maxIn !== undefined ? (
        <TxButton
          variant="secondary"
          size="md"
          label={`1. Approve ${formatMusd(maxIn)} MUSD`}
          disabledReason={reason}
          request={{
            address: MUSD,
            abi: erc20PermitAbi,
            functionName: 'approve',
            args: [BACKSTOP, maxIn],
          }}
          pendingTitle="Approving MUSD"
          successTitle="MUSD approved"
        />
      ) : null}
      <TxButton
        size="md"
        label={
          quote !== undefined && inventory > 0n
            ? `Buy ${formatBtc(inventory)} BTC for ≈ ${formatMusd(quote)} MUSD`
            : 'Take auction'
        }
        disabledReason={reason ?? (needsApproval ? 'Approve MUSD first.' : null)}
        request={
          owner && maxIn !== undefined
            ? {
                address: BACKSTOP,
                abi: backstopAbi,
                functionName: 'takeAuction',
                args: [inventory, maxIn, owner],
              }
            : undefined
        }
        pendingTitle="Buying from the auction"
        successTitle="Bought"
      />
    </div>
  )
}
