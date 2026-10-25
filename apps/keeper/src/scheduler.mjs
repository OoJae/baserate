import { alert } from './alerts.mjs'
import { log } from './log.mjs'

/** Per-job run state, served by /v1/status. */
export const jobs = {}

/** Live readings jobs publish for /status (accounts by LTV, depth, the sMUSD watch, …). */
export const readings = {}

/**
 * Runs `fn` now and then every `ms`, never overlapping itself. Three failures in a row raise an alert. A job that is
 * off (missing key, wrong network) is listed with the reason instead of running.
 */
export function every(name, ms, fn, { off } = {}) {
  const j = {
    cadenceS: ms / 1000,
    lastRun: null,
    lastSuccess: null,
    nextRun: null,
    failures: 0,
    note: null,
  }
  jobs[name] = j
  if (off) {
    j.note = `off: ${off}`
    log('info', `${name}: off`, { reason: off })
    return
  }
  let running = false
  const tick = async () => {
    j.nextRun = new Date(Date.now() + ms).toISOString()
    if (running) return
    running = true
    j.lastRun = new Date().toISOString()
    try {
      const note = await fn()
      j.lastSuccess = new Date().toISOString()
      j.failures = 0
      if (note !== undefined) j.note = note
    } catch (err) {
      j.failures += 1
      const reason = (err?.shortMessage ?? err?.message ?? String(err)).slice(0, 300)
      log('error', `${name} failed`, { reason, failures: j.failures })
      if (j.failures >= 3)
        await alert(`job:${name}`, `${name} failed ${j.failures} times in a row: ${reason}`)
    } finally {
      running = false
    }
  }
  tick()
  setInterval(tick, ms)
}
