import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress, zeroAddress } from 'viem'
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
import {
  MEZO_LOCAL_FORK_ID,
  MEZO_MAINNET_ID,
  MEZO_TESTNET_ID,
  MULTICALL3,
  mezo,
  mezoTestnet,
} from '../src/chains'
import testnetJson from '../src/deployments/31611.json'

const solPath = fileURLToPath(
  new URL('../../../contracts/script/config/MezoAddresses.sol', import.meta.url),
)
const sol = readFileSync(solPath, 'utf8')

/** Address-typed fields of `struct MezoNetwork`, in declaration order. */
function solAddressFields(): string[] {
  // The struct closes on a line of its own; comments inside it may contain braces.
  const body = sol.match(/struct MezoNetwork \{([\s\S]*?)\n\}/)?.[1] ?? ''
  return [...body.matchAll(/^\s*address\s+(\w+);/gm)].map((m) => m[1] as string)
}

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
  it('mirrors every address field of MezoAddresses.sol for both networks', () => {
    const fields = solAddressFields()
    // Sanity: the parser found the struct (MUSD system, Morpho, Pyth, Tigris, gauges and Slipstream).
    expect(fields).toContain('musd')
    expect(fields).toContain('clSwapRouter')
    for (const [fn, chainId] of [
      ['testnet', MEZO_TESTNET_ID],
      ['mainnet', MEZO_MAINNET_ID],
    ] as const) {
      const assigned = solNetwork(fn)
      // Every assignment targets a declared address field (catches a typo on either side).
      for (const key of Object.keys(assigned)) expect(fields, `${fn}.${key}`).toContain(key)
      const ext = getRegistry(chainId).external as unknown as Record<string, string>
      // Fields a network leaves unassigned (e.g. Slipstream on testnet) are zero in the registry.
      for (const key of fields) {
        expect(ext[key], `${fn}.${key}`).toBe(assigned[key] ?? zeroAddress)
      }
    }
  })

  it('gives the local fork the testnet external addresses', () => {
    const fork = getRegistry(MEZO_LOCAL_FORK_ID).external
    const testnet = getRegistry(MEZO_TESTNET_ID).external
    expect(fork).toEqual(testnet)
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

  it('has every Baserate contract deployed on testnet, with its deploy transaction', () => {
    const r = getRegistry(MEZO_TESTNET_ID)
    for (const [name, c] of Object.entries(r.contracts)) {
      expect(isDeployed(c.address), name).toBe(true)
      expect(c.tx, name).toMatch(/^0x[0-9a-f]{64}$/)
      expect(c.block, name).toBeGreaterThanOrEqual(r.startBlock)
    }
    expect(isDeployed(r.external.vaultV2Factory)).toBe(true)
    expect(isMarketKnown(r.markets.M1.id)).toBe(true)
    expect(r.markets.M1.params.collateralToken).toBe(r.contracts.collateral.address)
    expect(r.markets.M1.params.oracle).toBe(r.contracts.oracle.address)
    expect(computeMarketId(r.markets.M1.params)).toBe(r.markets.M1.id)
  })

  it('keeps mainnet Baserate contracts as explicit zero-address placeholders until deployment', () => {
    const r = getRegistry(MEZO_MAINNET_ID)
    for (const [name, c] of Object.entries(r.contracts)) {
      expect(isDeployed(c.address), name).toBe(false)
      expect(c.tx, name).toBeNull()
    }
    expect(isMarketKnown(r.markets.M1.id)).toBe(false)
    expect(isDeployed(r.external.musd)).toBe(true)
  })

  it('rejects malformed registry files', () => {
    const bad = structuredClone(testnetJson)
    bad.external.musd = '0x1234'
    expect(() => parseRegistry(bad, MEZO_TESTNET_ID)).toThrow(/external.musd/)
    expect(() => parseRegistry(testnetJson, MEZO_MAINNET_ID)).toThrow(/chainId/)
    const badOperator = structuredClone(testnetJson)
    badOperator.canaryOperator = 'keeper'
    expect(() => parseRegistry(badOperator, MEZO_TESTNET_ID)).toThrow(/canaryOperator/)
  })

  it('records the testnet canary operator and leaves it optional elsewhere', () => {
    expect(getRegistry(MEZO_TESTNET_ID).canaryOperator).toBe(
      getAddress('0xDB52588fd26744a23e24a70D73579f075Bc50dD9'),
    )
    expect(getRegistry(MEZO_MAINNET_ID).canaryOperator).toBeNull()
    const { canaryOperator: _omitted, ...withoutOperator } = structuredClone(testnetJson)
    expect(parseRegistry(withoutOperator, MEZO_TESTNET_ID).canaryOperator).toBeNull()
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
