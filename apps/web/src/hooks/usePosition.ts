import { borrowAccountAbi, borrowAccountFactoryAbi, erc20PermitAbi, Profile } from '@baserate/sdk'
import type { Address } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'
import { appChain, deployed, registry } from '../wagmi'

export interface PositionView {
  /** The owner's BorrowAccount (CREATE2-predicted even before it exists). */
  account: Address | undefined
  accountDeployed: boolean
  collateral: bigint
  /** Expected debt including accrued interest, rounded up (BorrowAccount.debt()). */
  debt: bigint
  /** MUSD the owner has approved to the account (approve path for contract wallets). */
  allowance: bigint
  hasPosition: boolean
  isLoading: boolean
}

export function usePosition(owner: Address | undefined): PositionView {
  const factory = registry.contracts.factory.address
  const acct = useReadContract({
    address: factory,
    abi: borrowAccountFactoryAbi,
    functionName: 'accountOf',
    args: owner ? [owner, Profile.STANDARD] : undefined,
    chainId: appChain.id,
    query: { enabled: deployed.factory && !!owner, refetchInterval: 30_000 },
  })
  const account = acct.data?.[0]
  const accountDeployed = acct.data?.[1] ?? false

  const pos = useReadContracts({
    contracts: account
      ? [
          { address: account, abi: borrowAccountAbi, functionName: 'collateral' },
          { address: account, abi: borrowAccountAbi, functionName: 'debt' },
          {
            address: registry.external.musd,
            abi: erc20PermitAbi,
            functionName: 'allowance',
            args: owner ? [owner, account] : undefined,
          },
        ]
      : [],
    allowFailure: false,
    query: { enabled: !!account && accountDeployed && !!owner, refetchInterval: 12_000 },
  })

  const collateral = (pos.data?.[0] as bigint | undefined) ?? 0n
  const debt = (pos.data?.[1] as bigint | undefined) ?? 0n
  const allowance = (pos.data?.[2] as bigint | undefined) ?? 0n

  return {
    account,
    accountDeployed,
    collateral,
    debt,
    allowance,
    hasPosition: accountDeployed && (collateral > 0n || debt > 0n),
    isLoading: acct.isLoading || pos.isLoading,
  }
}
