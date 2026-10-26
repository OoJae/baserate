// Baserate keeper (design: docs/design/offchain.md §7). One process runs every job on its own cadence; each re-reads
// chain state before it sends, and sends from one key run one at a time.
//
//   liquidations  every 12 s   liquidate M1 positions above the LLTV (canaries get a 6 h grace for anyone to take)
//   allocator     every 15 min vMUSD rebalance() when the preview has a move; checkpoint() hourly
//   wsmusd.sync   hourly       harvest sMUSD yield into wsMUSD's 3-day vesting
//   yield.sim     hourly       testnet only: labelled ~1% APR donation to sMUSD, daily budget cap (SIM key)
//   backstop      hourly       pay matured exits, sell BTC inventory above the auction floor, recognise gains
//   fee.flush     every 15 min FeeRouter distribute() once per epoch from Thu 01:05 UTC
//   canary        every 10 min keep the CANARY key's canary at LLTV − 0.25 pt; reopen 30 min after a liquidation
//   caps.depth    every 10 min liquidation depth vs the borrow cap; cuts on mainnet (SENTINEL), dry run on testnet
//   smusd.watch   every 5 min  sMUSD implementation/strategy/pcv/vaultGauge against pins; alert, freeze on mainnet
//   health        every 1 min  oracle freshness, key and dispenser balances
//   pyth.push     every 1 min  push the latest Pyth BTC/USD print once the stored one is over 4 min old (needs a Hermes key)
//
// HTTP: /healthz, /status, /v1/status, /v1/evidence (see server.mjs). Alerts go to Telegram when configured.

import { addressOf, hasRole } from './chain.mjs'
import { CADENCE, IS_TESTNET, RPC_URL, registry, SWITCHES } from './config.mjs'
import { canaryJob, capsDepthJob, healthJob, smusdWatchJob } from './jobs/guards.mjs'
import { liquidationsJob } from './jobs/liquidations.mjs'
import { backstopJob, feeFlushJob, yieldSimJob } from './jobs/money.mjs'
import { PYTH_API_KEY, pythPushJob } from './jobs/pyth.mjs'
import { allocatorJob, wsmusdSyncJob } from './jobs/vault.mjs'
import { log } from './log.mjs'
import { every } from './scheduler.mjs'
import { startServer } from './server.mjs'
import { initStore } from './store.mjs'

await initStore()
startServer()
log('info', 'keeper started', {
  chainId: registry.chainId,
  rpc: RPC_URL,
  roles: {
    keeper: addressOf('keeper'),
    sentinel: addressOf('sentinel'),
    canary: addressOf('canary'),
    sim: addressOf('sim'),
  },
})

every('health', CADENCE.health, healthJob)
every('liquidations', CADENCE.liquidations, liquidationsJob)
every('allocator', CADENCE.allocator, allocatorJob)
every('wsmusd.sync', CADENCE.wsmusdSync, wsmusdSyncJob)
every('yield.sim', CADENCE.yieldSim, yieldSimJob, {
  off: !IS_TESTNET
    ? 'testnet only'
    : !SWITCHES.yieldSim
      ? 'YIELD_SIM=off'
      : !hasRole('sim')
        ? 'SIM_PRIVATE_KEY not set'
        : undefined,
})
every('backstop', CADENCE.backstop, backstopJob)
every('fee.flush', CADENCE.feeFlush, feeFlushJob)
every('canary', CADENCE.canary, canaryJob, {
  off: hasRole('canary') ? undefined : 'CANARY_PRIVATE_KEY not set',
})
every('caps.depth', CADENCE.capsDepth, capsDepthJob)
every('smusd.watch', CADENCE.smusdWatch, smusdWatchJob, {
  off: registry.smusdPins ? undefined : 'no sMUSD pins for this chain',
})
every('pyth.push', CADENCE.pythPush, pythPushJob, {
  off: !registry.pyth
    ? 'no Pyth address for this chain'
    : !PYTH_API_KEY
      ? 'PYTH_API_KEY not set (Hermes needs one)'
      : undefined,
})
