/**
 * Number formatting for amounts held as bigint. Locale-independent (en-US grouping) so screenshots, tests and
 * the evidence page read the same everywhere.
 */

export type RoundingMode = 'down' | 'up' | 'nearest'

function pow10(n: number): bigint {
  return 10n ** BigInt(n)
}

/** Rounds a fixed-point value with `decimals` to `dp` places and returns a plain decimal string. */
export function toFixedDecimal(
  value: bigint,
  decimals: number,
  dp: number,
  mode: RoundingMode = 'nearest',
): string {
  const negative = value < 0n
  let abs = negative ? -value : value
  if (dp < decimals) {
    const step = pow10(decimals - dp)
    const rem = abs % step
    abs -= rem
    if (rem !== 0n) {
      if (mode === 'up' || (mode === 'nearest' && rem * 2n >= step)) abs += step
    }
    abs /= step
  } else {
    abs *= pow10(dp - decimals)
  }
  const s = abs.toString().padStart(dp + 1, '0')
  const int = s.slice(0, s.length - dp)
  const frac = dp > 0 ? s.slice(s.length - dp) : ''
  const out = dp > 0 ? `${int}.${frac}` : int
  return negative && abs !== 0n ? `-${out}` : out
}

/** Adds thousands separators to the integer part of a plain decimal string. */
export function groupThousands(decimal: string): string {
  const negative = decimal.startsWith('-')
  const body = negative ? decimal.slice(1) : decimal
  const [int = '0', frac] = body.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`
}

function trimZeros(decimal: string, minDp: number): string {
  if (!decimal.includes('.')) return decimal
  const [int, frac = ''] = decimal.split('.')
  let f = frac
  while (f.length > minDp && f.endsWith('0')) f = f.slice(0, -1)
  return f.length > 0 ? `${int}.${f}` : (int ?? '0')
}

/** MUSD with 2 decimals by default (use 6 to show a dust shortfall). */
export function formatMusd(wei: bigint, opts: { dp?: number; mode?: RoundingMode } = {}): string {
  return groupThousands(toFixedDecimal(wei, 18, opts.dp ?? 2, opts.mode ?? 'nearest'))
}

/** BTC with 6 to 8 decimals: rounds at `maxDp`, then trims trailing zeros down to `minDp`. */
export function formatBtc(
  wei: bigint,
  opts: { minDp?: number; maxDp?: number; mode?: RoundingMode } = {},
): string {
  const maxDp = opts.maxDp ?? 8
  const minDp = opts.minDp ?? 6
  return groupThousands(trimZeros(toFixedDecimal(wei, 18, maxDp, opts.mode ?? 'nearest'), minDp))
}

/** USD from a WAD value: "$1,234.56". */
export function formatUsd(wad: bigint, dp = 2): string {
  const s = groupThousands(toFixedDecimal(wad, 18, dp))
  return s.startsWith('-') ? `-$${s.slice(1)}` : `$${s}`
}

/** USD value of a BTC amount at a WAD BTC/USD price. */
export function btcToUsdWad(btcWei: bigint, btcUsdWad: bigint): bigint {
  return (btcWei * btcUsdWad) / 10n ** 18n
}

/** A WAD fraction as a percentage: 0.4955e18 → "49.55%". */
export function formatPercentWad(wad: bigint, dp = 2): string {
  return `${toFixedDecimal(wad * 100n, 18, dp)}%`
}

/** A JS number fraction as a percentage: 0.0741 → "7.41%". */
export function formatPercent(fraction: number, dp = 2): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(dp)}%`
}

/** Basis points as a percentage: 6200 → "62.00%". */
export function formatBps(bps: bigint | number, dp = 2): string {
  return `${toFixedDecimal(BigInt(bps), 2, dp)}%`
}

/** A WAD ratio such as a health factor: 2.345e18 → "2.35". */
export function formatWad(wad: bigint, dp = 2): string {
  return groupThousands(toFixedDecimal(wad, 18, dp))
}

/** Seconds as a short duration: "12s", "4m 05s", "1h 03m", "2d 4h". */
export function formatDuration(totalSeconds: number | bigint): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds)))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** 0x1234…abcd */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}

/**
 * Parses user input ("1,234.5", "0.0009", ".5") into a fixed-point bigint. Extra decimals are truncated.
 * Returns null for empty or malformed input.
 */
export function parseAmount(input: string, decimals = 18): bigint | null {
  const cleaned = input.trim().replace(/[,\s_]/g, '')
  if (cleaned === '' || cleaned === '.') return null
  if (!/^\d*\.?\d*$/.test(cleaned)) return null
  const [int = '', frac = ''] = cleaned.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  return (
    BigInt(int === '' ? '0' : int) * pow10(decimals) + BigInt(fracPadded === '' ? '0' : fracPadded)
  )
}

/** Formats a fixed-point amount for an input field: no grouping, trailing zeros trimmed. */
export function toInputString(value: bigint, decimals = 18, maxDp = 8): string {
  return trimZeros(toFixedDecimal(value, decimals, maxDp, 'down'), 0)
}
