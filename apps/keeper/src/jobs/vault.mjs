import { formatUnits } from 'viem'
import { ACTION, abi } from '../abis.mjs'
import { pub, send } from '../chain.mjs'
import { LIMITS, registry } from '../config.mjs'
import { readings } from '../scheduler.mjs'
import { getKv, setKv } from '../store.mjs'

const nowS = () => Math.floor(Date.now() / 1000)

/** vMUSD's allocator: `rebalance()` when its preview has a move and the cooldown is over; `checkpoint()` hourly. */
export async function allocatorJob() {
  const [[action, amount], readyAt] = await Promise.all([
    pub.readContract({
      address: registry.allocator,
      abi: abi.allocator,
      functionName: 'previewRebalance',
    }),
    pub.readContract({ address: registry.allocator, abi: abi.allocator, functionName: 'readyAt' }),
  ])
  readings.allocator = {
    next: ACTION[action],
    amountMusd: formatUnits(amount, 18),
    readyAt: Number(readyAt),
  }
  let note = `next move ${ACTION[action]}${action ? ` ${formatUnits(amount, 18)} MUSD` : ''}`
  if (action !== 0 && nowS() >= Number(readyAt)) {
    const sent = await send(
      'keeper',
      'allocator',
      {
        address: registry.allocator,
        abi: abi.allocator,
        functionName: 'rebalance',
      },
      { note: `${ACTION[action]} ${formatUnits(amount, 18)} MUSD` },
    )
    if (sent?.receipt) note = `moved ${ACTION[action]} ${formatUnits(amount, 18)} MUSD`
  } else if (action !== 0) {
    note += `, cooling down until ${new Date(Number(readyAt) * 1000).toISOString()}`
  } else {
    // Idle MUSD in the vault earns nothing; rebalance() re-parks it in wsMUSD even during the cooldown (round-2
    // R2X-4). Simulated first: it reverts when there is nothing to park.
    const idle = await pub.readContract({
      address: registry.musd,
      abi: abi.erc20,
      functionName: 'balanceOf',
      args: [registry.vMusd],
    })
    if (idle >= 10n ** 18n) {
      const sent = await send(
        'keeper',
        'allocator',
        { address: registry.allocator, abi: abi.allocator, functionName: 'rebalance' },
        { note: `parked ${formatUnits(idle, 18)} idle MUSD` },
      )
      if (sent?.receipt) note = `parked ${formatUnits(idle, 18)} idle MUSD in wsMUSD`
    }
  }
  if (nowS() - Number(await getKv('allocator:lastCheckpoint', '0')) >= 3600) {
    const sent = await send(
      'keeper',
      'allocator',
      {
        address: registry.allocator,
        abi: abi.allocator,
        functionName: 'checkpoint',
      },
      { onlyIf: (recorded) => recorded === true },
    )
    if (sent) await setKv('allocator:lastCheckpoint', nowS())
  }
  return note
}

/** wsMUSD `sync()`: harvests sMUSD yield into the 3-day vesting when ≥ 0.01 MUSD is pending, or every 6 h. */
export async function wsmusdSyncJob() {
  const [pending, lastHarvest] = await Promise.all([
    pub.readContract({ address: registry.wsMusd, abi: abi.wsMusd, functionName: 'pendingYield' }),
    pub.readContract({ address: registry.wsMusd, abi: abi.wsMusd, functionName: 'lastHarvest' }),
  ])
  const gap = nowS() - Number(lastHarvest)
  if (pending < LIMITS.syncMinPending && gap < LIMITS.syncMaxGapS) {
    return `pending ${formatUnits(pending, 18)} MUSD, last harvest ${Math.round(gap / 60)} min ago`
  }
  const sent = await send(
    'keeper',
    'wsmusd.sync',
    {
      address: registry.wsMusd,
      abi: abi.wsMusd,
      functionName: 'sync',
    },
    { note: `pending ${formatUnits(pending, 18)} MUSD` },
  )
  return sent?.receipt
    ? `harvested ${formatUnits(sent.result ?? 0n, 18)} MUSD`
    : 'sync skipped (would revert)'
}
