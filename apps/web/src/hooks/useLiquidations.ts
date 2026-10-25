import {
  borrowAccountFactoryAbi,
  expectedBorrowAssets,
  flashLiquidatorAbi,
  type MarketState,
  morphoAbi,
  Profile,
} from '@baserate/sdk'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { appChain, deployed, directClient, registry } from '../wagmi'

const FLASH = registry.contracts.flashLiquidator.address

export interface M1Position {
  owner: Address
  account: Address
  canary: boolean
  createdAt: bigint
  collateral: bigint
  borrowShares: bigint
}

/**
 * Every BorrowAccount the factory created (AccountCreated logs) and its M1 position on Morpho. Positions live in
 * Morpho under the account address; there is no indexer yet, so this reads the logs directly.
 */
export function useM1Positions() {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-m1-positions', appChain.id],
    enabled: deployed.factory && deployed.market && !!client,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 2,
    queryFn: async (): Promise<M1Position[]> => {
      if (!client) return []
      const created = await getEventsChunked(client, {
        address: registry.contracts.factory.address,
        abi: borrowAccountFactoryAbi,
        eventName: 'AccountCreated',
        fromBlock: BigInt(registry.contracts.factory.block),
      })
      const accounts = created
        .map((l) => ({
          owner: l.args.owner as Address,
          account: l.args.account as Address,
          canary: Number(l.args.profile) === Profile.CANARY,
          createdAt: l.blockNumber,
        }))
        .filter((a) => !!a.account)
      if (accounts.length === 0) return []
      const positions = await client.multicall({
        contracts: accounts.map((a) => ({
          address: registry.external.morpho,
          abi: morphoAbi,
          functionName: 'position',
          args: [registry.markets.M1.id, a.account],
        })),
        allowFailure: false,
      })
      return accounts.map((a, i) => {
        const p = positions[i] as unknown as readonly [bigint, bigint, bigint]
        return { ...a, borrowShares: p[1], collateral: p[2] }
      })
    },
  })
}

/** Debt with interest accrued to now (rounded up), from the market state and the IRM rate. */
export function positionDebt(
  borrowShares: bigint,
  market: MarketState | undefined,
  borrowRate: bigint | undefined,
): bigint | undefined {
  if (!market) return undefined
  return expectedBorrowAssets(
    borrowShares,
    market,
    borrowRate ?? 0n,
    BigInt(Math.floor(Date.now() / 1000)),
  )
}

export interface VenueQuote {
  proceeds: bigint
  profit: bigint
  ok: boolean
}

export interface LiquidationPreview {
  oracleOk: boolean
  liquidatable: boolean
  collateral: bigint
  debt: bigint
  price: bigint
  ltvWad: bigint
  seizable: bigint
  repaid: bigint
  badDebt: bigint
  minProceeds: bigint
  quotes: readonly [VenueQuote, VenueQuote, VenueQuote]
}

/**
 * FlashLiquidator.previewLiquidation per account. Not a view (QuoterV2 simulates), so each runs as its own
 * eth_call on the non-multicall client: a liquidatable preview spends up to 3 Skip reads, and Mezo caps
 * precompile calls per call.
 */
export function useLiquidationPreviews(accounts: Address[]) {
  return useQueries({
    queries: accounts.map((account) => ({
      queryKey: ['baserate-liq-preview', appChain.id, account],
      enabled: deployed.flashLiquidator,
      refetchInterval: 20_000,
      staleTime: 8_000,
      retry: 2,
      queryFn: async (): Promise<LiquidationPreview> => {
        const { result } = await directClient.simulateContract({
          address: FLASH,
          abi: flashLiquidatorAbi,
          functionName: 'previewLiquidation',
          args: [account],
        })
        return result as LiquidationPreview
      },
    })),
  })
}

/** What each venue would pay for `btc` now, and its oracle value (FlashLiquidator.quoteVenues, simulated). */
export function useVenueQuotes(btc: bigint | undefined) {
  return useQuery({
    queryKey: ['baserate-venue-quotes', appChain.id, btc?.toString()],
    enabled: deployed.flashLiquidator && !!btc && btc > 0n,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 2,
    queryFn: async () => {
      const { result } = await directClient.simulateContract({
        address: FLASH,
        abi: flashLiquidatorAbi,
        functionName: 'quoteVenues',
        args: [btc ?? 0n],
      })
      const [oracleValue, proceeds] = result as readonly [bigint, readonly [bigint, bigint, bigint]]
      return { oracleValue, proceeds }
    },
  })
}

/** FlashLiquidator constants: impact bound, incentive factor, and whether CL200 is wired on this network. */
export function useLiquidatorConfig() {
  return useQuery({
    queryKey: ['baserate-flash-config', appChain.id],
    enabled: deployed.flashLiquidator,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
    queryFn: async () => {
      const [maxImpactBps, incentive, clRouter] = await Promise.all([
        directClient.readContract({
          address: FLASH,
          abi: flashLiquidatorAbi,
          functionName: 'MAX_IMPACT_BPS',
        }),
        directClient.readContract({
          address: FLASH,
          abi: flashLiquidatorAbi,
          functionName: 'LIQUIDATION_INCENTIVE_FACTOR',
        }),
        directClient.readContract({
          address: FLASH,
          abi: flashLiquidatorAbi,
          functionName: 'CL_ROUTER',
        }),
      ])
      return { maxImpactBps, incentive, clAvailable: /[1-9a-f]/i.test(clRouter.slice(2)) }
    },
  })
}
