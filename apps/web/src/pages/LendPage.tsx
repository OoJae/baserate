import {
  ALLOCATOR,
  ALLOCATOR_ACTION_LABEL,
  AllocatorAction,
  baserateAllocatorAbi,
  erc20PermitAbi,
  erc4626ToShares,
  explorerAddressUrl,
  explorerTxUrl,
  formatDuration,
  formatMusd,
  formatPercentWad,
  maxBig,
  minBig,
  mulDivUp,
  parseAmount,
  toFixedDecimal,
  toInputString,
  vaultV2Abi,
  vaultWithdrawRoute,
  WAD,
} from '@baserate/sdk'
import { useState } from 'react'
import { isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem'
import { GetTestFunds } from '../components/GetTestFunds'
import { IconLend } from '../components/icons'
import { TxButton } from '../components/TxButton'
import {
  AddressLink,
  AmountInput,
  Badge,
  Card,
  CardHeader,
  ExternalLink,
  Notice,
  PageHeader,
  ReadError,
  Row,
  Segmented,
  SplitBar,
  Stat,
  Value,
} from '../components/ui'
import {
  type AllocatorSnapshot,
  useAllocatorMoves,
  useVault,
  type VaultView,
} from '../hooks/useVault'
import { useWallet } from '../hooks/useWallet'
import { useNow } from '../lib/useNow'
import { appChain, deployed, registry } from '../wagmi'

const VAULT = registry.contracts.vMusd.address
const ALLOC = registry.contracts.allocator.address
const MUSD = registry.external.musd

type Wallet = ReturnType<typeof useWallet>

/** While the input still shows exactly the rounded Max, act on the exact amount so Max leaves no dust. */
function isExactMax(input: string, max: bigint | undefined, dp: number): boolean {
  return max !== undefined && max > 0n && input !== '' && input === toInputString(max, 18, dp)
}

export function LendPage() {
  const wallet = useWallet()
  const vault = useVault(wallet.address)

  return (
    <>
      <PageHeader
        eyebrow="Lend"
        title="vMUSD: lend MUSD to BTC borrowers"
        lede="Deposit MUSD into a Morpho Vault V2. A permissionless allocator keeps a standing borrow buffer in market M1 and parks everything else in wsMUSD, moving the excess to whichever has paid more over the trailing week."
      />

      <Notice tone="warn" className="mb-5" title="Testnet roles">
        The Baserate deployer is vMUSD’s owner, curator and sentinel on testnet; caps and adapters
        change only through Vault V2’s 48-hour timelocks. The only allocator is BaserateAllocator,
        which anyone can trigger.
      </Notice>
      {!deployed.vault ? (
        <Notice tone="brand" className="mb-5" title="vMUSD is not deployed on this network" />
      ) : null}
      {vault.isError ? <ReadError className="mb-5" what="vMUSD" onRetry={vault.refetch} /> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <VaultCard vault={vault} />
          <ActionsCard vault={vault} wallet={wallet} />
          <AllocatorCard vault={vault} />
        </div>
        <div className="space-y-5 lg:col-span-5">
          <YourVault vault={vault} wallet={wallet} />
          <RatesCard vault={vault} />
          <CapsCard vault={vault} />
          <GetTestFunds />
        </div>
      </div>
    </>
  )
}

function VaultCard({ vault }: { vault: VaultView }) {
  const s = vault.snapshot
  const loading = vault.isLoading
  const inWs =
    vault.heldAssets !== undefined && vault.adapterIdle !== undefined
      ? maxBig(vault.heldAssets - vault.adapterIdle, 0n)
      : undefined
  return (
    <Card aria-labelledby="vault-title">
      <CardHeader
        id="vault-title"
        icon={<IconLend className="size-4" />}
        title="Vault"
        subtitle={
          <AddressLink
            href={explorerAddressUrl(appChain.id, VAULT)}
            address={VAULT}
            label="vMUSD"
          />
        }
        action={<Badge tone="brand">Morpho Vault V2</Badge>}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Total assets"
          value={
            <Value loading={loading}>
              {vault.totalAssets !== undefined ? formatMusd(vault.totalAssets) : null}
            </Value>
          }
          sub="MUSD"
        />
        <Stat
          label="Share price"
          value={
            <Value loading={loading}>
              {vault.sharePrice !== undefined ? toFixedDecimal(vault.sharePrice, 18, 6) : null}
            </Value>
          }
          sub="MUSD per vMUSD"
        />
        <Stat
          label="Lent to M1"
          value={<Value loading={loading}>{s ? formatMusd(s.vaultMarketAssets) : null}</Value>}
          sub="MUSD supplied by vMUSD"
        />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium text-ink">Where the MUSD is</p>
        {s && inWs !== undefined && vault.adapterIdle !== undefined ? (
          <SplitBar
            label="vMUSD allocation"
            segments={[
              {
                key: 'm1',
                label: 'Lent in M1',
                value: s.vaultMarketAssets,
                tone: 'brand',
                detail: `${formatMusd(s.vaultMarketAssets)} MUSD`,
              },
              {
                key: 'ws',
                label: 'In wsMUSD',
                value: inWs,
                tone: 'brand',
                soft: true,
                detail: `${formatMusd(inWs)} MUSD`,
              },
              {
                key: 'adapter-idle',
                label: 'Adapter idle',
                value: vault.adapterIdle,
                tone: 'warn',
                detail: `${formatMusd(vault.adapterIdle)} MUSD`,
              },
              {
                key: 'vault-idle',
                label: 'Vault idle',
                value: s.vaultIdle,
                tone: 'neutral',
                detail: `${formatMusd(s.vaultIdle)} MUSD`,
              },
            ]}
          />
        ) : (
          <Value loading={loading}>{null}</Value>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        Deposits land in wsMUSD through the{' '}
        <ExternalLink
          href={explorerAddressUrl(appChain.id, registry.contracts.wsMusdAdapter.address)}
        >
          liquidity adapter
        </ExternalLink>
        ; the allocator moves MUSD into M1 through the{' '}
        <ExternalLink href={explorerAddressUrl(appChain.id, registry.contracts.m1Adapter.address)}>
          market adapter
        </ExternalLink>
        .
      </p>
    </Card>
  )
}

function YourVault({ vault, wallet }: { vault: VaultView; wallet: Wallet }) {
  if (!wallet.isConnected) return null
  return (
    <Card aria-labelledby="my-vault-title">
      <CardHeader id="my-vault-title" title="Your position" />
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="vMUSD"
          value={vault.shares !== undefined ? formatMusd(vault.shares, { dp: 4 }) : '—'}
          sub={
            vault.sharesValue !== undefined ? `≈ ${formatMusd(vault.sharesValue)} MUSD` : undefined
          }
        />
        <Stat
          label="Wallet MUSD"
          value={wallet.musdBalance !== undefined ? formatMusd(wallet.musdBalance) : '—'}
        />
      </div>
    </Card>
  )
}

function RatesCard({ vault }: { vault: VaultView }) {
  const s = vault.snapshot
  const loading = vault.isLoading
  const window = s ? Number(s.apyWindow) : 0
  const short = s !== undefined && window < ALLOCATOR.MIN_APY_WINDOW
  const below = s ? s.m1Liquidity < s.bufferTarget : false
  const util = s && s.m1SupplyAssets > 0n ? (s.m1BorrowAssets * WAD) / s.m1SupplyAssets : undefined
  return (
    <Card aria-labelledby="rates-title">
      <CardHeader
        id="rates-title"
        title="Rates and buffer"
        subtitle="The allocator’s inputs, read live from BaserateAllocator.snapshot()"
      />
      <dl className="divide-y divide-line">
        <Row
          label="M1 supply APY"
          tip="Spot: borrow rate × utilisation × (1 − fee), annualised (simple), what MUSD lent in M1 earns now; it sizes a move. Trailing: growth of M1’s supply-share price over the same window as wsMUSD’s, annualised; against wsMUSD’s APY it picks the direction of a move. No transaction can move a trailing rate."
          value={
            <Value loading={loading}>
              {s ? (
                <>
                  {formatPercentWad(s.m1SupplyApy)} <span className="text-muted">spot</span> ·{' '}
                  {formatPercentWad(s.m1TrailingApy)} <span className="text-muted">trailing</span>
                </>
              ) : null}
            </Value>
          }
          hint={util !== undefined ? `utilisation ${formatPercentWad(util, 1)}` : undefined}
        />
        <Row
          label="wsMUSD APY"
          tip="wsMUSD share-price growth over the allocator’s hourly checkpoints (target window 7 days), annualised (simple). Compared with M1’s trailing APY over the same window."
          value={<Value loading={loading}>{s ? formatPercentWad(s.wsMusdApy) : null}</Value>}
          hint={
            s
              ? short
                ? `${formatDuration(window)} of history; rate-driven moves need 1 day`
                : `trailing ${formatDuration(window)}`
              : undefined
          }
        />
        <Row
          label="M1 liquidity"
          tip="M1 supply minus borrows: what borrowers can draw right now."
          value={<Value loading={loading}>{s ? `${formatMusd(s.m1Liquidity)} MUSD` : null}</Value>}
          hint={s ? `of ${formatMusd(s.m1SupplyAssets, { dp: 0 })} MUSD supplied` : undefined}
        />
        <Row
          label="Conservative liquidity"
          tip="vMUSD’s own M1 supply plus the lowest outside M1 liquidity seen now and at each checkpoint of the last day. A move from M1 back to wsMUSD is sized on this, so liquidity that appeared in M1 within the last day is never what vMUSD withdraws against."
          value={
            <Value loading={loading}>
              {s ? `${formatMusd(s.conservativeLiquidity)} MUSD` : null}
            </Value>
          }
          hint="sizes moves back to wsMUSD"
        />
        <Row
          label="Buffer target"
          tip="max(2,000 MUSD, 15% of M1 supply). Below it, the allocator tops M1 up regardless of rates."
          value={<Value loading={loading}>{s ? `${formatMusd(s.bufferTarget)} MUSD` : null}</Value>}
          hint={
            s ? (
              below ? (
                <span className="text-warn">
                  {formatMusd(s.bufferTarget - s.m1Liquidity)} MUSD short: next rebalance tops up
                </span>
              ) : (
                'met'
              )
            ) : undefined
          }
        />
      </dl>
    </Card>
  )
}

function CapsCard({ vault }: { vault: VaultView }) {
  const c = vault.caps
  const loading = vault.isLoading
  const cap = (x: { absolute: bigint; relative: bigint; allocation: bigint } | undefined) =>
    x ? `${formatMusd(x.allocation, { dp: 0 })} / ${formatMusd(x.absolute, { dp: 0 })} MUSD` : null
  const rel = (x: { relative: bigint } | undefined) =>
    x
      ? x.relative >= WAD
        ? 'no relative cap'
        : `relative cap ${formatPercentWad(x.relative, 0)}`
      : undefined
  return (
    <Card aria-labelledby="caps-title">
      <CardHeader
        id="caps-title"
        title="Caps"
        subtitle="Allocation / absolute cap per Vault V2 id"
      />
      <dl className="divide-y divide-line">
        <Row
          label="wsMUSD adapter"
          tip="Every deposit is allocated here first, so its room is the deposit room."
          value={<Value loading={loading}>{cap(c?.liquidity)}</Value>}
          hint={
            vault.depositRoom !== undefined
              ? `${formatMusd(vault.depositRoom, { dp: 0 })} MUSD of deposit room`
              : rel(c?.liquidity)
          }
        />
        <Row
          label="M1 market adapter"
          value={<Value loading={loading}>{cap(c?.m1Adapter)}</Value>}
          hint={rel(c?.m1Adapter)}
        />
        <Row
          label="bcBTC collateral"
          tip="Shared by every market with bcBTC collateral."
          value={<Value loading={loading}>{cap(c?.collateral)}</Value>}
          hint={rel(c?.collateral)}
        />
        <Row
          label="Market M1"
          value={<Value loading={loading}>{cap(c?.m1Market)}</Value>}
          hint={rel(c?.m1Market)}
        />
        <Row
          label="Vault fees"
          value={
            <Value loading={loading}>
              {vault.performanceFee !== undefined && vault.managementFee !== undefined
                ? `${formatPercentWad(vault.performanceFee, 0)} performance · ${formatPercentWad(vault.managementFee * 31_536_000n, 0)} management`
                : null}
            </Value>
          }
        />
      </dl>
      <p className="mt-3 text-xs text-muted">
        A cap cut stops new allocations; it never shrinks loans already made.
      </p>
    </Card>
  )
}

function AllocatorCard({ vault }: { vault: VaultView }) {
  const now = Math.floor(useNow(1_000) / 1000)
  const moves = useAllocatorMoves()
  const ready = vault.readyAt !== undefined ? Number(vault.readyAt) : undefined
  const wait = ready !== undefined && ready > now ? ready - now : 0
  const p = vault.preview
  const s = vault.snapshot
  const idle = s?.vaultIdle ?? 0n
  const nothing = p !== undefined && p.action === AllocatorAction.NONE && idle < ALLOCATOR.MIN_MOVE
  const why = p && s ? nextMoveReason(p.action, s) : undefined
  const parkIdle =
    idle >= ALLOCATOR.MIN_MOVE ? `park ${formatMusd(idle)} idle MUSD in wsMUSD` : null

  let reason: string | null = null
  if (!deployed.vault) reason = 'vMUSD is not deployed on this network.'
  else if (wait > 0)
    reason = `Cooling down after the last rate-driven move: ready in ${formatDuration(wait)}.`
  else if (nothing)
    reason = 'Nothing to move right now: the buffer is met and rates do not call for a move.'

  return (
    <Card aria-labelledby="allocator-title">
      <CardHeader
        id="allocator-title"
        title="Allocator"
        subtitle={
          <AddressLink
            href={explorerAddressUrl(appChain.id, ALLOC)}
            address={ALLOC}
            label="BaserateAllocator"
          />
        }
        action={<Badge>Permissionless</Badge>}
      />
      <dl className="divide-y divide-line">
        <Row
          label="Next move"
          tip="BaserateAllocator.previewRebalance(). The M1 borrow buffer comes first and ignores the cooldown. Above it, the trailing APYs (M1’s supply-share price against wsMUSD’s, over the same window) pick the direction and the spot M1 APY sizes the move, at most 1,000 MUSD. No rate-driven move runs with under 1 day of history or when M1 was touched earlier in the same block."
          value={
            <Value loading={vault.isLoading}>
              {p
                ? p.action === AllocatorAction.NONE
                  ? ALLOCATOR_ACTION_LABEL[p.action]
                  : `${ALLOCATOR_ACTION_LABEL[p.action]}: ${formatMusd(p.amount)} MUSD`
                : null}
            </Value>
          }
          hint={
            why || parkIdle
              ? [why, parkIdle ? (why ? `then ${parkIdle}` : `and ${parkIdle}`) : null]
                  .filter(Boolean)
                  .join('; ')
              : undefined
          }
        />
        <Row
          label="Cooldown"
          tip="One hour after each rate-driven move. Buffer top-ups ignore it and do not start it."
          value={
            ready === undefined ? (
              <Value loading={vault.isLoading}>{null}</Value>
            ) : wait > 0 ? (
              <span className="text-warn">{formatDuration(wait)} left</span>
            ) : (
              'Ready'
            )
          }
          hint={
            vault.lastRebalance && vault.lastRebalance > 0n
              ? `last rate-driven move ${formatDuration(now - Number(vault.lastRebalance))} ago`
              : 'no rate-driven move yet'
          }
        />
      </dl>
      {moves.data && moves.data.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">Recent moves</p>
          <ul className="space-y-1.5 text-sm">
            {moves.data.map((m) => (
              <li key={m.tx} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-ink">
                  {ALLOCATOR_ACTION_LABEL[m.action]}{' '}
                  <span className="num font-medium">{formatMusd(m.amount)} MUSD</span>
                </span>
                <span className="num text-xs text-muted">
                  <ExternalLink href={explorerTxUrl(appChain.id, m.tx)}>
                    {m.timestamp ? `${formatDuration(now - m.timestamp)} ago` : `block ${m.block}`}
                  </ExternalLink>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4">
        <TxButton
          variant="secondary"
          size="md"
          label="Rebalance"
          disabledReason={reason}
          request={{ address: ALLOC, abi: baserateAllocatorAbi, functionName: 'rebalance' }}
          pendingTitle="Rebalancing vMUSD"
          successTitle="Rebalanced"
          successMessage={rebalancedMessage}
        />
      </div>
    </Card>
  )
}

/** Why the allocator would (or would not) move funds now, from the snapshot it decides on. */
function nextMoveReason(action: number, s: AllocatorSnapshot): string {
  const m1 = formatPercentWad(s.m1TrailingApy)
  const ws = formatPercentWad(s.wsMusdApy)
  if (action === AllocatorAction.BUFFER_TOP_UP)
    return 'M1 liquidity is below the buffer; top-ups ignore the cooldown'
  if (action === AllocatorAction.TO_MARKET) return `M1 ${m1} trailing beats wsMUSD ${ws}`
  if (action === AllocatorAction.TO_LIQUIDITY) return `wsMUSD ${ws} beats M1 ${m1} trailing`
  if (s.marketTouched)
    return 'M1 was touched earlier in this block: rate moves wait for a later one'
  if (Number(s.apyWindow) < ALLOCATOR.MIN_APY_WINDOW)
    return `${formatDuration(Number(s.apyWindow))} of rate history; rate moves need 1 day`
  if (s.m1TrailingApy === s.wsMusdApy) return `trailing APYs are equal (${m1})`
  return `${s.m1TrailingApy > s.wsMusdApy ? `M1 ${m1} trailing leads wsMUSD ${ws}` : `wsMUSD ${ws} leads M1 ${m1} trailing`}, but no move of 1 MUSD or more fits the spot rate, the buffer and the caps`
}

function rebalancedMessage(receipt: TransactionReceipt): string {
  const logs = receipt.logs.filter((l) => isAddressEqual(l.address, ALLOC))
  const [e] = parseEventLogs({ abi: baserateAllocatorAbi, logs, eventName: 'Rebalanced' })
  if (!e) return `Included in block ${receipt.blockNumber}.`
  const action = Number(e.args.action) as keyof typeof ALLOCATOR_ACTION_LABEL
  return action === AllocatorAction.NONE
    ? 'Nothing to move; idle MUSD parked in wsMUSD.'
    : `${ALLOCATOR_ACTION_LABEL[action]}: ${formatMusd(e.args.amount)} MUSD.`
}

function ActionsCard({ vault, wallet }: { vault: VaultView; wallet: Wallet }) {
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  return (
    <Card aria-labelledby="vault-actions-title">
      <h2 id="vault-actions-title" className="sr-only">
        Deposit or withdraw
      </h2>
      <Segmented
        label="vMUSD action"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'deposit', label: 'Deposit' },
          { value: 'withdraw', label: 'Withdraw' },
        ]}
      />
      <div className="mt-5">
        {tab === 'deposit' ? (
          <Deposit vault={vault} wallet={wallet} />
        ) : (
          <Withdraw vault={vault} wallet={wallet} />
        )}
      </div>
    </Card>
  )
}

function Deposit({ vault, wallet }: { vault: VaultView; wallet: Wallet }) {
  const [input, setInput] = useState('')
  const owner = wallet.address
  const balance = wallet.musdBalance
  const room = vault.depositRoom
  const max =
    balance !== undefined ? (room !== undefined ? minBig(balance, room) : balance) : undefined
  const amount = isExactMax(input, max, 6) && max ? max : (parseAmount(input) ?? 0n)
  const shares =
    vault.totalAssets !== undefined && vault.totalSupply !== undefined
      ? erc4626ToShares(amount, vault.totalAssets, vault.totalSupply)
      : undefined
  const needsApproval = (vault.musdAllowance ?? 0n) < amount

  let reason: string | null = null
  if (!deployed.vault) reason = 'vMUSD is not deployed on this network.'
  else if (amount === 0n) reason = 'Enter an amount of MUSD.'
  else if (balance !== undefined && amount > balance) reason = 'Not enough MUSD in your wallet.'
  else if (room !== undefined && amount > room)
    reason = `The wsMUSD adapter cap allows ${formatMusd(room)} MUSD right now.`

  return (
    <div className="space-y-4">
      <AmountInput
        id="vault-deposit"
        label="Deposit MUSD"
        token="MUSD"
        value={input}
        onChange={setInput}
        invalid={!!reason && amount > 0n}
        onMax={max !== undefined ? () => setInput(toInputString(max, 18, 6)) : undefined}
        maxLabel={balance !== undefined ? `Balance ${formatMusd(balance)} MUSD` : undefined}
        footer={
          amount > 0n && shares !== undefined
            ? `You receive ≈ ${formatMusd(shares, { dp: 4 })} vMUSD`
            : 'Your MUSD goes to wsMUSD first; the allocator lends it to M1 when borrowers need it or M1 pays more.'
        }
      />
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
            args: [VAULT, amount],
          }}
          pendingTitle="Approving MUSD"
          successTitle="MUSD approved"
        />
      ) : null}
      <TxButton
        sticky
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
            ? { address: VAULT, abi: vaultV2Abi, functionName: 'deposit', args: [amount, owner] }
            : undefined
        }
        pendingTitle="Depositing into vMUSD"
        successTitle="Deposited"
        successMessage={(receipt) => vaultEventMessage(receipt, 'Deposit')}
        onConfirmed={() => setInput('')}
      />
      <p className="text-xs text-muted">
        Vault V2 has no permit deposit, so this is an approval and then the deposit.
      </p>
    </div>
  )
}

function Withdraw({ vault, wallet }: { vault: VaultView; wallet: Wallet }) {
  const [input, setInput] = useState('')
  const owner = wallet.address
  const s = vault.snapshot
  const max = vault.sharesValue
  const all = isExactMax(input, max, 6)
  const assets = all && max ? max : (parseAmount(input) ?? 0n)
  const route =
    s && assets > 0n
      ? vaultWithdrawRoute(assets, {
          vaultIdle: s.vaultIdle,
          liquidityAvailable: s.liquidityAvailable,
        })
      : 'direct'
  const viaAllocator = route === 'allocator'
  // Shares burnt (rounded up, as previewWithdraw), with 1% headroom for interest between approval and withdrawal.
  const sharesNeeded =
    vault.totalAssets !== undefined && vault.totalSupply !== undefined
      ? mulDivUp(assets, vault.totalSupply + 1n, vault.totalAssets + 1n)
      : undefined
  const approveShares =
    sharesNeeded !== undefined && vault.shares !== undefined
      ? minBig((sharesNeeded * 101n) / 100n, vault.shares)
      : undefined
  const needsApproval =
    viaAllocator && sharesNeeded !== undefined && (vault.allocatorAllowance ?? 0n) < sharesNeeded
  const liquidNow = s ? s.vaultIdle + s.liquidityAvailable : undefined
  // The allocator can pull at most min(vMUSD's M1 position, M1's free liquidity) on top.
  const reachable =
    s && liquidNow !== undefined
      ? liquidNow + minBig(s.vaultMarketAssets, s.m1Liquidity)
      : undefined

  let reason: string | null = null
  if (!deployed.vault) reason = 'vMUSD is not deployed on this network.'
  else if (assets === 0n) reason = 'Enter an amount of MUSD.'
  else if (max !== undefined && assets > max)
    reason = `Your vMUSD is worth ${formatMusd(max)} MUSD.`
  else if (reachable !== undefined && assets > reachable)
    reason = `Only ${formatMusd(reachable)} MUSD can leave the vault now; the rest is lent to borrowers.`

  const request = owner
    ? viaAllocator
      ? all && vault.shares
        ? {
            address: ALLOC,
            abi: baserateAllocatorAbi,
            functionName: 'redeem',
            args: [vault.shares, owner],
          }
        : {
            address: ALLOC,
            abi: baserateAllocatorAbi,
            functionName: 'withdraw',
            args: [assets, owner],
          }
      : all && vault.shares
        ? {
            address: VAULT,
            abi: vaultV2Abi,
            functionName: 'redeem',
            args: [vault.shares, owner, owner],
          }
        : {
            address: VAULT,
            abi: vaultV2Abi,
            functionName: 'withdraw',
            args: [assets, owner, owner],
          }
    : undefined

  return (
    <div className="space-y-4">
      <AmountInput
        id="vault-withdraw"
        label="Withdraw MUSD"
        token="MUSD"
        value={input}
        onChange={setInput}
        invalid={!!reason && assets > 0n}
        onMax={max !== undefined ? () => setInput(toInputString(max, 18, 6)) : undefined}
        maxLabel={
          vault.shares !== undefined
            ? `${formatMusd(vault.shares, { dp: 4 })} vMUSD ≈ ${formatMusd(max ?? 0n)} MUSD`
            : undefined
        }
        footer={
          liquidNow !== undefined
            ? `${formatMusd(liquidNow)} MUSD is instantly liquid (vault idle + wsMUSD)`
            : undefined
        }
      />
      {assets > 0n && s ? (
        viaAllocator ? (
          <Notice tone="brand" title="Part of this comes out of M1">
            The allocator deallocates {formatMusd(assets - (liquidNow ?? 0n))} MUSD from M1 for you,
            with no force-deallocate penalty. It needs your approval to burn the vMUSD.
          </Notice>
        ) : (
          <p className="text-xs text-muted">
            Paid from the vault’s idle MUSD and wsMUSD in one transaction.
          </p>
        )
      ) : null}
      {needsApproval && owner && approveShares !== undefined ? (
        <TxButton
          variant="secondary"
          size="md"
          label={`1. Approve ${formatMusd(approveShares, { dp: 4 })} vMUSD to the allocator`}
          disabledReason={reason}
          request={{
            address: VAULT,
            abi: vaultV2Abi,
            functionName: 'approve',
            args: [ALLOC, approveShares],
          }}
          pendingTitle="Approving vMUSD"
          successTitle="vMUSD approved"
        />
      ) : null}
      <TxButton
        sticky
        label={
          needsApproval
            ? '2. Withdraw'
            : assets > 0n
              ? `Withdraw ${formatMusd(assets)} MUSD`
              : 'Withdraw'
        }
        disabledReason={reason ?? (needsApproval ? 'Approve vMUSD to the allocator first.' : null)}
        request={request}
        pendingTitle="Withdrawing from vMUSD"
        successTitle="Withdrawn"
        successMessage={(receipt) => vaultEventMessage(receipt, 'Withdraw')}
        onConfirmed={() => setInput('')}
      />
      <p className="text-xs text-muted">
        {viaAllocator
          ? `Through BaserateAllocator.${all ? 'redeem' : 'withdraw'}.`
          : `Straight from vMUSD (${all ? 'redeem' : 'withdraw'}).`}
      </p>
    </div>
  )
}

/** What a vMUSD deposit or withdrawal did, from the vault's own event. */
function vaultEventMessage(receipt: TransactionReceipt, kind: 'Deposit' | 'Withdraw'): string {
  const logs = receipt.logs.filter((l) => isAddressEqual(l.address, VAULT))
  if (kind === 'Deposit') {
    const [e] = parseEventLogs({ abi: vaultV2Abi, logs, eventName: 'Deposit' })
    if (e)
      return `${formatMusd(e.args.shares, { dp: 4 })} vMUSD minted for ${formatMusd(e.args.assets)} MUSD.`
  } else {
    const [e] = parseEventLogs({ abi: vaultV2Abi, logs, eventName: 'Withdraw' })
    if (e) return `${formatMusd(e.args.assets)} MUSD sent to your wallet.`
  }
  return `Included in block ${receipt.blockNumber}.`
}
