import { formatUnits, maxUint256 } from 'viem'
import { abi, VENUE } from '../abis.mjs'
import { addressOf, pub, send } from '../chain.mjs'
import { IS_TESTNET, LIMITS, registry } from '../config.mjs'
import { readings } from '../scheduler.mjs'
import { getKv, hasIdem, setKv } from '../store.mjs'

const nowS = () => Math.floor(Date.now() / 1000)
const YEAR_S = 365n * 24n * 3600n

/**
 * Testnet only: simulates Mezo Earn yield on sMUSD at a labelled ~1% APR by donating MUSD through
 * `receiveProtocolYield`. The donation spreads over all sMUSD (≈890k), so it is capped at a daily budget.
 */
export async function yieldSimJob() {
  if (!IS_TESTNET) return 'testnet only'
  const sim = addressOf('sim')
  const supply = await pub.readContract({
    address: registry.smusd,
    abi: abi.smusd,
    functionName: 'totalSupply',
  })
  const last = Number(await getKv('sim:last', String(nowS() - 3600)))
  const dt = BigInt(Math.min(Math.max(nowS() - last, 0), 6 * 3600))
  let amount = (supply * LIMITS.yieldSimAprBps * dt) / (10_000n * YEAR_S)
  const day = new Date().toISOString().slice(0, 10)
  const spent = BigInt(await getKv(`sim:spent:${day}`, '0'))
  if (spent + amount > LIMITS.yieldSimDailyBudget) amount = LIMITS.yieldSimDailyBudget - spent
  if (amount <= 0n)
    return `daily budget of ${formatUnits(LIMITS.yieldSimDailyBudget, 18)} MUSD reached`
  if ((amount * 10n ** 18n) / supply === 0n) return 'amount too small to move the yield index'
  const balance = await pub.readContract({
    address: registry.musd,
    abi: abi.erc20,
    functionName: 'balanceOf',
    args: [sim],
  })
  if (balance < amount)
    return `SIM key holds ${formatUnits(balance, 18)} MUSD, needs ${formatUnits(amount, 18)}`
  const allowance = await pub.readContract({
    address: registry.musd,
    abi: abi.erc20,
    functionName: 'allowance',
    args: [sim, registry.smusd],
  })
  if (allowance < amount) {
    await send('sim', 'yield.sim', {
      address: registry.musd,
      abi: abi.erc20,
      functionName: 'approve',
      args: [registry.smusd, maxUint256],
    })
  }
  const hour = new Date().toISOString().slice(0, 13)
  const sent = await send(
    'sim',
    'yield.sim',
    {
      address: registry.smusd,
      abi: abi.smusd,
      functionName: 'receiveProtocolYield',
      args: [amount],
    },
    {
      idemKey: `sim:${hour}`,
      note: `${formatUnits(amount, 18)} MUSD at ${Number(LIMITS.yieldSimAprBps) / 100}% APR (simulated)`,
    },
  )
  if (!sent?.receipt) return 'donation skipped (would revert)'
  await setKv('sim:last', nowS())
  await setKv(`sim:spent:${day}`, (spent + amount).toString())
  return `donated ${formatUnits(amount, 18)} MUSD (simulated ${Number(LIMITS.yieldSimAprBps) / 100}% APR)`
}

/**
 * Backstop upkeep, all permissionless: sells BTC inventory on the vAMM when that beats the auction floor (the contract
 * enforces it) and recognises vested gains daily. Matured exits are left to their owners: claiming someone else's exit
 * at a temporary NAV dip would lock in their loss (round-1 audit note).
 */
export async function backstopJob() {
  const b = registry.backstop
  const notes = []
  const [inventory, maxSale] = await Promise.all([
    pub.readContract({ address: b, abi: abi.backstop, functionName: 'inventory' }),
    pub.readContract({ address: b, abi: abi.backstop, functionName: 'MAX_KEEPER_SALE' }),
  ])
  readings.backstop = { inventoryBtc: formatUnits(inventory, 18) }
  if (inventory > 0n) {
    const btcIn = inventory < maxSale ? inventory : maxSale
    const quote = await pub
      .simulateContract({
        address: b,
        abi: abi.backstop,
        functionName: 'sellInventory',
        args: [btcIn, VENUE.VAMM, 0n],
        account: addressOf('keeper'),
      })
      .then((s) => s.result)
      .catch(() => 0n)
    if (quote > 0n) {
      const sent = await send(
        'keeper',
        'backstop',
        {
          address: b,
          abi: abi.backstop,
          functionName: 'sellInventory',
          args: [btcIn, VENUE.VAMM, (quote * 995n) / 1000n],
        },
        { note: `sold ${formatUnits(btcIn, 18)} BTC of inventory` },
      )
      if (sent?.receipt) notes.push(`sold ${formatUnits(btcIn, 18)} BTC`)
    }
  }
  if (nowS() - Number(await getKv('backstop:lastSync', '0')) >= 24 * 3600) {
    const sent = await send('keeper', 'backstop', {
      address: b,
      abi: abi.backstop,
      functionName: 'sync',
    })
    if (sent?.receipt) await setKv('backstop:lastSync', nowS())
  }
  return notes.length ? notes.join(', ') : `inventory ${formatUnits(inventory, 18)} BTC`
}

/**
 * FeeRouter `distribute()` once per Mezo Earn epoch, from Thursday 01:05 UTC (so the bribe pays this epoch's voters
 * and stands for the whole vote), never in the epoch's last hour. "Once" is the keeper's own record: a bribe someone
 * else posted (even 1 wei) does not stop it (round-2 R2X-7), and the router itself carries bribes it can't post.
 */
export async function feeFlushJob() {
  const now = nowS()
  const epochStart = now - (now % LIMITS.epochS)
  const intoEpoch = now - epochStart
  const balance = await pub.readContract({
    address: registry.musd,
    abi: abi.erc20,
    functionName: 'balanceOf',
    args: [registry.feeRouter],
  })
  readings.fees = { routerMusd: formatUnits(balance, 18), epochStart }
  if (intoEpoch < LIMITS.feeFlushAfterEpochS) return 'waiting for Thursday 01:05 UTC'
  if (intoEpoch >= LIMITS.epochS - 3600) return "last hour of the epoch: next epoch's flush"
  if (balance < LIMITS.feeMinMusd)
    return `router holds ${formatUnits(balance, 18)} MUSD (min ${formatUnits(LIMITS.feeMinMusd, 18)})`
  const idemKey = `flush:${epochStart}`
  if (await hasIdem(idemKey)) return 'already flushed this epoch'
  const sent = await send(
    'keeper',
    'fees',
    {
      address: registry.feeRouter,
      abi: abi.feeRouter,
      functionName: 'distribute',
    },
    {
      idemKey,
      note: `${formatUnits(balance, 18)} MUSD for epoch ${new Date(epochStart * 1000).toISOString().slice(0, 10)}`,
    },
  )
  return sent?.receipt
    ? `distributed ${formatUnits(balance, 18)} MUSD`
    : 'distribute skipped (would revert)'
}
