import { borrowAccountFactoryAbi, erc20PermitAbi, feeRouterAbi } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import { type Address, encodeFunctionData, type Hex, toFunctionSelector } from 'viem'
import { usePublicClient, useReadContracts } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { appChain, deployed, registry } from '../wagmi'

const ROUTER = registry.contracts.feeRouter.address
const FACTORY = registry.contracts.factory.address

/** `setFeeRecipient(FeeRouter)`: the timelocked factory call that points origination fees at the router. */
export const FEE_SWITCH_CALL: Hex = encodeFunctionData({
  abi: borrowAccountFactoryAbi,
  functionName: 'setFeeRecipient',
  args: [ROUTER],
})
const SET_FEE_RECIPIENT = toFunctionSelector('setFeeRecipient(address)')

export function useFeeRouter() {
  const r = { address: ROUTER, abi: feeRouterAbi } as const
  const f = { address: FACTORY, abi: borrowAccountFactoryAbi } as const
  const q = useReadContracts({
    contracts: [
      { ...r, functionName: 'previewDistribute' },
      { ...r, functionName: 'targets' },
      { ...r, functionName: 'TREASURY' },
      { ...r, functionName: 'SMUSD' },
      { ...r, functionName: 'VOTER' },
      { ...f, functionName: 'feeRecipient' },
      { ...f, functionName: 'executableAt', args: [FEE_SWITCH_CALL] },
      { ...f, functionName: 'TIMELOCK' },
      { ...f, functionName: 'ORIGINATION_FEE_BPS' },
      { ...f, functionName: 'governor' },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'balanceOf',
        args: [ROUTER],
      },
    ],
    allowFailure: true,
    query: { enabled: deployed.feeRouter, refetchInterval: 20_000 },
  })
  const x = <T>(v: { status: 'success'; result: T } | { status: 'failure' } | undefined) =>
    v?.status === 'success' ? v.result : undefined
  const d = q.data
  return {
    plan: x(d?.[0]),
    targets: x(d?.[1]),
    treasury: x(d?.[2]),
    smusd: x(d?.[3]),
    voter: x(d?.[4]),
    feeRecipient: x(d?.[5]),
    switchExecutableAt: x(d?.[6]),
    timelock: x(d?.[7]),
    feeBps: x(d?.[8]),
    governor: x(d?.[9]),
    balance: x(d?.[10]),
    isLoading: deployed.feeRouter && q.isLoading,
    isError: q.isError || (!!d && d.slice(0, 2).some((v) => v.status === 'failure')),
    refetch: () => void q.refetch(),
  }
}

export interface Distribution {
  tx: Hex
  block: bigint
  timestamp?: number
  caller: Address
  epochStart: bigint
  total: bigint
  toSmusd: bigint
  toBribes: bigint
  toTreasury: bigint
  retained: bigint
  bribes: { gauge: Address; bribe: Address; amount: bigint }[]
}

/** Every FeeRouter distribution (Distributed and BribePosted events), newest first. */
export function useDistributions() {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-distributions', appChain.id],
    enabled: deployed.feeRouter && !!client,
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: 2,
    queryFn: async (): Promise<Distribution[]> => {
      if (!client) return []
      const fromBlock = BigInt(registry.contracts.feeRouter.block)
      const [dist, bribes] = await Promise.all([
        getEventsChunked(client, {
          address: ROUTER,
          abi: feeRouterAbi,
          eventName: 'Distributed',
          fromBlock,
        }),
        getEventsChunked(client, {
          address: ROUTER,
          abi: feeRouterAbi,
          eventName: 'BribePosted',
          fromBlock,
        }),
      ])
      const out = await Promise.all(
        dist.map(async (l) => {
          const block = await client.getBlock({ blockNumber: l.blockNumber }).catch(() => null)
          return {
            tx: l.transactionHash,
            block: l.blockNumber,
            timestamp: block ? Number(block.timestamp) : undefined,
            caller: l.args.caller as Address,
            epochStart: l.args.epochStart ?? 0n,
            total: l.args.total ?? 0n,
            toSmusd: l.args.toSmusd ?? 0n,
            toBribes: l.args.toBribes ?? 0n,
            toTreasury: l.args.toTreasury ?? 0n,
            retained: l.args.retained ?? 0n,
            bribes: bribes
              .filter((b) => b.transactionHash === l.transactionHash)
              .map((b) => ({
                gauge: b.args.gauge as Address,
                bribe: b.args.bribe as Address,
                amount: b.args.amount ?? 0n,
              })),
          }
        }),
      )
      return out.reverse()
    },
  })
}

/** The factory's `Submitted` record of the fee switch (its tx hash), if any. */
export function useFeeSwitchSubmission() {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-fee-switch-submitted', appChain.id],
    enabled: deployed.feeRouter && deployed.factory && !!client,
    staleTime: 5 * 60_000,
    retry: 2,
    queryFn: async () => {
      if (!client) return null
      const logs = await getEventsChunked(client, {
        address: FACTORY,
        abi: borrowAccountFactoryAbi,
        eventName: 'Submitted',
        args: { selector: SET_FEE_RECIPIENT },
        fromBlock: BigInt(registry.contracts.feeRouter.block),
      })
      const match = logs
        .filter((l) => l.args.data?.toLowerCase() === FEE_SWITCH_CALL.toLowerCase())
        .at(-1)
      return match ? { tx: match.transactionHash, block: match.blockNumber } : null
    },
  })
}
