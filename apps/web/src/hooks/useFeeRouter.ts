import { borrowAccountFactoryAbi, erc20PermitAbi, feeRouterAbi } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  toFunctionSelector,
} from 'viem'
import { usePublicClient, useReadContracts } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { indexedTo, META, querySubgraph, readHistory } from '../lib/subgraph'
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

const DISTRIBUTIONS_QUERY = `query Distributions {
  distributions(first: 1000, orderBy: blockNumber, orderDirection: desc) {
    caller epochStart total toSmusd toBribes toTreasury retained blockNumber timestamp transactionHash
    bribes(where: { posted: true }, orderBy: logIndex, orderDirection: asc) { gauge bribe amount }
  }
  ${META}
}`

interface DistributionRow {
  caller: string
  epochStart: string
  total: string
  toSmusd: string
  toBribes: string
  toTreasury: string
  retained: string
  blockNumber: string
  timestamp: string
  transactionHash: Hex
  bribes: { gauge: string; bribe: string; amount: string }[]
}

/** Distributions the subgraph indexed, oldest first. */
async function distributionsFromSubgraph() {
  const data = await querySubgraph<{ distributions: DistributionRow[] }>(DISTRIBUTIONS_QUERY)
  const items = data.distributions.map(
    (d): Distribution => ({
      tx: d.transactionHash,
      block: BigInt(d.blockNumber),
      timestamp: Number(d.timestamp),
      caller: getAddress(d.caller),
      epochStart: BigInt(d.epochStart),
      total: BigInt(d.total),
      toSmusd: BigInt(d.toSmusd),
      toBribes: BigInt(d.toBribes),
      toTreasury: BigInt(d.toTreasury),
      retained: BigInt(d.retained),
      bribes: d.bribes.map((b) => ({
        gauge: getAddress(b.gauge),
        bribe: getAddress(b.bribe),
        amount: BigInt(b.amount),
      })),
    }),
  )
  return { items: items.reverse(), indexedTo: indexedTo(data) }
}

/** Distributed and BribePosted logs from `fromBlock`, joined by transaction, oldest first. */
async function distributionsFromLogs(
  client: PublicClient,
  fromBlock: bigint,
): Promise<Distribution[]> {
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
  return Promise.all(
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
}

/**
 * Every FeeRouter distribution (Distributed and BribePosted events), newest first: from the subgraph when one is
 * configured (plus the blocks it has not indexed yet), otherwise from logs.
 */
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
      const out = await readHistory({
        subgraph: distributionsFromSubgraph,
        logs: (fromBlock) => distributionsFromLogs(client, fromBlock),
        startBlock: BigInt(registry.contracts.feeRouter.block),
      })
      return out.reverse()
    },
  })
}

const FEE_SWITCH_QUERY = `query FeeSwitchSubmission($factory: Bytes!, $data: Bytes!) {
  timelockSubmissions(
    first: 1
    orderBy: blockNumber
    orderDirection: desc
    where: { contract: $factory, data: $data }
  ) {
    blockNumber transactionHash
  }
  ${META}
}`

interface FeeSwitchSubmission {
  tx: Hex
  block: bigint
}

/** The latest fee-switch submission the subgraph indexed (zero or one item). */
async function feeSwitchFromSubgraph() {
  const data = await querySubgraph<{
    timelockSubmissions: { blockNumber: string; transactionHash: Hex }[]
  }>(FEE_SWITCH_QUERY, {
    factory: FACTORY.toLowerCase(),
    data: FEE_SWITCH_CALL.toLowerCase(),
  })
  const items = data.timelockSubmissions.map(
    (s): FeeSwitchSubmission => ({ tx: s.transactionHash, block: BigInt(s.blockNumber) }),
  )
  return { items, indexedTo: indexedTo(data) }
}

/** Fee-switch `Submitted` logs from `fromBlock`, oldest first. */
async function feeSwitchFromLogs(
  client: PublicClient,
  fromBlock: bigint,
): Promise<FeeSwitchSubmission[]> {
  const logs = await getEventsChunked(client, {
    address: FACTORY,
    abi: borrowAccountFactoryAbi,
    eventName: 'Submitted',
    args: { selector: SET_FEE_RECIPIENT },
    fromBlock,
  })
  return logs
    .filter((l) => l.args.data?.toLowerCase() === FEE_SWITCH_CALL.toLowerCase())
    .map((l) => ({ tx: l.transactionHash, block: l.blockNumber }))
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
      const submissions = await readHistory({
        subgraph: feeSwitchFromSubgraph,
        logs: (fromBlock) => feeSwitchFromLogs(client, fromBlock),
        startBlock: BigInt(registry.contracts.feeRouter.block),
      })
      return submissions.at(-1) ?? null
    },
  })
}
