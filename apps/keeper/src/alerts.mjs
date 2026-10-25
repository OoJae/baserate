import { CHAIN_ID, env } from './config.mjs'
import { log } from './log.mjs'

/**
 * Alerts to a Telegram chat (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Without them alerts are logged only. The same
 * alert key is sent at most once per 30 minutes.
 */
const token = env('TELEGRAM_BOT_TOKEN')
const chatId = env('TELEGRAM_CHAT_ID')
const DEDUPE_MS = 30 * 60_000
const lastSent = new Map()
export const recentAlerts = []

export const alertsConfigured = Boolean(token && chatId)

export async function alert(key, text) {
  const now = Date.now()
  if (now - (lastSent.get(key) ?? 0) < DEDUPE_MS) return
  lastSent.set(key, now)
  recentAlerts.unshift({ t: new Date(now).toISOString(), key, text })
  recentAlerts.length = Math.min(recentAlerts.length, 50)
  log('warn', `alert: ${text}`, { key })
  if (!alertsConfigured) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Baserate keeper (${CHAIN_ID === 31612 ? 'mainnet' : 'testnet'}): ${text}`,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) log('error', 'telegram alert failed', { status: res.status })
  } catch (err) {
    log('error', 'telegram alert failed', { reason: String(err).slice(0, 200) })
  }
}
