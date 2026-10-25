import {
  type AllocatorActionId,
  baserateAllocatorAbi,
  erc20PermitAbi,
  vaultAdapterCapId,
  vaultCollateralCapId,
  vaultDepositRoom,
  vaultMarketCapId,
  vaultV2Abi,
  WAD,
  wsMusdLiquidityAdapterAbi,
} from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import { type Address, type Hex, type PublicClient, zeroAddress } from 'viem'
import { usePublicClient, useReadContracts } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { indexedTo, META, querySubgraph, readHistory } from '../lib/subgraph'
import { appChain, deployed, registry } from '../wagmi'

const VAULT = registry.contracts.vMusd.address
const ALLOCATOR = registry.contracts.allocator.address
const WS_ADAPTER = registry.contracts.wsMusdAdapter.address
const M1_ADAPTER = registry.contracts.m1Adapter.address

/** Vault V2 cap ids vMUSD uses: the wsMUSD adapter's, and the three a M1 allocation touches. */
export const VAULT_IDS = {
  liquidity: vaultAdapterCapId(WS_ADAPTER),
  m1Adapter: vaultAdapterCapId(M1_ADAPTER),
  collateral: vaultCollateralCapId(registry.contracts.collateral.address),
  m1Market: vaultMarketCapId(M1_ADAPTER, registry.markets.M1.params),
} as const

export interface CapView {
  absolute: bigint
  relative: bigint
  allocation: bigint
}

export interface AllocatorSnapshot {
  m1SupplyAssets: bigint
  m1BorrowAssets: bigint
  m1Liquidity: bigint
  bufferTarget: bigint
  m1SupplyApy: bigint
  wsMusdApy: bigint
  apyWindow: bigint
  vaultMarketAssets: bigint
  vaultIdle: bigint
  liquidityAvailable: bigint
}

export interface VaultView {
  totalAssets?: bigint
  totalSupply?: bigint
  /** convertToAssets(1e18): MUSD per vMUSD. */
  sharePrice?: bigint
  snapshot?: AllocatorSnapshot
  preview?: { action: AllocatorActionId; amount: bigint }
  /** Earliest next rebalance (unix seconds; 0 = now). */
  readyAt?: bigint
  lastRebalance?: bigint
  /** wsMUSD adapter: wsMUSD value + idle MUSD it holds for the vault. */
  heldAssets?: bigint
  /** MUSD the adapter can release now. */
  availableLiquidity?: bigint
  adapterIdle?: bigint
  caps?: { liquidity: CapView; m1Adapter: CapView; collateral: CapView; m1Market: CapView }
  performanceFee?: bigint
  managementFee?: bigint
  liquidityAdapter?: Address
  /** MUSD a deposit can take now (Vault V2's maxDeposit is always 0). */
  depositRoom?: bigint
  /** The user's vMUSD shares, their MUSD value, and approvals. */
  shares?: bigint
  sharesValue?: bigint
  musdAllowance?: bigint
  allocatorAllowance?: bigint
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

export function useVault(owner: Address | undefined): VaultView {
  const user = owner ?? zeroAddress
  const v = { address: VAULT, abi: vaultV2Abi } as const
  const a = { address: ALLOCATOR, abi: baserateAllocatorAbi } as const
  const w = { address: WS_ADAPTER, abi: wsMusdLiquidityAdapterAbi } as const
  const cap = (id: `0x${string}`) =>
    [
      { ...v, functionName: 'absoluteCap', args: [id] },
      { ...v, functionName: 'relativeCap', args: [id] },
      { ...v, functionName: 'allocation', args: [id] },
    ] as const

  const pool = useReadContracts({
    contracts: [
      { ...v, functionName: 'totalAssets' },
      { ...v, functionName: 'totalSupply' },
      { ...v, functionName: 'convertToAssets', args: [WAD] },
      { ...a, functionName: 'snapshot' },
      { ...a, functionName: 'previewRebalance' },
      { ...a, functionName: 'readyAt' },
      { ...a, functionName: 'lastRebalance' },
      { ...w, functionName: 'heldAssets' },
      { ...w, functionName: 'availableLiquidity' },
      { ...w, functionName: 'idle' },
      { ...v, functionName: 'performanceFee' },
      { ...v, functionName: 'managementFee' },
      { ...v, functionName: 'liquidityAdapter' },
      ...cap(VAULT_IDS.liquidity),
      ...cap(VAULT_IDS.m1Adapter),
      ...cap(VAULT_IDS.collateral),
      ...cap(VAULT_IDS.m1Market),
    ],
    allowFailure: true,
    query: { enabled: deployed.vault, refetchInterval: 15_000 },
  })

  const mine = useReadContracts({
    contracts: [
      { ...v, functionName: 'balanceOf', args: [user] },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'allowance',
        args: [user, VAULT],
      },
      { ...v, functionName: 'allowance', args: [user, ALLOCATOR] },
    ],
    allowFailure: true,
    query: { enabled: deployed.vault && !!owner, refetchInterval: 15_000 },
  })
  const r = <T>(x: { status: 'success'; result: T } | { status: 'failure' } | undefined) =>
    x?.status === 'success' ? x.result : undefined
  const shares = r(mine.data?.[0])

  const value = useReadContracts({
    contracts: [{ ...v, functionName: 'previewRedeem', args: [shares ?? 0n] }],
    allowFailure: true,
    query: { enabled: deployed.vault && shares !== undefined, refetchInterval: 15_000 },
  })

  const p = pool.data
  /** A bigint result by index (the cap reads share one shape, so the per-index union does not matter). */
  const big = (i: number): bigint | undefined => {
    const x = p?.[i] as { status: string; result?: unknown } | undefined
    return x?.status === 'success' && typeof x.result === 'bigint' ? x.result : undefined
  }
  const capAt = (i: number): CapView | undefined => {
    const absolute = big(i)
    const relative = big(i + 1)
    const allocation = big(i + 2)
    return absolute !== undefined && relative !== undefined && allocation !== undefined
      ? { absolute, relative, allocation }
      : undefined
  }
  const caps = {
    liquidity: capAt(13),
    m1Adapter: capAt(16),
    collateral: capAt(19),
    m1Market: capAt(22),
  }
  const preview = r(p?.[4])
  const heldAssets = r(p?.[7])
  const totalAssets = r(p?.[0])

  return {
    totalAssets,
    totalSupply: r(p?.[1]),
    sharePrice: r(p?.[2]),
    snapshot: r(p?.[3]),
    preview: preview ? { action: preview[0] as AllocatorActionId, amount: preview[1] } : undefined,
    readyAt: r(p?.[5]),
    lastRebalance: r(p?.[6]),
    heldAssets,
    availableLiquidity: r(p?.[8]),
    adapterIdle: r(p?.[9]),
    performanceFee: r(p?.[10]),
    managementFee: r(p?.[11]),
    liquidityAdapter: r(p?.[12]),
    caps:
      caps.liquidity && caps.m1Adapter && caps.collateral && caps.m1Market
        ? {
            liquidity: caps.liquidity,
            m1Adapter: caps.m1Adapter,
            collateral: caps.collateral,
            m1Market: caps.m1Market,
          }
        : undefined,
    depositRoom:
      caps.liquidity && heldAssets !== undefined && totalAssets !== undefined
        ? vaultDepositRoom({
            absoluteCap: caps.liquidity.absolute,
            relativeCap: caps.liquidity.relative,
            heldAssets,
            totalAssets,
          })
        : undefined,
    shares,
    sharesValue: r(value.data?.[0]),
    musdAllowance: r(mine.data?.[1]),
    allocatorAllowance: r(mine.data?.[2]),
    isLoading: deployed.vault && pool.isLoading,
    isError: pool.isError || (!!p && p.slice(0, 5).some((x) => x.status === 'failure')),
    refetch: () => void pool.refetch(),
  }
}

export interface AllocatorMove {
  action: AllocatorActionId
  amount: bigint
  m1SupplyApy: bigint
  wsMusdApy: bigint
  block: bigint
  tx: `0x${string}`
  timestamp?: number
}

const MOVES_QUERY = `query AllocatorMoves($limit: Int!) {
  rebalances(first: $limit, orderBy: blockNumber, orderDirection: desc, where: { actionId_gt: 0 }) {
    actionId amount m1SupplyApy wsMusdApy blockNumber timestamp transactionHash
  }
  ${META}
}`

interface RebalanceRow {
  actionId: number
  amount: string
  m1SupplyApy: string
  wsMusdApy: string
  blockNumber: string
  timestamp: string
  transactionHash: Hex
}

/** The last `limit` moves the subgraph indexed, oldest first. */
async function movesFromSubgraph(limit: number) {
  const data = await querySubgraph<{ rebalances: RebalanceRow[] }>(MOVES_QUERY, { limit })
  const items = data.rebalances.map(
    (r): AllocatorMove => ({
      action: r.actionId as AllocatorActionId,
      amount: BigInt(r.amount),
      m1SupplyApy: BigInt(r.m1SupplyApy),
      wsMusdApy: BigInt(r.wsMusdApy),
      block: BigInt(r.blockNumber),
      tx: r.transactionHash,
      timestamp: Number(r.timestamp),
    }),
  )
  return { items: items.reverse(), indexedTo: indexedTo(data) }
}

/** The last `limit` moves in Rebalanced logs from `fromBlock`, oldest first, with their block timestamps. */
async function movesFromLogs(
  client: PublicClient,
  fromBlock: bigint,
  limit: number,
): Promise<AllocatorMove[]> {
  const logs = await getEventsChunked(client, {
    address: ALLOCATOR,
    abi: baserateAllocatorAbi,
    eventName: 'Rebalanced',
    fromBlock,
  })
  const moves = logs.filter((l) => Number(l.args.action) !== 0).slice(-limit)
  return Promise.all(
    moves.map(async (l) => {
      const block = await client.getBlock({ blockNumber: l.blockNumber }).catch(() => null)
      return {
        action: Number(l.args.action) as AllocatorActionId,
        amount: l.args.amount ?? 0n,
        m1SupplyApy: l.args.m1SupplyApy ?? 0n,
        wsMusdApy: l.args.wsMusdApy ?? 0n,
        block: l.blockNumber,
        tx: l.transactionHash,
        timestamp: block ? Number(block.timestamp) : undefined,
      }
    }),
  )
}

/**
 * The allocator's last fund moves (Rebalanced events with an action), newest first: from the subgraph when one is
 * configured (plus the blocks it has not indexed yet), otherwise from logs.
 */
export function useAllocatorMoves(limit = 3) {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-allocator-moves', appChain.id, limit],
    enabled: deployed.vault && !!client,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
    queryFn: async (): Promise<AllocatorMove[]> => {
      if (!client) return []
      const moves = await readHistory({
        subgraph: () => movesFromSubgraph(limit),
        logs: (fromBlock) => movesFromLogs(client, fromBlock, limit),
        startBlock: BigInt(registry.contracts.allocator.block),
      })
      return moves.slice(-limit).reverse()
    },
  })
}
