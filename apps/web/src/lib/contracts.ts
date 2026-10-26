import type { Address } from 'viem'
import { registry } from '../chain'

/** One row of the contracts table: a Baserate contract or a Mezo dependency, with what it does. */
export interface ContractRow {
  name: string
  role: string
  address: Address
  ours: boolean
  precompile?: boolean
}

/**
 * Every contract Baserate deploys or relies on, from the address registry, in the order the Evidence page lists them.
 * Shared by the Evidence page's contracts table and the landing's proof section.
 */
export function contractRows(): ContractRow[] {
  const c = registry.contracts
  const x = registry.external
  return [
    {
      name: 'BorrowAccountFactory',
      role: 'Opens accounts, enforces caps',
      address: c.factory.address,
      ours: true,
    },
    {
      name: 'BorrowAccount (impl)',
      role: 'Per-user clone logic',
      address: c.borrowAccountImpl.address,
      ours: true,
    },
    {
      name: 'CollateralBTC (bcBTC)',
      role: 'Gated 1:1 BTC receipt',
      address: c.collateral.address,
      ours: true,
    },
    {
      name: 'BtcMusdOracle',
      role: 'Skip price, Pyth band, MUSD clamp',
      address: c.oracle.address,
      ours: true,
    },
    { name: 'WsMUSD', role: 'ERC-4626 over sMUSD', address: c.wsMusd.address, ours: true },
    { name: 'MusdDispenser', role: 'Test MUSD faucet', address: c.dispenser.address, ours: true },
    {
      name: 'vMUSD (Vault V2)',
      role: 'MUSD lending vault, created by Mezo’s VaultV2Factory',
      address: c.vMusd.address,
      ours: true,
    },
    {
      name: 'WsMusdLiquidityAdapter',
      role: 'Parks vMUSD’s idle MUSD in wsMUSD',
      address: c.wsMusdAdapter.address,
      ours: true,
    },
    {
      name: 'MorphoMarketV1AdapterV2',
      role: 'Holds vMUSD’s M1 supply',
      address: c.m1Adapter.address,
      ours: true,
    },
    {
      name: 'BaserateAllocator',
      role: 'Permissionless buffer and APY allocator',
      address: c.allocator.address,
      ours: true,
    },
    {
      name: 'FlashLiquidator',
      role: 'Zero-capital M1 liquidations',
      address: c.flashLiquidator.address,
      ours: true,
    },
    { name: 'Backstop (bMUSD)', role: 'Buys seized BTC', address: c.backstop.address, ours: true },
    { name: 'FeeRouter', role: '40/40/20 fee splitter', address: c.feeRouter.address, ours: true },
    { name: 'RiskLens', role: 'One-call risk snapshot', address: c.riskLens.address, ours: true },
    { name: 'Morpho Blue', role: 'Mezo’s official lending core', address: x.morpho, ours: false },
    {
      name: 'VaultV2Factory',
      role: 'Mezo’s Morpho Vault V2 factory',
      address: x.vaultV2Factory,
      ours: false,
    },
    { name: 'AdaptiveCurveIrm', role: 'Interest rate model', address: x.irm, ours: false },
    { name: 'MUSD', role: 'Loan token', address: x.musd, ours: false },
    { name: 'sMUSD', role: 'MUSD savings rate', address: x.smusd, ours: false },
    {
      name: 'Skip BTC/USD',
      role: 'Primary price (precompile)',
      address: x.skipBtcUsd,
      ours: false,
      precompile: true,
    },
    { name: 'Pyth', role: 'Sanity band and MUSD price', address: x.pyth, ours: false },
    { name: 'SortedTroves', role: 'MUSD redemption queue', address: x.sortedTroves, ours: false },
    { name: 'TroveManager', role: 'Trove ratios', address: x.troveManager, ours: false },
    { name: 'PoolsVoter', role: 'Mezo Earn gauges and bribes', address: x.poolsVoter, ours: false },
  ]
}
