import { maxBig, wsMusdAbi } from '@baserate/sdk'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { usePosition } from '../hooks/usePosition'
import { useWallet } from '../hooks/useWallet'
import { useWsMusd } from '../hooks/useWsMusd'
import { META, querySubgraph, trySubgraph } from '../lib/subgraph'
import { appChain, deployed, registry } from '../wagmi'
import { IconCheck } from './icons'
import { Card, CardHeader, cx } from './ui'

/** Mezo RPCs serve eth_getLogs over at most 10,000 blocks (about ten hours of testnet blocks). */
const LOG_WINDOW = 9_999n

const WS_DEPOSIT_QUERY = `query WsMusdDeposit($vault: Bytes!, $owner: Bytes!) {
  vaultFlows(first: 1, where: { vault: $vault, owner: $owner, kind: DEPOSIT }) { id }
  ${META}
}`

/**
 * Whether `owner` deposited into wsMUSD: ever, per the subgraph when one is configured, otherwise (or when it has
 * not indexed one yet) within the last log window. Lets the walkthrough keep "Save" ticked after the judge redeems
 * everything (deposit → redeem is the guided flow).
 */
function useRecentWsDeposit(owner: Address | undefined, enabled: boolean) {
  const client = usePublicClient({ chainId: appChain.id })
  return useQuery({
    queryKey: ['baserate-recent-ws-deposit', appChain.id, owner],
    enabled: enabled && !!owner && !!client && deployed.wsMusd,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      if (!client || !owner) return false
      const indexed = await trySubgraph(async () => {
        const data = await querySubgraph<{ vaultFlows: { id: string }[] }>(WS_DEPOSIT_QUERY, {
          vault: registry.contracts.wsMusd.address.toLowerCase(),
          owner: owner.toLowerCase(),
        })
        return data.vaultFlows.length > 0
      })
      if (indexed) return true
      const head = await client.getBlockNumber()
      const logs = await client.getContractEvents({
        address: registry.contracts.wsMusd.address,
        abi: wsMusdAbi,
        eventName: 'Deposit',
        args: { owner },
        fromBlock: maxBig(head - LOG_WINDOW, BigInt(registry.contracts.wsMusd.block)),
        toBlock: head,
      })
      return logs.length > 0
    },
  })
}

/** The judge walkthrough, derived purely from on-chain state. */
export function Checklist() {
  const wallet = useWallet()
  const position = usePosition(wallet.address)
  const ws = useWsMusd(wallet.address)
  const holdsWs = (ws.shares ?? 0n) > 0n
  const recentDeposit = useRecentWsDeposit(wallet.address, ws.shares === 0n)
  if (!wallet.isConnected) return null

  const steps: { label: string; done: boolean; detail: ReactNode }[] = [
    {
      label: 'Get test BTC',
      done: (wallet.btcBalance ?? 0n) > 0n || position.collateral > 0n,
      detail: 'From the Mezo faucet',
    },
    {
      label: 'Borrow MUSD',
      done: position.debt > 0n || (position.accountDeployed && !position.hasPosition),
      detail: 'One transaction, BTC as value',
    },
    {
      label: 'Save in wsMUSD',
      done: holdsWs || recentDeposit.data === true,
      detail: 'Deposit with a permit',
    },
    {
      label: 'Repay & withdraw',
      done: position.accountDeployed && !position.hasPosition,
      detail: 'Native BTC back',
    },
  ]
  const done = steps.filter((s) => s.done).length

  return (
    <Card aria-labelledby="checklist-title">
      <CardHeader
        id="checklist-title"
        title="Your walkthrough"
        subtitle={`${done} of ${steps.length} done · read from chain state`}
      />
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className={cx(
                'num inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium',
                s.done
                  ? 'bg-good text-on-good shadow-[0_0_0_2px_var(--surface),0_0_0_3px_var(--good)]'
                  : 'border border-line-strong text-muted',
              )}
            >
              {s.done ? <IconCheck className="size-3.5" /> : i + 1}
              <span className="sr-only">{s.done ? 'done' : 'to do'}</span>
            </span>
            <span className="min-w-0 text-sm">
              <span className={cx('font-medium', s.done ? 'text-muted line-through' : 'text-ink')}>
                {s.label}
              </span>
              <span className="block text-xs text-muted">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
