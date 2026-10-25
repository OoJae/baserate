/**
 * Morpho Blue and Baserate math in bigint, mirroring the on-chain libraries (MathLib, SharesMathLib,
 * MorphoBalancesLib) so previews match executed amounts. Fractions are WAD (1e18) unless noted.
 */

export const WAD = 10n ** 18n
/** Morpho oracle prices are scaled by 1e36 (collateral price quoted in loan-token units). */
export const ORACLE_PRICE_SCALE = 10n ** 36n
/** SharesMathLib virtual shares and assets (inflation-attack protection). */
export const VIRTUAL_SHARES = 10n ** 6n
export const VIRTUAL_ASSETS = 1n
export const BPS = 10_000n
export const SECONDS_PER_YEAR = 31_536_000n
/** Morpho's liquidation incentive cap and cursor. */
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1_150_000_000_000_000_000n
export const LIQUIDATION_CURSOR = 300_000_000_000_000_000n
/** MUSD trove nominal ICR precision. */
export const NICR_PRECISION = 10n ** 20n

// ---------------------------------------------------------------------------------------------------------------
// Primitive math (MathLib)
// ---------------------------------------------------------------------------------------------------------------

export function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y) / d
}

export function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y + (d - 1n)) / d
}

export function wMulDown(x: bigint, y: bigint): bigint {
  return mulDivDown(x, y, WAD)
}

export function wDivDown(x: bigint, y: bigint): bigint {
  return mulDivDown(x, WAD, y)
}

export function wDivUp(x: bigint, y: bigint): bigint {
  return mulDivUp(x, WAD, y)
}

/** Third-order Taylor expansion of e^(x·n) − 1, as in Morpho's MathLib. */
export function wTaylorCompounded(x: bigint, n: bigint): bigint {
  const firstTerm = x * n
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD)
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD)
  return firstTerm + secondTerm + thirdTerm
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

// ---------------------------------------------------------------------------------------------------------------
// Shares (SharesMathLib)
// ---------------------------------------------------------------------------------------------------------------

export function toSharesDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS)
}

export function toSharesUp(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS)
}

export function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES)
}

export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES)
}

// ---------------------------------------------------------------------------------------------------------------
// Market state (MorphoBalancesLib)
// ---------------------------------------------------------------------------------------------------------------

export interface MarketState {
  totalSupplyAssets: bigint
  totalSupplyShares: bigint
  totalBorrowAssets: bigint
  totalBorrowShares: bigint
  lastUpdate: bigint
  fee: bigint
}

/** Market totals after accruing interest up to `timestamp`, given the IRM's `borrowRateView`. */
export function expectedMarketBalances(
  market: MarketState,
  borrowRate: bigint,
  timestamp: bigint,
): MarketState {
  const next = { ...market }
  const elapsed = timestamp - market.lastUpdate
  if (elapsed > 0n && market.totalBorrowAssets !== 0n) {
    const interest = wMulDown(market.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed))
    next.totalBorrowAssets += interest
    next.totalSupplyAssets += interest
    if (market.fee !== 0n) {
      const feeAmount = wMulDown(interest, market.fee)
      const feeShares = toSharesDown(
        feeAmount,
        next.totalSupplyAssets - feeAmount,
        next.totalSupplyShares,
      )
      next.totalSupplyShares += feeShares
    }
    next.lastUpdate = timestamp
  }
  return next
}

/** A borrower's debt including accrued interest, rounded up (what a full repay pulls). */
export function expectedBorrowAssets(
  borrowShares: bigint,
  market: MarketState,
  borrowRate: bigint,
  timestamp: bigint,
): bigint {
  const m = expectedMarketBalances(market, borrowRate, timestamp)
  return toAssetsUp(borrowShares, m.totalBorrowAssets, m.totalBorrowShares)
}

/** MUSD that can still be borrowed from the market. */
export function availableLiquidity(market: MarketState): bigint {
  return maxBig(market.totalSupplyAssets - market.totalBorrowAssets, 0n)
}

export function utilization(market: MarketState): bigint {
  return market.totalSupplyAssets === 0n
    ? 0n
    : wDivDown(market.totalBorrowAssets, market.totalSupplyAssets)
}

// ---------------------------------------------------------------------------------------------------------------
// Position risk
// ---------------------------------------------------------------------------------------------------------------

/** Collateral value in loan-token units (MUSD wei) at a 1e36-scaled oracle price. */
export function collateralValue(collateral: bigint, oraclePrice: bigint): bigint {
  return mulDivDown(collateral, oraclePrice, ORACLE_PRICE_SCALE)
}

/** Morpho's borrow limit: collateral × price × LLTV (rounded down). */
export function maxBorrow(collateral: bigint, oraclePrice: bigint, lltv: bigint): bigint {
  return wMulDown(collateralValue(collateral, oraclePrice), lltv)
}

/** Loan-to-value as a WAD fraction (rounded up). Returns 0 with no debt; `null` with debt but no collateral value. */
export function ltv(debt: bigint, collateral: bigint, oraclePrice: bigint): bigint | null {
  if (debt === 0n) return 0n
  const value = collateralValue(collateral, oraclePrice)
  if (value === 0n) return null
  return wDivUp(debt, value)
}

/** Health factor = collateral × price × LLTV / debt (WAD). `null` when there is no debt (infinitely healthy). */
export function healthFactor(
  debt: bigint,
  collateral: bigint,
  oraclePrice: bigint,
  lltv: bigint,
): bigint | null {
  if (debt === 0n) return null
  return wDivDown(maxBorrow(collateral, oraclePrice, lltv), debt)
}

/**
 * Oracle price (1e36 scale) at which the position becomes liquidatable: debt / (collateral × LLTV).
 * `null` with no debt or no collateral.
 */
export function liquidationPrice(debt: bigint, collateral: bigint, lltv: bigint): bigint | null {
  if (debt === 0n || collateral === 0n || lltv === 0n) return null
  return mulDivUp(debt, ORACLE_PRICE_SCALE * WAD, collateral * lltv)
}

/** Converts a 1e36-scaled oracle price for 18-decimal tokens into a WAD "MUSD per BTC" value. */
export function oraclePriceToWad(oraclePrice: bigint): bigint {
  return oraclePrice / WAD
}

/** Converts a WAD "MUSD per BTC" value back into the 1e36-scaled oracle price. */
export function wadToOraclePrice(priceWad: bigint): bigint {
  return priceWad * WAD
}

/** Liquidation incentive factor = min(1.15, 1 / (1 − 0.3 × (1 − LLTV))) = min(1.15, 1 / (0.3·LLTV + 0.7)). */
export function liquidationIncentiveFactor(lltv: bigint): bigint {
  return minBig(
    MAX_LIQUIDATION_INCENTIVE_FACTOR,
    wDivDown(WAD, WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv)),
  )
}

/** The liquidator's bonus as a WAD fraction (7.41% at LLTV 0.77, 4.38% at 0.86). */
export function liquidationIncentive(lltv: bigint): bigint {
  return liquidationIncentiveFactor(lltv) - WAD
}

// ---------------------------------------------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------------------------------------------

/** Per-second WAD rate (IRM `borrowRateView`) to a simple annual rate, as a JS number fraction. */
export function rateToApr(ratePerSecond: bigint): number {
  return Number(ratePerSecond * SECONDS_PER_YEAR) / 1e18
}

/** Per-second WAD rate to the continuously compounded APY e^(r·t) − 1, as a JS number fraction. */
export function rateToApy(ratePerSecond: bigint): number {
  return Math.expm1(rateToApr(ratePerSecond))
}

/** Annualised growth implied by a share price that started at 1.0, after `elapsedSeconds`. */
export function sharePriceApy(sharePriceWad: bigint, elapsedSeconds: number): number | null {
  if (elapsedSeconds <= 0 || sharePriceWad <= 0n) return null
  const growth = Number(sharePriceWad) / 1e18
  return growth ** (Number(SECONDS_PER_YEAR) / elapsedSeconds) - 1
}

// ---------------------------------------------------------------------------------------------------------------
// Baserate borrow quote
// ---------------------------------------------------------------------------------------------------------------

export interface BorrowQuoteInput {
  /** Existing collateral in the position (wei). */
  collateral: bigint
  /** Existing debt including accrued interest (wei). */
  debt: bigint
  /** BTC being added with this transaction (wei). */
  btcIn: bigint
  /** Target loan-to-value after the borrow, in bps. */
  targetLtvBps: bigint
  /** BtcMusdOracle.price(), 1e36 scale. */
  oraclePrice: bigint
  lltv: bigint
  /** Origination fee in bps (0 when the factory has no fee recipient). */
  feeBps: bigint
  /** Opening ceiling for the profile, in bps. */
  ceilingBps: bigint
  /** Extra LTV head-room passed as `maxLtvBps`, so a small price move does not revert the transaction. */
  slippageBps?: bigint
  /** Round `musdOut` down to a multiple of this (default 0.01 MUSD). */
  roundTo?: bigint
}

export interface BorrowQuote {
  /** MUSD sent to the borrower. */
  musdOut: bigint
  /** Origination fee added to the debt: ceil(musdOut × feeBps / 1e4). */
  fee: bigint
  newCollateral: bigint
  newDebt: bigint
  collateralValue: bigint
  /** WAD LTV after the borrow. */
  ltv: bigint | null
  healthFactor: bigint | null
  /** Oracle price (1e36 scale) at which the position is liquidatable. */
  liquidationPrice: bigint | null
  /** `maxLtvBps` argument for openAndBorrow / borrow. */
  maxLtvBps: bigint
}

/** Origination fee as charged by BorrowAccount: ceil(musdOut × feeBps / 1e4). */
export function originationFee(musdOut: bigint, feeBps: bigint): bigint {
  return feeBps === 0n ? 0n : mulDivUp(musdOut, feeBps, BPS)
}

/**
 * Sizes `musdOut` so the post-borrow LTV, including the origination fee, lands at the target.
 * debt' = debt + musdOut + fee ≤ (collateral + btcIn) × price × target.
 */
export function quoteBorrow(input: BorrowQuoteInput): BorrowQuote {
  const roundTo = input.roundTo ?? 10n ** 16n
  const slippage = input.slippageBps ?? 100n
  const target = minBig(input.targetLtvBps, input.ceilingBps)
  const newCollateral = input.collateral + input.btcIn
  const value = collateralValue(newCollateral, input.oraclePrice)
  const targetDebt = mulDivDown(value, target, BPS)
  const room = maxBig(targetDebt - input.debt, 0n)
  let musdOut = mulDivDown(room, BPS, BPS + input.feeBps)
  if (roundTo > 1n) musdOut -= musdOut % roundTo
  let fee = originationFee(musdOut, input.feeBps)
  // Ceil rounding of the fee can overshoot the target by a wei; step down until it fits.
  while (musdOut > 0n && input.debt + musdOut + fee > targetDebt) {
    musdOut -= roundTo > 1n ? roundTo : 1n
    fee = originationFee(musdOut, input.feeBps)
  }
  const newDebt = input.debt + musdOut + fee
  return {
    musdOut,
    fee,
    newCollateral,
    newDebt,
    collateralValue: value,
    ltv: ltv(newDebt, newCollateral, input.oraclePrice),
    healthFactor: healthFactor(newDebt, newCollateral, input.oraclePrice, input.lltv),
    liquidationPrice: liquidationPrice(newDebt, newCollateral, input.lltv),
    maxLtvBps: minBig(target + slippage, input.ceilingBps),
  }
}

/**
 * Permit / approval amount for a full repay: the debt plus head-room for interest that accrues before the
 * transaction lands (5 bps, at least 0.01 MUSD). The account pulls exactly the debt.
 */
export function repayAllowance(debt: bigint): bigint {
  return debt + maxBig(mulDivUp(debt, 5n, BPS), 10n ** 16n)
}

// ---------------------------------------------------------------------------------------------------------------
// MUSD trove comparison
// ---------------------------------------------------------------------------------------------------------------

/** MUSD's nominal ICR: collateral × 1e20 / debt. */
export function nominalIcr(collateral: bigint, debt: bigint): bigint | null {
  if (debt === 0n) return null
  return mulDivDown(collateral, NICR_PRECISION, debt)
}

/** BTC needed to open the smallest MUSD trove (`minDebt`) at the minimum collateral ratio (`mcr`, WAD). */
export function minTroveCollateral(minDebt: bigint, mcr: bigint, btcUsdWad: bigint): bigint {
  if (btcUsdWad === 0n) return 0n
  return mulDivUp(minDebt, mcr, btcUsdWad)
}

// ---------------------------------------------------------------------------------------------------------------
// ERC-4626 (OpenZeppelin v5, decimals offset 0) and wsMUSD yield
// ---------------------------------------------------------------------------------------------------------------

export function erc4626ToShares(assets: bigint, totalAssets: bigint, totalSupply: bigint): bigint {
  return mulDivDown(assets, totalSupply + 1n, totalAssets + 1n)
}

export function erc4626ToAssets(shares: bigint, totalAssets: bigint, totalSupply: bigint): bigint {
  return mulDivDown(shares, totalAssets + 1n, totalSupply + 1n)
}

/** sMUSD pending yield for a holder: claimable + balance × (yieldIndex − supplyYieldIndex) / 1e18. */
export function smusdPendingYield(
  claimable: bigint,
  balance: bigint,
  yieldIndex: bigint,
  supplyYieldIndex: bigint,
): bigint {
  const delta = yieldIndex > supplyYieldIndex ? yieldIndex - supplyYieldIndex : 0n
  return claimable + mulDivDown(balance, delta, WAD)
}
