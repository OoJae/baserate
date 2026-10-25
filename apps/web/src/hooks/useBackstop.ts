import { backstopAbi, erc20PermitAbi, WAD } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import { type Address, getAddress, type PublicClient, zeroAddress } from 'viem'
import { usePublicClient, useReadContracts } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { indexedTo, META, querySubgraph, readHistory } from '../lib/subgraph'
import { appChain, deployed, registry } from '../wagmi'

const BACKSTOP = registry.contracts.backstop.address

export interface BackstopView {
  totalAssets?: bigint
  totalSupply?: bigint
  /** NAV: convertToAssets(1e18), MUSD per bMUSD. */
  sharePrice?: bigint
  cash?: bigint
  availableCash?: bigint
  /**
   * Cash plus inventory marked at oracle × 0.95 (inventory counts 0 while the oracle is down or below
   * `DUST_INVENTORY`). Deposits are priced at this value (book + unvested gains), not at `totalAssets`.
   */
  grossAssets?: bigint
  inventory?: bigint
  /** `DUST_INVENTORY`: BTC inventory below this counts as 0 in NAV and needs no oracle. */
  dustInventory?: bigint
  auctionFactor?: bigint
  auctionStart?: bigint
  reservedAssets?: bigint
  depositsPaused?: boolean
  vesting?: { book: bigint; unvested: bigint; lastSync: bigint; periodEnd: bigint }
  discount?: bigint
  redeemDelay?: bigint
  /** MUSD to buy the whole inventory from the auction now. */
  auctionQuote?: bigint
  shares?: bigint
  sharesValue?: bigint
  musdAllowance?: bigint
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

/**
 * Backstop reads. NAV, gross assets and the auction quote read the oracle (one Skip call each) only while the
 * backstop holds at least `DUST_INVENTORY` of BTC, so this batch stays far under Mezo's per-call precompile limit.
 */
export function useBackstop(owner: Address | undefined): BackstopView {
  const b = { address: BACKSTOP, abi: backstopAbi } as const
  const user = owner ?? zeroAddress
  const pool = useReadContracts({
    contracts: [
      { ...b, functionName: 'totalAssets' },
      { ...b, functionName: 'totalSupply' },
      { ...b, functionName: 'convertToAssets', args: [WAD] },
      { ...b, functionName: 'cash' },
      { ...b, functionName: 'availableCash' },
      { ...b, functionName: 'grossAssets' },
      { ...b, functionName: 'inventory' },
      { ...b, functionName: 'auctionFactor' },
      { ...b, functionName: 'auctionStart' },
      { ...b, functionName: 'reservedAssets' },
      { ...b, functionName: 'depositsPaused' },
      { ...b, functionName: 'vestingState' },
      { ...b, functionName: 'DISCOUNT' },
      { ...b, functionName: 'REDEEM_DELAY' },
      { ...b, functionName: 'DUST_INVENTORY' },
    ],
    allowFailure: true,
    query: { enabled: deployed.backstop, refetchInterval: 20_000 },
  })
  const r = <T>(x: { status: 'success'; result: T } | { status: 'failure' } | undefined) =>
    x?.status === 'success' ? x.result : undefined
  const p = pool.data
  const inventory = r(p?.[6])

  const auction = useReadContracts({
    contracts: [{ ...b, functionName: 'quoteAuction', args: [inventory ?? 0n] }],
    allowFailure: true,
    query: { enabled: deployed.backstop && !!inventory && inventory > 0n, refetchInterval: 20_000 },
  })

  const mine = useReadContracts({
    contracts: [
      { ...b, functionName: 'balanceOf', args: [user] },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'allowance',
        args: [user, BACKSTOP],
      },
    ],
    allowFailure: true,
    query: { enabled: deployed.backstop && !!owner, refetchInterval: 15_000 },
  })
  const shares = r(mine.data?.[0])
  const value = useReadContracts({
    contracts: [{ ...b, functionName: 'convertToAssets', args: [shares ?? 0n] }],
    allowFailure: true,
    query: { enabled: deployed.backstop && shares !== undefined, refetchInterval: 20_000 },
  })

  const vesting = r(p?.[11])
  return {
    totalAssets: r(p?.[0]),
    totalSupply: r(p?.[1]),
    sharePrice: r(p?.[2]),
    cash: r(p?.[3]),
    availableCash: r(p?.[4]),
    grossAssets: r(p?.[5]),
    inventory,
    dustInventory: r(p?.[14]),
    auctionFactor: r(p?.[7]),
    auctionStart: r(p?.[8]),
    reservedAssets: r(p?.[9]),
    depositsPaused: r(p?.[10]),
    vesting: vesting
      ? {
          book: vesting[0],
          unvested: vesting[1],
          lastSync: BigInt(vesting[2]),
          periodEnd: BigInt(vesting[3]),
        }
      : undefined,
    discount: r(p?.[12]),
    redeemDelay: r(p?.[13]),
    auctionQuote: r(auction.data?.[0]),
    shares,
    sharesValue: r(value.data?.[0]),
    musdAllowance: r(mine.data?.[1]),
    isLoading: deployed.backstop && pool.isLoading,
    isError: pool.isError || (!!p && p.slice(0, 3).some((x) => x.status === 'failure')),
    refetch: () => void pool.refetch(),
  }
}

export interface RedeemRequestView {
  id: bigint
  /** Escrowed shares still queued (live: a partial claim burns part of them). */
  shares: bigint
  /** NAV of `shares` at request (live): the most the rest of this exit can pay. */
  assets: bigint
  /** Shares escrowed by the original request. */
  requestedShares: bigint
  claimableAt: number
  receiver: Address
  /** False once fully claimed (the contract zeroes the request). */
  pending: boolean
  /** A claim paid part of it from the cash there was; the rest stays queued (`RedeemPartiallyClaimed`). */
  partlyPaid: boolean
  /** For a partly paid exit: MUSD paid so far and in how many claims (when known). */
  paidAssets?: bigint
  claimCount?: number
}

/** The subgraph's RedeemStatus. */
type RedeemStatus = 'PENDING' | 'PARTIALLY_CLAIMED' | 'CLAIMED'

/** A RedeemRequested record (shares and assets as requested), before its live state is read. */
interface QueuedRequest {
  id: bigint
  shares: bigint
  assets: bigint
  claimableAt: number
  receiver: Address
  /** Subgraph only: fully claimed (final, so its live state need not be read). */
  closed?: boolean
  paidAssets?: bigint
  claimCount?: number
}

const REQUESTS_QUERY = `query RedeemRequests($owner: Bytes!) {
  redeemRequests(first: 1000, orderBy: requestId, orderDirection: asc, where: { owner: $owner }) {
    requestId shares assets claimableAt receiver status sharesLeft assetsLeft paidAssets claimCount
  }
  ${META}
}`

interface RequestRow {
  requestId: string
  shares: string
  assets: string
  claimableAt: string
  receiver: string
  status: RedeemStatus
  sharesLeft: string
  assetsLeft: string
  paidAssets: string
  claimCount: number
}

/** The owner's requests the subgraph indexed, oldest first. */
async function requestsFromSubgraph(owner: Address) {
  const data = await querySubgraph<{ redeemRequests: RequestRow[] }>(REQUESTS_QUERY, {
    owner: owner.toLowerCase(),
  })
  const items = data.redeemRequests.map(
    (r): QueuedRequest => ({
      id: BigInt(r.requestId),
      shares: BigInt(r.shares),
      assets: BigInt(r.assets),
      claimableAt: Number(r.claimableAt),
      receiver: getAddress(r.receiver),
      closed: r.status === 'CLAIMED',
      paidAssets: BigInt(r.paidAssets),
      claimCount: r.claimCount,
    }),
  )
  return { items, indexedTo: indexedTo(data) }
}

/** The owner's RedeemRequested logs from `fromBlock`, oldest first. */
async function requestsFromLogs(
  client: PublicClient,
  owner: Address,
  fromBlock: bigint,
): Promise<QueuedRequest[]> {
  const logs = await getEventsChunked(client, {
    address: BACKSTOP,
    abi: backstopAbi,
    eventName: 'RedeemRequested',
    args: { owner },
    fromBlock,
  })
  return logs.map((l) => ({
    id: l.args.id ?? 0n,
    shares: l.args.shares ?? 0n,
    assets: l.args.assets ?? 0n,
    claimableAt: Number(l.args.claimableAt ?? 0n),
    receiver: (l.args.receiver ?? owner) as Address,
  }))
}

/** MUSD paid so far and the number of payments per request, from RedeemClaimed logs of `ids`. */
async function paymentsFromLogs(client: PublicClient, ids: bigint[]) {
  const logs = await getEventsChunked(client, {
    address: BACKSTOP,
    abi: backstopAbi,
    eventName: 'RedeemClaimed',
    args: { id: ids },
    fromBlock: BigInt(registry.contracts.backstop.block),
  })
  const paid = new Map<bigint, { assets: bigint; count: number }>()
  for (const l of logs) {
    const id = l.args.id ?? 0n
    const p = paid.get(id) ?? { assets: 0n, count: 0 }
    paid.set(id, { assets: p.assets + (l.args.assets ?? 0n), count: p.count + 1 })
  }
  return paid
}

/**
 * The owner's backstop exit requests, newest first, with their live state (`redeemRequest(id)` by multicall): a
 * partial claim leaves the request queued with fewer shares and assets, so what is still owed comes from the live
 * read (the subgraph's sharesLeft/assetsLeft can trail it by a few blocks). The list comes from the subgraph when one
 * is configured (plus the blocks it has not indexed yet), otherwise from RedeemRequested logs; requests the subgraph
 * reports fully claimed are final and skip the live read. What a partly paid exit has paid so far comes from the
 * subgraph, or from RedeemClaimed logs for the requests that need it.
 */
export function useRedeemRequests(owner: Address | undefined) {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-backstop-requests', appChain.id, owner],
    enabled: deployed.backstop && !!owner && !!client,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 2,
    queryFn: async (): Promise<RedeemRequestView[]> => {
      if (!client || !owner) return []
      const requests = await readHistory({
        subgraph: () => requestsFromSubgraph(owner),
        logs: (fromBlock) => requestsFromLogs(client, owner, fromBlock),
        startBlock: BigInt(registry.contracts.backstop.block),
      })
      const open = requests.filter((r) => !r.closed)
      if (open.length === 0) return []
      // Typed loosely: the full backstop ABI makes multicall's inference too deep for TypeScript.
      const live = (await client.multicall({
        contracts: open.map((r) => ({
          address: BACKSTOP,
          abi: backstopAbi,
          functionName: 'redeemRequest',
          args: [r.id],
        })) as never,
        allowFailure: false,
      })) as unknown as { shares: bigint; assets: bigint }[]
      const views = open.map((r, i): RedeemRequestView => {
        const now = live[i] ?? { shares: 0n, assets: 0n }
        const pending = now.shares > 0n
        return {
          id: r.id,
          requestedShares: r.shares,
          shares: pending ? now.shares : r.shares,
          assets: pending ? now.assets : r.assets,
          claimableAt: r.claimableAt,
          receiver: r.receiver,
          pending,
          partlyPaid: pending && now.shares < r.shares,
          paidAssets: r.paidAssets,
          claimCount: r.claimCount,
        }
      })
      // Partly paid exits the subgraph has not reported payments for (log path or a lagging index).
      const unknown = views.filter((v) => v.partlyPaid && !v.paidAssets)
      if (unknown.length > 0) {
        const paid = await paymentsFromLogs(
          client,
          unknown.map((v) => v.id),
        ).catch(() => undefined)
        for (const v of unknown) {
          const p = paid?.get(v.id)
          if (p) {
            v.paidAssets = p.assets
            v.claimCount = p.count
          }
        }
      }
      return views.reverse()
    },
  })
}
