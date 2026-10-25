import {
  encodeAbiParameters,
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  parseEther,
} from 'viem'
import { abi, EIP1967_IMPL_SLOT, PROFILE, VENUE } from '../abis.mjs'
import { alert } from '../alerts.mjs'
import { addressOf, hasRole, pub, send, signers } from '../chain.mjs'
import { IS_MAINNET, LIMITS, registry, SWITCHES } from '../config.mjs'
import { readings } from '../scheduler.mjs'
import { addDepthSample, depthMin24h, getKv, setKv } from '../store.mjs'

const nowS = () => Math.floor(Date.now() / 1000)
const E36 = 10n ** 36n

/**
 * Keeps the CANARY key's canary just under the LLTV (target LLTV − 0.25 point): borrows more as BTC rises, and
 * reopens it 30 min after it has been liquidated, so a liquidation can always be exercised on real state.
 */
export async function canaryJob() {
  const op = addressOf('canary')
  const isOperator = await pub.readContract({
    address: registry.factory,
    abi: abi.factory,
    functionName: 'isCanaryOperator',
    args: [op],
  })
  if (!isOperator) return `${op} is not a canary operator`
  const [account, deployed] = await pub.readContract({
    address: registry.factory,
    abi: abi.factory,
    functionName: 'accountOf',
    args: [op, PROFILE.CANARY],
  })
  const price = await pub.readContract({
    address: registry.oracle,
    abi: abi.oracle,
    functionName: 'price',
  })
  const target = LIMITS.canaryTargetBps
  const [collateral, debt] = deployed
    ? await Promise.all([
        pub.readContract({ address: account, abi: abi.account, functionName: 'collateral' }),
        pub.readContract({ address: account, abi: abi.account, functionName: 'debt' }),
      ])
    : [0n, 0n]
  readings.canary = {
    account,
    deployed,
    collateralBtc: formatEther(collateral),
    debtMusd: formatUnits(debt, 18),
  }

  if (collateral === 0n) {
    const emptySince = Number(await getKv('canary:emptySince', '0')) || nowS()
    await setKv('canary:emptySince', emptySince)
    if (nowS() - emptySince < LIMITS.canaryReopenAfterS) return 'liquidated: reopening 30 min after'
    // Borrow so LTV lands 3 bps under the target after the 10 bps origination fee.
    const value = (LIMITS.canaryCollateralWei * price) / E36
    const musdOut = (value * (target - 3n) * 1000n) / (10_000n * 1001n)
    const sent = await send(
      'canary',
      'canary',
      {
        address: registry.factory,
        abi: abi.factory,
        functionName: 'openCanary',
        args: [musdOut, target],
        value: LIMITS.canaryCollateralWei,
      },
      { note: `opened at ~${Number(target) / 100}% LTV` },
    )
    if (sent?.receipt) await setKv('canary:emptySince', '')
    return sent?.receipt
      ? `opened canary with ${formatEther(LIMITS.canaryCollateralWei)} BTC`
      : 'openCanary skipped'
  }
  await setKv('canary:emptySince', '')
  const value = (collateral * price) / E36
  const ltvBps = (debt * 10_000n) / value
  if (ltvBps + LIMITS.canaryTopUpGapBps >= target)
    return `at ${Number(ltvBps) / 100}% LTV (target ${Number(target) / 100}%)`
  const targetDebt = (value * (target - 3n)) / 10_000n
  const musdOut = ((targetDebt - debt) * 1000n) / 1001n
  if (musdOut <= 0n) return `at ${Number(ltvBps) / 100}% LTV`
  const sent = await send(
    'canary',
    'canary',
    {
      address: account,
      abi: abi.account,
      functionName: 'borrow',
      args: [musdOut, target, op],
    },
    { note: `topped up from ${Number(ltvBps) / 100}% LTV` },
  )
  return sent?.receipt
    ? `borrowed ${formatUnits(musdOut, 18)} MUSD back to ~${Number(target) / 100}%`
    : 'top-up skipped'
}

/**
 * Liquidation depth vs the borrow cap. Depth = largest BTC sale whose best venue price is within 4% of the oracle.
 * cap = min(2 × free backstop cash, free backstop cash + 24 h minimum depth), never above the proof-mode ceiling. On
 * mainnet a lower cap is applied at once with the sentinel role (decrease-only); a higher one is an alert for the
 * Safe (48 h timelock). Testnet runs fixed labelled caps, so it is a dry run there.
 */
export async function capsDepthJob() {
  const price = await pub.readContract({
    address: registry.oracle,
    abi: abi.oracle,
    functionName: 'price',
  })
  let depthBtc = 0n
  for (const size of LIMITS.depthSizesBtc) {
    const btc = parseEther(size)
    const { result } = await pub.simulateContract({
      address: registry.flashLiquidator,
      abi: abi.liquidator,
      functionName: 'quoteVenues',
      args: [btc],
      account: addressOf('keeper'),
    })
    const [oracleValue, proceeds] = result
    const best =
      proceeds[VENUE.VAMM] > proceeds[VENUE.CL200] ? proceeds[VENUE.VAMM] : proceeds[VENUE.CL200]
    if (oracleValue === 0n || (oracleValue - best) * 10_000n > oracleValue * LIMITS.depthImpactBps)
      break
    depthBtc = btc
  }
  const depthMusd = (depthBtc * price) / E36
  const free = await pub.readContract({
    address: registry.backstop,
    abi: abi.backstop,
    functionName: 'availableCash',
  })
  await addDepthSample({
    depthBtc: formatEther(depthBtc),
    depthMusd: formatUnits(depthMusd, 18),
    freeBackstopMusd: formatUnits(free, 18),
  })
  const minDepth = parseEther(
    ((await depthMin24h()) ?? Number(formatUnits(depthMusd, 18))).toFixed(6),
  )
  let cap = 2n * free < free + minDepth ? 2n * free : free + minDepth
  if (cap > LIMITS.capCeiling) cap = LIMITS.capCeiling
  const current = await pub.readContract({
    address: registry.factory,
    abi: abi.factory,
    functionName: 'globalBorrowCap',
  })
  readings.capsDepth = {
    depthBtc: formatEther(depthBtc),
    depthMusd: formatUnits(depthMusd, 18),
    minDepth24hMusd: formatUnits(minDepth, 18),
    freeBackstopMusd: formatUnits(free, 18),
    recommendedCapMusd: formatUnits(cap, 18),
    currentCapMusd: formatUnits(current, 18),
    live: SWITCHES.capsDepthLive,
  }
  if (!SWITCHES.capsDepthLive) {
    return `dry run (testnet uses fixed labelled caps): depth ${formatEther(depthBtc)} BTC, would cap at ${formatUnits(cap, 18)} MUSD vs ${formatUnits(current, 18)}`
  }
  if (cap < current && hasRole('sentinel')) {
    const sent = await send(
      'sentinel',
      'caps.depth',
      {
        address: registry.factory,
        abi: abi.factory,
        functionName: 'setGlobalBorrowCap',
        args: [cap],
      },
      { idemKey: `capcut:${cap}`, note: `depth ${formatEther(depthBtc)} BTC` },
    )
    if (sent?.receipt)
      await alert(
        `capcut:${cap}`,
        `cut the global borrow cap to ${formatUnits(cap, 18)} MUSD (depth ${formatEther(depthBtc)} BTC)`,
      )
    return `cap cut to ${formatUnits(cap, 18)} MUSD`
  }
  if (cap > current)
    await alert(
      'cap:raise',
      `depth supports a cap of ${formatUnits(cap, 18)} MUSD (now ${formatUnits(current, 18)}): the Safe can queue a raise`,
    )
  return `cap ${formatUnits(current, 18)} MUSD within depth`
}

/**
 * Watches sMUSD for an upgrade or rewiring: its EIP-1967 implementation, strategy, pcv and vaultGauge against the
 * pins for this chain. On a change it alerts and (mainnet, or SMUSD_WATCH_CUT=on) freezes vMUSD's wsMUSD exposure by
 * cutting the liquidity adapter's cap to its current allocation with the vault sentinel role.
 */
export async function smusdWatchJob() {
  const pins = registry.smusdPins
  const smusd = registry.smusd
  const slot = await pub.getStorageAt({ address: smusd, slot: EIP1967_IMPL_SLOT })
  const read = (fn) =>
    pub.readContract({ address: smusd, abi: abi.smusd, functionName: fn }).catch(() => null)
  const now = {
    implementation: slot ? getAddress(`0x${slot.slice(-40)}`) : null,
    strategy: await read('strategy'),
    pcv: await read('pcv'),
    vaultGauge: await read('vaultGauge'),
  }
  const changed = Object.entries(now).filter(
    ([k, v]) => v && pins[k] && getAddress(v) !== getAddress(pins[k]),
  )
  readings.smusdWatch = { ...now, pinned: pins, ok: changed.length === 0 }
  if (changed.length === 0) return 'sMUSD matches its pins'
  const what = changed.map(([k, v]) => `${k} → ${v}`).join(', ')
  await alert(`smusd:${what}`, `sMUSD changed: ${what}`)
  if (!SWITCHES.smusdWatchCut || !hasRole('sentinel')) return `changed (${what}); alert only`
  const idData = encodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    ['this', registry.wsMusdAdapter],
  )
  const id = keccak256(idData)
  const [cap, allocation] = await Promise.all([
    pub.readContract({
      address: registry.vMusd,
      abi: abi.vault,
      functionName: 'absoluteCap',
      args: [id],
    }),
    pub.readContract({
      address: registry.vMusd,
      abi: abi.vault,
      functionName: 'allocation',
      args: [id],
    }),
  ])
  if (cap <= allocation) return `changed (${what}); wsMUSD cap already frozen`
  const sent = await send(
    'sentinel',
    'smusd.watch',
    {
      address: registry.vMusd,
      abi: abi.vault,
      functionName: 'decreaseAbsoluteCap',
      args: [idData, allocation],
    },
    { idemKey: `smusd:${what}`, note: `sMUSD changed: ${what}` },
  )
  if (sent?.receipt)
    await alert(
      `smusd-cut:${what}`,
      `froze vMUSD's wsMUSD cap at ${formatUnits(allocation, 18)} MUSD`,
    )
  return `changed (${what}); wsMUSD cap frozen`
}

/** Oracle freshness, key balances and the dispenser's float. */
export async function healthJob() {
  const s = await pub.readContract({
    address: registry.oracle,
    abi: abi.oracle,
    functionName: 'status',
  })
  readings.oracle = {
    ok: s.ok,
    skipAgeS: Number(s.skipAge),
    pythBtcAgeS: Number(s.pythBtcAge),
    musdAgeS: Number(s.musdAge),
    deviationBps: Number(s.deviationBps),
  }
  if (!s.ok || Number(s.skipAge) > LIMITS.oracleMaxAgeS) {
    await alert('oracle', `oracle ${s.ok ? 'stale' : 'not ok'}: Skip ${Number(s.skipAge)} s old`)
  }
  const balances = {}
  for (const [role, sgn] of Object.entries(signers)) {
    const wei = await pub.getBalance({ address: sgn.account.address })
    balances[role] = { address: sgn.account.address, btc: formatEther(wei) }
    if (wei < LIMITS.lowGasWei)
      await alert(
        `gas:${role}`,
        `${role} key ${sgn.account.address} is low on gas: ${formatEther(wei)} BTC`,
      )
  }
  if (registry.dispenser) {
    const musd = await pub.readContract({
      address: registry.musd,
      abi: abi.erc20,
      functionName: 'balanceOf',
      args: [registry.dispenser],
    })
    balances.dispenser = { address: registry.dispenser, musd: formatUnits(musd, 18) }
    if (!IS_MAINNET && musd < LIMITS.lowDispenserMusd)
      await alert('dispenser', `dispenser is low: ${formatUnits(musd, 18)} MUSD`)
  }
  readings.balances = balances
  return `oracle ${s.ok ? 'ok' : 'NOT OK'}, Skip ${Number(s.skipAge)} s old`
}
