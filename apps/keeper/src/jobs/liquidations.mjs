import { abi, events, PROFILE, VENUE } from '../abis.mjs'
import { alert } from '../alerts.mjs'
import { addressOf, pub, send } from '../chain.mjs'
import { LIMITS, registry, WAD } from '../config.mjs'
import { readings } from '../scheduler.mjs'
import { getKv, setKv } from '../store.mjs'

/** Every BorrowAccount clone, from the factory's AccountCreated logs (re-read from the deploy block on boot). */
export const accounts = new Map()
let cursor = BigInt(registry.deployBlock ?? 0)

export async function refreshAccounts() {
  const head = await pub.getBlockNumber()
  while (cursor <= head) {
    // biome-ignore lint/complexity/useMathMinMax: BigInt block numbers; Math.min does not accept bigint
    const toBlock = cursor + LIMITS.logChunk > head ? head : cursor + LIMITS.logChunk
    const logs = await pub.getLogs({
      address: registry.factory,
      event: events.accountCreated,
      fromBlock: cursor,
      toBlock,
    })
    for (const l of logs)
      accounts.set(l.args.account, { owner: l.args.owner, profile: Number(l.args.profile) })
    cursor = toBlock + 1n
  }
}

/**
 * Liquidates any M1 position above the LLTV through the FlashLiquidator (vAMM first, then the backstop). Canaries
 * are left for anyone to take for 6 h, or until their health falls below 0.98, so judges get the first shot.
 */
export async function liquidationsJob() {
  await refreshAccounts()
  const price = await pub.readContract({
    address: registry.oracle,
    abi: abi.oracle,
    functionName: 'price',
  })
  const lltv = BigInt(registry.lltv)
  const snapshot = []
  // One multicall per 200 accounts (2 reads each), so empty accounts created to slow the scan cost it almost nothing.
  const list = [...accounts]
  const reads = []
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const res = await pub.multicall({
      allowFailure: true,
      contracts: chunk.flatMap(([account]) => [
        { address: account, abi: abi.account, functionName: 'collateral' },
        { address: account, abi: abi.account, functionName: 'debt' },
      ]),
    })
    for (let j = 0; j < chunk.length; j++) {
      const [c, d] = [res[2 * j], res[2 * j + 1]]
      if (c.status === 'success' && d.status === 'success')
        reads.push([chunk[j], c.result, d.result])
    }
  }
  for (const [[account, meta], collateral, debt] of reads) {
    if (debt === 0n) continue
    const value = (collateral * price) / 10n ** 36n
    const maxBorrow = (value * lltv) / WAD
    const healthWad = (maxBorrow * WAD) / debt
    const ltvPct = value === 0n ? 999.99 : Number((debt * 10_000n) / value) / 100
    const canary = meta.profile === PROFILE.CANARY
    const liquidatable = debt > maxBorrow
    snapshot.push({ account, ltvPct, liquidatable, canary, health: Number(healthWad) / 1e18 })
    const sinceKey = `liquidatableSince:${account}`
    if (!liquidatable) {
      if (await getKv(sinceKey)) await setKv(sinceKey, '')
      continue
    }
    let since = Number(await getKv(sinceKey, '')) || 0
    if (!since) {
      since = Date.now()
      await setKv(sinceKey, since)
      await alert(
        `liquidatable:${account}`,
        `${canary ? 'canary' : 'position'} ${account} is liquidatable at ${ltvPct}% LTV`,
      )
    }
    if (
      canary &&
      Date.now() - since < LIMITS.canaryGraceS * 1000 &&
      healthWad >= LIMITS.canaryHealthFloorWad
    ) {
      continue
    }
    for (const venue of [VENUE.VAMM, VENUE.BACKSTOP]) {
      // Simulate first so the real call can demand 90% of the expected profit: a sandwich can't take the incentive.
      const request = {
        address: registry.flashLiquidator,
        abi: abi.liquidator,
        functionName: 'liquidate',
        args: [account, 0n, venue, 0n],
      }
      const quote = await pub
        .simulateContract({ ...request, account: addressOf('keeper') })
        .then((s) => s.result[2])
        .catch(() => null)
      if (quote === null) continue
      const sent = await send(
        'keeper',
        'liquidations',
        { ...request, args: [account, 0n, venue, (quote * 9n) / 10n] },
        { note: `${canary ? 'canary' : 'position'} ${account} at ${ltvPct}% LTV` },
      )
      if (sent?.receipt?.status === 'success') {
        await alert(
          `liquidated:${account}:${sent.receipt.transactionHash}`,
          `liquidated ${account} (${ltvPct}% LTV): ${sent.receipt.transactionHash}`,
        )
        break
      }
    }
  }
  readings.accounts = snapshot.sort((a, b) => b.ltvPct - a.ltvPct)
  return `${snapshot.length} open position${snapshot.length === 1 ? '' : 's'}, ${snapshot.filter((s) => s.liquidatable).length} liquidatable`
}
