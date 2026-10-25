import type { ReactNode } from 'react'
import { usePosition } from '../hooks/usePosition'
import { useWallet } from '../hooks/useWallet'
import { useWsMusd } from '../hooks/useWsMusd'
import { IconCheck } from './icons'
import { Card, CardHeader, cx } from './ui'

/** The judge walkthrough, derived purely from on-chain state. */
export function Checklist() {
  const wallet = useWallet()
  const position = usePosition(wallet.address)
  const ws = useWsMusd(wallet.address)
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
    { label: 'Save in wsMUSD', done: (ws.shares ?? 0n) > 0n, detail: 'Deposit with a permit' },
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
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className={cx(
                'num inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                s.done ? 'bg-good text-white' : 'border border-line-strong text-muted',
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
