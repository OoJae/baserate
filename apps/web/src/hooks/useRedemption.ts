import { borrowerOperationsAbi, sortedTrovesAbi, troveManagerAbi } from '@baserate/sdk'
import { useReadContract, useReadContracts } from 'wagmi'
import { appChain, registry } from '../wagmi'

export interface RedemptionView {
  troveCount?: bigint
  /** Nominal ICR of the trove at the tail of SortedTroves: the next one redeemed. */
  lastNicr?: bigint
  /** Minimum trove debt = minNetDebt + MUSD_GAS_COMPENSATION (2,000 MUSD). */
  minTroveDebt?: bigint
  mcr?: bigint
  isLoading: boolean
}

/** MUSD trove-queue reads used by the "Redemption risk: none" comparison. */
export function useRedemption(): RedemptionView {
  const { sortedTroves, troveManager, borrowerOperations } = registry.external
  const base = useReadContracts({
    contracts: [
      { address: sortedTroves, abi: sortedTrovesAbi, functionName: 'getLast' },
      { address: sortedTroves, abi: sortedTrovesAbi, functionName: 'getSize' },
      { address: troveManager, abi: troveManagerAbi, functionName: 'MCR' },
      { address: borrowerOperations, abi: borrowerOperationsAbi, functionName: 'minNetDebt' },
      {
        address: borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'MUSD_GAS_COMPENSATION',
      },
    ],
    allowFailure: true,
    query: { refetchInterval: 60_000 },
  })
  const [last, size, mcr, minNet, gasComp] = base.data ?? []
  const lastTrove = last?.status === 'success' ? last.result : undefined

  const nicr = useReadContract({
    address: troveManager,
    abi: troveManagerAbi,
    functionName: 'getNominalICR',
    args: lastTrove ? [lastTrove] : undefined,
    chainId: appChain.id,
    query: { enabled: !!lastTrove, refetchInterval: 60_000 },
  })

  return {
    troveCount: size?.status === 'success' ? size.result : undefined,
    lastNicr: nicr.data,
    minTroveDebt:
      minNet?.status === 'success' && gasComp?.status === 'success'
        ? minNet.result + gasComp.result
        : undefined,
    mcr: mcr?.status === 'success' ? mcr.result : undefined,
    isLoading: base.isLoading || nicr.isLoading,
  }
}
