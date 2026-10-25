import { type Address, encodeAbiParameters, type Hex, keccak256 } from 'viem'
import type { MarketParams } from './addresses'
import { BPS, liquidationPrice, maxBig, minBig, mulDivDown, oraclePriceToWad, WAD } from './math'

/**
 * Wave 2 periphery helpers: vMUSD (Morpho Vault V2 + BaserateAllocator), FlashLiquidator / Backstop venues,
 * FeeRouter epochs and RiskLens source flags. Constants mirror the Solidity sources; tests pin them.
 */

// ---------------------------------------------------------------------------------------------------------------
// Liquidation venues (ILiquidationVenues.Venue)
// ---------------------------------------------------------------------------------------------------------------

export const Venue = { BACKSTOP: 0, CL200: 1, VAMM: 2 } as const
export type VenueId = (typeof Venue)[keyof typeof Venue]

export const VENUE_LABEL: Record<VenueId, string> = {
  [Venue.BACKSTOP]: 'Backstop (bMUSD)',
  [Venue.CL200]: 'Tigris CL200',
  [Venue.VAMM]: 'Tigris vAMM',
}

/** Default slippage guard for `FlashLiquidator.liquidate`: accept at least 90% of the previewed profit. */
export const DEFAULT_MIN_PROFIT_BPS = 9_000n

/** `minProfit` for `liquidate`: `profit × bps / 10,000`, rounded down. */
export function minProfitFor(previewProfit: bigint, bps: bigint = DEFAULT_MIN_PROFIT_BPS): bigint {
  return mulDivDown(previewProfit, bps, BPS)
}

/**
 * BTC/USD price (WAD) below which a position becomes liquidatable: the oracle's liquidation price (MUSD per BTC,
 * `debt / (collateral × LLTV)`) times the MUSD/USD leg the oracle divides by. Null without collateral or debt.
 */
export function liquidationBtcUsd(
  debt: bigint,
  collateral: bigint,
  lltv: bigint,
  musdUsd: bigint = WAD,
): bigint | null {
  const price = liquidationPrice(debt, collateral, lltv)
  return price === null ? null : mulDivDown(oraclePriceToWad(price), musdUsd, WAD)
}

// ---------------------------------------------------------------------------------------------------------------
// vMUSD (Vault V2) and BaserateAllocator
// ---------------------------------------------------------------------------------------------------------------

export const AllocatorAction = { NONE: 0, BUFFER_TOP_UP: 1, TO_MARKET: 2, TO_LIQUIDITY: 3 } as const
export type AllocatorActionId = (typeof AllocatorAction)[keyof typeof AllocatorAction]

export const ALLOCATOR_ACTION_LABEL: Record<AllocatorActionId, string> = {
  [AllocatorAction.NONE]: 'Nothing to move',
  [AllocatorAction.BUFFER_TOP_UP]: 'Top up the M1 borrow buffer',
  [AllocatorAction.TO_MARKET]: 'Move wsMUSD into M1 (M1 pays more)',
  [AllocatorAction.TO_LIQUIDITY]: 'Move M1 supply into wsMUSD (wsMUSD pays more)',
}

/** BaserateAllocator policy constants (all immutable on-chain). */
export const ALLOCATOR = {
  BUFFER_FLOOR: 2_000n * WAD,
  BUFFER_BPS: 1_500n,
  MAX_MOVE: 1_000n * WAD,
  MIN_MOVE: WAD,
  COOLDOWN: 3_600,
  APY_WINDOW: 7 * 86_400,
  MIN_APY_WINDOW: 86_400,
} as const

/** Vault V2 cap id of an adapter that uses `keccak256(abi.encode("this", adapter))` (both vMUSD adapters do). */
export function vaultAdapterCapId(adapter: Address): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['this', adapter]),
  )
}

/** Vault V2 cap id shared by every market with `collateralToken`: `keccak256(abi.encode("collateralToken", t))`. */
export function vaultCollateralCapId(collateralToken: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }],
      ['collateralToken', collateralToken],
    ),
  )
}

/** Vault V2 cap id of one Morpho market behind a MorphoMarketV1AdapterV2. */
export function vaultMarketCapId(marketAdapter: Address, params: MarketParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'address' },
        {
          type: 'tuple',
          components: [
            { name: 'loanToken', type: 'address' },
            { name: 'collateralToken', type: 'address' },
            { name: 'oracle', type: 'address' },
            { name: 'irm', type: 'address' },
            { name: 'lltv', type: 'uint256' },
          ],
        },
      ],
      ['this/marketParams', marketAdapter, params],
    ),
  )
}

/**
 * MUSD a vMUSD deposit can take now. Vault V2's `maxDeposit` always returns 0, and every deposit is allocated to
 * the liquidity adapter, whose next allocation is `heldAssets + assets`: so the room is the adapter id's absolute
 * cap minus `heldAssets`, and also its relative cap (`relativeCap × totalAssets`, the total growing with the deposit).
 */
export function vaultDepositRoom(p: {
  absoluteCap: bigint
  relativeCap: bigint
  heldAssets: bigint
  totalAssets: bigint
}): bigint {
  let room = maxBig(p.absoluteCap - p.heldAssets, 0n)
  if (p.relativeCap < WAD) {
    // held + x <= rel × (total + x)  ⇔  x <= (rel × total − held) / (1 − rel)
    const lhs = mulDivDown(p.relativeCap, p.totalAssets, WAD)
    const rel = lhs > p.heldAssets ? mulDivDown(lhs - p.heldAssets, WAD, WAD - p.relativeCap) : 0n
    room = minBig(room, rel)
  }
  return room
}

/**
 * Which exit a vMUSD withdrawal of `assets` takes. Vault V2 pays from its idle MUSD, then from the liquidity
 * adapter (wsMUSD); anything beyond that sits in M1 and only the allocator's `withdraw` can pull it (no
 * force-deallocate penalty).
 */
export function vaultWithdrawRoute(
  assets: bigint,
  liquid: { vaultIdle: bigint; liquidityAvailable: bigint },
): 'direct' | 'allocator' {
  return assets <= liquid.vaultIdle + liquid.liquidityAvailable ? 'direct' : 'allocator'
}

// ---------------------------------------------------------------------------------------------------------------
// FeeRouter / Mezo Earn bribe epochs
// ---------------------------------------------------------------------------------------------------------------

/** Mezo's ProtocolTimeLibrary.WEEK: epochs flip every Thursday 00:00 UTC. */
export const EPOCH_SECONDS = 7 * 86_400

/** Start of the bribe epoch containing `timestamp` (seconds). */
export function epochStart(timestamp: number): number {
  return timestamp - (timestamp % EPOCH_SECONDS)
}

/** The next Thursday 00:00 UTC flip after `timestamp`, when the current epoch's bribes become claimable. */
export function nextEpochFlip(timestamp: number): number {
  return epochStart(timestamp) + EPOCH_SECONDS
}

/** FeeRouter split in bps (immutable). */
export const FEE_SPLIT_BPS = { smusd: 4_000n, bribes: 4_000n, treasury: 2_000n } as const

// ---------------------------------------------------------------------------------------------------------------
// RiskLens
// ---------------------------------------------------------------------------------------------------------------

/** `RiskLens.SRC_*` bits used in `Snapshot.failed` and `Snapshot.skipped`. */
export const RiskSource = {
  ORACLE: 1n << 0n,
  MARKET: 1n << 1n,
  FACTORY: 1n << 2n,
  BACKSTOP: 1n << 3n,
  MUSD_POOL: 1n << 4n,
  CL_DEPTH: 1n << 5n,
  VAMM_DEPTH: 1n << 6n,
  TROVES: 1n << 7n,
  PYTH_MUSD: 1n << 8n,
} as const
export type RiskSourceName = keyof typeof RiskSource

export const RISK_SOURCE_LABEL: Record<RiskSourceName, string> = {
  ORACLE: 'Oracle',
  MARKET: 'M1 market',
  FACTORY: 'Factory caps',
  BACKSTOP: 'Backstop',
  MUSD_POOL: 'MUSD/USD pool',
  CL_DEPTH: 'CL200 depth',
  VAMM_DEPTH: 'vAMM depth',
  TROVES: 'Trove queue',
  PYTH_MUSD: 'Pyth MUSD',
}

export type RiskSourceState = 'ok' | 'failed' | 'skipped'

/** State of every RiskLens source from a snapshot's `failed` and `skipped` bitmasks. */
export function riskSourceStates(
  failed: bigint,
  skipped: bigint,
): { name: RiskSourceName; label: string; state: RiskSourceState }[] {
  return (Object.keys(RiskSource) as RiskSourceName[]).map((name) => {
    const bit = RiskSource[name]
    const state: RiskSourceState =
      (failed & bit) !== 0n ? 'failed' : (skipped & bit) !== 0n ? 'skipped' : 'ok'
    return { name, label: RISK_SOURCE_LABEL[name], state }
  })
}

/** RiskLens query limits (`MAX_DEPTH_SIZES`, `MAX_TROVES`). */
export const RISK_LENS_LIMITS = { maxDepthSizes: 8, maxTroves: 25 } as const
