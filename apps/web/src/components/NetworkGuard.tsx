import { useQuery } from '@tanstack/react-query'
import { hexToBigInt } from 'viem'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { appChain } from '../wagmi'
import { Button, Notice } from './ui'

/** A wallet more than this many blocks behind our RPC is treated as stale. */
const MAX_WALLET_LAG = 30n

/** Our public RPC's head; a failure means the (single) testnet RPC is down. */
export function useChainHead() {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-head', appChain.id],
    enabled: !!client,
    refetchInterval: 12_000,
    retry: 1,
    queryFn: async () => {
      if (!client) throw new Error('no client')
      return client.getBlockNumber({ cacheTime: 0 })
    },
  })
}

/**
 * Wrong network → one-click switch (wallet_switchEthereumChain, falling back to wallet_addEthereumChain with our
 * first RPC). Stale wallet RPC → explain how to fix it. Our RPC down → banner.
 */
export function NetworkGuard() {
  const { isConnected, chainId, connector, chain } = useAccount()
  const { switchChain, isPending, error: switchError } = useSwitchChain()
  const head = useChainHead()
  const onAppChain = chainId === appChain.id

  const walletHead = useQuery({
    queryKey: ['baserate-wallet-head', connector?.uid, chainId],
    enabled: isConnected && onAppChain && !!connector,
    refetchInterval: 20_000,
    retry: false,
    queryFn: async () => {
      const provider = (await connector?.getProvider()) as
        | { request: (a: { method: string }) => Promise<string> }
        | undefined
      if (!provider?.request) throw new Error('no provider')
      return hexToBigInt((await provider.request({ method: 'eth_blockNumber' })) as `0x${string}`)
    },
  })

  const rpcUrl = appChain.rpcUrls.default.http[0]
  const lag =
    head.data !== undefined && walletHead.data !== undefined ? head.data - walletHead.data : 0n
  const wrongChain = isConnected && !onAppChain
  const staleWallet = isConnected && onAppChain && (walletHead.isError || lag > MAX_WALLET_LAG)
  if (!head.isError && !wrongChain && !staleWallet) return null

  return (
    <div className="space-y-2">
      {head.isError ? (
        <Notice tone="bad" title="The Mezo testnet RPC is not responding">
          Live data may be out of date. Baserate reads from {rpcUrl}; it will reconnect on its own.
        </Notice>
      ) : null}

      {wrongChain ? (
        <Notice
          tone="warn"
          title={`Your wallet is on ${chain?.name ?? `chain ${chainId}`}`}
          action={
            <Button
              size="sm"
              onClick={() => switchChain({ chainId: appChain.id })}
              disabled={isPending}
            >
              {isPending ? 'Switching…' : `Switch to ${appChain.name}`}
            </Button>
          }
        >
          Baserate runs on {appChain.name} (chain id {appChain.id}). Switching adds the network with
          RPC <span className="font-mono text-xs">{rpcUrl}</span> if your wallet does not have it.
          {switchError ? (
            <span className="mt-1 block text-bad">
              Your wallet refused the switch. Add the network manually: chain id {appChain.id},
              currency BTC, RPC {rpcUrl}.
            </span>
          ) : null}
        </Notice>
      ) : null}

      {staleWallet ? (
        <Notice tone="warn" title="Your wallet’s Mezo RPC looks stale">
          {walletHead.isError
            ? 'Your wallet could not report the latest block.'
            : `Your wallet is ${lag.toString()} blocks behind the network.`}{' '}
          Transactions may fail or show old balances. In your wallet’s network settings, edit{' '}
          {appChain.name} and set the RPC URL to <span className="font-mono text-xs">{rpcUrl}</span>
          .
        </Notice>
      ) : null}
    </div>
  )
}
