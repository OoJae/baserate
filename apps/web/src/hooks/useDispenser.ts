import { erc20PermitAbi, musdDispenserAbi } from '@baserate/sdk'
import { type Address, zeroAddress } from 'viem'
import { useReadContracts } from 'wagmi'
import { deployed, registry } from '../wagmi'

export interface DispenserView {
  available: boolean
  claimable?: bigint
  perAddressDaily?: bigint
  globalDaily?: bigint
  /** Non-zero signer means voucher mode (Wave 2): claims need a server signature. */
  voucherMode: boolean
  balance?: bigint
  isLoading: boolean
}

export function useDispenser(owner: Address | undefined): DispenserView {
  const d = registry.contracts.dispenser.address
  const q = useReadContracts({
    contracts: [
      {
        address: d,
        abi: musdDispenserAbi,
        functionName: 'claimable',
        args: [owner ?? zeroAddress],
      },
      { address: d, abi: musdDispenserAbi, functionName: 'perAddressDaily' },
      { address: d, abi: musdDispenserAbi, functionName: 'globalDaily' },
      { address: d, abi: musdDispenserAbi, functionName: 'signer' },
      {
        address: registry.external.musd,
        abi: erc20PermitAbi,
        functionName: 'balanceOf',
        args: [d],
      },
    ],
    allowFailure: true,
    query: { enabled: deployed.dispenser, refetchInterval: 20_000 },
  })
  const [claimable, perAddress, global, signer, balance] = q.data ?? []
  const ok = <T>(x: { status: 'success'; result: T } | { status: 'failure' } | undefined) =>
    x?.status === 'success' ? x.result : undefined
  const signerAddr = ok(signer)
  return {
    available: deployed.dispenser,
    claimable: owner ? ok(claimable) : undefined,
    perAddressDaily: ok(perAddress),
    globalDaily: ok(global),
    voucherMode: !!signerAddr && signerAddr !== zeroAddress,
    balance: ok(balance),
    isLoading: q.isLoading,
  }
}
