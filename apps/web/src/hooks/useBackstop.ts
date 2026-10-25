import { backstopAbi, erc20PermitAbi, WAD } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import { type Address, zeroAddress } from 'viem'
import { usePublicClient, useReadContracts } from 'wagmi'
import { getEventsChunked } from '../lib/logs'
import { appChain, deployed, registry } from '../wagmi'

const BACKSTOP = registry.contracts.backstop.address

export interface BackstopView {
  totalAssets?: bigint
  totalSupply?: bigint
  /** NAV: convertToAssets(1e18), MUSD per bMUSD. */
  sharePrice?: bigint
  cash?: bigint
  availableCash?: bigint
  /** Cash plus inventory marked at oracle × 0.95. */
  grossAssets?: bigint
  inventory?: bigint
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
 * backstop holds BTC, so this batch stays far under Mezo's per-call precompile limit.
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
  shares: bigint
  assets: bigint
  claimableAt: number
  receiver: Address
  /** False once claimed (the contract zeroes the request). */
  pending: boolean
}

/** The owner's backstop exit requests (RedeemRequested logs), with their live state. */
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
      const logs = await getEventsChunked(client, {
        address: BACKSTOP,
        abi: backstopAbi,
        eventName: 'RedeemRequested',
        args: { owner },
        fromBlock: BigInt(registry.contracts.backstop.block),
      })
      if (logs.length === 0) return []
      // Typed loosely: the full backstop ABI makes multicall's inference too deep for TypeScript.
      const live = (await client.multicall({
        contracts: logs.map((l) => ({
          address: BACKSTOP,
          abi: backstopAbi,
          functionName: 'redeemRequest',
          args: [l.args.id ?? 0n],
        })) as never,
        allowFailure: false,
      })) as unknown as { shares: bigint }[]
      return logs
        .map((l, i) => {
          const req = live[i] ?? { shares: 0n }
          return {
            id: l.args.id ?? 0n,
            shares: l.args.shares ?? 0n,
            assets: l.args.assets ?? 0n,
            claimableAt: Number(l.args.claimableAt ?? 0n),
            receiver: (l.args.receiver ?? owner) as Address,
            pending: req.shares > 0n,
          }
        })
        .reverse()
    },
  })
}
