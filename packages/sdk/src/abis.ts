/**
 * Hand-written `as const` ABIs.
 *
 * Baserate contract ABIs follow the agreed SHARED INTERFACE exactly (names, argument order and types), so the UI
 * is not blocked on the contracts track. When compiled artifacts exist, `@wagmi/cli` output should replace these
 * stubs; until then keep them in lockstep with the interfaces in contracts/src/interfaces/.
 *
 * Every Baserate ABI carries the full custom-error set so viem can decode errors that bubble up through nested
 * calls (factory → account → Morpho → oracle).
 */

// ---------------------------------------------------------------------------------------------------------------
// Shared structs
// ---------------------------------------------------------------------------------------------------------------

const marketParamsComponents = [
  { name: 'loanToken', type: 'address' },
  { name: 'collateralToken', type: 'address' },
  { name: 'oracle', type: 'address' },
  { name: 'irm', type: 'address' },
  { name: 'lltv', type: 'uint256' },
] as const

const marketComponents = [
  { name: 'totalSupplyAssets', type: 'uint128' },
  { name: 'totalSupplyShares', type: 'uint128' },
  { name: 'totalBorrowAssets', type: 'uint128' },
  { name: 'totalBorrowShares', type: 'uint128' },
  { name: 'lastUpdate', type: 'uint128' },
  { name: 'fee', type: 'uint128' },
] as const

// ---------------------------------------------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------------------------------------------

import {
  borrowAccountFactoryGenerated,
  borrowAccountGenerated,
  btcMusdOracleGenerated,
  collateralBTCGenerated,
  musdDispenserGenerated,
  wsMUSDGenerated,
} from './generated'

type AbiItem = { readonly type: string }
type ErrorItem<T> = Extract<T, { readonly type: 'error' }>
/** Picks the custom-error entries out of a compiled ABI. */
function errorsOf<const T extends readonly AbiItem[]>(abi: T): ErrorItem<T[number]>[] {
  return abi.filter((x): x is ErrorItem<T[number]> => x.type === 'error')
}

export const oracleErrorsAbi = [
  { type: 'error', name: 'SkipInvalidAnswer', inputs: [{ name: 'answer', type: 'int256' }] },
  { type: 'error', name: 'SkipStale', inputs: [{ name: 'age', type: 'uint256' }] },
  {
    type: 'error',
    name: 'PythDeviation',
    inputs: [
      { name: 'skipPrice', type: 'uint256' },
      { name: 'pythPrice', type: 'uint256' },
    ],
  },
] as const

export const accountErrorsAbi = [
  { type: 'error', name: 'Unauthorized', inputs: [] },
  {
    type: 'error',
    name: 'LtvTooHigh',
    inputs: [
      { name: 'ltvBps', type: 'uint256' },
      { name: 'limitBps', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'PositionCapExceeded', inputs: [] },
  { type: 'error', name: 'GlobalCapExceeded', inputs: [] },
  { type: 'error', name: 'BorrowPaused', inputs: [] },
  { type: 'error', name: 'ModuleNotApproved', inputs: [] },
] as const

export const collateralErrorsAbi = [
  { type: 'error', name: 'NotAccount', inputs: [] },
  {
    type: 'error',
    name: 'TransferRestricted',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
    ],
  },
  { type: 'error', name: 'NativeSendFailed', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
] as const

/** OpenZeppelin v5 errors our contracts (and MUSD) can surface. */
export const openZeppelinErrorsAbi = [
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ERC20InvalidSender', inputs: [{ name: 'sender', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidReceiver', inputs: [{ name: 'receiver', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidApprover', inputs: [{ name: 'approver', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidSpender', inputs: [{ name: 'spender', type: 'address' }] },
  {
    type: 'error',
    name: 'ERC2612ExpiredSignature',
    inputs: [{ name: 'deadline', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ERC2612InvalidSigner',
    inputs: [
      { name: 'signer', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'ERC4626ExceededMaxDeposit',
    inputs: [
      { name: 'receiver', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC4626ExceededMaxMint',
    inputs: [
      { name: 'receiver', type: 'address' },
      { name: 'shares', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC4626ExceededMaxWithdraw',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC4626ExceededMaxRedeem',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'shares', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidAccountNonce',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'currentNonce', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ECDSAInvalidSignature', inputs: [] },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureLength',
    inputs: [{ name: 'length', type: 'uint256' }],
  },
  { type: 'error', name: 'ECDSAInvalidSignatureS', inputs: [{ name: 's', type: 'bytes32' }] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
  { type: 'error', name: 'SafeERC20FailedOperation', inputs: [{ name: 'token', type: 'address' }] },
  { type: 'error', name: 'AddressEmptyCode', inputs: [{ name: 'target', type: 'address' }] },
  { type: 'error', name: 'FailedCall', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [{ name: 'account', type: 'address' }],
  },
  { type: 'error', name: 'EnforcedPause', inputs: [] },
] as const

/** sMUSD (MUSDSavingsRate) errors. `ZeroAmount()` shares its selector with CollateralBTC's. */
export const smusdErrorsAbi = [
  { type: 'error', name: 'AmountTooSmall', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
] as const

/** Every custom error the Baserate flows can surface, de-duplicated by signature. */
export const baserateErrorsAbi = [
  ...errorsOf(btcMusdOracleGenerated),
  ...errorsOf(wsMUSDGenerated),
  ...errorsOf(collateralBTCGenerated),
  ...errorsOf(borrowAccountFactoryGenerated),
  ...errorsOf(borrowAccountGenerated),
  ...errorsOf(musdDispenserGenerated),
  ...oracleErrorsAbi,
  ...accountErrorsAbi,
  ...collateralErrorsAbi,
  ...openZeppelinErrorsAbi,
  ...smusdErrorsAbi,
] as const

// ---------------------------------------------------------------------------------------------------------------
// Baserate contracts (SHARED INTERFACE)
// ---------------------------------------------------------------------------------------------------------------

/** `contract BtcMusdOracle is IOracle`. */
export const btcMusdOracleAbi = [...btcMusdOracleGenerated, ...baserateErrorsAbi] as const

/** `contract WsMUSD is ERC4626` over Mezo's claim-based sMUSD. */
export const wsMusdAbi = [...wsMUSDGenerated, ...baserateErrorsAbi] as const

/** `contract CollateralBTC` (bcBTC): gated 1:1 native-BTC receipt used as M1 collateral. */
export const collateralBtcAbi = [...collateralBTCGenerated, ...baserateErrorsAbi] as const

/** Mirrors `enum Profile` in IBorrowAccountFactory.sol. */
export const Profile = { STANDARD: 0, CANARY: 1 } as const
export type ProfileId = (typeof Profile)[keyof typeof Profile]

/** `contract BorrowAccountFactory`. */
export const borrowAccountFactoryAbi = [
  ...borrowAccountFactoryGenerated,
  ...baserateErrorsAbi,
] as const

/** `contract BorrowAccount` (EIP-1167 clone, owner-only). */
export const borrowAccountAbi = [...borrowAccountGenerated, ...baserateErrorsAbi] as const

/** `contract MusdDispenser` (testnet judge top-ups). */
export const musdDispenserAbi = [...musdDispenserGenerated, ...baserateErrorsAbi] as const

export const morphoAbi = [
  {
    type: 'function',
    name: 'market',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: marketComponents,
  },
  {
    type: 'function',
    name: 'position',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'supplyShares', type: 'uint256' },
      { name: 'borrowShares', type: 'uint128' },
      { name: 'collateral', type: 'uint128' },
    ],
  },
  {
    type: 'function',
    name: 'idToMarketParams',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: marketParamsComponents,
  },
  {
    type: 'function',
    name: 'isIrmEnabled',
    stateMutability: 'view',
    inputs: [{ name: 'irm', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isLltvEnabled',
    stateMutability: 'view',
    inputs: [{ name: 'lltv', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'accrueInterest',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketParams', type: 'tuple', components: marketParamsComponents }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'SupplyCollateral',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Borrow',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: false },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Repay',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawCollateral',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: false },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
    ],
  },
] as const

/** AdaptiveCurveIrm view surface. `borrowRateView` returns a per-second WAD rate. */
export const adaptiveCurveIrmAbi = [
  {
    type: 'function',
    name: 'borrowRateView',
    stateMutability: 'view',
    inputs: [
      { name: 'marketParams', type: 'tuple', components: marketParamsComponents },
      { name: 'market', type: 'tuple', components: marketComponents },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'rateAtTarget',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'int256' }],
  },
] as const

// ---------------------------------------------------------------------------------------------------------------
// Tokens, oracles and the MUSD system
// ---------------------------------------------------------------------------------------------------------------

/** ERC-20 with EIP-2612 permit and EIP-5267 (MUSD is OpenZeppelin v5 ERC20Permit, ECDSA only). */
export const erc20PermitAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  ...openZeppelinErrorsAbi,
] as const

/** sMUSD (MUSDSavingsRate) views and entry points. Not ERC-4626: `asset()` and `totalAssets()` revert. */
export const smusdAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimableYield',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'supplyYieldIndex',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'yieldIndex',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pendingYield',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'musdToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'pcv',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'strategy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'vaultGauge',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimYield',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'receiveProtocolYield',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  ...smusdErrorsAbi,
  { type: 'error', name: 'ZeroAmount', inputs: [] },
] as const

/** Mezo's Skip BTC/USD precompile. `description()` reverts; call only these two. */
export const skipAggregatorAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

/** Pyth `getPriceUnsafe`: no staleness check, so validate `publishTime` yourself. */
export const pythAbi = [
  {
    type: 'function',
    name: 'getPriceUnsafe',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      {
        name: 'price',
        type: 'tuple',
        components: [
          { name: 'price', type: 'int64' },
          { name: 'conf', type: 'uint64' },
          { name: 'expo', type: 'int32' },
          { name: 'publishTime', type: 'uint256' },
        ],
      },
    ],
  },
] as const

/** MUSD trove queue: the lowest nominal ICR (the tail) is redeemed first. */
export const sortedTrovesAbi = [
  {
    type: 'function',
    name: 'getLast',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getFirst',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getSize',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPrev',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const troveManagerAbi = [
  {
    type: 'function',
    name: 'getNominalICR',
    stateMutability: 'view',
    inputs: [{ name: 'borrower', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getCurrentICR',
    stateMutability: 'view',
    inputs: [
      { name: 'borrower', type: 'address' },
      { name: 'price', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MCR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const borrowerOperationsAbi = [
  {
    type: 'function',
    name: 'minNetDebt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MUSD_GAS_COMPENSATION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/** Multicall3 helpers used to timestamp a batch of reads consistently. */
export const multicall3Abi = [
  {
    type: 'function',
    name: 'getCurrentBlockTimestamp',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'timestamp', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getBlockNumber',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint256' }],
  },
] as const

export const collSurplusPoolAbi = [
  {
    type: 'function',
    name: 'getCollateral',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
