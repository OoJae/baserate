import { formatBps } from '@baserate/sdk'
import type { CSSProperties } from 'react'

/**
 * Target-LTV slider drawn against the liquidation threshold: the track spans 0 → LLTV, the slider stops at the
 * opening ceiling, and the fill turns amber then red as it approaches the line.
 */
export function LtvSlider({
  value,
  onChange,
  ceilingBps,
  lltvBps,
  minBps = 500,
}: {
  value: number
  onChange: (v: number) => void
  ceilingBps: number
  lltvBps: number
  minBps?: number
}) {
  const pctOfLltv = (bps: number) => Math.min(100, (bps / lltvBps) * 100)
  const tone =
    value / lltvBps < 0.55 ? 'var(--good)' : value / lltvBps < 0.75 ? 'var(--warn)' : 'var(--bad)'
  const fill = ((value - minBps) / Math.max(1, ceilingBps - minBps)) * 100
  const style = {
    '--track': `linear-gradient(to right, ${tone} 0%, ${tone} ${fill}%, var(--line) ${fill}%, var(--line) 100%)`,
  } as CSSProperties
  const risk =
    value / lltvBps < 0.55 ? 'Conservative' : value / lltvBps < 0.75 ? 'Moderate' : 'Aggressive'

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor="ltv" className="text-sm font-medium text-ink">
          Target loan-to-value
        </label>
        <span className="num text-sm">
          <span className="font-semibold text-ink">{formatBps(value, 1)}</span>
          <span className="ml-2 text-xs text-muted">{risk}</span>
        </span>
      </div>
      <div
        className="relative"
        style={{
          marginLeft: `${pctOfLltv(minBps)}%`,
          width: `${pctOfLltv(ceilingBps) - pctOfLltv(minBps)}%`,
        }}
      >
        <input
          id="ltv"
          type="range"
          className="ltv-range"
          min={minBps}
          max={ceilingBps}
          step={50}
          value={value}
          style={style}
          aria-valuetext={`${formatBps(value, 1)} loan-to-value`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-raised" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pctOfLltv(value)}%`, background: tone, opacity: 0.35 }}
        />
        <div
          className="absolute inset-y-[-3px] w-0.5 bg-ink/60"
          style={{ left: `${pctOfLltv(ceilingBps)}%` }}
        />
        <div className="absolute inset-y-[-3px] right-0 w-0.5 bg-bad" />
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
        <span>0%</span>
        <span>Opening limit {formatBps(ceilingBps, 0)}</span>
        <span className="text-bad">Liquidation {formatBps(lltvBps, 0)}</span>
      </div>
    </div>
  )
}
