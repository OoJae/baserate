import { readFileSync } from 'node:fs'

export const env = (name, fallback) => {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

export const CHAIN_ID = Number(env('CHAIN_ID', '31611'))
export const registry = JSON.parse(
  readFileSync(new URL(`../registry.${CHAIN_ID}.json`, import.meta.url), 'utf8'),
)
export const IS_TESTNET = CHAIN_ID === 31611
export const IS_MAINNET = CHAIN_ID === 31612

export const RPC_URL = env(
  'RPC_URL',
  IS_MAINNET ? 'https://mezo-mainnet.boar.network' : 'https://rpc.test.mezo.org',
)
export const PORT = Number(env('PORT', '8080'))

const seconds = (name, fallback) => Number(env(name, String(fallback))) * 1000

/** Job cadences (ms). Every one can be overridden with `<JOB>_EVERY_S`. */
export const CADENCE = {
  health: seconds('HEALTH_EVERY_S', 60),
  liquidations: seconds('LIQUIDATIONS_EVERY_S', 12),
  allocator: seconds('ALLOCATOR_EVERY_S', 15 * 60),
  wsmusdSync: seconds('WSMUSD_SYNC_EVERY_S', 60 * 60),
  yieldSim: seconds('YIELD_SIM_EVERY_S', 60 * 60),
  backstop: seconds('BACKSTOP_EVERY_S', 60 * 60),
  capsDepth: seconds('CAPS_DEPTH_EVERY_S', 10 * 60),
  canary: seconds('CANARY_EVERY_S', 10 * 60),
  smusdWatch: seconds('SMUSD_WATCH_EVERY_S', 5 * 60),
  feeFlush: seconds('FEE_FLUSH_EVERY_S', 15 * 60),
}

export const WAD = 10n ** 18n
export const MUSD = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n

export const LIMITS = {
  /**
   * Mezo's eth_estimateGas leaves out most of what precompile reads cost on-chain: a canary liquidation estimated at
   * 477k used 749k (and ×1.4 of a 53k estimate ran out of gas). Gas costs ~146 wei, so every send gets
   * max(2 × estimate, 2M); unused gas is not charged.
   */
  gasMultiplierPct: 200n,
  gasFloor: 2_000_000n,
  /** eth_getLogs is capped at 10k blocks on Mezo's RPCs. */
  logChunk: 9_000n,
  oracleMaxAgeS: 120,
  feeMinMusd: MUSD(env('FEES_MIN_MUSD', '10')),
  /** Bribes go out once per Mezo Earn epoch, from Thursday 01:05 UTC, never in the epoch's last hour. */
  feeFlushAfterEpochS: 65 * 60,
  epochS: 7 * 24 * 3600,
  syncMinPending: MUSD('0.01'),
  syncMaxGapS: 6 * 3600,
  /** Canaries are left for anyone to liquidate for 6 h, or until health falls below 0.98. */
  canaryGraceS: 6 * 3600,
  canaryHealthFloorWad: (98n * WAD) / 100n,
  canaryReopenAfterS: 30 * 60,
  canaryCollateralWei: BigInt(env('CANARY_COLLATERAL_WEI', '2000000000000000')),
  /** Target LTV for canaries: LLTV − 0.25 point, in bps. */
  canaryTargetBps: BigInt(env('CANARY_TARGET_BPS', registry.canaryTargetBps ?? '7675')),
  canaryTopUpGapBps: 15n,
  yieldSimAprBps: BigInt(env('YIELD_SIM_APR_BPS', '100')),
  yieldSimDailyBudget: MUSD(env('YIELD_SIM_DAILY_BUDGET_MUSD', '25')),
  depthImpactBps: 400n,
  depthSizesBtc: ['0.005', '0.01', '0.02', '0.05', '0.1', '0.2', '0.5'],
  capCeiling: MUSD(env('CAP_CEILING_MUSD', IS_MAINNET ? '2000' : '5000')),
  /** 0.0001 BTC: at Mezo's ~146 wei gas price that is still ~300 sends of 2M gas. */
  lowGasWei: BigInt(env('LOW_GAS_WEI', '100000000000000')),
  lowDispenserMusd: MUSD(env('LOW_DISPENSER_MUSD', '100')),
}

/** Opt-in switches for jobs that spend or that change protocol limits. */
export const SWITCHES = {
  yieldSim: env('YIELD_SIM', IS_TESTNET ? 'on' : 'off') === 'on' && IS_TESTNET,
  /** Cap cuts by the depth job run on mainnet only; testnet runs it as a labelled dry run. */
  capsDepthLive: IS_MAINNET && env('CAPS_DEPTH', 'on') === 'on',
  /** The sMUSD watcher cuts the vault's wsMUSD cap on mainnet; on testnet it alerts unless SMUSD_WATCH_CUT=on. */
  smusdWatchCut: IS_MAINNET || env('SMUSD_WATCH_CUT', 'off') === 'on',
}
