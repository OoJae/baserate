import {
  availableLiquidity,
  explorerAddressUrl,
  formatBps,
  formatBtc,
  formatMusd,
  formatPercent,
  formatPercentWad,
  liquidationIncentive,
  maxBig,
  rateToApr,
  rateToApy,
  shortAddress,
  utilization,
} from '@baserate/sdk'
import { Link } from '@tanstack/react-router'
import type { MarketView } from '../../hooks/useMarket'
import { appChain, registry } from '../../wagmi'
import { Badge, Card, CardHeader, ExternalLink, Row, Value } from '../ui'

export function MarketCard({ market }: { market: MarketView }) {
  const s = market.state
  const loading = market.isLoading
  return (
    <Card aria-labelledby="market-title">
      <CardHeader
        id="market-title"
        title="Market M1 · MUSD / bcBTC"
        subtitle="On Mezo’s own Morpho Blue"
        action={
          market.risk.expected ? <Badge>Launch parameters</Badge> : <Badge tone="brand">Live</Badge>
        }
      />
      <dl className="divide-y divide-line">
        <Row
          label="Borrow rate"
          value={
            <Value loading={loading && !!market.id}>
              {market.borrowRate !== undefined
                ? `${formatPercent(rateToApr(market.borrowRate))} APR`
                : null}
            </Value>
          }
          hint={
            market.borrowRate !== undefined
              ? `${formatPercent(rateToApy(market.borrowRate))} APY · adaptive curve`
              : undefined
          }
        />
        <Row
          label="Available liquidity"
          tip="M1 liquidity comes from the team’s direct supply and the vMUSD lending vault, whose allocator keeps at least 2,000 MUSD (or 15% of supply) free for borrowers."
          value={
            <Value loading={loading && !!market.id}>
              {s ? `${formatMusd(availableLiquidity(s))} MUSD` : null}
            </Value>
          }
          hint={s ? `Utilisation ${formatPercentWad(utilization(s), 1)}` : undefined}
        />
        <Row
          label="Global borrow cap"
          tip="Caps are sized to measured liquidation depth. Cutting a cap never shrinks existing loans."
          value={`${formatMusd(market.risk.globalBorrowCap, { dp: 0 })} MUSD`}
          hint={
            s
              ? `${formatMusd(maxBig(market.risk.globalBorrowCap - s.totalBorrowAssets, 0n), { dp: 0 })} MUSD left`
              : undefined
          }
        />
        <Row
          label="Per-position cap"
          tip="Limits borrowing: a position with more collateral than this cannot borrow. Adding collateral is never capped, so a position can always be defended."
          value={`${formatBtc(market.risk.positionCap, { minDp: 2 })} BTC`}
        />
        <Row
          label="Opening limit · LLTV"
          value={`${formatBps(market.risk.ceilingBps, 0)} · ${formatPercentWad(market.lltv, 0)}`}
        />
        <Row
          label="Liquidation incentive"
          value={formatPercentWad(liquidationIncentive(market.lltv))}
        />
        <Row
          label="Origination fee"
          value={market.risk.feeBps === 0n ? 'None' : formatBps(market.risk.feeBps)}
        />
      </dl>
      <p className="mt-3 text-xs text-muted">
        Liquidity from the team and the{' '}
        <Link to="/lend" className="font-medium text-brand hover:underline">
          vMUSD vault
        </Link>
        . Morpho{' '}
        <ExternalLink href={explorerAddressUrl(appChain.id, registry.external.morpho)}>
          {shortAddress(registry.external.morpho)}
        </ExternalLink>
      </p>
    </Card>
  )
}
