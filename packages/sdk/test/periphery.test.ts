import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getRegistry } from '../src/addresses'
import { MEZO_TESTNET_ID } from '../src/chains'
import { WAD } from '../src/math'
import {
  ALLOCATOR,
  AllocatorAction,
  EPOCH_SECONDS,
  epochStart,
  liquidationBtcUsd,
  minProfitFor,
  nextEpochFlip,
  RiskSource,
  riskSourceStates,
  Venue,
  vaultAdapterCapId,
  vaultCollateralCapId,
  vaultDepositRoom,
  vaultMarketCapId,
  vaultWithdrawRoute,
} from '../src/periphery'

const src = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../contracts/src/${path}`, import.meta.url)), 'utf8')

describe('vMUSD cap ids', () => {
  // Values read from vMUSD v2 on Mezo testnet (`adapterId()`, and the ids DeployVault gave non-zero caps).
  const r = getRegistry(MEZO_TESTNET_ID)

  it('matches the adapters’ on-chain adapterId()', () => {
    expect(vaultAdapterCapId(r.contracts.wsMusdAdapter.address)).toBe(
      '0x8e15d136944de3d7d23dd86e9069e5aa0b2f710f6d89b7959771d33102c06ad8',
    )
    expect(vaultAdapterCapId(r.contracts.m1Adapter.address)).toBe(
      '0xf91fb1c70dbcddf1ca64c3667ba65da881718d7ba359ca1332c31f13637cb85d',
    )
  })

  it('matches the collateral and market ids the vault caps', () => {
    expect(vaultCollateralCapId(r.contracts.collateral.address)).toBe(
      '0x91fcf8658fcf5cc5ee8cb1f8f7bdf23afbf38c9912489abba3d0ace00d465ba1',
    )
    expect(vaultMarketCapId(r.contracts.m1Adapter.address, r.markets.M1.params)).toBe(
      '0x1d036b0dbcfd6613a63437cd934e29bd215050ba8ca900bd4c584073f9756293',
    )
  })
})

describe('vaultDepositRoom', () => {
  it('is the absolute cap minus what the liquidity adapter holds', () => {
    expect(
      vaultDepositRoom({
        absoluteCap: 250_000n * WAD,
        relativeCap: WAD,
        heldAssets: 2_100n * WAD,
        totalAssets: 3_100n * WAD,
      }),
    ).toBe(247_900n * WAD)
  })

  it('never goes negative and respects a relative cap', () => {
    expect(
      vaultDepositRoom({ absoluteCap: 0n, relativeCap: WAD, heldAssets: 5n, totalAssets: 5n }),
    ).toBe(0n)
    // 50% relative cap, 100 held of 300 total: 100 + x <= 0.5 (300 + x) ⇒ x <= 100.
    expect(
      vaultDepositRoom({
        absoluteCap: 10_000n * WAD,
        relativeCap: WAD / 2n,
        heldAssets: 100n * WAD,
        totalAssets: 300n * WAD,
      }),
    ).toBe(100n * WAD)
  })
})

describe('vaultWithdrawRoute', () => {
  it('goes direct while idle plus wsMUSD liquidity covers the amount', () => {
    const liquid = { vaultIdle: 1n * WAD, liquidityAvailable: 2_100n * WAD }
    expect(vaultWithdrawRoute(2_101n * WAD, liquid)).toBe('direct')
    expect(vaultWithdrawRoute(2_101n * WAD + 1n, liquid)).toBe('allocator')
  })
})

describe('liquidations', () => {
  it('keeps 90% of the previewed profit as the minimum by default', () => {
    expect(minProfitFor(1_000n)).toBe(900n)
    expect(minProfitFor(0n)).toBe(0n)
    expect(minProfitFor(1_000n, 5_000n)).toBe(500n)
  })

  it('prices the liquidation threshold in USD', () => {
    // 0.002 BTC, 123.59 MUSD debt, LLTV 0.77 → 80,253 MUSD per BTC; MUSD at $1.00.
    const usd = liquidationBtcUsd(123_590_000_000_000_000_000n, 2n * 10n ** 15n, 77n * 10n ** 16n)
    expect(usd).not.toBeNull()
    expect(Number(usd) / 1e18).toBeCloseTo(80_253.25, 1)
    // MUSD at $1.02 scales the BTC/USD threshold up by 2%.
    const at102 = liquidationBtcUsd(
      123_590_000_000_000_000_000n,
      2n * 10n ** 15n,
      77n * 10n ** 16n,
      102n * 10n ** 16n,
    )
    expect(Number(at102) / Number(usd)).toBeCloseTo(1.02, 6)
    expect(liquidationBtcUsd(0n, 1n, 1n)).toBeNull()
  })

  it('mirrors the Venue enum', () => {
    const sol = src('interfaces/ILiquidationVenues.sol')
    const body = sol.match(/enum Venue \{([^}]*)\}/)?.[1] ?? ''
    expect(body.split(',').map((s) => s.trim())).toEqual(Object.keys(Venue))
  })
})

describe('allocator', () => {
  it('mirrors the Action enum and policy constants', () => {
    const sol = src('interfaces/IBaserateAllocator.sol')
    const body = sol.match(/enum Action \{([^}]*)\}/)?.[1] ?? ''
    expect(body.split(',').map((s) => s.trim())).toEqual(Object.keys(AllocatorAction))
    const impl = src('vault/BaserateAllocator.sol')
    expect(impl).toContain('BUFFER_FLOOR = 2000e18')
    expect(impl).toContain('BUFFER_BPS = 1500')
    expect(impl).toContain('MAX_MOVE = 1000e18')
    expect(impl).toContain('COOLDOWN = 1 hours')
    expect(ALLOCATOR.COOLDOWN).toBe(3_600)
  })
})

describe('bribe epochs', () => {
  it('flip on Thursday 00:00 UTC', () => {
    // The FeeRouter distribution of 2026-10-25 credited epoch 1792627200 (Thu 22 Oct 2026 00:00 UTC).
    const sunday = Date.UTC(2026, 9, 25, 19, 0, 0) / 1000
    expect(epochStart(sunday)).toBe(1_792_627_200)
    expect(new Date(epochStart(sunday) * 1000).getUTCDay()).toBe(4)
    expect(nextEpochFlip(sunday)).toBe(1_792_627_200 + EPOCH_SECONDS)
    expect(epochStart(1_792_627_200)).toBe(1_792_627_200)
  })
})

describe('RiskLens sources', () => {
  it('mirrors the SRC_* constants', () => {
    const sol = src('lens/RiskLens.sol')
    for (const [name, bit] of Object.entries(RiskSource)) {
      const m = sol.match(new RegExp(`SRC_${name} = 1 << (\\d+);`))
      expect(m, name).not.toBeNull()
      expect(1n << BigInt(m?.[1] ?? -1)).toBe(bit)
    }
  })

  it('reads the testnet bitmask (no MUSD/USD pool, no CL depth)', () => {
    const states = riskSourceStates(0n, 48n)
    expect(states.filter((s) => s.state === 'skipped').map((s) => s.name)).toEqual([
      'MUSD_POOL',
      'CL_DEPTH',
    ])
    expect(riskSourceStates(RiskSource.ORACLE, 0n)[0]?.state).toBe('failed')
  })
})
