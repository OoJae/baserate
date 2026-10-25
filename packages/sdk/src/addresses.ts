import {
  type Address,
  encodeAbiParameters,
  getAddress,
  type Hex,
  isAddress,
  isHex,
  keccak256,
  zeroAddress,
  zeroHash,
} from 'viem'
import {
  MEZO_LOCAL_FORK_ID,
  MEZO_MAINNET_ID,
  MEZO_TESTNET_ID,
  type SupportedChainId,
} from './chains'
import localFork from './deployments/31337.json' with { type: 'json' }
import testnet from './deployments/31611.json' with { type: 'json' }
import mainnet from './deployments/31612.json' with { type: 'json' }

/**
 * Typed address registry, loaded from `deployments/<chainId>.json`.
 *
 * External Mezo addresses mirror `contracts/script/config/MezoAddresses.sol` (zero where a network lacks one, e.g.
 * Slipstream on testnet). Baserate's own contracts come from `contracts/deployments/<chainId>.json` and the forge
 * broadcasts; they are zero-address placeholders on networks not deployed yet. Use {@link isDeployed} before reading
 * any Baserate contract.
 */

/** Mezo's Skip BTC/USD precompile (same address on every network). Only `decimals()` and `latestRoundData()`. */
export const SKIP_BTC_USD = '0x7b7c000000000000000000000000000000000015' as const
/** Native BTC ERC-20 precompile. Read balances with `eth_getBalance` instead. */
export const BTC_PRECOMPILE = '0x7b7C000000000000000000000000000000000000' as const
export const PYTH_BTC_USD_FEED =
  '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' as const
export const PYTH_MUSD_USD_FEED =
  '0x0617a9b725011a126a2b9fd53563f4236501f32cf76d877644b943394606c6de' as const

export interface DeployedContract {
  address: Address
  /** Deployment transaction, when known. */
  tx: Hex | null
  /** Deployment block (0 when not deployed). */
  block: number
}

export interface ExternalAddresses {
  musd: Address
  smusd: Address
  pcv: Address
  borrowerOperations: Address
  borrowerOperationsSignatures: Address
  troveManager: Address
  sortedTroves: Address
  priceFeed: Address
  collSurplusPool: Address
  morpho: Address
  irm: Address
  pyth: Address
  skipBtcUsd: Address
  btc: Address
  mezo: Address
  router: Address
  poolFactory: Address
  btcMusdVolatilePool: Address
  multicall3: Address
  create2Deployer: Address
  /** Mezo Earn PoolsVoter (gauges and their BribeVotingRewards). */
  poolsVoter: Address
  /** Primary BTC/MUSD pool gauge and its bribe (mainnet CL200, testnet vAMM). */
  gauge0: Address
  bribe0: Address
  /** Second BTC/MUSD gauge and bribe (mainnet vAMM; zero on testnet). */
  gauge1: Address
  bribe1: Address
  /** Slipstream QuoterV2 (zero on testnet). */
  clQuoter: Address
  /** Slipstream BTC/MUSD CL200 pool (zero on testnet). */
  clBtcMusdPool: Address
  /** Slipstream MUSD/USD-stable pool used for the MUSD TWAP (mainnet CL10 mUSDC/MUSD; zero on testnet). */
  clMusdUsdPool: Address
  /** Slipstream swap router (zero on testnet, which disables the CL200 liquidation venue). */
  clSwapRouter: Address
  /** Mezo's Morpho VaultV2Factory (vMUSD is created through it). */
  vaultV2Factory: Address
}

export interface BaserateContracts {
  /** BtcMusdOracle (Morpho IOracle). */
  oracle: DeployedContract
  /** WsMUSD, the ERC-4626 over sMUSD. */
  wsMusd: DeployedContract
  /** BorrowAccountFactory. */
  factory: DeployedContract
  /** CollateralBTC (bcBTC), deployed by the factory constructor. */
  collateral: DeployedContract
  /** BorrowAccount implementation, deployed by the factory constructor. */
  borrowAccountImpl: DeployedContract
  /** MusdDispenser (testnet only). */
  dispenser: DeployedContract
  /** Backstop (bMUSD): ERC-4626 that buys seized BTC, exits through a 7-day queue. */
  backstop: DeployedContract
  /** FlashLiquidator: zero-capital M1 liquidations through the backstop, CL200 or the vAMM. */
  flashLiquidator: DeployedContract
  /** FeeRouter: splits origination fees 40% sMUSD / 40% gauge bribes / 20% treasury. */
  feeRouter: DeployedContract
  /** RiskLens: one-call risk snapshot (oracle, market, caps, depth, trove queue). */
  riskLens: DeployedContract
  /** vMUSD, a Morpho Vault V2 created through Mezo's VaultV2Factory (`tx` is the createVaultV2 call). */
  vMusd: DeployedContract
  /** vMUSD's WsMusdLiquidityAdapter (parks idle MUSD in wsMUSD). */
  wsMusdAdapter: DeployedContract
  /** vMUSD's MorphoMarketV1AdapterV2 (holds the vault's M1 supply). */
  m1Adapter: DeployedContract
  /** BaserateAllocator: vMUSD's permissionless allocator (buffer + APY policy). */
  allocator: DeployedContract
}

export interface MarketParams {
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
}

export interface MarketEntry {
  id: Hex
  params: MarketParams
}

export interface BaserateRegistry {
  chainId: SupportedChainId
  version: string
  /** First block worth scanning for Baserate events. */
  startBlock: number
  external: ExternalAddresses
  /** The only LLTV enabled on Mezo's Morpho for this network (0.77 testnet, 0.86 mainnet). */
  lltv: bigint
  feeds: { pythBtcUsd: Hex; pythMusdUsd: Hex }
  contracts: BaserateContracts
  markets: { M1: MarketEntry }
}

type RawContract = { address: string; tx: string | null; block: number }
type RawRegistry = {
  chainId: number
  version: string
  startBlock: number
  external: Record<string, string>
  lltv: string
  feeds: { pythBtcUsd: string; pythMusdUsd: string }
  contracts: Record<string, RawContract>
  markets: {
    M1: {
      id: string
      loanToken: string
      collateralToken: string
      oracle: string
      irm: string
      lltv: string
    }
  }
}

function addr(value: unknown, where: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new Error(`Registry: ${where} is not an address (${String(value)})`)
  }
  return getAddress(value)
}

function bytes32(value: unknown, where: string): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) {
    throw new Error(`Registry: ${where} is not a bytes32 (${String(value)})`)
  }
  return value
}

const EXTERNAL_KEYS: (keyof ExternalAddresses)[] = [
  'musd',
  'smusd',
  'pcv',
  'borrowerOperations',
  'borrowerOperationsSignatures',
  'troveManager',
  'sortedTroves',
  'priceFeed',
  'collSurplusPool',
  'morpho',
  'irm',
  'pyth',
  'skipBtcUsd',
  'btc',
  'mezo',
  'router',
  'poolFactory',
  'btcMusdVolatilePool',
  'multicall3',
  'create2Deployer',
  'poolsVoter',
  'gauge0',
  'bribe0',
  'gauge1',
  'bribe1',
  'clQuoter',
  'clBtcMusdPool',
  'clMusdUsdPool',
  'clSwapRouter',
  'vaultV2Factory',
]

const CONTRACT_KEYS: (keyof BaserateContracts)[] = [
  'oracle',
  'wsMusd',
  'factory',
  'collateral',
  'borrowAccountImpl',
  'dispenser',
  'backstop',
  'flashLiquidator',
  'feeRouter',
  'riskLens',
  'vMusd',
  'wsMusdAdapter',
  'm1Adapter',
  'allocator',
]

/** Validates a raw deployments JSON and returns the typed registry. Throws on any malformed entry. */
export function parseRegistry(raw: RawRegistry, chainId: SupportedChainId): BaserateRegistry {
  if (raw.chainId !== chainId) {
    throw new Error(`Registry: chainId ${raw.chainId} in file does not match ${chainId}`)
  }
  const external = {} as ExternalAddresses
  for (const key of EXTERNAL_KEYS) external[key] = addr(raw.external[key], `external.${key}`)

  const contracts = {} as BaserateContracts
  for (const key of CONTRACT_KEYS) {
    const c = raw.contracts[key]
    if (!c) throw new Error(`Registry: contracts.${key} missing`)
    contracts[key] = {
      address: addr(c.address, `contracts.${key}.address`),
      tx: c.tx === null ? null : bytes32(c.tx, `contracts.${key}.tx`),
      block: c.block,
    }
  }

  const m = raw.markets.M1
  return {
    chainId,
    version: raw.version,
    startBlock: raw.startBlock,
    external,
    lltv: BigInt(raw.lltv),
    feeds: {
      pythBtcUsd: bytes32(raw.feeds.pythBtcUsd, 'feeds.pythBtcUsd'),
      pythMusdUsd: bytes32(raw.feeds.pythMusdUsd, 'feeds.pythMusdUsd'),
    },
    contracts,
    markets: {
      M1: {
        id: bytes32(m.id, 'markets.M1.id'),
        params: {
          loanToken: addr(m.loanToken, 'markets.M1.loanToken'),
          collateralToken: addr(m.collateralToken, 'markets.M1.collateralToken'),
          oracle: addr(m.oracle, 'markets.M1.oracle'),
          irm: addr(m.irm, 'markets.M1.irm'),
          lltv: BigInt(m.lltv),
        },
      },
    },
  }
}

export const registries: Record<SupportedChainId, BaserateRegistry> = {
  [MEZO_TESTNET_ID]: parseRegistry(testnet, MEZO_TESTNET_ID),
  [MEZO_MAINNET_ID]: parseRegistry(mainnet, MEZO_MAINNET_ID),
  [MEZO_LOCAL_FORK_ID]: parseRegistry(localFork, MEZO_LOCAL_FORK_ID),
}

export function getRegistry(chainId: SupportedChainId): BaserateRegistry {
  return registries[chainId]
}

/** True when an address is set (not the zero-address placeholder). */
export function isDeployed(address: Address | undefined | null): address is Address {
  return !!address && address !== zeroAddress
}

/** True when the M1 market id has been filled in. */
export function isMarketKnown(id: Hex | undefined | null): id is Hex {
  return !!id && id !== zeroHash
}

/** Morpho market id: keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv)). */
export function computeMarketId(params: MarketParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
    ),
  )
}
