import { erc20PermitAbi, smusdAbi, WAD, wsMusdAbi } from '@baserate/sdk'
import { type Address, zeroAddress } from 'viem'
import { useBlock, useReadContracts } from 'wagmi'
import { appChain, deployed, registry } from '../wagmi'

export interface WsMusdView {
  totalAssets?: bigint
  totalSupply?: bigint
  /** convertToAssets(1e18) */
  sharePrice?: bigint
  depositCap?: bigint
  maxDeposit?: bigint
  pendingYield?: bigint
  vesting?: { stored: bigint; unvested: bigint; lastSync: bigint; periodEnd: bigint }
  pendingCap?: bigint
  pendingCapAt?: bigint
  smusdHeld?: bigint
  shares?: bigint
  maxRedeem?: bigint
  /** MUSD value of the user's shares (previewRedeem). */
  sharesValue?: bigint
  allowance?: bigint
  /** Deploy block timestamp, for the since-inception APY. */
  deployedAt?: bigint
  isLoading: boolean
}

export function useWsMusd(owner: Address | undefined): WsMusdView {
  const ws = registry.contracts.wsMusd.address
  const user = owner ?? zeroAddress

  const pool = useReadContracts({
    contracts: [
      { address: ws, abi: wsMusdAbi, functionName: 'totalAssets' },
      { address: ws, abi: wsMusdAbi, functionName: 'totalSupply' },
      { address: ws, abi: wsMusdAbi, functionName: 'convertToAssets', args: [WAD] },
      { address: ws, abi: wsMusdAbi, functionName: 'depositCap' },
      { address: ws, abi: wsMusdAbi, functionName: 'maxDeposit', args: [user] },
      { address: ws, abi: wsMusdAbi, functionName: 'pendingYield' },
      { address: ws, abi: wsMusdAbi, functionName: 'vestingState' },
      { address: ws, abi: wsMusdAbi, functionName: 'pendingCap' },
      { address: ws, abi: wsMusdAbi, functionName: 'pendingCapAt' },
      { address: registry.external.smusd, abi: smusdAbi, functionName: 'balanceOf', args: [ws] },
    ],
    allowFailure: true,
    query: { enabled: deployed.wsMusd, refetchInterval: 15_000 },
  })

  const mine = useReadContracts({
    contracts: [
      { address: ws, abi: wsMusdAbi, functionName: 'balanceOf', args: [user] },
      { address: ws, abi: wsMusdAbi, functionName: 'maxRedeem', args: [user] },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'allowance',
        args: [user, ws],
      },
    ],
    allowFailure: true,
    query: { enabled: deployed.wsMusd && !!owner, refetchInterval: 15_000 },
  })

  const shares = mine.data?.[0]?.status === 'success' ? mine.data[0].result : undefined

  const preview = useReadContracts({
    contracts: [
      { address: ws, abi: wsMusdAbi, functionName: 'previewRedeem', args: [shares ?? 0n] },
    ],
    allowFailure: true,
    query: { enabled: deployed.wsMusd && shares !== undefined, refetchInterval: 15_000 },
  })

  const deployBlock = registry.contracts.wsMusd.block
  const block = useBlock({
    blockNumber: BigInt(deployBlock),
    chainId: appChain.id,
    query: { enabled: deployed.wsMusd && deployBlock > 0, staleTime: Number.POSITIVE_INFINITY },
  })

  const r = <T>(x: { status: 'success'; result: T } | { status: 'failure' } | undefined) =>
    x?.status === 'success' ? x.result : undefined
  const p = pool.data
  const vesting = r(p?.[6])

  return {
    totalAssets: r(p?.[0]),
    totalSupply: r(p?.[1]),
    sharePrice: r(p?.[2]),
    depositCap: r(p?.[3]),
    maxDeposit: r(p?.[4]),
    pendingYield: r(p?.[5]),
    vesting: vesting
      ? {
          stored: vesting[0],
          unvested: vesting[1],
          lastSync: BigInt(vesting[2]),
          periodEnd: BigInt(vesting[3]),
        }
      : undefined,
    pendingCap: r(p?.[7]),
    pendingCapAt: r(p?.[8]),
    smusdHeld: r(p?.[9]),
    shares,
    maxRedeem: r(mine.data?.[1]),
    allowance: r(mine.data?.[2]),
    sharesValue: r(preview.data?.[0]),
    deployedAt: block.data?.timestamp,
    isLoading: pool.isLoading,
  }
}
