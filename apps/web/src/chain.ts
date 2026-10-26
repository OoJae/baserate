import {
  type BaserateRegistry,
  getRegistry,
  isDeployed,
  isMarketKnown,
  mezoLocalFork,
  mezoTestnet,
} from '@baserate/sdk'
import { env } from './env'

/**
 * The chain and the address registry, with no wallet code. The app reaches these through `src/wagmi.ts` (which
 * re-exports them); the site's lazy read chunks import them from here, so viem's chain definitions never pull
 * RainbowKit or wagmi along. This module still imports `@baserate/sdk` (viem), so keep it out of the landing's entry
 * chunk: import it from lazily loaded code only. For a query key in the entry, use `APP_CHAIN_ID` from
 * `src/queryClient.ts`.
 */

/** Wave 1 runs on Mezo testnet only (or a local fork of it for development). */
export const appChain = env.localFork ? mezoLocalFork : mezoTestnet
export type AppChain = typeof appChain

export const registry: BaserateRegistry = getRegistry(appChain.id)

/** Which Baserate contracts are live on the app chain. */
export const deployed = {
  oracle: isDeployed(registry.contracts.oracle.address),
  factory: isDeployed(registry.contracts.factory.address),
  wsMusd: isDeployed(registry.contracts.wsMusd.address),
  dispenser: isDeployed(registry.contracts.dispenser.address),
  market: isMarketKnown(registry.markets.M1.id),
  backstop: isDeployed(registry.contracts.backstop.address),
  flashLiquidator: isDeployed(registry.contracts.flashLiquidator.address),
  feeRouter: isDeployed(registry.contracts.feeRouter.address),
  riskLens: isDeployed(registry.contracts.riskLens.address),
  vault:
    isDeployed(registry.contracts.vMusd.address) &&
    isDeployed(registry.contracts.allocator.address) &&
    isDeployed(registry.contracts.wsMusdAdapter.address),
} as const
