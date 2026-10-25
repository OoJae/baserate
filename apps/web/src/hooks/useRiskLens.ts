import { RISK_LENS_LIMITS, riskLensAbi } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import type { ContractFunctionReturnType } from 'viem'
import { appChain, deployed, directClient, registry } from '../wagmi'

export type RiskSnapshot = ContractFunctionReturnType<typeof riskLensAbi, 'view', 'snapshot'>

/** BTC sizes quoted for liquidation depth: 0.001 to 0.2 BTC (RiskLens takes at most 8). */
export const DEPTH_SIZES: bigint[] = [
  1_000_000_000_000_000n,
  2_000_000_000_000_000n,
  5_000_000_000_000_000n,
  10_000_000_000_000_000n,
  20_000_000_000_000_000n,
  50_000_000_000_000_000n,
  100_000_000_000_000_000n,
  200_000_000_000_000_000n,
].slice(0, RISK_LENS_LIMITS.maxDepthSizes)

/** Troves walked from the tail of the MUSD redemption queue. */
export const TROVE_COUNT = 10n

/**
 * One RiskLens.snapshot call: oracle, market, caps, backstop, MUSD price, depth and the trove queue. It runs as a
 * plain eth_call on the non-multicall client, never batched with other Skip reads (the 20-precompile limit is per
 * call, and CL quotes need a CALL context).
 */
export function useRiskLens() {
  return useQuery({
    queryKey: ['baserate-risklens', appChain.id],
    enabled: deployed.riskLens,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 2,
    queryFn: async (): Promise<RiskSnapshot> =>
      directClient.readContract({
        address: registry.contracts.riskLens.address,
        abi: riskLensAbi,
        functionName: 'snapshot',
        args: [
          {
            backstop: registry.contracts.backstop.address,
            btcSizes: DEPTH_SIZES,
            troveCount: TROVE_COUNT,
            twapWindow: 0,
          },
        ],
      }),
  })
}
