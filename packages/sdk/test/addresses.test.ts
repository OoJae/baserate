import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  computeMarketId,
  getRegistry,
  isDeployed,
  isMarketKnown,
  PYTH_BTC_USD_FEED,
  PYTH_MUSD_USD_FEED,
  parseRegistry,
  registries,
  SKIP_BTC_USD,
} from '../src/addresses'
import { MEZO_MAINNET_ID, MEZO_TESTNET_ID, MULTICALL3, mezo, mezoTestnet } from '../src/chains'
import testnetJson from '../src/deployments/31611.json'

const solPath = fileURLToPath(
  new URL('../../../contracts/script/config/MezoAddresses.sol', import.meta.url),
)
const sol = readFileSync(solPath, 'utf8')

/** Pulls `n.<field> = 0x…;` assignments out of one network function in MezoAddresses.sol. */
function solNetwork(fn: 'testnet' | 'mainnet'): Record<string, string> {
  const start = sol.indexOf(`function ${fn}()`)
  const body = sol.slice(start, sol.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/n\.(\w+) = (0x[0-9a-fA-F]{40});/g)) {
    out[m[1] as string] = getAddress(m[2] as string)
  }
  return out
}

describe('registry', () => {
  it('mirrors contracts/script/config/MezoAddresses.sol for both networks', () => {
    for (const [fn, chainId] of [
      ['testnet', MEZO_TESTNET_ID],
      ['mainnet', MEZO_MAINNET_ID],
    ] as const) {
      const expected = solNetwork(fn)
      expect(Object.keys(expected).length).toBe(15)
      const ext = getRegistry(chainId).external as unknown as Record<string, string>
      for (const [key, address] of Object.entries(expected)) {
        expect(ext[key], `${fn}.${key}`).toBe(address)
      }
    }
  })

  it('carries the precompile, feed and LLTV constants from MezoAddresses.sol', () => {
    expect(sol).toContain(SKIP_BTC_USD)
    expect(sol).toContain(PYTH_BTC_USD_FEED)
    expect(sol).toContain(PYTH_MUSD_USD_FEED)
    expect(getRegistry(MEZO_TESTNET_ID).lltv).toBe(770_000_000_000_000_000n)
    expect(getRegistry(MEZO_MAINNET_ID).lltv).toBe(860_000_000_000_000_000n)
    for (const r of Object.values(registries)) {
      expect(r.external.skipBtcUsd).toBe(getAddress(SKIP_BTC_USD))
      expect(r.external.multicall3).toBe(MULTICALL3)
      expect(r.feeds.pythBtcUsd).toBe(PYTH_BTC_USD_FEED)
    }
  })

  it('has the Wave 1 testnet deployment wired in', () => {
    const r = getRegistry(MEZO_TESTNET_ID)
    expect(isDeployed(r.contracts.factory.address)).toBe(true)
    expect(isMarketKnown(r.markets.M1.id)).toBe(true)
    expect(r.markets.M1.params.collateralToken).toBe(r.contracts.collateral.address)
    expect(r.markets.M1.params.oracle).toBe(r.contracts.oracle.address)
    expect(computeMarketId(r.markets.M1.params)).toBe(r.markets.M1.id)
  })

  it('keeps mainnet Baserate contracts as explicit zero-address placeholders until deployment', () => {
    const r = getRegistry(MEZO_MAINNET_ID)
    expect(isDeployed(r.contracts.factory.address)).toBe(false)
    expect(isMarketKnown(r.markets.M1.id)).toBe(false)
    expect(isDeployed(r.external.musd)).toBe(true)
  })

  it('rejects malformed registry files', () => {
    const bad = structuredClone(testnetJson)
    bad.external.musd = '0x1234'
    expect(() => parseRegistry(bad, MEZO_TESTNET_ID)).toThrow(/external.musd/)
    expect(() => parseRegistry(testnetJson, MEZO_MAINNET_ID)).toThrow(/chainId/)
  })

  it('computes Morpho market ids (testnet BTC/mUSDC market 0x1a7f…0b2e)', () => {
    expect(
      computeMarketId({
        loanToken: '0xe1a26db653708a2ad8f824e92db9852410e33a59',
        collateralToken: '0x7b7C000000000000000000000000000000000000',
        oracle: '0x72fb16cc59eb5e7acf84f24d9f2605ee153e0e6c',
        irm: '0x0c97Fe017628636649ff374aD499529F91167441',
        lltv: 770_000_000_000_000_000n,
      }),
    ).toBe('0x1a7f8d1036936234ff8477741ba80d4a85f573fee4de1bccc779ecc7e5680b2e')
  })
})

describe('chains', () => {
  it('overrides viem’s dead mainnet RPC and adds multicall3', () => {
    expect(mezo.rpcUrls.default.http).not.toContain('https://rpc.mezo.org')
    expect(mezo.rpcUrls.default.http[0]).toBe('https://mezo-mainnet.boar.network')
    expect(mezo.contracts.multicall3).toEqual({ address: MULTICALL3, blockCreated: 351_760 })
    expect(mezoTestnet.rpcUrls.default.http).toEqual(['https://rpc.test.mezo.org'])
    expect(mezoTestnet.id).toBe(31_611)
    expect(mezo.id).toBe(31_612)
  })
})
