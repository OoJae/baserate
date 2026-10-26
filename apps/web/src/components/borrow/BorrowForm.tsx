import {
  availableLiquidity,
  type BorrowQuote,
  borrowAccountFactoryAbi,
  btcToUsdWad,
  formatBps,
  formatBtc,
  formatMusd,
  formatPercent,
  formatPercentWad,
  formatUsd,
  formatWad,
  gasReserveWei,
  liquidationIncentive,
  maxBig,
  minBig,
  oraclePriceToWad,
  parseAmount,
  quoteBorrow,
  rateToApr,
  rateToApy,
  toInputString,
  WAD,
} from '@baserate/sdk'
import type { MarketView } from '../../hooks/useMarket'
import type { OracleView } from '../../hooks/useOracle'
import type { PositionView } from '../../hooks/usePosition'
import type { useWallet } from '../../hooks/useWallet'
import { appChain, deployed, registry } from '../../wagmi'
import { IconBorrow } from '../icons'
import { TxButton } from '../TxButton'
import { AmountInput, Card, CardHeader, Notice, Row, Value } from '../ui'
import { LtvSlider } from './LtvSlider'

/** Default target LTV: 30% conserves the shared test liquidity. */
export const DEFAULT_LTV_BPS = 3_000

/** Sizes the borrow for the current inputs (null until the oracle has an ok price). */
export function useBorrowQuote({
  btcInput,
  ltv,
  oracle,
  market,
  position,
}: {
  btcInput: string
  ltv: number
  oracle: OracleView
  market: MarketView
  position: PositionView
}) {
  const target = Math.min(ltv, Number(market.risk.ceilingBps))
  const btcIn = parseAmount(btcInput) ?? 0n
  const price = oracle.status?.ok ? oracle.status.price : undefined
  const quote: BorrowQuote | undefined = price
    ? quoteBorrow({
        collateral: position.collateral,
        debt: position.debt,
        btcIn,
        targetLtvBps: BigInt(target),
        oraclePrice: price,
        lltv: market.lltv,
        feeBps: market.risk.feeBps,
        ceilingBps: market.risk.ceilingBps,
      })
    : undefined
  return { quote, target, btcIn }
}

export function BorrowForm({
  oracle,
  market,
  wallet,
  position,
  btcInput,
  onBtcInput: setBtcInput,
  ltv,
  onLtv: setLtv,
}: {
  oracle: OracleView
  market: MarketView
  wallet: ReturnType<typeof useWallet>
  position: PositionView
  btcInput: string
  onBtcInput: (v: string) => void
  ltv: number
  onLtv: (v: number) => void
}) {
  const ceiling = Number(market.risk.ceilingBps)
  const lltvBps = Number((market.lltv * 10_000n) / WAD)
  const { quote, target, btcIn } = useBorrowQuote({ btcInput, ltv, oracle, market, position })
  const status = oracle.status
  const skipUsd = status?.skipPrice

  const reserve = gasReserveWei(appChain.id)
  const maxByBalance =
    wallet.btcBalance !== undefined ? maxBig(wallet.btcBalance - reserve, 0n) : undefined
  // This form always borrows, and a borrow needs the position within its cap; top-ups alone are never capped.
  const roomUnderCap = maxBig(market.risk.positionCap - position.collateral, 0n)
  const maxBtc = maxByBalance !== undefined ? minBig(maxByBalance, roomUnderCap) : roomUnderCap
  const capText = `${formatBtc(market.risk.positionCap, { minDp: 2 })} BTC`

  const liquidity = market.state ? availableLiquidity(market.state) : undefined
  const globalRoom = market.state
    ? maxBig(market.risk.globalBorrowCap - market.state.totalBorrowAssets, 0n)
    : undefined
  const needed = quote ? quote.musdOut + quote.fee : 0n

  let reason: string | null = null
  if (!deployed.factory) {
    reason = 'Borrowing opens when the Baserate contracts are deployed on Mezo testnet.'
  } else if (status && !status.ok) {
    reason = 'Borrowing is paused by the oracle guard. Repay and withdraw still work.'
  } else if (market.risk.borrowPaused) {
    reason = 'New borrows are paused by the risk sentinel. Repay and withdraw still work.'
  } else if (btcIn === 0n && position.collateral === 0n) {
    reason = 'Enter how much BTC to deposit.'
  } else if (maxByBalance !== undefined && btcIn > maxByBalance) {
    reason = `Not enough BTC. Keep ${formatBtc(reserve)} BTC for gas.`
  } else if (position.collateral + btcIn > market.risk.positionCap) {
    reason = position.hasPosition
      ? `Borrowing needs the position within the ${capText} per-position cap. To add BTC without borrowing, use Add collateral above: top-ups are never capped.`
      : `Borrowing needs the position within the ${capText} per-position cap. Deposit at most ${capText}.`
  } else if (quote && quote.musdOut === 0n) {
    reason = 'Raise the target LTV or add BTC to borrow more.'
  } else if (liquidity !== undefined && needed > liquidity) {
    reason = `Only ${formatMusd(liquidity)} MUSD of market liquidity is available right now.`
  } else if (globalRoom !== undefined && needed > globalRoom) {
    reason = `The global borrow cap leaves ${formatMusd(globalRoom)} MUSD to borrow.`
  }

  const liqUsd =
    quote?.liquidationPrice && oracle.musdUsed
      ? (oraclePriceToWad(quote.liquidationPrice) * oracle.musdUsed) / WAD
      : undefined
  const drop =
    liqUsd !== undefined && skipUsd && skipUsd > 0n
      ? Number(((skipUsd - liqUsd) * 10_000n) / skipUsd) / 100
      : undefined
  const apr = market.borrowRate !== undefined ? rateToApr(market.borrowRate) : undefined
  const hasPosition = position.hasPosition

  return (
    <Card aria-labelledby="borrow-title">
      <CardHeader
        id="borrow-title"
        icon={<IconBorrow className="size-4" />}
        title={hasPosition ? 'Add BTC or borrow more' : 'Borrow MUSD against BTC'}
        subtitle="One transaction: your BTC is wrapped, supplied to Mezo’s Morpho and borrowed against."
      />

      <div className="space-y-5">
        <AmountInput
          id="btc-in"
          label={hasPosition ? 'Add BTC (optional)' : 'Deposit BTC'}
          token="BTC"
          tokenTone="btc"
          value={btcInput}
          onChange={setBtcInput}
          invalid={maxByBalance !== undefined && btcIn > maxByBalance}
          onMax={wallet.isConnected ? () => setBtcInput(toInputString(maxBtc)) : undefined}
          maxLabel={
            wallet.btcBalance !== undefined
              ? `Balance ${formatBtc(wallet.btcBalance)} BTC`
              : undefined
          }
          footer={
            skipUsd && btcIn > 0n
              ? `≈ ${formatUsd(btcToUsdWad(btcIn, skipUsd))} at ${formatUsd(skipUsd, 0)} per BTC`
              : `Borrowing needs at most ${capText} of collateral per position${position.hasPosition ? '; top-ups alone are never capped' : ''}`
          }
        />

        <LtvSlider value={target} onChange={setLtv} ceilingBps={ceiling} lltvBps={lltvBps} />

        <div className="rounded-[3px] border border-line bg-raised/60 p-3 sm:p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b-[3px] border-double border-line-strong/50 pb-3">
            <span className="serial text-[10.5px] text-muted">You receive</span>
            <span className="numeral text-[30px] leading-none font-medium text-ink sm:text-[34px]">
              <Value loading={!quote && oracle.isLoading}>
                {quote ? formatMusd(quote.musdOut) : null}
              </Value>{' '}
              <span className="font-sans text-sm font-semibold tracking-[0.04em] text-muted">
                MUSD
              </span>
            </span>
          </div>
          <dl className="divide-y divide-line/70">
            <Row
              label={`Origination fee (${formatBps(market.risk.feeBps)})`}
              tip="Added to your debt, the same 0.10% as MUSD's trove issuance fee. It goes to the protocol fee router."
              value={
                !quote || quote.musdOut === 0n
                  ? '—'
                  : market.risk.feeBps === 0n
                    ? 'None'
                    : `${formatMusd(quote.fee, { dp: 4 })} MUSD`
              }
            />
            <Row
              label={hasPosition ? 'Total debt after' : 'Debt'}
              value={quote ? `${formatMusd(quote.newDebt, { mode: 'up' })} MUSD` : '—'}
            />
            <Row
              label="Loan-to-value"
              value={quote?.ltv != null ? formatPercentWad(quote.ltv) : '—'}
              hint={`Opening limit ${formatBps(ceiling, 0)}`}
            />
            <Row
              label="Health factor"
              tip="Collateral × price × LLTV ÷ debt. Below 1.00 the position can be liquidated."
              value={quote?.healthFactor != null ? formatWad(quote.healthFactor) : '—'}
            />
            <Row
              label="Liquidation price"
              tip="The BTC price at which this position becomes liquidatable."
              value={liqUsd !== undefined ? formatUsd(liqUsd) : '—'}
              hint={drop !== undefined ? `BTC would have to fall ${drop.toFixed(1)}%` : undefined}
            />
            <Row
              label="LLTV · liquidation incentive"
              tip="Morpho liquidates above the LLTV. Liquidators earn min(15%, 1/(0.3·LLTV + 0.7) − 1) of the repaid debt in extra collateral."
              value={`${formatBps(lltvBps, 0)} · ${formatPercentWad(liquidationIncentive(market.lltv))}`}
            />
            <Row
              label="Borrow rate"
              tip="AdaptiveCurveIrm.borrowRateView, annualised. APY compounds continuously."
              value={apr !== undefined ? `${formatPercent(apr)} APR` : '—'}
              hint={
                market.borrowRate !== undefined
                  ? `${formatPercent(rateToApy(market.borrowRate))} APY`
                  : deployed.market
                    ? undefined
                    : 'Live once the market exists'
              }
            />
          </dl>
          {quote && quote.musdOut > 0n && deployed.factory ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Reverts instead of borrowing if the price moves enough to push LTV past{' '}
              {formatBps(quote.maxLtvBps, 1)} before it lands.
            </p>
          ) : null}
        </div>

        {!status?.ok && status ? (
          <Notice tone="bad" title="Oracle guard active">
            Borrowing is paused until the oracle recovers. Repay and withdraw still work.
          </Notice>
        ) : null}
        {market.risk.expected ? (
          <Notice tone="neutral">
            Preview uses live Skip and Pyth prices with the launch parameters (LLTV{' '}
            {formatBps(lltvBps, 0)}, opening limit {formatBps(ceiling, 0)}, cap{' '}
            {formatBtc(market.risk.positionCap, { minDp: 2 })} BTC per position).
          </Notice>
        ) : null}

        <TxButton
          sticky
          label={
            quote && quote.musdOut > 0n
              ? `Borrow ${formatMusd(quote.musdOut)} MUSD`
              : hasPosition
                ? 'Borrow more'
                : 'Borrow'
          }
          disabledReason={reason}
          request={
            quote && quote.musdOut > 0n && !reason
              ? {
                  address: registry.contracts.factory.address,
                  abi: borrowAccountFactoryAbi,
                  functionName: 'openAndBorrow',
                  args: [quote.musdOut, quote.maxLtvBps],
                  value: btcIn,
                }
              : undefined
          }
          pendingTitle="Opening your position"
          successTitle="Borrowed"
          successMessage={() =>
            quote ? `${formatMusd(quote.musdOut)} MUSD is in your wallet.` : 'Done.'
          }
          onConfirmed={() => setBtcInput('')}
        />
      </div>
    </Card>
  )
}
