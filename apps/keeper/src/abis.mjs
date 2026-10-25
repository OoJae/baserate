import { parseAbi, parseAbiItem } from 'viem'

export const abi = {
  allocator: parseAbi([
    'function rebalance() returns (uint8 action, uint256 amount)',
    'function checkpoint() returns (bool recorded)',
    'function readyAt() view returns (uint256)',
    'struct Snapshot { uint256 m1SupplyAssets; uint256 m1BorrowAssets; uint256 m1Liquidity; uint256 bufferTarget; uint256 m1SupplyApy; uint256 wsMusdApy; uint256 apyWindow; uint256 vaultMarketAssets; uint256 vaultIdle; uint256 liquidityAvailable; }',
    'function previewRebalance() view returns (uint8 action, uint256 amount, Snapshot snapshot)',
  ]),
  factory: parseAbi([
    'function globalBorrowCap() view returns (uint256)',
    'function setGlobalBorrowCap(uint256 newCap)',
    'function openCanary(uint256 musdOut, uint256 maxLtvBps) payable returns (address account)',
    'function accountOf(address owner, uint8 profile) view returns (address account, bool deployed)',
    'function profileOf(address account) view returns (uint8)',
    'function isCanaryOperator(address) view returns (bool)',
    'function executableAt(bytes data) view returns (uint256)',
    'function setCanaryOperator(address operator, bool enabled)',
  ]),
  account: parseAbi([
    'function collateral() view returns (uint256)',
    'function debt() view returns (uint256)',
    'function borrow(uint256 musdOut, uint256 maxLtvBps, address receiver)',
  ]),
  oracle: parseAbi([
    'function price() view returns (uint256)',
    'struct Status { uint256 price; bool ok; uint256 skipPrice; uint256 skipAge; uint256 pythBtcPrice; uint256 pythBtcAge; bool pythBtcFresh; uint256 musdPrice; uint256 musdAge; bool musdFresh; uint256 deviationBps; }',
    'function status() view returns (Status s)',
  ]),
  liquidator: parseAbi([
    'function liquidate(address borrower, uint256 seizedAssets, uint8 venue, uint256 minProfit) returns (uint256 seized, uint256 repaid, uint256 profit)',
    'function quoteVenues(uint256 btcAmount) returns (uint256 oracleValue, uint256[3] proceeds)',
  ]),
  feeRouter: parseAbi([
    'function distribute()',
    'struct BribeTarget { address gauge; address bribe; }',
    'function targets() view returns (BribeTarget[])',
    'function epochStartOf(uint256 timestamp) pure returns (uint256)',
  ]),
  bribe: parseAbi([
    'function tokenRewardsPerEpoch(address token, uint256 epochStart) view returns (uint256)',
  ]),
  wsMusd: parseAbi([
    'function sync() returns (uint256 harvested)',
    'function pendingYield() view returns (uint256)',
    'function lastHarvest() view returns (uint64)',
    'function SMUSD() view returns (address)',
  ]),
  smusd: parseAbi([
    'function receiveProtocolYield(uint256 amount)',
    'function totalSupply() view returns (uint256)',
    'function strategy() view returns (address)',
    'function pcv() view returns (address)',
    'function vaultGauge() view returns (address)',
  ]),
  backstop: parseAbi([
    'function sync()',
    'function inventory() view returns (uint256)',
    'function availableCash() view returns (uint256)',
    'function nextRequestId() view returns (uint256)',
    'struct RedeemRequest { address owner; address receiver; uint128 shares; uint128 assets; uint64 claimableAt; }',
    'function redeemRequest(uint256 id) view returns (RedeemRequest)',
    'function claimRedeem(uint256 id) returns (uint256 assets)',
    'function sellInventory(uint256 btcIn, uint8 venue, uint256 minOut) returns (uint256 musdOut)',
    'function MAX_KEEPER_SALE() view returns (uint256)',
  ]),
  vault: parseAbi([
    'function decreaseAbsoluteCap(bytes idData, uint256 newAbsoluteCap)',
    'function absoluteCap(bytes32 id) view returns (uint256)',
    'function allocation(bytes32 id) view returns (uint256)',
    'function isSentinel(address) view returns (bool)',
  ]),
  morpho: parseAbi([
    'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  ]),
  erc20: parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ]),
}

export const events = {
  accountCreated: parseAbiItem(
    'event AccountCreated(address indexed owner, address indexed account, uint8 profile)',
  ),
}

export const VENUE = { BACKSTOP: 0, CL200: 1, VAMM: 2 }
export const ACTION = ['NONE', 'BUFFER_TOP_UP', 'TO_MARKET', 'TO_LIQUIDITY']
export const PROFILE = { STANDARD: 0, CANARY: 1 }
export const EIP1967_IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
