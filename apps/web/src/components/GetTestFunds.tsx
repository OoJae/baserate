import { formatBtc, formatMusd, musdDispenserAbi, shortAddress } from '@baserate/sdk'
import { useWatchAsset } from 'wagmi'
import { useDispenser } from '../hooks/useDispenser'
import { useWallet } from '../hooks/useWallet'
import { appChain, registry } from '../wagmi'
import { IconDrop } from './icons'
import { TxButton } from './TxButton'
import { Badge, Button, Card, CardHeader, CopyButton, ExternalLink, Skeleton } from './ui'

const FAUCET_URL = 'https://faucet.test.mezo.org'

/** Dispenser claim, reused by the funds card and the repay shortfall. */
export function DispenserClaim({ compact }: { compact?: boolean }) {
  const { address } = useWallet()
  const d = useDispenser(address)

  if (!d.available) {
    return (
      <p className="text-sm text-muted">
        The MUSD dispenser goes live with the testnet deployment. Until then, swap a little faucet
        BTC for MUSD on Mezo’s testnet pools.
      </p>
    )
  }
  if (d.voucherMode) {
    return (
      <p className="text-sm text-muted">
        The dispenser is in voucher mode. Claims need a signed voucher, which arrives with the next
        release.
      </p>
    )
  }
  const claimable = d.claimable ?? 0n
  // Rounded to 10 minutes so the pre-simulation key stays stable between renders.
  const deadline = BigInt(Math.floor(Date.now() / 600_000) * 600 + 3_600)
  return (
    <div className="space-y-2">
      {!compact ? (
        <p className="num text-sm text-muted">
          Up to {d.perAddressDaily !== undefined ? formatMusd(d.perAddressDaily) : '…'} MUSD per
          address per day
          {d.balance !== undefined ? ` · ${formatMusd(d.balance)} MUSD left in the dispenser` : ''}.
        </p>
      ) : null}
      <TxButton
        variant={compact ? 'primary' : 'secondary'}
        size="md"
        label={
          claimable > 0n ? `Claim ${formatMusd(claimable)} test MUSD` : 'Nothing to claim today'
        }
        request={
          address && claimable > 0n
            ? {
                address: registry.contracts.dispenser.address,
                abi: musdDispenserAbi,
                functionName: 'claim',
                args: [claimable, deadline, '0x'],
              }
            : undefined
        }
        disabledReason={
          address && d.claimable !== undefined && claimable === 0n
            ? 'You have claimed today’s allowance. It resets at 00:00 UTC.'
            : null
        }
        pendingTitle="Claiming test MUSD"
        successTitle="Test MUSD claimed"
      />
    </div>
  )
}

export function GetTestFunds() {
  const { address, btcBalance, musdBalance, isConnected } = useWallet()
  const watch = useWatchAsset()

  return (
    <Card aria-labelledby="funds-title">
      <CardHeader
        id="funds-title"
        icon={<IconDrop className="size-4" />}
        title="Get test funds"
        subtitle="Testnet only. Test tokens have no value."
      />

      {isConnected && address ? (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-[3px] border border-line bg-raised/60 p-3">
          <div>
            <p className="serial text-[10px] text-muted">Wallet BTC</p>
            <p className="num mt-1 font-semibold text-btc">
              {btcBalance === undefined ? <Skeleton /> : formatBtc(btcBalance)}
            </p>
          </div>
          <div>
            <p className="serial text-[10px] text-muted">Wallet MUSD</p>
            <p className="num mt-1 font-semibold text-ink">
              {musdBalance === undefined ? <Skeleton /> : formatMusd(musdBalance)}
            </p>
          </div>
        </div>
      ) : null}

      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Take test BTC from the Mezo faucet</p>
            <p className="mt-0.5 text-sm text-muted">
              0.001 BTC per IP per day. Paste your address there.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {address ? (
                <span className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface pl-2.5 text-sm">
                  <span className="num font-mono text-xs tracking-[0.02em]">
                    {shortAddress(address, 6)}
                  </span>
                  <CopyButton value={address} label="Copy your address" />
                </span>
              ) : null}
              <ExternalLink href={FAUCET_URL} className="text-sm">
                faucet.test.mezo.org
              </ExternalLink>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-sm font-semibold text-ink">Claim test MUSD</p>
            <DispenserClaim />
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Show MUSD in your wallet</p>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 mt-1"
              disabled={!isConnected || watch.isPending}
              onClick={() =>
                watch.watchAsset({
                  type: 'ERC20',
                  options: { address: registry.external.musd, symbol: 'MUSD', decimals: 18 },
                })
              }
            >
              {watch.isSuccess ? 'MUSD added' : 'Add MUSD to wallet'}
            </Button>
            {!isConnected ? <p className="text-xs text-muted">Connect a wallet first.</p> : null}
          </div>
        </li>
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Network: <Badge>{appChain.name}</Badge> · chain id {appChain.id}
      </p>
    </Card>
  )
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="num mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand/50 bg-brand-soft font-mono text-[11px] font-medium text-brand"
    >
      {n}
    </span>
  )
}
