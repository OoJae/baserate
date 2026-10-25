import pg from 'pg'
import { CHAIN_ID, env } from './config.mjs'
import { log } from './log.mjs'

/**
 * Keeper memory: every attempted transaction (`actions`, the Evidence feed), cursors and small key/value state, and
 * liquidation-depth samples. Postgres when DATABASE_URL is set (Railway), so history survives restarts; in memory
 * otherwise.
 */
const url = env('DATABASE_URL')
const pool = url ? new pg.Pool({ connectionString: url, max: 3 }) : null

const mem = { actions: [], kv: new Map(), depth: [] }

export const persistent = Boolean(pool)

export async function initStore() {
  if (!pool) {
    log('warn', 'DATABASE_URL not set: keeper history is kept in memory only')
    return
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS actions (
      id BIGSERIAL PRIMARY KEY,
      chain_id INTEGER NOT NULL,
      job TEXT NOT NULL,
      role TEXT NOT NULL,
      fn TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      block BIGINT NOT NULL,
      idem_key TEXT UNIQUE,
      note TEXT,
      ts TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS kv (
      chain_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chain_id, name)
    );
    CREATE TABLE IF NOT EXISTS depth_samples (
      chain_id INTEGER NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      depth_btc NUMERIC NOT NULL,
      depth_musd NUMERIC NOT NULL,
      free_backstop_musd NUMERIC NOT NULL
    );
  `)
  log('info', 'store ready (postgres)')
}

export async function recordAction({
  job,
  role,
  fn,
  tx,
  status,
  block,
  idemKey = null,
  note = null,
}) {
  const row = { t: new Date().toISOString(), job, role, fn, tx, status, block, note }
  mem.actions.unshift(row)
  mem.actions.length = Math.min(mem.actions.length, 200)
  if (idemKey && status === 'success') mem.kv.set(`idem:${idemKey}`, '1')
  if (!pool) return
  try {
    await pool.query(
      `INSERT INTO actions (chain_id, job, role, fn, tx_hash, status, block, idem_key, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idem_key) DO NOTHING`,
      [CHAIN_ID, job, role, fn, tx, status, block, idemKey, note],
    )
  } catch (err) {
    log('error', 'store: recordAction failed', { reason: String(err).slice(0, 200) })
  }
}

/** True when an action with this idempotency key already succeeded (e.g. the bribe for one epoch). */
export async function hasIdem(idemKey) {
  if (!pool) return mem.kv.has(`idem:${idemKey}`)
  const { rowCount } = await pool.query(
    `SELECT 1 FROM actions WHERE idem_key = $1 AND status = 'success'`,
    [idemKey],
  )
  return rowCount > 0
}

export async function recentActions(limit = 50) {
  if (!pool) return mem.actions.slice(0, limit)
  const { rows } = await pool.query(
    `SELECT ts, job, role, fn, tx_hash, status, block, note FROM actions WHERE chain_id = $1
     ORDER BY id DESC LIMIT $2`,
    [CHAIN_ID, limit],
  )
  return rows.map((r) => ({
    t: r.ts.toISOString(),
    job: r.job,
    role: r.role,
    fn: r.fn,
    tx: r.tx_hash,
    status: r.status,
    block: Number(r.block),
    note: r.note,
  }))
}

export async function getKv(name, fallback = null) {
  if (!pool) return mem.kv.get(name) ?? fallback
  const { rows } = await pool.query(`SELECT value FROM kv WHERE chain_id = $1 AND name = $2`, [
    CHAIN_ID,
    name,
  ])
  return rows[0]?.value ?? fallback
}

export async function setKv(name, value) {
  mem.kv.set(name, String(value))
  if (!pool) return
  await pool.query(
    `INSERT INTO kv (chain_id, name, value) VALUES ($1,$2,$3)
     ON CONFLICT (chain_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CHAIN_ID, name, String(value)],
  )
}

export async function addDepthSample({ depthBtc, depthMusd, freeBackstopMusd }) {
  const row = { ts: Date.now(), depthBtc, depthMusd, freeBackstopMusd }
  mem.depth.push(row)
  mem.depth = mem.depth.filter((d) => d.ts > Date.now() - 24 * 3600_000)
  if (!pool) return
  await pool.query(
    `INSERT INTO depth_samples (chain_id, depth_btc, depth_musd, free_backstop_musd) VALUES ($1,$2,$3,$4)`,
    [CHAIN_ID, depthBtc, depthMusd, freeBackstopMusd],
  )
}

/** Smallest depth (MUSD) seen over the last 24 h: caps follow the worst recent depth, not the latest sample. */
export async function depthMin24h() {
  if (!pool) {
    if (mem.depth.length === 0) return null
    return mem.depth.reduce((m, d) => (Number(d.depthMusd) < m ? Number(d.depthMusd) : m), Infinity)
  }
  const { rows } = await pool.query(
    `SELECT min(depth_musd) AS m FROM depth_samples WHERE chain_id = $1 AND ts > now() - interval '24 hours'`,
    [CHAIN_ID],
  )
  return rows[0]?.m == null ? null : Number(rows[0].m)
}
