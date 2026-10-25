import {
  borrowAccountAbi,
  btcToUsdWad,
  erc20PermitAbi,
  explorerAddressUrl,
  formatBtc,
  formatMusd,
  formatPercentWad,
  formatUsd,
  formatWad,
  gasReserveWei,
  healthFactor,
  liquidationIncentive,
  liquidationPrice,
  ltv,
  maxBig,
  minBig,
  musdAllowanceOverride,
  oraclePriceToWad,
  parseAmount,
  repayAllowance,
  signMusdPermit,
  toInputString,
  WAD,
} from '@baserate/sdk'
import { useState } from 'react'
import { useConfig, usePublicClient } from 'wagmi'
import { signTypedData } from 'wagmi/actions'
import type { MarketView } from '../../hooks/useMarket'
import type { OracleView } from '../../hooks/useOracle'
import type { PositionView } from '../../hooks/usePosition'
import type { useWallet } from '../../hooks/useWallet'
import { appChain, registry } from '../../wagmi'
import { DispenserClaim } from '../GetTestFunds'
import { IconWallet } from '../icons'
import { TxButton } from '../TxButton'
import {
  AmountInput,
  Badge,
  Card,
  CardHeader,
  ExternalLink,
  Notice,
  Row,
  Segmented,
  Stat,
  type Tone,
} from '../ui'

function hfTone(hf: bigint | null): Tone {
  if (hf === null) return 'good'
  if (hf < 1_100_000_000_000_000_000n) return 'bad'
  if (hf < 1_400_000_000_000_000_000n) return 'warn'
  return 'good'
}

export function PositionCard({
  position,
  oracle,
  market,
  wallet,
}: {
  position: PositionView
  oracle: OracleView
  market: MarketView
  wallet: ReturnType<typeof useWallet>
}) {
  const [tab, setTab] = useState<'exit' | 'add'>('exit')
  const [exited, setExited] = useState<bigint | null>(null)
  const price = oracle.status?.ok ? oracle.status.price : undefined
  const skipUsd = oracle.status?.skipPrice
  const { collateral, debt } = position
  const ltvNow = price ? ltv(debt, collateral, price) : null
  const hf = price ? healthFactor(debt, collateral, price, market.lltv) : null
  const liq = liquidationPrice(debt, collateral, market.lltv)
  const liqUsd =
    liq && oracle.musdUsed ? (oraclePriceToWad(liq) * oracle.musdUsed) / WAD : undefined

  if (!position.hasPosition) {
    return exited !== null ? (
      <Notice
        tone="good"
        title={`Position closed. ${formatBtc(exited)} BTC is back in your wallet.`}
      >
        Repay-and-withdraw never asks the oracle for a price, so it works even if the oracle is
        frozen.
      </Notice>
    ) : null
  }

  return (
    <Card aria-labelledby="position-title">
      <CardHeader
        id="position-title"
        icon={<IconWallet className="size-4" />}
        title="Your position"
        subtitle={
          position.account ? (
            <ExternalLink href={explorerAddressUrl(appChain.id, position.account)}>
              Borrow account
            </ExternalLink>
          ) : undefined
        }
        action={
          <Badge tone={hfTone(hf)}>{hf === null ? 'No debt' : `Health ${formatWad(hf)}`}</Badge>
        }
      />
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <Stat
          label="Collateral"
          value={<span className="text-btc">{formatBtc(collateral)} BTC</span>}
          sub={skipUsd ? formatUsd(btcToUsdWad(collateral, skipUsd)) : undefined}
        />
        <Stat
          label="Debt"
          value={`${formatMusd(debt, { mode: 'up' })}`}
          sub="MUSD incl. interest"
        />
        <Stat
          label="Loan-to-value"
          value={ltvNow !== null ? formatPercentWad(ltvNow) : '—'}
          sub={`Liquidation at ${formatPercentWad(market.lltv, 0)}`}
          tone={hfTone(hf)}
        />
        <Stat
          label="Liquidation price"
          value={liqUsd !== undefined ? formatUsd(liqUsd, 0) : '—'}
          sub={
            liqUsd !== undefined && skipUsd
              ? `BTC −${(Number(((skipUsd - liqUsd) * 10_000n) / skipUsd) / 100).toFixed(1)}%`
              : undefined
          }
        />
        <Stat label="Health factor" value={hf !== null ? formatWad(hf) : '∞'} tone={hfTone(hf)} />
        <Stat
          label="Liquidation incentive"
          value={formatPercentWad(liquidationIncentive(market.lltv))}
          sub="paid to liquidators"
        />
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <Segmented
          label="Position actions"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'exit', label: 'Repay & withdraw' },
            { value: 'add', label: 'Add collateral' },
          ]}
        />
        <div className="mt-4">
          {tab === 'exit' ? (
            <RepayAndWithdraw
              position={position}
              wallet={wallet}
              onExited={() => setExited(collateral)}
            />
          ) : (
            <AddCollateral position={position} market={market} wallet={wallet} />
          )}
        </div>
      </div>
    </Card>
  )
}

function RepayAndWithdraw({
  position,
  wallet,
  onExited,
}: {
  position: PositionView
  wallet: ReturnType<typeof useWallet>
  onExited: () => void
}) {
  const config = useConfig()
  const client = usePublicClient({ chainId: appChain.id })
  const { account, debt, collateral, allowance } = position
  const owner = wallet.address
  const musd = registry.external.musd
  const walletMusd = wallet.musdBalance ?? 0n
  const shortfall = maxBig(debt - walletMusd, 0n)
  const maxRepay = repayAllowance(debt)
  const needsApproval = !wallet.canPermit && allowance < debt

  const fundsReason =
    shortfall > 0n
      ? `You need ${formatMusd(shortfall, { dp: 6, mode: 'up' })} more MUSD to repay in full.`
      : null

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line">
        <Row
          label="Debt to repay"
          value={`${formatMusd(debt, { dp: 6, mode: 'up' })} MUSD`}
          strong
        />
        <Row label="Wallet MUSD" value={`${formatMusd(walletMusd, { dp: 6 })} MUSD`} />
        <Row
          label="BTC returned"
          value={<span className="text-btc">{formatBtc(collateral)} BTC</span>}
          hint="Native BTC, straight to your wallet"
        />
      </dl>

      {shortfall > 0n ? (
        <Notice tone="warn" title={`Short by ${formatMusd(shortfall, { dp: 6, mode: 'up' })} MUSD`}>
          Interest and the 0.10% fee mean you owe slightly more than you borrowed. Top up from the
          dispenser:
          <div className="mt-2">
            <DispenserClaim compact />
          </div>
        </Notice>
      ) : null}

      {wallet.isContractWallet ? (
        <p className="text-xs text-muted">
          Smart-contract wallet detected: MUSD permits accept plain ECDSA signatures only, so this
          uses an approval first.
        </p>
      ) : null}

      {needsApproval && account && owner ? (
        <TxButton
          variant="secondary"
          size="md"
          label={`1. Approve ${formatMusd(maxRepay)} MUSD`}
          disabledReason={fundsReason}
          request={{
            address: musd,
            abi: erc20PermitAbi,
            functionName: 'approve',
            args: [account, maxRepay],
          }}
          pendingTitle="Approving MUSD"
          successTitle="MUSD approved"
        />
      ) : null}

      <TxButton
        label={
          needsApproval
            ? '2. Repay & withdraw'
            : `Repay ${formatMusd(debt, { mode: 'up' })} MUSD & withdraw BTC`
        }
        disabledReason={
          !account || !owner
            ? 'Connect your wallet.'
            : (fundsReason ?? (needsApproval ? 'Approve MUSD first.' : null))
        }
        request={
          account && owner
            ? {
                address: account,
                abi: borrowAccountAbi,
                functionName: 'repayAndWithdraw',
                args: [owner],
              }
            : undefined
        }
        // Permit path: pre-simulate with the allowance the permit will grant, before the user signs.
        preflightOverride={
          account && owner && wallet.canPermit
            ? musdAllowanceOverride(musd, owner, account, maxRepay)
            : undefined
        }
        prepare={
          wallet.canPermit && account && client
            ? async ({ account: signer }) => {
                const permit = await signMusdPermit({
                  client,
                  sign: (td) => signTypedData(config, td),
                  chainId: appChain.id,
                  musd,
                  owner: signer,
                  spender: account,
                  value: maxRepay,
                })
                return {
                  address: account,
                  abi: borrowAccountAbi,
                  functionName: 'repayAndWithdrawWithPermit',
                  args: [maxRepay, permit.deadline, permit.v, permit.r, permit.s, signer],
                }
              }
            : undefined
        }
        pendingTitle="Repaying and withdrawing"
        successTitle="Position closed"
        successMessage={() => `${formatBtc(collateral)} BTC returned to your wallet.`}
        onConfirmed={onExited}
      />
      <p className="text-xs text-muted">
        {wallet.canPermit
          ? 'You sign a MUSD permit, then send one transaction. '
          : 'Approve once, then send the repay transaction. '}
        Works even if the oracle is frozen: Morpho never checks the price of a position with no
        debt.
      </p>
    </div>
  )
}

function AddCollateral({
  position,
  market,
  wallet,
}: {
  position: PositionView
  market: MarketView
  wallet: ReturnType<typeof useWallet>
}) {
  const [input, setInput] = useState('')
  const amount = parseAmount(input) ?? 0n
  const reserve = gasReserveWei(appChain.id)
  const room = maxBig(market.risk.positionCap - position.collateral, 0n)
  const maxByBalance =
    wallet.btcBalance !== undefined ? maxBig(wallet.btcBalance - reserve, 0n) : undefined
  const max = maxByBalance !== undefined ? minBig(room, maxByBalance) : room

  let reason: string | null = null
  if (amount === 0n) reason = 'Enter an amount of BTC.'
  else if (maxByBalance !== undefined && amount > maxByBalance)
    reason = 'Not enough BTC in your wallet.'
  else if (amount > room) reason = `The per-position cap leaves room for ${formatBtc(room)} BTC.`

  return (
    <div className="space-y-4">
      <AmountInput
        id="add-btc"
        label="Add BTC"
        token="BTC"
        tokenTone="btc"
        value={input}
        onChange={setInput}
        onMax={() => setInput(toInputString(max))}
        maxLabel={
          wallet.btcBalance !== undefined
            ? `Balance ${formatBtc(wallet.btcBalance)} BTC`
            : undefined
        }
        footer="Lowers your LTV. Never paused, so you can always rescue a position."
      />
      <TxButton
        variant="secondary"
        label={amount > 0n ? `Add ${formatBtc(amount)} BTC` : 'Add collateral'}
        disabledReason={reason}
        request={
          position.account && !reason
            ? {
                address: position.account,
                abi: borrowAccountAbi,
                functionName: 'addCollateral',
                value: amount,
              }
            : undefined
        }
        pendingTitle="Adding collateral"
        successTitle="Collateral added"
        onConfirmed={() => setInput('')}
      />
    </div>
  )
}
