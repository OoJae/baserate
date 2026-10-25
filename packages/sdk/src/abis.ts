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

/** `BtcMusdOracle.Status`. Prices are 1e18 USD; `price` is Morpho's 1e36 scale. */
const oracleStatusComponents = [
  { name: 'price', type: 'uint256' },
  { name: 'ok', type: 'bool' },
  { name: 'skipPrice', type: 'uint256' },
  { name: 'skipAge', type: 'uint256' },
  { name: 'pythBtcPrice', type: 'uint256' },
  { name: 'pythBtcAge', type: 'uint256' },
  { name: 'pythBtcFresh', type: 'bool' },
  { name: 'musdPrice', type: 'uint256' },
  { name: 'musdAge', type: 'uint256' },
  { name: 'musdFresh', type: 'bool' },
  { name: 'deviationBps', type: 'uint256' },
] as const

// ---------------------------------------------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------------------------------------------

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
export const btcMusdOracleAbi = [
  {
    type: 'constructor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pyth', type: 'address' },
      { name: 'btcFeed', type: 'bytes32' },
      { name: 'musdFeed', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'price',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'status',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'tuple', components: oracleStatusComponents }],
  },
  ...oracleErrorsAbi,
] as const

/** `contract WsMUSD is ERC4626` ("Wrapped Savings MUSD", "wsMUSD"). */
export const wsMusdAbi = [
  {
    type: 'constructor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'musd', type: 'address' },
      { name: 'smusd', type: 'address' },
      { name: 'capAdmin', type: 'address' },
      { name: 'initialCap', type: 'uint256' },
    ],
  },
  // ERC-20
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
  // ERC-4626
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToShares',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxDeposit',
    stateMutability: 'view',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxMint',
    stateMutability: 'view',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxRedeem',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewDeposit',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewMint',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewRedeem',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Baserate extras
  {
    type: 'function',
    name: 'depositWithPermit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sync',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'harvested', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeemInKind',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [
      { name: 'smusdOut', type: 'uint256' },
      { name: 'musdOut', type: 'uint256' },
    ],
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
    name: 'vestingState',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'stored', type: 'uint256' },
      { name: 'unvested', type: 'uint256' },
      { name: 'lastSync', type: 'uint64' },
      { name: 'periodEnd', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'depositCap',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Cap-raise timelock (contracts.md §3.2): CAP_ADMIN submits, anyone accepts after 72 h, CAP_ADMIN revokes.
  {
    type: 'function',
    name: 'submitCapRaise',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newCap', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptCapRaise',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeCapRaise',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // Spec storage (`pendingCap`, `pendingCapAt`); read with allowFailure until the compiled ABI confirms them.
  {
    type: 'function',
    name: 'pendingCap',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pendingCapAt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  ...baserateErrorsAbi,
] as const

/** `contract CollateralBTC is ERC20` ("Baserate Collateral BTC", "bcBTC"). */
export const collateralBtcAbi = [
  {
    type: 'function',
    name: 'wrap',
    stateMutability: 'payable',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'unwrap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
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
  ...collateralErrorsAbi,
] as const

/** `enum Profile { STANDARD, CANARY }` from IBorrowAccountFactory.sol. */
export const Profile = { STANDARD: 0, CANARY: 1 } as const
export type ProfileId = (typeof Profile)[keyof typeof Profile]

/** `contract BorrowAccountFactory`. */
export const borrowAccountFactoryAbi = [
  {
    type: 'function',
    name: 'openAndBorrow',
    stateMutability: 'payable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
  {
    type: 'function',
    name: 'openCanary',
    stateMutability: 'payable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'createAccount',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'accountOf',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'profile', type: 'uint8' },
    ],
    outputs: [
      { name: 'account', type: 'address' },
      { name: 'deployed', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'isAccount',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'marketParams',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'tuple', components: marketParamsComponents }],
  },
  {
    type: 'function',
    name: 'MARKET_ID',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'COLLATERAL',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'IMPLEMENTATION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'globalBorrowCap',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'limits',
    stateMutability: 'view',
    inputs: [{ name: 'profile', type: 'uint8' }],
    outputs: [
      { name: 'positionCap', type: 'uint128' },
      { name: 'ceilingBps', type: 'uint16' },
    ],
  },
  {
    type: 'function',
    name: 'borrowPaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'ORIGINATION_FEE_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'feeRecipient',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'comeBack',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'claimSig', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
    ],
    outputs: [
      { name: 'account', type: 'address' },
      { name: 'claimed', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'AccountCreated',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'profile', type: 'uint8', indexed: false },
    ],
  },
  ...baserateErrorsAbi,
] as const

/** `contract BorrowAccount` (EIP-1167 clone, owner-only). */
export const borrowAccountAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'openAndBorrow',
    stateMutability: 'payable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addCollateral',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'supplyIdle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repayAndWithdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'btcTo', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repayAndWithdrawWithPermit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'maxRepay', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
      { name: 'btcTo', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawCollateral',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'btcTo', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'collateral',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'debt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'borrowByModule',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'musdOut', type: 'uint256' },
      { name: 'maxLtvBps', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setModule',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'module', type: 'address' },
      { name: 'enabled', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rescueNative',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [],
  },
  { type: 'receive', stateMutability: 'payable' },
  ...baserateErrorsAbi,
] as const

/** `contract MusdDispenser` (testnet only). Admin `sweep` is omitted: its signature is not part of the shared interface. */
export const musdDispenserAbi = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimable',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'perAddressDaily',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'globalDaily',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'signer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setLimits',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perAddressDaily', type: 'uint256' },
      { name: 'globalDaily', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setSigner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'signer', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPaused',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'paused', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Claimed',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'day', type: 'uint256', indexed: true },
    ],
  },
  ...baserateErrorsAbi,
] as const

// ---------------------------------------------------------------------------------------------------------------
// Morpho Blue and the AdaptiveCurveIrm
// ---------------------------------------------------------------------------------------------------------------

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
