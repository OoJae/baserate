import { createServer } from 'node:http'
import { formatEther } from 'viem'
import { alertsConfigured, recentAlerts } from './alerts.mjs'
import { pub, signers } from './chain.mjs'
import { CHAIN_ID, PORT } from './config.mjs'
import { log } from './log.mjs'
import { jobs, readings } from './scheduler.mjs'
import { persistent, recentActions } from './store.mjs'

const startedAt = new Date().toISOString()

const json = (res, body) =>
  res
    .writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    .end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))

async function gasBalance() {
  try {
    return formatEther(await pub.getBalance({ address: signers.keeper.account.address }))
  } catch {
    return null
  }
}

/**
 * /healthz: liveness. /status: the summary the app's Evidence page reads. /v1/status: every job's last run, last
 * success, next run and note, plus live readings. /v1/evidence: the keeper's recent transactions.
 */
export function startServer() {
  createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    try {
      if (path === '/healthz') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      if (path === '/status') {
        const actions = await recentActions(20)
        return json(res, {
          chainId: CHAIN_ID,
          keeper: signers.keeper.account.address,
          gasBalanceBtc: await gasBalance(),
          startedAt,
          lastRun: {
            liquidations: jobs.liquidations?.lastRun ?? null,
            allocator: jobs.allocator?.lastRun ?? null,
            fees: jobs['fee.flush']?.lastRun ?? null,
          },
          accounts: readings.accounts ?? [],
          actions,
          jobs,
        })
      }
      if (path === '/v1/status') {
        return json(res, {
          chainId: CHAIN_ID,
          startedAt,
          persistent,
          alertsConfigured,
          roles: Object.fromEntries(
            Object.entries(signers).map(([r, s]) => [r, s.account.address]),
          ),
          jobs,
          readings,
          alerts: recentAlerts,
        })
      }
      if (path === '/v1/evidence')
        return json(res, { chainId: CHAIN_ID, actions: await recentActions(100) })
      res.writeHead(404).end()
    } catch (err) {
      log('error', 'http handler failed', { path, reason: String(err).slice(0, 200) })
      res.writeHead(500).end()
    }
  }).listen(PORT, () => log('info', 'keeper http up', { port: PORT }))
}
