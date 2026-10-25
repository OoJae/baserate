import { canSignPermit, erc20PermitAbi } from '@baserate/sdk'
import { useAccount, useBalance, useBytecode, useReadContract } from 'wagmi'
import { appChain, registry } from '../wagmi'

/** The connected wallet's BTC (native, via eth_getBalance) and MUSD balances, and whether it can sign permits. */
export function useWallet() {
  const { address, isConnected, chainId } = useAccount()
  const enabled = !!address

  const btc = useBalance({
    address,
    chainId: appChain.id,
    query: { enabled, refetchInterval: 15_000 },
  })
  const musd = useReadContract({
    address: registry.external.musd,
    abi: erc20PermitAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: appChain.id,
    query: { enabled, refetchInterval: 15_000 },
  })
  const code = useBytecode({
    address,
    chainId: appChain.id,
    query: { enabled, staleTime: 5 * 60_000 },
  })

  return {
    address,
    isConnected,
    walletChainId: chainId,
    onAppChain: chainId === appChain.id,
    btcBalance: btc.data?.value,
    musdBalance: musd.data,
    balancesLoading: enabled && (btc.isLoading || musd.isLoading),
    /** EOAs and EIP-7702 EOAs sign MUSD permits; Safes and smart accounts approve instead. */
    canPermit: code.isSuccess ? canSignPermit(code.data) : true,
    isContractWallet: code.isSuccess ? !canSignPermit(code.data) : false,
  }
}
