import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as/assembly/index'
import {
  Deposit as BackstopDeposit,
  Checkpoint,
  RedeemClaimed,
  RedeemRequested,
} from '../generated/Backstop/Backstop'
import { CheckpointRecorded, Rebalanced } from '../generated/BaserateAllocator/BaserateAllocator'
import {
  Accepted,
  AccountCreated,
  Submitted,
} from '../generated/BorrowAccountFactory/BorrowAccountFactory'
import { BribePosted, BribeRedirected, Distributed } from '../generated/FeeRouter/FeeRouter'
import { Liquidated } from '../generated/FlashLiquidator/FlashLiquidator'
import {
  AccrueInterest,
  Borrow,
  CreateMarket,
  Liquidate,
  Repay,
  Supply,
  SupplyCollateral,
  WithdrawCollateral,
} from '../generated/Morpho/Morpho'
import {
  Allocate,
  AccrueInterest as VaultAccrueInterest,
  Deposit as VaultDeposit,
} from '../generated/VMUSD/VaultV2'
import { Synced, Deposit as WsDeposit } from '../generated/WsMUSD/WsMUSD'
import { handleCheckpointRecorded, handleRebalanced } from '../src/allocator'
import {
  handleDeposit as handleBackstopDeposit,
  handleCheckpoint,
  handleRedeemClaimed,
  handleRedeemRequested,
} from '../src/backstop'
import { handleAccepted, handleAccountCreated, handleSubmitted } from '../src/factory'
import { handleBribePosted, handleBribeRedirected, handleDistributed } from '../src/fee-router'
import { handleLiquidated } from '../src/flash-liquidator'
import {
  handleAccrueInterest,
  handleBorrow,
  handleCreateMarket,
  handleLiquidate,
  handleRepay,
  handleSupply,
  handleSupplyCollateral,
  handleWithdrawCollateral,
} from '../src/morpho'
import {
  handleAllocate,
  handleAccrueInterest as handleVaultAccrueInterest,
  handleDeposit as handleVaultDeposit,
} from '../src/vmusd'
import { handleSynced, handleDeposit as handleWsDeposit } from '../src/wsmusd'
import {
  eventIdHex,
  mockEvent,
  pAddress,
  pBytes,
  pFixed,
  pFixedArray,
  pInt,
  pSmall,
  pUint,
  txHash,
  WAD,
  wad,
} from './helpers'

const FACTORY = '0xa3a03cd439b4ccb7292ef21a23bb6bb36a4b86fe'
const MORPHO = '0xce1da828ca15cb1fdafa84c366a53c8106655a73'
const FLASH = '0x8259050ff9976c9154042ec9d955db8face929c8'
const FEE_ROUTER = '0x8266d915fb60ac45998bb919a815c8013b9bf1bc'
const BACKSTOP = '0xc06239d0cb52e51cc0edcf4b181da7ccacd1ac01'
const VMUSD = '0x00890f9e2367acf6ac26cc06d8bf6c4270da7440'
const ALLOCATOR = '0x5a28c3f024aecddc4828f2e5841038f647d8a067'
const WS_MUSD = '0x92aa0306c3af1e02d776ea05857653a3839debeb'
const M1_ADAPTER = '0xffbdbe74f1f118dde2c2fe09286f3aa9f448b394'
const M1 = '0xadd5f62435744e4fe91c94212024eba66fe93af38824bf264dee64258aebb13b'
const OTHER_MARKET = '0x1111111111111111111111111111111111111111111111111111111111111111'
const OWNER = '0x0000000000000000000000000000000000000a11'
const ACCOUNT = '0x0000000000000000000000000000000000000acc'
const KEEPER = '0x000000000000000000000000000000000000beef'
const GAUGE = '0x0000000000000000000000000000000000006a06'
const BRIBE = '0x000000000000000000000000000000000000b41b'
const SHARES = BigInt.fromString('1000000') // Morpho virtual shares per asset unit
const ZERO_BI = BigInt.zero()

// ---------------------------------------------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------------------------------------------

function accountCreated(): void {
  const e = changetype<AccountCreated>(
    mockEvent(FACTORY, txHash(1), 0, 10, [
      pAddress('owner', OWNER),
      pAddress('account', ACCOUNT),
      pSmall('profile', 0),
    ]),
  )
  handleAccountCreated(e)
}

function createM1(): void {
  const params = changetype<ethereum.Tuple>([
    ethereum.Value.fromAddress(Address.fromString(OWNER)),
    ethereum.Value.fromAddress(Address.fromString(ACCOUNT)),
    ethereum.Value.fromAddress(Address.fromString(KEEPER)),
    ethereum.Value.fromAddress(Address.fromString(GAUGE)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString('770000000000000000')),
  ])
  const e = changetype<CreateMarket>(
    mockEvent(MORPHO, txHash(2), 0, 11, [
      pFixed('id', M1),
      new ethereum.EventParam('marketParams', ethereum.Value.fromTuple(params)),
    ]),
  )
  handleCreateMarket(e)
}

function supply(market: string, assets: BigInt, block: i32): void {
  handleSupply(
    changetype<Supply>(
      mockEvent(MORPHO, txHash(3), 0, block, [
        pFixed('id', market),
        pAddress('caller', M1_ADAPTER),
        pAddress('onBehalf', M1_ADAPTER),
        pUint('assets', assets),
        pUint('shares', assets.times(SHARES)),
      ]),
    ),
  )
}

function supplyCollateral(assets: BigInt, block: i32): void {
  handleSupplyCollateral(
    changetype<SupplyCollateral>(
      mockEvent(MORPHO, txHash(4), 1, block, [
        pFixed('id', M1),
        pAddress('caller', ACCOUNT),
        pAddress('onBehalf', ACCOUNT),
        pUint('assets', assets),
      ]),
    ),
  )
}

function borrow(assets: BigInt, block: i32): void {
  handleBorrow(
    changetype<Borrow>(
      mockEvent(MORPHO, txHash(4), 2, block, [
        pFixed('id', M1),
        pAddress('caller', ACCOUNT),
        pAddress('onBehalf', ACCOUNT),
        pAddress('receiver', ACCOUNT),
        pUint('assets', assets),
        pUint('shares', assets.times(SHARES)),
      ]),
    ),
  )
}

/** Account with 2 BTC collateral and 1,000 MUSD debt in an M1 with 5,000 MUSD supplied. */
function openPosition(): void {
  accountCreated()
  createM1()
  supply(M1, wad(5000), 12)
  supplyCollateral(wad(2), 13)
  borrow(wad(1000), 13)
}

function liquidate(
  tx: Bytes,
  logIndex: i32,
  repaid: BigInt,
  seized: BigInt,
  badDebt: BigInt,
): void {
  handleLiquidate(
    changetype<Liquidate>(
      mockEvent(MORPHO, tx, logIndex, 20, [
        pFixed('id', M1),
        pAddress('caller', FLASH),
        pAddress('borrower', ACCOUNT),
        pUint('repaidAssets', repaid),
        pUint('repaidShares', repaid.times(SHARES)),
        pUint('seizedAssets', seized),
        pUint('badDebtAssets', badDebt),
        pUint('badDebtShares', badDebt.times(SHARES)),
      ]),
    ),
  )
}

afterEach(() => {
  clearStore()
})

// ---------------------------------------------------------------------------------------------------------------
// Accounts and M1
// ---------------------------------------------------------------------------------------------------------------

describe('accounts and M1 positions', () => {
  beforeEach(() => {
    openPosition()
  })

  test('AccountCreated registers the account and starts its BorrowAccount template', () => {
    assert.fieldEquals('Account', ACCOUNT, 'owner', OWNER)
    assert.fieldEquals('Account', ACCOUNT, 'profile', 'STANDARD')
    assert.fieldEquals('Account', ACCOUNT, 'canary', 'false')
    assert.fieldEquals('Protocol', 'baserate', 'accountCount', '1')
    assert.dataSourceCount('BorrowAccount', 1)
  })

  test('Morpho events replay the position and market totals', () => {
    assert.fieldEquals('Account', ACCOUNT, 'collateral', wad(2).toString())
    assert.fieldEquals('Account', ACCOUNT, 'borrowShares', wad(1000).times(SHARES).toString())
    assert.fieldEquals('Account', ACCOUNT, 'isOpen', 'true')
    assert.fieldEquals('Protocol', 'baserate', 'openPositionCount', '1')
    assert.fieldEquals('Market', M1, 'totalSupplyAssets', wad(5000).toString())
    assert.fieldEquals('Market', M1, 'totalBorrowAssets', wad(1000).toString())
    assert.fieldEquals('Market', M1, 'totalCollateral', wad(2).toString())
    assert.fieldEquals('Market', M1, 'utilization', '0.2')
    assert.fieldEquals('MarketEvent', eventIdHex(txHash(4), 2), 'kind', 'BORROW')
    assert.fieldEquals('MarketEvent', eventIdHex(txHash(4), 2), 'account', ACCOUNT)
    assert.entityCount('MarketDailySnapshot', 1)
  })

  test('events of other Morpho markets are ignored', () => {
    supply(OTHER_MARKET, wad(1), 14)
    assert.notInStore('Market', OTHER_MARKET)
    assert.fieldEquals('Market', M1, 'totalSupplyAssets', wad(5000).toString())
  })

  test('accrual, full repay and withdrawal close the position', () => {
    handleAccrueInterest(
      changetype<AccrueInterest>(
        mockEvent(MORPHO, txHash(5), 0, 15, [
          pFixed('id', M1),
          pUint('prevBorrowRate', BigInt.fromI32(1000)),
          pUint('interest', wad(10)),
          pUint('feeShares', ZERO_BI),
        ]),
      ),
    )
    assert.fieldEquals('Market', M1, 'totalBorrowAssets', wad(1010).toString())
    assert.fieldEquals('Market', M1, 'totalSupplyAssets', wad(5010).toString())

    handleRepay(
      changetype<Repay>(
        mockEvent(MORPHO, txHash(5), 1, 15, [
          pFixed('id', M1),
          pAddress('caller', ACCOUNT),
          pAddress('onBehalf', ACCOUNT),
          pUint('assets', wad(1010)),
          pUint('shares', wad(1000).times(SHARES)),
        ]),
      ),
    )
    handleWithdrawCollateral(
      changetype<WithdrawCollateral>(
        mockEvent(MORPHO, txHash(5), 2, 15, [
          pFixed('id', M1),
          pAddress('caller', ACCOUNT),
          pAddress('onBehalf', ACCOUNT),
          pAddress('receiver', OWNER),
          pUint('assets', wad(2)),
        ]),
      ),
    )
    assert.fieldEquals('Account', ACCOUNT, 'borrowShares', '0')
    assert.fieldEquals('Account', ACCOUNT, 'collateral', '0')
    assert.fieldEquals('Account', ACCOUNT, 'isOpen', 'false')
    assert.fieldEquals('Protocol', 'baserate', 'openPositionCount', '0')
    assert.fieldEquals('Market', M1, 'totalBorrowAssets', '0')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Liquidations
// ---------------------------------------------------------------------------------------------------------------

describe('liquidations', () => {
  beforeEach(() => {
    openPosition()
  })

  test('FlashLiquidator.Liquidated enriches the Morpho liquidation in the same transaction', () => {
    const tx = txHash(50)
    liquidate(tx, 3, wad(400), wad(1), ZERO_BI)
    handleLiquidated(
      changetype<Liquidated>(
        mockEvent(FLASH, tx, 9, 20, [
          pAddress('caller', KEEPER),
          pAddress('borrower', ACCOUNT),
          pSmall('venue', 0),
          pUint('seized', wad(1)),
          pUint('repaid', wad(400)),
          pUint('proceeds', wad(430)),
          pUint('profit', wad(12)),
        ]),
      ),
    )
    const id = eventIdHex(tx, 3)
    assert.entityCount('Liquidation', 1)
    assert.fieldEquals('Liquidation', id, 'viaFlashLiquidator', 'true')
    assert.fieldEquals('Liquidation', id, 'venue', 'BACKSTOP')
    assert.fieldEquals('Liquidation', id, 'liquidator', KEEPER)
    assert.fieldEquals('Liquidation', id, 'profit', wad(12).toString())
    assert.fieldEquals('Liquidation', id, 'account', ACCOUNT)
    assert.fieldEquals('Account', ACCOUNT, 'collateral', wad(1).toString())
    assert.fieldEquals('Account', ACCOUNT, 'borrowShares', wad(600).times(SHARES).toString())
    assert.fieldEquals('Account', ACCOUNT, 'liquidationCount', '1')
    assert.fieldEquals('Protocol', 'baserate', 'totalLiquidatorProfit', wad(12).toString())
  })

  test('bad debt clears the position and is socialised', () => {
    liquidate(txHash(51), 0, wad(300), wad(2), wad(700))
    assert.fieldEquals('Account', ACCOUNT, 'collateral', '0')
    assert.fieldEquals('Account', ACCOUNT, 'borrowShares', '0')
    assert.fieldEquals('Account', ACCOUNT, 'isOpen', 'false')
    assert.fieldEquals('Market', M1, 'totalBorrowAssets', '0')
    assert.fieldEquals('Market', M1, 'totalBorrowShares', '0')
    assert.fieldEquals('Market', M1, 'totalSupplyAssets', wad(4300).toString())
  })
})

// ---------------------------------------------------------------------------------------------------------------
// FeeRouter
// ---------------------------------------------------------------------------------------------------------------

describe('fee distributions', () => {
  test('a distribution is keyed by its transaction and collects its bribes', () => {
    const tx = txHash(60)
    const epoch = BigInt.fromI32(1760054400)
    handleBribePosted(
      changetype<BribePosted>(
        mockEvent(FEE_ROUTER, tx, 1, 30, [
          pAddress('gauge', GAUGE),
          pAddress('bribe', BRIBE),
          pUint('epochStart', epoch),
          pUint('amount', wad(4)),
        ]),
      ),
    )
    handleBribeRedirected(
      changetype<BribeRedirected>(
        mockEvent(FEE_ROUTER, tx, 2, 30, [
          pAddress('gauge', KEEPER),
          pUint('amount', wad(1)),
          pSmall('reason', 0),
        ]),
      ),
    )
    handleDistributed(
      changetype<Distributed>(
        mockEvent(FEE_ROUTER, tx, 3, 30, [
          pAddress('caller', KEEPER),
          pUint('epochStart', epoch),
          pUint('total', wad(10)),
          pUint('toSmusd', wad(5)),
          pUint('toBribes', wad(4)),
          pUint('toTreasury', wad(1)),
          pUint('retained', ZERO_BI),
        ]),
      ),
    )
    assert.fieldEquals('Distribution', tx.toHexString(), 'total', wad(10).toString())
    assert.fieldEquals('Bribe', eventIdHex(tx, 1), 'distribution', tx.toHexString())
    assert.fieldEquals('Bribe', eventIdHex(tx, 1), 'posted', 'true')
    assert.fieldEquals('Bribe', eventIdHex(tx, 2), 'posted', 'false')
    assert.fieldEquals('Bribe', eventIdHex(tx, 2), 'redirectReason', 'GAUGE_DEAD')
    assert.fieldEquals('Protocol', 'baserate', 'totalDistributed', wad(10).toString())
    assert.fieldEquals('Protocol', 'baserate', 'distributionCount', '1')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Backstop
// ---------------------------------------------------------------------------------------------------------------

function checkpoint(book: BigInt, block: i32, logIndex: i32): void {
  handleCheckpoint(
    changetype<Checkpoint>(
      mockEvent(BACKSTOP, txHash(block), logIndex, block, [
        pUint('book', book),
        pUint('unvested', ZERO_BI),
        pUint('periodEnd', ZERO_BI),
        pUint('inventory', ZERO_BI),
      ]),
    ),
  )
}

describe('backstop exits', () => {
  test('a queued exit reserves assets, and its claim burns the shares at the book price', () => {
    checkpoint(ZERO_BI, 70, 0)
    handleBackstopDeposit(
      changetype<BackstopDeposit>(
        mockEvent(BACKSTOP, txHash(70), 1, 70, [
          pAddress('sender', OWNER),
          pAddress('owner', OWNER),
          pUint('assets', wad(100)),
          pUint('shares', wad(100)),
        ]),
      ),
    )
    assert.fieldEquals('Vault', BACKSTOP, 'kind', 'BACKSTOP')
    assert.fieldEquals('Vault', BACKSTOP, 'totalSupply', wad(100).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'sharePrice', WAD.toString())

    handleRedeemRequested(
      changetype<RedeemRequested>(
        mockEvent(BACKSTOP, txHash(71), 1, 71, [
          pUint('id', ZERO_BI),
          pAddress('owner', OWNER),
          pAddress('receiver', KEEPER),
          pUint('shares', wad(40)),
          pUint('assets', wad(40)),
          pUint('claimableAt', BigInt.fromI32(1760999999)),
        ]),
      ),
    )
    assert.fieldEquals('RedeemRequest', '0', 'claimed', 'false')
    assert.fieldEquals('Vault', BACKSTOP, 'reservedAssets', wad(40).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'pendingRedeemCount', '1')

    // claimRedeem emits its closing Checkpoint (book already reduced) before RedeemClaimed.
    checkpoint(wad(60), 80, 1)
    handleRedeemClaimed(
      changetype<RedeemClaimed>(
        mockEvent(BACKSTOP, txHash(80), 2, 80, [
          pUint('id', ZERO_BI),
          pAddress('receiver', KEEPER),
          pUint('shares', wad(40)),
          pUint('assets', wad(40)),
        ]),
      ),
    )
    assert.fieldEquals('RedeemRequest', '0', 'claimed', 'true')
    assert.fieldEquals('RedeemRequest', '0', 'claimedAssets', wad(40).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'totalSupply', wad(60).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'reservedAssets', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'pendingRedeemCount', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'sharePrice', WAD.toString())
    const point = Bytes.fromHexString(BACKSTOP).concatI32(80).toHexString()
    assert.fieldEquals('SharePricePoint', point, 'sharePrice', WAD.toString())
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Vaults and allocator
// ---------------------------------------------------------------------------------------------------------------

describe('vaults and allocator', () => {
  test('vMUSD replays Vault V2 total assets and fee shares', () => {
    handleVaultAccrueInterest(
      changetype<VaultAccrueInterest>(
        mockEvent(VMUSD, txHash(90), 0, 90, [
          pUint('previousTotalAssets', ZERO_BI),
          pUint('newTotalAssets', ZERO_BI),
          pUint('performanceFeeShares', ZERO_BI),
          pUint('managementFeeShares', ZERO_BI),
        ]),
      ),
    )
    handleVaultDeposit(
      changetype<VaultDeposit>(
        mockEvent(VMUSD, txHash(90), 1, 90, [
          pAddress('sender', OWNER),
          pAddress('onBehalf', OWNER),
          pUint('assets', wad(100)),
          pUint('shares', wad(100)),
        ]),
      ),
    )
    assert.fieldEquals('Vault', VMUSD, 'sharePrice', WAD.toString())

    handleVaultAccrueInterest(
      changetype<VaultAccrueInterest>(
        mockEvent(VMUSD, txHash(91), 0, 91, [
          pUint('previousTotalAssets', wad(100)),
          pUint('newTotalAssets', wad(110)),
          pUint('performanceFeeShares', wad(1)),
          pUint('managementFeeShares', ZERO_BI),
        ]),
      ),
    )
    const expected = wad(110)
      .plus(BigInt.fromI32(1))
      .times(WAD)
      .div(wad(101).plus(BigInt.fromI32(1)))
    assert.fieldEquals('Vault', VMUSD, 'totalAssets', wad(110).toString())
    assert.fieldEquals('Vault', VMUSD, 'totalSupply', wad(101).toString())
    assert.fieldEquals('Vault', VMUSD, 'performanceFeeShares', wad(1).toString())
    assert.fieldEquals('Vault', VMUSD, 'sharePrice', expected.toString())

    handleAllocate(
      changetype<Allocate>(
        mockEvent(VMUSD, txHash(92), 0, 92, [
          pAddress('sender', ALLOCATOR),
          pAddress('adapter', M1_ADAPTER),
          pUint('assets', wad(50)),
          pFixedArray('ids', [Bytes.fromHexString(M1)]),
          pInt('change', wad(50)),
        ]),
      ),
    )
    assert.fieldEquals('VaultAllocation', eventIdHex(txHash(92), 0), 'adapterKind', 'M1_MARKET')
    assert.fieldEquals('VaultAllocation', eventIdHex(txHash(92), 0), 'change', wad(50).toString())
  })

  test('wsMUSD prices flows and syncs; allocator checkpoints update it too', () => {
    handleWsDeposit(
      changetype<WsDeposit>(
        mockEvent(WS_MUSD, txHash(93), 0, 93, [
          pAddress('sender', OWNER),
          pAddress('owner', OWNER),
          pUint('assets', wad(100)),
          pUint('shares', wad(100)),
        ]),
      ),
    )
    handleSynced(
      changetype<Synced>(
        mockEvent(WS_MUSD, txHash(94), 0, 94, [
          pUint('harvested', wad(2)),
          pUint('instant', ZERO_BI),
          pUint('surplus', ZERO_BI),
          pUint('stored', wad(101)),
          pUint('unvested', wad(1)),
          pUint('periodEnd', BigInt.fromI32(1761000000)),
        ]),
      ),
    )
    const synced = wad(101)
      .plus(BigInt.fromI32(1))
      .times(WAD)
      .div(wad(100).plus(BigInt.fromI32(1)))
    assert.fieldEquals('Vault', WS_MUSD, 'sharePrice', synced.toString())
    assert.fieldEquals('Vault', WS_MUSD, 'totalAssets', wad(101).toString())
    assert.entityCount('WsMusdSync', 1)

    const observed = BigInt.fromString('1050000000000000000')
    handleCheckpointRecorded(
      changetype<CheckpointRecorded>(
        mockEvent(ALLOCATOR, txHash(95), 0, 95, [
          pUint('index', BigInt.fromI32(3)),
          pUint('timestamp', BigInt.fromI32(1760000300)),
          pUint('sharePrice', observed),
        ]),
      ),
    )
    assert.fieldEquals('Vault', WS_MUSD, 'sharePrice', observed.toString())
    assert.fieldEquals('AllocatorCheckpoint', eventIdHex(txHash(95), 0), 'index', '3')
  })

  test('Rebalanced records the action', () => {
    handleRebalanced(
      changetype<Rebalanced>(
        mockEvent(ALLOCATOR, txHash(96), 0, 96, [
          pSmall('action', 2),
          pUint('amount', wad(25)),
          pUint('m1SupplyApy', BigInt.fromString('60000000000000000')),
          pUint('wsMusdApy', BigInt.fromString('40000000000000000')),
          pUint('apyWindow', BigInt.fromI32(604800)),
          pUint('m1Liquidity', wad(500)),
          pUint('bufferTarget', wad(250)),
        ]),
      ),
    )
    const id = eventIdHex(txHash(96), 0)
    assert.fieldEquals('Rebalance', id, 'action', 'TO_MARKET')
    assert.fieldEquals('Rebalance', id, 'actionId', '2')
    assert.fieldEquals('Rebalance', id, 'amount', wad(25).toString())
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------------------------------------------

describe('factory timelock', () => {
  test('Submitted then Accepted resolves the submission', () => {
    const selector = '0xe74b981b'
    const data = Bytes.fromHexString(
      selector + '0000000000000000000000008266d915fb60ac45998bb919a815c8013b9bf1bc',
    )
    handleSubmitted(
      changetype<Submitted>(
        mockEvent(FACTORY, txHash(100), 0, 100, [
          pFixed('selector', selector),
          pBytes('data', data),
          pUint('executableAt', BigInt.fromI32(1760172800)),
        ]),
      ),
    )
    const id = eventIdHex(txHash(100), 0)
    assert.fieldEquals('TimelockSubmission', id, 'status', 'PENDING')
    assert.fieldEquals('TimelockSubmission', id, 'data', data.toHexString())

    handleAccepted(
      changetype<Accepted>(
        mockEvent(FACTORY, txHash(101), 0, 101, [
          pFixed('selector', selector),
          pBytes('data', data),
        ]),
      ),
    )
    assert.fieldEquals('TimelockSubmission', id, 'status', 'ACCEPTED')
    assert.fieldEquals(
      'TimelockSubmission',
      id,
      'resolveTransactionHash',
      txHash(101).toHexString(),
    )
    assert.entityCount('GovernanceEvent', 2)
  })
})
