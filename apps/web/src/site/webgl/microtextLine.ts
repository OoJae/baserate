/**
 * The coin's microtext ring, the words: live chain values as one line of microprint, any missing value left out
 * (never estimated). Kept apart from microtext.ts (which lays the line out and paints it for the stage), so the
 * landing's entry chunk carries only this.
 */

/** Live values for the ring. Pass what you have read; anything missing is left out of the text. */
export interface MicrotextValues {
  /** The network label, e.g. "Mezo testnet". Defaults to the chain's name for Mezo testnet (31611). */
  readonly network?: string
  /** The chain id, e.g. 31611. */
  readonly chainId?: number
  /** The latest block number read from the chain. */
  readonly block?: bigint | number
  /** M1's borrow rate as % APR (e.g. 1.17 for 1.17 %), from the IRM's borrowRateView. */
  readonly m1BorrowApr?: number
  /** M1's liquidation LTV as a % (e.g. 77), from the market's params. */
  readonly lltv?: number
}

/** The separator the microprint and the serial strips share. */
export const MICROTEXT_SEPARATOR = ' · '

const NETWORKS: Readonly<Record<number, string>> = { 31611: 'Mezo testnet' }

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 16368412 → "16,368,412" (grouped by hand, so the text never depends on the reader's locale). */
function grouped(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 77 → "77", 77.5 → "77.5", 0.865 → "0.87". */
function percent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '')
}

/**
 * The ring's line of text, in capitals:
 * "MEZO TESTNET · CHAIN 31611 · BLOCK 16,368,412 · M1 BORROW 1.17% APR · LLTV 77% · NO REDEMPTION QUEUE".
 * Values that are missing or malformed are left out; "NO REDEMPTION QUEUE" is the product, not a reading.
 */
export function composeMicrotext(values: MicrotextValues = {}): string {
  const parts: string[] = []
  const network =
    values.network ?? (values.chainId !== undefined ? NETWORKS[values.chainId] : undefined)
  if (network) parts.push(network)
  if (isWhole(values.chainId)) parts.push(`Chain ${values.chainId}`)
  const block = values.block
  if ((typeof block === 'bigint' && block >= 0n) || isWhole(block)) {
    parts.push(`Block ${grouped(block)}`)
  }
  if (isFiniteNonNegative(values.m1BorrowApr))
    parts.push(`M1 borrow ${values.m1BorrowApr.toFixed(2)}% APR`)
  if (isFiniteNonNegative(values.lltv)) parts.push(`LLTV ${percent(values.lltv)}%`)
  parts.push('No redemption queue')
  return parts.join(MICROTEXT_SEPARATOR).toUpperCase()
}
