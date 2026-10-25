import {
  formatBtc,
  formatMusd,
  formatPercentWad,
  minTroveCollateral,
  mulDivDown,
  NICR_PRECISION,
  nominalIcr,
  toFixedDecimal,
  WAD,
} from '@baserate/sdk'
import { useRedemption } from '../hooks/useRedemption'
import { IconShield } from './icons'
import { Badge, Card, CardHeader, Row, Skeleton } from './ui'

/** MUSD's redemption fee is 0.75%, so redeeming pays whenever MUSD trades below ≈ $0.9925. */
const REDEMPTION_FLOOR = 992_500_000_000_000_000n

export function RedemptionPanel({
  collateral,
  debt,
  btcUsd,
  musdUsd,
}: {
  /** Position (or quoted) collateral and debt to compare with the trove queue. */
  collateral: bigint
  debt: bigint
  btcUsd: bigint | undefined
  musdUsd: bigint | undefined
}) {
  const r = useRedemption()
  const userNicr = nominalIcr(collateral, debt)
  const toIcr = (nicr: bigint) => (btcUsd ? mulDivDown(nicr, btcUsd, NICR_PRECISION) : undefined)
  const userIcr = userNicr !== null ? toIcr(userNicr) : undefined
  const lastIcr = r.lastNicr !== undefined ? toIcr(r.lastNicr) : undefined
  const firstInLine =
    userNicr !== null && r.lastNicr !== undefined ? userNicr < r.lastNicr : undefined
  const minColl =
    r.minTroveDebt !== undefined && r.mcr !== undefined && btcUsd
      ? minTroveCollateral(r.minTroveDebt, r.mcr, btcUsd)
      : undefined

  return (
    <Card aria-labelledby="redemption-title">
      <CardHeader
        id="redemption-title"
        icon={<IconShield className="size-4" />}
        title="Redemption risk: none"
        subtitle="Morpho loans have no redemption queue. Nobody can repay your debt at par and take your BTC."
        action={<Badge tone="good">No queue</Badge>}
      />
      <p className="mb-2 text-sm text-muted">The same loan as a MUSD trove:</p>
      <dl className="divide-y divide-line">
        <Row
          label="Queue position"
          tip="Troves are redeemed lowest collateral ratio first. If yours would sit below the riskiest current trove, it would be the next one redeemed."
          value={
            firstInLine === undefined ? (
              debt === 0n ? (
                'Enter an amount'
              ) : (
                <Skeleton />
              )
            ) : firstInLine ? (
              <span className="font-semibold text-bad">First in line</span>
            ) : (
              <span className="text-ink">Not first in line</span>
            )
          }
          hint={
            userIcr !== undefined && lastIcr !== undefined
              ? `Yours ${formatPercentWad(userIcr, 0)} vs tail ${formatPercentWad(lastIcr, 1)}${r.troveCount !== undefined ? ` of ${r.troveCount.toString()} troves` : ''}`
              : undefined
          }
        />
        <Row
          label="MUSD price"
          tip="MUSD's 0.75% redemption fee makes redeeming profitable below about $0.9925."
          value={
            musdUsd && musdUsd > 0n ? (
              <span className={musdUsd < REDEMPTION_FLOOR ? 'text-warn' : 'text-ink'}>
                ${toFixedDecimal(musdUsd, 18, 4)}
              </span>
            ) : (
              <Skeleton />
            )
          }
          hint={
            musdUsd && musdUsd > 0n
              ? musdUsd < REDEMPTION_FLOOR
                ? 'Below the ≈$0.9925 floor: redemptions pay now'
                : 'At or above the ≈$0.9925 floor'
              : undefined
          }
        />
        <Row
          label="Smallest trove"
          tip="A MUSD trove needs at least 2,000 MUSD of debt (1,800 net plus the 200 gas compensation) at a 110% minimum collateral ratio. Baserate has no minimum."
          value={
            minColl !== undefined && r.minTroveDebt !== undefined ? (
              `${formatMusd(r.minTroveDebt, { dp: 0 })} MUSD ≈ ${formatBtc(minColl, { minDp: 4, maxDp: 4 })} BTC`
            ) : (
              <Skeleton />
            )
          }
          hint={
            collateral > 0n
              ? `You are using ${formatBtc(collateral)} BTC${minColl && minColl > 0n ? ` (${toFixedDecimal((collateral * WAD * 100n) / minColl, 18, 1)}% of that)` : ''}`
              : undefined
          }
        />
      </dl>
    </Card>
  )
}
