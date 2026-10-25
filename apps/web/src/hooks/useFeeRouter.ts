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
import { getAllEventsChunked, getEventsChunked } from '../lib/logs'
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
      { ...f, functionName: 'EXECUTION_WINDOW' },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'balanceOf',
        args: [ROUTER],
      },
      { ...r, functionName: 'smusdCarry' },
      { ...r, functionName: 'smusdFailingSince' },
      { ...r, functionName: 'bribeCarry', args: [0n] },
      { ...r, functionName: 'bribeCarry', args: [1n] },
      { ...r, functionName: 'SMUSD_GRACE_EPOCHS' },
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
    /** How long a matured timelocked call stays executable (14 days); after that it lapses. */
    executionWindow: x(d?.[10]),
    balance: x(d?.[11]),
    /** MUSD carried for the sMUSD leg: below sMUSD's dust floor, or a failed donation within the grace period. */
    smusdCarry: x(d?.[12]),
    /** First failed sMUSD donation of the current streak (0 while sMUSD is healthy). */
    smusdFailingSince: x(d?.[13]),
    /** Bribe MUSD carried per configured gauge (0 for an unconfigured index). */
    bribeCarry: [x(d?.[14]), x(d?.[15])] as const,
    /** Epoch flips a failure streak must span before the sMUSD leg goes to the treasury. */
    smusdGraceEpochs: x(d?.[16]),
    isLoading: deployed.feeRouter && q.isLoading,
    isError: q.isError || (!!d && d.slice(0, 2).some((v) => v.status === 'failure')),
    refetch: () => void q.refetch(),
  }
}

/** What a distribute() did with its sMUSD leg (the subgraph's SmusdOutcome). */
export type SmusdOutcome = 'NONE' | 'DONATED' | 'DEFERRED' | 'FAILED' | 'TO_TREASURY'
/** Why a bribe share was carried (FeeRouter.CarryReason). */
export type CarryReason = 'VOTE_WINDOW_CLOSED' | 'NO_VOTES'

export interface Distribution {
  tx: Hex
  block: bigint
  timestamp?: number
  caller: Address
  epochStart: bigint
  total: bigint
  /** MUSD sMUSD actually received. */
  toSmusd: bigint
  toBribes: bigint
  /** Treasury's 20% plus `smusdToTreasury`. */
  toTreasury: bigint
  /** Carried to the next distribution: `bribesCarried + smusdCarried`. */
  retained: bigint
  bribes: { gauge: Address; bribe: Address; amount: bigint }[]
  bribesCarried: bigint
  bribeCarries: { gauge: Address; amount: bigint; reason: CarryReason }[]
  /** Part of the sMUSD leg carried: below sMUSD's dust floor, or a failed donation within the grace period. */
  smusdCarried: bigint
  /** Part of the sMUSD leg paid to the treasury because sMUSD kept failing past the grace period. */
  smusdToTreasury: bigint
  smusdOutcome: SmusdOutcome
  /** FAILED / TO_TREASURY: start of the sMUSD failure streak (unix seconds). */
  smusdFailingSince?: number
}

const DISTRIBUTIONS_QUERY = `query Distributions {
  distributions(first: 1000, orderBy: blockNumber, orderDirection: desc) {
    caller epochStart total toSmusd toBribes toTreasury retained blockNumber timestamp transactionHash
    bribesCarried smusdCarried smusdToTreasury smusdOutcome smusdFailingSince
    bribes(where: { posted: true }, orderBy: logIndex, orderDirection: asc) { gauge bribe amount }
    bribeCarries(orderBy: logIndex, orderDirection: asc) { gauge amount reason }
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
  bribesCarried: string
  smusdCarried: string
  smusdToTreasury: string
  smusdOutcome: SmusdOutcome
  smusdFailingSince: string | null
  bribes: { gauge: string; bribe: string; amount: string }[]
  bribeCarries: { gauge: string; amount: string; reason: CarryReason }[]
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
      bribesCarried: BigInt(d.bribesCarried),
      bribeCarries: d.bribeCarries.map((c) => ({
        gauge: getAddress(c.gauge),
        amount: BigInt(c.amount),
        reason: c.reason,
      })),
      smusdCarried: BigInt(d.smusdCarried),
      smusdToTreasury: BigInt(d.smusdToTreasury),
      smusdOutcome: d.smusdOutcome,
      smusdFailingSince: d.smusdFailingSince ? Number(d.smusdFailingSince) : undefined,
    }),
  )
  return { items: items.reverse(), indexedTo: indexedTo(data) }
}

const CARRY_REASON: readonly CarryReason[] = ['VOTE_WINDOW_CLOSED', 'NO_VOTES']

/**
 * Distributions from the router's logs from `fromBlock`, oldest first: one scan of every FeeRouter event, joined by
 * transaction (Distributed with its BribePosted, BribeCarried and sMUSD-leg events), mapped as the subgraph does.
 */
async function distributionsFromLogs(
  client: PublicClient,
  fromBlock: bigint,
): Promise<Distribution[]> {
  const logs = await getAllEventsChunked(client, { address: ROUTER, abi: feeRouterAbi, fromBlock })
  const inTx = (tx: Hex) => logs.filter((l) => l.transactionHash === tx)
  return Promise.all(
    logs
      .filter((l) => l.eventName === 'Distributed')
      .map(async (l) => {
        const block = await client.getBlock({ blockNumber: l.blockNumber }).catch(() => null)
        const same = inTx(l.transactionHash)
        const bribes: Distribution['bribes'] = []
        const bribeCarries: Distribution['bribeCarries'] = []
        let smusdCarried = 0n
        let smusdToTreasury = 0n
        let outcome: SmusdOutcome = 'NONE'
        let failingSince: number | undefined
        for (const e of same) {
          if (e.eventName === 'BribePosted')
            bribes.push({ gauge: e.args.gauge, bribe: e.args.bribe, amount: e.args.amount })
          else if (e.eventName === 'BribeCarried')
            bribeCarries.push({
              gauge: e.args.gauge,
              amount: e.args.amount,
              reason: CARRY_REASON[e.args.reason] ?? 'NO_VOTES',
            })
          else if (e.eventName === 'SmusdYieldDeferred') {
            smusdCarried += e.args.amount
            outcome = 'DEFERRED'
          } else if (e.eventName === 'SmusdYieldFailed') {
            smusdCarried += e.args.amount
            outcome = 'FAILED'
            failingSince = Number(e.args.failingSince)
          } else if (e.eventName === 'SmusdShareToTreasury') {
            smusdToTreasury += e.args.amount
            outcome = 'TO_TREASURY'
            failingSince = Number(e.args.failingSince)
          }
        }
        const args = l.eventName === 'Distributed' ? l.args : undefined
        const toSmusd = args?.toSmusd ?? 0n
        if (outcome === 'NONE' && toSmusd > 0n) outcome = 'DONATED'
        return {
          tx: l.transactionHash,
          block: l.blockNumber,
          timestamp: block ? Number(block.timestamp) : undefined,
          caller: (args?.caller ?? ROUTER) as Address,
          epochStart: args?.epochStart ?? 0n,
          total: args?.total ?? 0n,
          toSmusd,
          toBribes: args?.toBribes ?? 0n,
          toTreasury: args?.toTreasury ?? 0n,
          retained: args?.retained ?? 0n,
          bribes,
          bribesCarried: bribeCarries.reduce((a, c) => a + c.amount, 0n),
          bribeCarries,
          smusdCarried,
          smusdToTreasury,
          smusdOutcome: outcome,
          smusdFailingSince: failingSince,
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
    blockNumber transactionHash status executableAt expiresAt
  }
  ${META}
}`

/** The subgraph's TimelockStatus (a PENDING submission past `expiresAt` has lapsed too). */
export type TimelockStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'INVALIDATED' | 'EXPIRED'

export interface FeeSwitchSubmission {
  tx: Hex
  block: bigint
  /** When the submission became executable (unix seconds). */
  executableAt: number
  /** Subgraph only: where the submission stands, and its last executable second. */
  status?: TimelockStatus
  expiresAt?: number
}

/** The latest fee-switch submission the subgraph indexed (zero or one item). */
async function feeSwitchFromSubgraph() {
  const data = await querySubgraph<{
    timelockSubmissions: {
      blockNumber: string
      transactionHash: Hex
      status: TimelockStatus
      executableAt: string
      expiresAt: string
    }[]
  }>(FEE_SWITCH_QUERY, {
    factory: FACTORY.toLowerCase(),
    data: FEE_SWITCH_CALL.toLowerCase(),
  })
  const items = data.timelockSubmissions.map(
    (s): FeeSwitchSubmission => ({
      tx: s.transactionHash,
      block: BigInt(s.blockNumber),
      executableAt: Number(s.executableAt),
      status: s.status,
      expiresAt: Number(s.expiresAt),
    }),
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
    .map((l) => ({
      tx: l.transactionHash,
      block: l.blockNumber,
      executableAt: Number(l.args.executableAt ?? 0n),
    }))
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
