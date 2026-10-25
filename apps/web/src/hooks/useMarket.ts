import {
  adaptiveCurveIrmAbi,
  borrowAccountFactoryAbi,
  isMarketKnown,
  type MarketParams,
  type MarketState,
  morphoAbi,
  Profile,
} from '@baserate/sdk'
import type { Hex } from 'viem'
import { zeroAddress } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'
import { appChain, deployed, registry } from '../wagmi'

export interface RiskConfig {
  positionCap: bigint
  ceilingBps: bigint
  globalBorrowCap: bigint
  borrowPaused: boolean
  /** Effective fee: ORIGINATION_FEE_BPS when a fee recipient is set, else 0. */
  feeBps: bigint
  /** True when values come from the spec because the factory is not deployed yet. */
  expected: boolean
}

/** Testnet launch parameters from contracts.md §3.5, shown as "expected" until the factory is live. */
const EXPECTED: RiskConfig = {
  positionCap: 10n ** 16n, // 0.01 BTC
  ceilingBps: 6_200n,
  globalBorrowCap: 5_000n * 10n ** 18n,
  borrowPaused: false,
  feeBps: 10n,
  expected: true,
}

export interface MarketView {
  id: Hex | undefined
  params: MarketParams | undefined
  lltv: bigint
  risk: RiskConfig
  state: MarketState | undefined
  /** IRM borrowRateView: per-second WAD rate. */
  borrowRate: bigint | undefined
  isLoading: boolean
}

/** M1 market configuration (from the factory), live Morpho totals and the IRM rate. */
export function useMarket(): MarketView {
  const factory = registry.contracts.factory.address
  const cfg = useReadContracts({
    contracts: [
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'MARKET_ID' },
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'marketParams' },
      {
        address: factory,
        abi: borrowAccountFactoryAbi,
        functionName: 'limits',
        args: [Profile.STANDARD],
      },
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'globalBorrowCap' },
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'borrowPaused' },
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'ORIGINATION_FEE_BPS' },
      { address: factory, abi: borrowAccountFactoryAbi, functionName: 'feeRecipient' },
    ],
    allowFailure: false,
    query: { enabled: deployed.factory, refetchInterval: 30_000 },
  })

  const fromFactory = cfg.data?.[0]
  const id: Hex | undefined = isMarketKnown(fromFactory)
    ? fromFactory
    : deployed.market
      ? registry.markets.M1.id
      : undefined
  const params: MarketParams | undefined =
    cfg.data?.[1] ?? (deployed.market ? registry.markets.M1.params : undefined)

  const market = useReadContract({
    address: registry.external.morpho,
    abi: morphoAbi,
    functionName: 'market',
    args: id ? [id] : undefined,
    chainId: appChain.id,
    query: { enabled: !!id, refetchInterval: 15_000 },
  })

  const state: MarketState | undefined = market.data
    ? {
        totalSupplyAssets: market.data[0],
        totalSupplyShares: market.data[1],
        totalBorrowAssets: market.data[2],
        totalBorrowShares: market.data[3],
        lastUpdate: market.data[4],
        fee: market.data[5],
      }
    : undefined

  const rate = useReadContract({
    address: params?.irm ?? registry.external.irm,
    abi: adaptiveCurveIrmAbi,
    functionName: 'borrowRateView',
    args: params && state ? [params, state] : undefined,
    chainId: appChain.id,
    query: { enabled: !!params && !!state && state.lastUpdate > 0n, refetchInterval: 30_000 },
  })

  let risk = EXPECTED
  if (cfg.data) {
    const [, , limits, globalBorrowCap, borrowPaused, feeBps, feeRecipient] = cfg.data
    risk = {
      positionCap: limits[0],
      ceilingBps: BigInt(limits[1]),
      globalBorrowCap,
      borrowPaused,
      feeBps: feeRecipient === zeroAddress ? 0n : feeBps,
      expected: false,
    }
  }

  return {
    id,
    params,
    lltv: params?.lltv ?? registry.lltv,
    risk,
    state,
    borrowRate: rate.data,
    isLoading: cfg.isLoading || market.isLoading,
  }
}
