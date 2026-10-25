import { describe, expect, it } from 'vitest'
import {
  availableLiquidity,
  BPS,
  collateralValue,
  erc4626ToAssets,
  erc4626ToShares,
  expectedBorrowAssets,
  expectedMarketBalances,
  healthFactor,
  liquidationIncentive,
  liquidationIncentiveFactor,
  liquidationPrice,
  ltv,
  type MarketState,
  maxBorrow,
  minBig,
  minTroveCollateral,
  mulDivDown,
  mulDivUp,
  nominalIcr,
  ORACLE_PRICE_SCALE,
  oraclePriceToWad,
  originationFee,
  quoteBorrow,
  rateToApr,
  rateToApy,
  repayAllowance,
  SECONDS_PER_YEAR,
  sharePriceApy,
  smusdPendingYield,
  toAssetsDown,
  toAssetsUp,
  toSharesDown,
  toSharesUp,
  utilization,
  VIRTUAL_ASSETS,
  VIRTUAL_SHARES,
  WAD,
  wTaylorCompounded,
} from '../src/math'

const e18 = (n: number | string) => {
  const [i = '0', f = ''] = String(n).split('.')
  return BigInt(i) * WAD + BigInt(f.padEnd(18, '0').slice(0, 18))
}
/** BTC at $80,000 in Morpho's 1e36 scale. */
const PRICE_80K = 80_000n * ORACLE_PRICE_SCALE
const LLTV_TESTNET = e18('0.77')
const LLTV_MAINNET = e18('0.86')

/** Deterministic pseudo-random bigints for property checks. */
function* lcg(seed: bigint, count: number): Generator<bigint> {
  let x = seed
  for (let i = 0; i < count; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n
    yield x
  }
}

describe('MathLib primitives', () => {
  it('rounds mulDiv down and up', () => {
    expect(mulDivDown(10n, 3n, 4n)).toBe(7n)
    expect(mulDivUp(10n, 3n, 4n)).toBe(8n)
    expect(mulDivUp(8n, 1n, 4n)).toBe(2n)
  })

  it('wTaylorCompounded tracks e^x − 1 for small x', () => {
    // 5% a year for one year.
    const rate = e18('0.05') / SECONDS_PER_YEAR
    const compounded = Number(wTaylorCompounded(rate, SECONDS_PER_YEAR)) / 1e18
    expect(compounded).toBeCloseTo(Math.expm1(0.05), 5)
  })
})

describe('SharesMathLib (virtual shares 1e6, virtual assets 1)', () => {
  it('uses the Morpho virtual offsets', () => {
    expect(VIRTUAL_SHARES).toBe(1_000_000n)
    expect(VIRTUAL_ASSETS).toBe(1n)
  })

  it('mints 1e6 shares per asset wei in an empty market', () => {
    expect(toSharesDown(WAD, 0n, 0n)).toBe(WAD * 1_000_000n)
  })

  it('rounds in the protocol’s favour', () => {
    // 3 shares of a market with 10 assets / 20 shares: (3 × 11) / 1_000_020.
    expect(toAssetsDown(3n, 10n, 20n)).toBe(0n)
    expect(toAssetsUp(3n, 10n, 20n)).toBe(1n)
    expect(toSharesDown(5n, 10n, 20n)).toBe((5n * 1_000_020n) / 11n)
    expect(toSharesUp(5n, 10n, 20n)).toBe((5n * 1_000_020n + 10n) / 11n)
  })

  it('keeps Up ≥ Down and within one unit, across random markets', () => {
    const values = [...lcg(42n, 300)]
    for (let i = 0; i + 2 < values.length; i += 3) {
      const totalAssets = (values[i] as bigint) % 10n ** 30n
      const totalShares = (values[i + 1] as bigint) * 1_000_000n
      const x = (values[i + 2] as bigint) % 10n ** 24n
      const ad = toAssetsDown(x, totalAssets, totalShares)
      const au = toAssetsUp(x, totalAssets, totalShares)
      expect(au - ad === 0n || au - ad === 1n).toBe(true)
      const sd = toSharesDown(x, totalAssets, totalShares)
      const su = toSharesUp(x, totalAssets, totalShares)
      expect(su - sd === 0n || su - sd === 1n).toBe(true)
      // Borrowing x assets mints at least toSharesUp; repaying those shares costs at least x.
      expect(toAssetsUp(su, totalAssets, totalShares) >= x).toBe(true)
    }
  })
})

describe('market accrual (MorphoBalancesLib)', () => {
  const market: MarketState = {
    totalSupplyAssets: e18(1_000),
    totalSupplyShares: e18(1_000) * VIRTUAL_SHARES,
    totalBorrowAssets: e18(500),
    totalBorrowShares: e18(500) * VIRTUAL_SHARES,
    lastUpdate: 1_000n,
    fee: 0n,
  }
  const rate = e18('0.10') / SECONDS_PER_YEAR // ~10% APR

  it('does nothing without elapsed time', () => {
    expect(expectedMarketBalances(market, rate, 1_000n)).toEqual(market)
  })

  it('accrues interest to both borrow and supply sides', () => {
    const next = expectedMarketBalances(market, rate, 1_000n + SECONDS_PER_YEAR)
    const interest = next.totalBorrowAssets - market.totalBorrowAssets
    expect(next.totalSupplyAssets - market.totalSupplyAssets).toBe(interest)
    // ~10.5% continuously compounded on 500.
    expect(Number(interest) / 1e18).toBeCloseTo(500 * Math.expm1(0.1), 1)
    expect(next.totalSupplyShares).toBe(market.totalSupplyShares)
  })

  it('mints fee shares when the market has a fee', () => {
    const withFee = { ...market, fee: e18('0.1') }
    const next = expectedMarketBalances(withFee, rate, 1_000n + 86_400n)
    expect(next.totalSupplyShares > withFee.totalSupplyShares).toBe(true)
  })

  it('expected debt grows with time and rounds up', () => {
    const shares = e18(40) * VIRTUAL_SHARES
    const now = expectedBorrowAssets(shares, market, rate, 1_000n)
    const later = expectedBorrowAssets(shares, market, rate, 1_000n + 86_400n)
    expect(now).toBe(toAssetsUp(shares, market.totalBorrowAssets, market.totalBorrowShares))
    expect(later > now).toBe(true)
  })

  it('reports liquidity and utilization', () => {
    expect(availableLiquidity(market)).toBe(e18(500))
    expect(utilization(market)).toBe(e18('0.5'))
    expect(utilization({ ...market, totalSupplyAssets: 0n })).toBe(0n)
  })
})

describe('position risk', () => {
  it('values collateral at the 1e36-scaled oracle price', () => {
    expect(collateralValue(WAD, PRICE_80K)).toBe(e18(80_000))
    expect(maxBorrow(WAD, PRICE_80K, LLTV_TESTNET)).toBe(e18(61_600))
    expect(oraclePriceToWad(PRICE_80K)).toBe(e18(80_000))
  })

  it('computes LTV and health factor', () => {
    expect(ltv(e18(40_000), WAD, PRICE_80K)).toBe(e18('0.5'))
    expect(ltv(0n, WAD, PRICE_80K)).toBe(0n)
    expect(ltv(1n, 0n, PRICE_80K)).toBeNull()
    expect(healthFactor(e18(40_000), WAD, PRICE_80K, LLTV_TESTNET)).toBe(e18('1.54'))
    expect(healthFactor(0n, WAD, PRICE_80K, LLTV_TESTNET)).toBeNull()
  })

  it('puts the liquidation price exactly at health factor 1', () => {
    const debt = e18(40_000)
    const liq = liquidationPrice(debt, WAD, LLTV_TESTNET)
    expect(liq).not.toBeNull()
    const p = liq as bigint
    // 40,000 / 0.77 = 51,948.05… MUSD per BTC
    expect(Number(oraclePriceToWad(p)) / 1e18).toBeCloseTo(51_948.05, 1)
    const hfAt = healthFactor(debt, WAD, p, LLTV_TESTNET) as bigint
    expect(Number(hfAt - WAD) / 1e18).toBeCloseTo(0, 12)
    const above = p + p / 1_000n
    const below = p - p / 1_000n
    expect((healthFactor(debt, WAD, above, LLTV_TESTNET) as bigint) > WAD).toBe(true)
    expect((healthFactor(debt, WAD, below, LLTV_TESTNET) as bigint) < WAD).toBe(true)
    expect(liquidationPrice(0n, WAD, LLTV_TESTNET)).toBeNull()
  })

  it('matches Morpho’s liquidation incentive: min(1.15, 1/(0.3·LLTV + 0.7))', () => {
    expect(liquidationIncentiveFactor(LLTV_TESTNET)).toBe(1_074_113_856_068_743_286n)
    expect(Number(liquidationIncentive(LLTV_TESTNET)) / 1e18).toBeCloseTo(0.0741, 4)
    expect(Number(liquidationIncentive(LLTV_MAINNET)) / 1e18).toBeCloseTo(0.0438, 4)
    expect(liquidationIncentiveFactor(0n)).toBe(e18('1.15'))
    for (const l of [0.5, 0.625, 0.77, 0.86, 0.915, 0.945]) {
      const expected = Math.min(1.15, 1 / (0.3 * l + 0.7))
      expect(Number(liquidationIncentiveFactor(e18(l))) / 1e18).toBeCloseTo(expected, 12)
    }
  })
})

describe('rates', () => {
  it('converts a per-second rate to APR and continuously compounded APY', () => {
    const rate = e18('0.05') / SECONDS_PER_YEAR
    expect(rateToApr(rate)).toBeCloseTo(0.05, 8)
    expect(rateToApy(rate)).toBeCloseTo(Math.expm1(0.05), 8)
    expect(rateToApy(0n)).toBe(0)
  })

  it('annualises share-price growth', () => {
    expect(sharePriceApy(e18('1.01'), Number(SECONDS_PER_YEAR))).toBeCloseTo(0.01, 10)
    expect(sharePriceApy(e18('1.01'), 0)).toBeNull()
  })
})

describe('quoteBorrow', () => {
  const base = {
    collateral: 0n,
    debt: 0n,
    btcIn: e18('0.0009'),
    targetLtvBps: 5_000n,
    oraclePrice: PRICE_80K,
    lltv: LLTV_TESTNET,
    feeBps: 10n,
    ceilingBps: 6_200n,
  }

  it('sizes the judge flow: 0.0009 BTC at 50% LTV with the 0.10% fee', () => {
    const q = quoteBorrow(base)
    // 0.0009 × 80,000 = 72 MUSD of collateral; 36 MUSD of debt room; 36 / 1.001 → 35.96 out.
    expect(q.collateralValue).toBe(e18(72))
    expect(q.musdOut).toBe(e18('35.96'))
    expect(q.fee).toBe(originationFee(e18('35.96'), 10n))
    expect(q.fee).toBe(e18('0.03596'))
    expect(q.newDebt).toBe(q.musdOut + q.fee)
    expect(q.newDebt <= e18(36)).toBe(true)
    expect((q.ltv as bigint) <= e18('0.5')).toBe(true)
    expect(q.maxLtvBps).toBe(5_100n)
    expect(Number(q.healthFactor) / 1e18).toBeCloseTo(1.54, 2)
  })

  it('never exceeds the target across random inputs, and clamps to the ceiling', () => {
    const values = [...lcg(7n, 400)]
    for (let i = 0; i + 3 < values.length; i += 4) {
      const btcIn = (values[i] as bigint) % e18('0.01')
      const debt = (values[i + 1] as bigint) % e18(300)
      const collateral = (values[i + 2] as bigint) % e18('0.01')
      const target = 500n + ((values[i + 3] as bigint) % 7_000n)
      const q = quoteBorrow({ ...base, btcIn, debt, collateral, targetLtvBps: target })
      const cap = minBig(target, base.ceilingBps)
      const targetDebt = (collateralValue(collateral + btcIn, PRICE_80K) * cap) / BPS
      if (q.musdOut > 0n) expect(q.newDebt <= targetDebt).toBe(true)
      expect(q.musdOut >= 0n).toBe(true)
      expect(q.musdOut % 10n ** 16n).toBe(0n)
      expect(q.maxLtvBps <= base.ceilingBps).toBe(true)
    }
  })

  it('returns zero when existing debt is already above the target', () => {
    const q = quoteBorrow({ ...base, collateral: e18('0.001'), debt: e18(70), btcIn: 0n })
    expect(q.musdOut).toBe(0n)
    expect(q.fee).toBe(0n)
    expect(q.newDebt).toBe(e18(70))
  })

  it('charges no fee when the fee recipient is unset', () => {
    const q = quoteBorrow({ ...base, feeBps: 0n })
    expect(q.fee).toBe(0n)
    expect(q.musdOut).toBe(e18(36))
  })

  it('adds head-room to repay allowances', () => {
    expect(repayAllowance(e18(40))).toBe(e18(40) + e18('0.02'))
    expect(repayAllowance(e18(1))).toBe(e18(1) + e18('0.01'))
  })
})

describe('MUSD trove comparison', () => {
  it('computes the nominal ICR like TroveManager (coll × 1e20 / debt)', () => {
    expect(nominalIcr(e18('0.001'), e18(40))).toBe((e18('0.001') * 10n ** 20n) / e18(40))
    expect(nominalIcr(WAD, 0n)).toBeNull()
  })

  it('prices the 2,000 MUSD minimum trove at the 110% MCR', () => {
    // Live testnet Skip read 2026-10-25: 80,502.98844 → ≈0.0273 BTC.
    const btc = minTroveCollateral(e18(2_000), e18('1.1'), 80_502_988_440_000_000_000_000n)
    expect(Number(btc) / 1e18).toBeCloseTo(0.027328, 5)
    expect(minTroveCollateral(e18(2_000), e18('1.1'), 0n)).toBe(0n)
  })
})

describe('ERC-4626 and sMUSD yield', () => {
  it('converts with OpenZeppelin’s +1 virtual offset', () => {
    expect(erc4626ToShares(e18(100), 0n, 0n)).toBe(e18(100))
    expect(erc4626ToShares(e18(100), e18(110), e18(100))).toBe(
      (e18(100) * (e18(100) + 1n)) / (e18(110) + 1n),
    )
    expect(erc4626ToAssets(e18(100), e18(110), e18(100))).toBe(
      (e18(100) * (e18(110) + 1n)) / (e18(100) + 1n),
    )
  })

  it('computes sMUSD pending yield as claimable + balance × Δindex', () => {
    expect(smusdPendingYield(e18(1), e18(1_000), e18('163.5'), e18(163))).toBe(e18(501))
    expect(smusdPendingYield(0n, e18(1_000), e18(163), e18(164))).toBe(0n)
  })
})
