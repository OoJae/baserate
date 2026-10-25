import {
  erc20PermitAbi,
  erc4626ToAssets,
  erc4626ToShares,
  explorerAddressUrl,
  formatDuration,
  formatMusd,
  formatPercent,
  maxBig,
  minBig,
  musdAllowanceOverride,
  parseAmount,
  sharePriceApy,
  shortAddress,
  signMusdPermit,
  smusdAbi,
  toFixedDecimal,
  toInputString,
  WAD,
  wsMusdAbi,
} from '@baserate/sdk'
import { useState } from 'react'
import { useConfig, usePublicClient, useReadContracts } from 'wagmi'
import { signTypedData } from 'wagmi/actions'
import { GetTestFunds } from '../components/GetTestFunds'
import { IconSave } from '../components/icons'
import { TxButton } from '../components/TxButton'
import {
  AmountInput,
  Badge,
  Card,
  CardHeader,
  ExternalLink,
  Notice,
  PageHeader,
  Row,
  Segmented,
  Stat,
  Value,
} from '../components/ui'
import { useWallet } from '../hooks/useWallet'
import { useWsMusd, type WsMusdView } from '../hooks/useWsMusd'
import { useNow } from '../lib/useNow'
import { appChain, deployed, registry } from '../wagmi'

const WS = registry.contracts.wsMusd.address
const ONE_DAY = 86_400

function sharePrice4(p: bigint | undefined) {
  return p !== undefined ? toFixedDecimal(p, 18, 6) : undefined
}

export function SavePage() {
  const wallet = useWallet()
  const ws = useWsMusd(wallet.address)

  return (
    <>
      <PageHeader
        eyebrow="Save"
        title="wsMUSD: sMUSD savings as an ERC-4626 token"
        lede="Deposit MUSD; wsMUSD deposits it into Mezo’s sMUSD and vests the yield over three days, so the share price only rises and can be used by any vault, market or pool."
      />

      <Notice tone="warn" className="mb-5" title="Testnet yield is simulated by Baserate">
        On testnet the team donates MUSD to wsMUSD at a labelled ≈1% APR, which vests over 3 days
        like real yield. On mainnet, yield is the live sMUSD savings rate.
      </Notice>
      {!deployed.wsMusd ? (
        <Notice tone="brand" className="mb-5" title="wsMUSD deploys to Mezo testnet next">
          The underlying sMUSD below is live. Deposits open when the wsMUSD contract is deployed.
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <PoolCard ws={ws} />
          <ActionsCard ws={ws} wallet={wallet} />
        </div>
        <div className="space-y-5 lg:col-span-5">
          <YourSavings ws={ws} wallet={wallet} />
          <UnderlyingCard />
          <GetTestFunds />
        </div>
      </div>
    </>
  )
}

function PoolCard({ ws }: { ws: WsMusdView }) {
  const now = Math.floor(useNow(5_000) / 1000)
  const v = ws.vesting
  const vestLeft = v && Number(v.periodEnd) > now ? Number(v.periodEnd) - now : 0
  const elapsed = ws.deployedAt ? now - Number(ws.deployedAt) : 0
  const apy = ws.sharePrice && elapsed > ONE_DAY ? sharePriceApy(ws.sharePrice, elapsed) : null
  const remaining =
    ws.depositCap !== undefined && ws.totalAssets !== undefined
      ? maxBig(ws.depositCap - ws.totalAssets, 0n)
      : undefined
  const loading = deployed.wsMusd && ws.isLoading

  return (
    <Card aria-labelledby="pool-title">
      <CardHeader
        id="pool-title"
        icon={<IconSave className="size-4" />}
        title="Pool"
        subtitle={
          deployed.wsMusd ? (
            <ExternalLink href={explorerAddressUrl(appChain.id, WS)}>
              wsMUSD {shortAddress(WS)}
            </ExternalLink>
          ) : (
            'Not deployed yet'
          )
        }
        action={deployed.wsMusd ? <SyncButton /> : null}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Share price"
          value={<Value loading={loading}>{sharePrice4(ws.sharePrice)}</Value>}
          sub="MUSD per wsMUSD"
        />
        <Stat
          label="Total assets"
          value={
            <Value loading={loading}>
              {ws.totalAssets !== undefined ? formatMusd(ws.totalAssets) : null}
            </Value>
          }
          sub="MUSD"
        />
        <Stat
          label="APY since launch"
          value={<Value loading={loading}>{apy !== null ? formatPercent(apy) : null}</Value>}
          sub={elapsed > 0 && elapsed <= ONE_DAY ? 'Needs a day of history' : 'From share price'}
        />
      </div>
      <dl className="mt-4 divide-y divide-line border-t border-line pt-2">
        <Row
          label="Pending yield"
          tip="sMUSD yield not yet harvested: claimableYield + balance × (yieldIndex − supplyYieldIndex) ÷ 1e18. The next sync starts vesting it."
          value={
            <Value loading={loading}>
              {ws.pendingYield !== undefined
                ? `${formatMusd(ws.pendingYield, { dp: 4 })} MUSD`
                : null}
            </Value>
          }
        />
        <Row
          label="Vesting"
          tip="Harvested yield vests linearly over 3 days, so a same-block deposit cannot capture it."
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
        <Row
          label="Last sync"
          value={
            <Value loading={loading}>
              {v && v.lastSync > 0n ? `${formatDuration(now - Number(v.lastSync))} ago` : null}
            </Value>
          }
        />
        <Row
          label="Deposit cap"
          tip="Raise-only, behind a 72-hour timelock. There is no pause and no way to lower it."
          value={
            <Value loading={loading}>
              {ws.depositCap !== undefined ? `${formatMusd(ws.depositCap, { dp: 0 })} MUSD` : null}
            </Value>
          }
          hint={
            remaining !== undefined ? `${formatMusd(remaining, { dp: 0 })} MUSD of room` : undefined
          }
        />
        {ws.pendingCap && ws.pendingCap > 0n ? (
          <Row
            label="Pending cap raise"
            value={`${formatMusd(ws.pendingCap, { dp: 0 })} MUSD`}
            hint={
              ws.pendingCapAt && Number(ws.pendingCapAt) > now
                ? `executable in ${formatDuration(Number(ws.pendingCapAt) - now)}`
                : 'executable now'
            }
          />
        ) : null}
        <Row
          label="Held in sMUSD"
          value={
            <Value loading={loading}>
              {ws.smusdHeld !== undefined ? `${formatMusd(ws.smusdHeld)} sMUSD` : null}
            </Value>
          }
        />
      </dl>
    </Card>
  )
}

/** `sync()` is permissionless: anyone can harvest pending sMUSD yield into the vesting schedule. */
function SyncButton() {
  return (
    <div className="w-36">
      <TxButton
        variant="secondary"
        size="md"
        label="Sync yield"
        request={{ address: WS, abi: wsMusdAbi, functionName: 'sync' }}
        pendingTitle="Syncing wsMUSD"
        successTitle="Yield synced"
      />
    </div>
  )
}

function YourSavings({ ws, wallet }: { ws: WsMusdView; wallet: ReturnType<typeof useWallet> }) {
  if (!wallet.isConnected) return null
  return (
    <Card aria-labelledby="mine-title">
      <CardHeader id="mine-title" title="Your savings" />
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="wsMUSD"
          value={ws.shares !== undefined ? formatMusd(ws.shares, { dp: 4 }) : '—'}
          sub={ws.sharesValue !== undefined ? `≈ ${formatMusd(ws.sharesValue)} MUSD` : undefined}
        />
        <Stat
          label="Wallet MUSD"
          value={wallet.musdBalance !== undefined ? formatMusd(wallet.musdBalance) : '—'}
        />
      </div>
    </Card>
  )
}

function UnderlyingCard() {
  const q = useReadContracts({
    contracts: [
      { address: registry.external.smusd, abi: smusdAbi, functionName: 'totalSupply' },
      { address: registry.external.smusd, abi: smusdAbi, functionName: 'yieldIndex' },
    ],
    allowFailure: true,
    query: { refetchInterval: 60_000 },
  })
  const supply = q.data?.[0]?.status === 'success' ? q.data[0].result : undefined
  const index = q.data?.[1]?.status === 'success' ? q.data[1].result : undefined
  return (
    <Card aria-labelledby="underlying-title">
      <CardHeader
        id="underlying-title"
        title="Underlying: Mezo sMUSD"
        subtitle="Not ERC-4626 on its own; wsMUSD makes it composable"
        action={<Badge tone="brand">Live</Badge>}
      />
      <dl className="divide-y divide-line">
        <Row
          label="sMUSD supply"
          value={
            <Value loading={q.isLoading}>
              {supply !== undefined ? formatMusd(supply, { dp: 0 }) : null}
            </Value>
          }
        />
        <Row
          label="Yield index"
          value={
            <Value loading={q.isLoading}>
              {index !== undefined ? toFixedDecimal(index, 18, 4) : null}
            </Value>
          }
        />
        <Row
          label="Contract"
          value={
            <ExternalLink href={explorerAddressUrl(appChain.id, registry.external.smusd)}>
              {shortAddress(registry.external.smusd)}
            </ExternalLink>
          }
        />
      </dl>
    </Card>
  )
}

function ActionsCard({ ws, wallet }: { ws: WsMusdView; wallet: ReturnType<typeof useWallet> }) {
  const [tab, setTab] = useState<'deposit' | 'redeem'>('deposit')
  return (
    <Card aria-labelledby="ws-actions-title">
      <h2 id="ws-actions-title" className="sr-only">
        Deposit or redeem
      </h2>
      <Segmented
        label="wsMUSD action"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'deposit', label: 'Deposit' },
          { value: 'redeem', label: 'Redeem' },
        ]}
      />
      <div className="mt-5">
        {tab === 'deposit' ? (
          <Deposit ws={ws} wallet={wallet} />
        ) : (
          <Redeem ws={ws} wallet={wallet} />
        )}
      </div>
    </Card>
  )
}

function Deposit({ ws, wallet }: { ws: WsMusdView; wallet: ReturnType<typeof useWallet> }) {
  const config = useConfig()
  const client = usePublicClient({ chainId: appChain.id })
  const [input, setInput] = useState('')
  const amount = parseAmount(input) ?? 0n
  const owner = wallet.address
  const balance = wallet.musdBalance
  const musd = registry.external.musd
  const capRoom = ws.maxDeposit
  const max =
    balance !== undefined ? (capRoom !== undefined ? minBig(balance, capRoom) : balance) : undefined
  const shares =
    ws.totalAssets !== undefined && ws.totalSupply !== undefined
      ? erc4626ToShares(amount, ws.totalAssets, ws.totalSupply)
      : undefined
  const needsApproval = !wallet.canPermit && (ws.allowance ?? 0n) < amount

  let reason: string | null = null
  if (!deployed.wsMusd) reason = 'Deposits open when wsMUSD is deployed.'
  else if (amount === 0n) reason = 'Enter an amount of MUSD.'
  else if (balance !== undefined && amount > balance) reason = 'Not enough MUSD in your wallet.'
  else if (capRoom !== undefined && amount > capRoom)
    reason = `The deposit cap allows ${formatMusd(capRoom)} MUSD right now.`

  return (
    <div className="space-y-4">
      <AmountInput
        id="ws-deposit"
        label="Deposit MUSD"
        token="MUSD"
        value={input}
        onChange={setInput}
        invalid={!!reason && amount > 0n}
        onMax={max !== undefined ? () => setInput(toInputString(max, 18, 6)) : undefined}
        maxLabel={balance !== undefined ? `Balance ${formatMusd(balance)} MUSD` : undefined}
        footer={
          amount > 0n && shares !== undefined
            ? `You receive ≈ ${formatMusd(shares, { dp: 4 })} wsMUSD`
            : 'Your MUSD goes into sMUSD; yield vests into the share price.'
        }
      />
      {needsApproval && owner ? (
        <TxButton
          variant="secondary"
          size="md"
          label={`1. Approve ${formatMusd(amount)} MUSD`}
          disabledReason={reason}
          request={{
            address: musd,
            abi: erc20PermitAbi,
            functionName: 'approve',
            args: [WS, amount],
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
            ? { address: WS, abi: wsMusdAbi, functionName: 'deposit', args: [amount, owner] }
            : undefined
        }
        preflightOverride={
          owner && wallet.canPermit ? musdAllowanceOverride(musd, owner, WS, amount) : undefined
        }
        prepare={
          wallet.canPermit && client
            ? async ({ account }) => {
                const permit = await signMusdPermit({
                  client,
                  sign: (td) => signTypedData(config, td),
                  chainId: appChain.id,
                  musd,
                  owner: account,
                  spender: WS,
                  value: amount,
                })
                return {
                  address: WS,
                  abi: wsMusdAbi,
                  functionName: 'depositWithPermit',
                  args: [amount, account, permit.deadline, permit.v, permit.r, permit.s],
                }
              }
            : undefined
        }
        pendingTitle="Depositing into wsMUSD"
        successTitle="Deposited"
        onConfirmed={() => setInput('')}
      />
      <p className="text-xs text-muted">
        {wallet.canPermit
          ? 'You sign a MUSD permit, then send one transaction.'
          : 'Contract wallet: approve first, then deposit.'}
      </p>
    </div>
  )
}

function Redeem({ ws, wallet }: { ws: WsMusdView; wallet: ReturnType<typeof useWallet> }) {
  const [input, setInput] = useState('')
  const [inKind, setInKind] = useState(false)
  const shares = parseAmount(input) ?? 0n
  const owner = wallet.address
  const max = ws.maxRedeem ?? ws.shares
  const assets =
    ws.totalAssets !== undefined && ws.totalSupply !== undefined
      ? erc4626ToAssets(shares, ws.totalAssets, ws.totalSupply)
      : undefined

  let reason: string | null = null
  if (!deployed.wsMusd) reason = 'Redemptions open when wsMUSD is deployed.'
  else if (shares === 0n) reason = 'Enter an amount of wsMUSD.'
  else if (max !== undefined && shares > max)
    reason = `You can redeem at most ${formatMusd(max, { dp: 4 })} wsMUSD.`

  return (
    <div className="space-y-4">
      <AmountInput
        id="ws-redeem"
        label="Redeem wsMUSD"
        token="wsMUSD"
        tokenTone="brand"
        value={input}
        onChange={setInput}
        invalid={!!reason && shares > 0n}
        onMax={max !== undefined ? () => setInput(toInputString(max, 18, 8)) : undefined}
        maxLabel={
          ws.shares !== undefined ? `Balance ${formatMusd(ws.shares, { dp: 4 })} wsMUSD` : undefined
        }
        footer={
          shares > 0n && assets !== undefined
            ? `Worth ≈ ${formatMusd(assets)} MUSD at ${toFixedDecimal(ws.sharePrice ?? WAD, 18, 6)}`
            : undefined
        }
      />
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--brand)]"
          checked={inKind}
          onChange={(e) => setInKind(e.target.checked)}
        />
        <span>
          <span className="font-medium text-ink">Redeem in kind</span>
          <span className="block text-muted">
            Receive sMUSD 1:1 plus any vested MUSD, without touching sMUSD’s deposit or withdraw.
            The exit that still works if sMUSD is paused or upgraded.
          </span>
        </span>
      </label>
      <TxButton
        sticky
        label={
          inKind
            ? 'Redeem in kind'
            : assets !== undefined && shares > 0n
              ? `Redeem for ${formatMusd(assets)} MUSD`
              : 'Redeem'
        }
        disabledReason={reason}
        request={
          owner
            ? {
                address: WS,
                abi: wsMusdAbi,
                functionName: inKind ? 'redeemInKind' : 'redeem',
                args: [shares, owner, owner],
              }
            : undefined
        }
        pendingTitle={inKind ? 'Redeeming in kind' : 'Redeeming wsMUSD'}
        successTitle="Redeemed"
        onConfirmed={() => setInput('')}
      />
    </div>
  )
}
