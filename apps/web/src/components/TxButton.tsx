import { type DecodedError, decodeBaserateError, explorerTxUrl, hasExplorer } from '@baserate/sdk'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import type { Abi, Address, StateOverride, TransactionReceipt } from 'viem'
import { useAccount, useConfig, usePublicClient, useSwitchChain } from 'wagmi'
import { waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { appChain } from '../wagmi'
import { IconAlert } from './icons'
import { useToast } from './Toaster'
import { Button, cx, Spinner } from './ui'

export interface TxRequest {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

export interface TxButtonProps {
  /** Button text in the idle state. */
  label: ReactNode
  /** The call, simulated continuously before the wallet ever opens. `undefined` disables the button. */
  request?: TxRequest
  /** State overrides for the live pre-simulation only, e.g. the allowance a permit will grant. */
  preflightOverride?: StateOverride
  /** Runs on click before the final simulation (e.g. sign a permit) and returns the request to send. */
  prepare?: (ctx: { account: Address }) => Promise<TxRequest>
  /** When set, the button is disabled and this text explains why. */
  disabledReason?: string | null
  /** Toast title while pending / after confirmation. */
  pendingTitle?: string
  successTitle?: string
  successMessage?: (receipt: TransactionReceipt) => string
  onConfirmed?: (receipt: TransactionReceipt) => void
  variant?: 'primary' | 'secondary'
  size?: 'md' | 'lg'
  className?: string
  /** Pins the button to the bottom of the viewport on small screens. */
  sticky?: boolean
}

type Phase = 'idle' | 'preparing' | 'simulating' | 'confirm' | 'pending'

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  preparing: 'Sign the permit in your wallet…',
  simulating: 'Checking the transaction…',
  confirm: 'Confirm in your wallet…',
  pending: 'Waiting for confirmation…',
}

/** Kinds of preflight failure that mean "this will revert": block the button until inputs change. */
const BLOCKING: DecodedError['kind'][] = ['contract', 'revert', 'panic', 'funds']

/** gas = estimate × 1.3 */
export function withGasHeadroom(estimate: bigint): bigint {
  return (estimate * 13n) / 10n
}

/**
 * Simulate → estimate gas × 1.3 → write → toast with explorer link → wait for the receipt.
 * The decoded revert reason shows under the button before the wallet opens.
 */
export function TxButton({
  label,
  request,
  preflightOverride,
  prepare,
  disabledReason,
  pendingTitle,
  successTitle,
  successMessage,
  onConfirmed,
  variant = 'primary',
  size = 'lg',
  className,
  sticky,
}: TxButtonProps) {
  const { address, isConnected, chainId } = useAccount()
  const config = useConfig()
  const publicClient = usePublicClient({ chainId: appChain.id })
  const queryClient = useQueryClient()
  const toast = useToast()
  const { openConnectModal } = useConnectModal()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [phase, setPhase] = useState<Phase>('idle')
  const [runError, setRunError] = useState<DecodedError | null>(null)

  const onAppChain = chainId === appChain.id
  const canPreflight =
    !!request && !!address && !!publicClient && onAppChain && !disabledReason && phase === 'idle'

  const preflight = useQuery({
    queryKey: [
      'baserate-preflight',
      appChain.id,
      address,
      request?.address,
      request?.functionName,
      request?.args,
      request?.value,
      preflightOverride,
    ],
    enabled: canPreflight,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!request || !address || !publicClient) return true
      await publicClient.simulateContract({
        ...request,
        account: address,
        stateOverride: preflightOverride,
      } as never)
      return true
    },
  })

  const preflightError =
    canPreflight && preflight.error ? decodeBaserateError(preflight.error) : null
  const blocked = !!preflightError && BLOCKING.includes(preflightError.kind)
  const busy = phase !== 'idle'

  async function run() {
    if (!address || !publicClient || !request) return
    setRunError(null)
    let toastId: string | undefined
    try {
      let req: TxRequest = request
      if (prepare) {
        setPhase('preparing')
        req = await prepare({ account: address })
      }
      setPhase('simulating')
      await publicClient.simulateContract({ ...req, account: address } as never)
      const estimate = await publicClient.estimateContractGas({ ...req, account: address } as never)
      setPhase('confirm')
      const hash = await writeContract(config, {
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
        value: req.value,
        gas: withGasHeadroom(estimate),
        account: address,
        chainId: appChain.id,
      } as never)
      setPhase('pending')
      toastId = toast.push({
        id: hash,
        tone: 'pending',
        title: pendingTitle ?? 'Transaction submitted',
        message: 'Waiting for the next Mezo block…',
        href: hasExplorer(appChain.id) ? explorerTxUrl(appChain.id, hash) : undefined,
      })
      const receipt = await waitForTransactionReceipt(config, {
        hash,
        chainId: appChain.id,
        timeout: 180_000,
        // Mezo makes a block every ~4s; viem's default 4s poll could hold the spinner up to two blocks late.
        pollingInterval: 1_000,
      })
      if (receipt.status === 'success') {
        toast.update(hash, {
          tone: 'success',
          title: successTitle ?? 'Confirmed',
          message: successMessage?.(receipt) ?? `Included in block ${receipt.blockNumber}.`,
        })
        onConfirmed?.(receipt)
      } else {
        toast.update(hash, {
          tone: 'error',
          title: 'Transaction reverted',
          message: 'It was mined but reverted, so nothing changed except the gas spent.',
        })
      }
      await queryClient.invalidateQueries()
    } catch (e) {
      const decoded = decodeBaserateError(e)
      setRunError(decoded.kind === 'rejected' ? null : decoded)
      if (toastId) {
        toast.update(toastId, { tone: 'error', title: decoded.title, message: decoded.message })
      } else if (decoded.kind === 'rejected') {
        toast.push({ tone: 'info', title: 'Cancelled', message: decoded.message })
      } else {
        toast.push({ tone: 'error', title: decoded.title, message: decoded.message })
      }
    } finally {
      setPhase('idle')
    }
  }

  let content: ReactNode
  let onClick: (() => void) | undefined
  let disabled = false

  if (!isConnected) {
    content = 'Connect wallet'
    onClick = openConnectModal
  } else if (!onAppChain) {
    content = switching ? 'Switching…' : `Switch to ${appChain.name}`
    onClick = () => switchChain({ chainId: appChain.id })
    disabled = switching
  } else if (busy) {
    content = (
      <>
        <Spinner />
        {PHASE_LABEL[phase as Exclude<Phase, 'idle'>]}
      </>
    )
    disabled = true
  } else {
    content = label
    onClick = () => void run()
    disabled = !request || !!disabledReason || blocked
  }

  const shownError = runError ?? preflightError
  const checking = canPreflight && preflight.isFetching && !preflight.data && !preflight.error

  return (
    <div
      className={cx(
        sticky &&
          'sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-surface/95 px-1 pt-2 pb-1 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none',
        className,
      )}
    >
      <Button
        variant={variant}
        size={size}
        className="w-full"
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy || undefined}
      >
        {content}
      </Button>
      {isConnected && onAppChain && !busy ? (
        disabledReason ? (
          <p className="mt-2 text-center text-xs text-muted">{disabledReason}</p>
        ) : shownError ? (
          <div
            role="alert"
            className="mt-2 flex gap-2 rounded-lg bg-bad-soft p-2.5 text-xs text-ink"
          >
            <IconAlert className="mt-px size-4 shrink-0 text-bad" />
            <p>
              <span className="font-semibold text-bad">{shownError.title}. </span>
              {shownError.message}
            </p>
          </div>
        ) : checking ? (
          <p className="mt-2 text-center text-xs text-muted">Simulating on Mezo…</p>
        ) : null
      ) : null}
    </div>
  )
}
