import { abi } from '../abis.mjs'
import { pub, send } from '../chain.mjs'
import { env, LIMITS, registry } from '../config.mjs'
import { readings } from '../scheduler.mjs'

const HERMES = env('PYTH_HERMES_URL', 'https://hermes.pyth.network')
/** Hermes has required an API key (sent as a Bearer token) since Pyth's Core upgrade in August 2026. */
export const PYTH_API_KEY = env('PYTH_API_KEY')

const nowS = () => Math.floor(Date.now() / 1000)

/** The latest signed BTC/USD update from Hermes, as `updatePriceFeeds` data. */
async function latestUpdate() {
  const res = await fetch(
    `${HERMES}/v2/updates/price/latest?ids[]=${registry.pythBtcUsdFeed}&encoding=hex`,
    { headers: { Authorization: `Bearer ${PYTH_API_KEY}` }, signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) throw new Error(`Hermes answered ${res.status}`)
  const body = await res.json()
  return {
    data: body.binary.data.map((d) => `0x${d}`),
    publishTime: Number(body.parsed[0].price.publish_time),
  }
}

/**
 * Pushes the latest Pyth BTC/USD print when the stored one is older than `maxAgeS` (round-3 R3E-3 and R3F-C). The
 * oracle's ±10% band then always compares Skip with a current price, and Pyth refuses the older prints anyone could
 * replay to hold the band through a crash, since it only accepts updates newer than the stored one. Updates are
 * permissionless and Mezo charges no update fee.
 */
export async function pushPyth(maxAgeS = LIMITS.pythMaxAgeS) {
  const stored = await pub.readContract({
    address: registry.pyth,
    abi: abi.pyth,
    functionName: 'getPriceUnsafe',
    args: [registry.pythBtcUsdFeed],
  })
  const age = nowS() - Number(stored.publishTime)
  readings.pyth = { btcUsdAgeS: age, maxAgeS }
  if (age <= maxAgeS) return `Pyth BTC/USD is ${age} s old`
  const { data, publishTime } = await latestUpdate()
  if (publishTime <= Number(stored.publishTime)) return `Hermes has nothing newer (${age} s old)`
  const fee = await pub.readContract({
    address: registry.pyth,
    abi: abi.pyth,
    functionName: 'getUpdateFee',
    args: [data],
  })
  const sent = await send(
    'keeper',
    'pyth.push',
    {
      address: registry.pyth,
      abi: abi.pyth,
      functionName: 'updatePriceFeeds',
      args: [data],
      value: fee,
    },
    { note: `BTC/USD print ${nowS() - publishTime} s old replaced one ${age} s old` },
  )
  return sent?.receipt
    ? `pushed a fresh BTC/USD print (was ${age} s old)`
    : 'push skipped (would revert)'
}

export const pythPushJob = () => pushPyth()
