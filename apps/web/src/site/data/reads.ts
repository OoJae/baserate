import { rateToApr, SKIP_BTC_USD, transportFor } from '@baserate/sdk'
import { createClient } from 'viem'
import { getBlockNumber, multicall, readContract } from 'viem/actions'
import { appChain, deployed, registry } from '../../chain'
import { VAULT_IDS } from '../../lib/vaultIds'
import type { NoteContract } from '../content/products'

/*
 * The landing's live reads, in a chunk of their own: useLive.ts imports it on the first query, after the first
 * paint, so viem never sits in the entry. A bare viem client with only the three actions used here (a public
 * client would bring every public action, signature recovery included). Each read stays far under Mezo's 20
 * precompile calls per eth_call: the market read spends one (Skip BTC/USD); the rest touch no precompile. ABIs are
 * the few fragments these calls need, not the SDK's full ABIs.
 */

const marketParams = [
  { name: 'loanToken', type: 'address' },
  { name: 'collateralToken', type: 'address' },
  { name: 'oracle', type: 'address' },
  { name: 'irm', type: 'address' },
  { name: 'lltv', type: 'uint256' },
] as const

const marketState = [
  { name: 'totalSupplyAssets', type: 'uint128' },
  { name: 'totalSupplyShares', type: 'uint128' },
  { name: 'totalBorrowAssets', type: 'uint128' },
  { name: 'totalBorrowShares', type: 'uint128' },
  { name: 'lastUpdate', type: 'uint128' },
  { name: 'fee', type: 'uint128' },
] as const

const factoryAbi = [
  {
    type: 'function',
    name: 'limits',
    stateMutability: 'view',
    inputs: [{ name: 'profile', type: 'uint8' }],
    outputs: [
      { name: 'positionCap', type: 'uint128' },
      { name: 'ceilingBps', type: 'uint16' },
    ],
  },
] as const

const morphoAbi = [
  {
    type: 'function',
    name: 'market',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: marketState,
  },
] as const

const irmAbi = [
  {
    type: 'function',
    name: 'borrowRateView',
    stateMutability: 'view',
    inputs: [
      { name: 'marketParams', type: 'tuple', components: marketParams },
      { name: 'market', type: 'tuple', components: marketState },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const skipAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

const vaultAbi = [
  {
    type: 'function',
    name: 'allocation',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/** `Profile.STANDARD` in IBorrowAccountFactory.sol (the SDK's `Profile`, without pulling its ABIs in). */
const PROFILE_STANDARD = 0

let client: ReturnType<typeof makeClient> | undefined

function makeClient() {
  return createClient({ chain: appChain, transport: transportFor(appChain) })
}

function getClient() {
  client ??= makeClient()
  return client
}

/** A WAD (1e18) amount as a JS number, for display only. */
function fromWad(value: bigint): number {
  return Number(value / 10n ** 12n) / 1e6
}

/** The chain head: the same value, and the same query key, as the app's NetworkGuard.useChainHead. */
export async function readHead(): Promise<bigint> {
  return getBlockNumber(getClient(), { cacheTime: 0 })
}

export interface MarketRead {
  /** M1's borrow rate now (AdaptiveCurveIrm.borrowRateView, annualised), in percent. */
  aprPct: number | null
  /** The most a STANDARD account may borrow, as a percent of its collateral (`limits(STANDARD).ceilingBps`). */
  maxLtvPct: number | null
  /** M1's liquidation threshold, in percent (the market's LLTV). */
  lltvPct: number
  /** BTC/USD from Mezo's Skip precompile. */
  btcUsd: number | null
}

/** M1's rate, the borrow ceiling, LLTV and the BTC price: one multicall, then the IRM's view of the market. */
export async function readMarket(): Promise<MarketRead> {
  const c = getClient()
  const m1 = registry.markets.M1
  const lltvPct = fromWad(m1.params.lltv) * 100
  const [limits, market, skip] = await multicall(c, {
    allowFailure: true,
    contracts: [
      {
        address: registry.contracts.factory.address,
        abi: factoryAbi,
        functionName: 'limits',
        args: [PROFILE_STANDARD],
      },
      {
        address: registry.external.morpho,
        abi: morphoAbi,
        functionName: 'market',
        args: [m1.id],
      },
      { address: SKIP_BTC_USD, abi: skipAbi, functionName: 'latestRoundData' },
    ],
  })

  let aprPct: number | null = null
  if (deployed.market && market.status === 'success' && market.result[4] > 0n) {
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = market.result
    const rate = await readContract(c, {
      address: m1.params.irm,
      abi: irmAbi,
      functionName: 'borrowRateView',
      args: [
        m1.params,
        {
          totalSupplyAssets,
          totalSupplyShares,
          totalBorrowAssets,
          totalBorrowShares,
          lastUpdate,
          fee,
        },
      ],
    })
    aprPct = rateToApr(rate) * 100
  }

  return {
    aprPct,
    maxLtvPct:
      deployed.factory && limits.status === 'success' ? Number(limits.result[1]) / 100 : null,
    lltvPct,
    btcUsd: skip.status === 'success' && skip.result[1] > 0n ? fromWad(skip.result[1]) : null,
  }
}

export interface SplitRead {
  /** MUSD vMUSD has lent to M1. */
  m1: number
  /** MUSD vMUSD holds in wsMUSD through its liquidity adapter. */
  wsMusd: number
  /** Everything vMUSD holds (the remainder is idle in the vault). */
  total: number
}

/** Where vMUSD's MUSD sits: Vault V2's `allocation` behind M1 and behind the wsMUSD adapter. */
export async function readSplit(): Promise<SplitRead | null> {
  if (!deployed.vault) return null
  const vault = registry.contracts.vMusd.address
  const [m1, wsMusd, total] = await multicall(getClient(), {
    allowFailure: false,
    contracts: [
      { address: vault, abi: vaultAbi, functionName: 'allocation', args: [VAULT_IDS.m1Market] },
      { address: vault, abi: vaultAbi, functionName: 'allocation', args: [VAULT_IDS.liquidity] },
      { address: vault, abi: vaultAbi, functionName: 'totalAssets' },
    ],
  })
  return { m1: fromWad(m1), wsMusd: fromWad(wsMusd), total: fromWad(total) }
}

/** The notes' serials: each product's contract on the app chain, from the registry (no request). */
export function readSerials(): Record<NoteContract, string> {
  const c = registry.contracts
  return {
    factory: c.factory.address,
    wsMusd: c.wsMusd.address,
    vMusd: c.vMusd.address,
    flashLiquidator: c.flashLiquidator.address,
    feeRouter: c.feeRouter.address,
  }
}
