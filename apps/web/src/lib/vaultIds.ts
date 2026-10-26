import { vaultAdapterCapId, vaultCollateralCapId, vaultMarketCapId } from '@baserate/sdk'
import { registry } from '../chain'

/**
 * Vault V2 cap ids vMUSD uses: the wsMUSD adapter's, and the three a M1 allocation touches. `allocation(id)` on vMUSD
 * reads how much sits behind each; useVault reads all four, the landing's split station reads `m1Market` and
 * `liquidity`. Re-exported from hooks/useVault for older imports.
 */
export const VAULT_IDS = {
  liquidity: vaultAdapterCapId(registry.contracts.wsMusdAdapter.address),
  m1Adapter: vaultAdapterCapId(registry.contracts.m1Adapter.address),
  collateral: vaultCollateralCapId(registry.contracts.collateral.address),
  m1Market: vaultMarketCapId(registry.contracts.m1Adapter.address, registry.markets.M1.params),
} as const
