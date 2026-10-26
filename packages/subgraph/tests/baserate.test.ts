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
  RedeemPartiallyClaimed,
  RedeemRequested,
} from '../generated/Backstop/Backstop'
import { CheckpointRecorded, Rebalanced } from '../generated/BaserateAllocator/BaserateAllocator'
import {
  Accepted,
  AccountCreated,
  PendingInvalidated,
  Submitted,
} from '../generated/BorrowAccountFactory/BorrowAccountFactory'
import {
  BribeCarried,
  BribePosted,
  BribeRedirected,
  Distributed,
  SmusdShareToTreasury,
  SmusdYieldFailed,
} from '../generated/FeeRouter/FeeRouter'
import { Liquidated, NativeKept, NativeSwept } from '../generated/FlashLiquidator/FlashLiquidator'
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
import { Swept } from '../generated/templates/BorrowAccount/BorrowAccount'
import {
  Allocate,
  AccrueInterest as VaultAccrueInterest,
  Deposit as VaultDeposit,
} from '../generated/VMUSD/VaultV2'
import { Synced, Deposit as WsDeposit } from '../generated/WsMUSD/WsMUSD'
import { handleSwept } from '../src/account'
import { handleCheckpointRecorded, handleRebalanced } from '../src/allocator'
import {
  handleDeposit as handleBackstopDeposit,
  handleCheckpoint,
  handleRedeemClaimed,
  handleRedeemPartiallyClaimed,
  handleRedeemRequested,
} from '../src/backstop'
import { M1_ADAPTER, M1_MARKET_ID, WS_MUSD } from '../src/config'
import {
  handleAccepted,
  handleAccountCreated,
  handlePendingInvalidated,
  handleSubmitted,
} from '../src/factory'
import {
  handleBribeCarried,
  handleBribePosted,
  handleBribeRedirected,
  handleDistributed,
  handleSmusdShareToTreasury,
  handleSmusdYieldFailed,
} from '../src/fee-router'
import { handleLiquidated, handleNativeKept, handleNativeSwept } from '../src/flash-liquidator'
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

// Emitting addresses: any address works (the mappings key vaults by event.address). M1, wsMUSD and the M1 adapter
// come from src/config.ts, which the mappings compare against.
const FACTORY = '0x0ef62f97130fe4d1d22de4acc4163154f82890b1'
const MORPHO = '0xce1da828ca15cb1fdafa84c366a53c8106655a73'
const FLASH = '0x291868f26639bc619bac1e87b7a19ee84988e973'
const FEE_ROUTER = '0x2de420d13d808aeba11ab743abe630d0dd48c13b'
const BACKSTOP = '0x64fe4cc966e55a0081913a8bf72a22b007946c2b'
const VMUSD = '0x76a62ffefb0b9a5980750fb106df05ceff6b941a'
const ALLOCATOR = '0x8b1314d983973342da53a6e30cd5586d5d92d20f'
const M1 = M1_MARKET_ID
const OTHER_MARKET = '0x1111111111111111111111111111111111111111111111111111111111111111'
const OWNER = '0x0000000000000000000000000000000000000a11'
const ACCOUNT = '0x0000000000000000000000000000000000000acc'
const KEEPER = '0x000000000000000000000000000000000000beef'
const GAUGE = '0x0000000000000000000000000000000000006a06'
const BRIBE = '0x000000000000000000000000000000000000b41b'
const MUSD = '0x118917a40faf1cd7a13db0ef56c86de7973ac503'
const TREASURY = '0x0000000000000000000000000000000000007eaa'
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

  test('BorrowAccount.Swept records a SWEPT action for the owner', () => {
    handleSwept(
      changetype<Swept>(
        mockEvent(ACCOUNT, txHash(6), 0, 16, [
          pAddress('token', MUSD),
          pAddress('to', OWNER),
          pUint('amount', wad(3)),
        ]),
      ),
    )
    const id = eventIdHex(txHash(6), 0)
    assert.fieldEquals('AccountAction', id, 'kind', 'SWEPT')
    assert.fieldEquals('AccountAction', id, 'owner', OWNER)
    assert.fieldEquals('AccountAction', id, 'token', MUSD)
    assert.fieldEquals('AccountAction', id, 'amount', wad(3).toString())
    assert.fieldEquals('AccountAction', id, 'recipient', OWNER)
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

  test('NativeKept joins the liquidation it follows; NativeSwept is recorded on its own', () => {
    const tx = txHash(52)
    liquidate(tx, 3, wad(400), wad(1), ZERO_BI)
    handleLiquidated(
      changetype<Liquidated>(
        mockEvent(FLASH, tx, 9, 20, [
          pAddress('caller', KEEPER),
          pAddress('borrower', ACCOUNT),
          pSmall('venue', 2),
          pUint('seized', wad(1)),
          pUint('repaid', wad(400)),
          pUint('proceeds', wad(410)),
          pUint('profit', wad(10)),
        ]),
      ),
    )
    const leftover = BigInt.fromI32(12345)
    handleNativeKept(
      changetype<NativeKept>(
        mockEvent(FLASH, tx, 10, 20, [pAddress('caller', KEEPER), pUint('amount', leftover)]),
      ),
    )
    const liquidation = eventIdHex(tx, 3)
    assert.fieldEquals('Liquidation', liquidation, 'nativeKept', leftover.toString())
    assert.fieldEquals('FlashLiquidatorNative', eventIdHex(tx, 10), 'kind', 'KEPT')
    assert.fieldEquals('FlashLiquidatorNative', eventIdHex(tx, 10), 'liquidation', liquidation)

    handleNativeSwept(
      changetype<NativeSwept>(
        mockEvent(FLASH, txHash(53), 0, 21, [
          pAddress('caller', OWNER),
          pAddress('to', KEEPER),
          pUint('amount', leftover),
        ]),
      ),
    )
    const swept = eventIdHex(txHash(53), 0)
    assert.fieldEquals('FlashLiquidatorNative', swept, 'kind', 'SWEPT')
    assert.fieldEquals('FlashLiquidatorNative', swept, 'to', KEEPER)
    assert.fieldEquals('FlashLiquidatorNative', swept, 'amount', leftover.toString())
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
    assert.fieldEquals('Distribution', tx.toHexString(), 'smusdOutcome', 'DONATED')
    assert.fieldEquals('Distribution', tx.toHexString(), 'bribesCarried', '0')
  })

  test('carries and the sMUSD fallback are split out of retained and toTreasury', () => {
    const epoch = BigInt.fromI32(1760054400)
    const since = BigInt.fromI32(1760000000)

    // 10 MUSD of new fees: the gauge's 4 is carried (vote window closed), sMUSD's 4 fails and is carried.
    const first = txHash(61)
    handleBribeCarried(
      changetype<BribeCarried>(
        mockEvent(FEE_ROUTER, first, 1, 31, [
          pAddress('gauge', GAUGE),
          pUint('amount', wad(4)),
          pSmall('reason', 0),
        ]),
      ),
    )
    handleSmusdYieldFailed(
      changetype<SmusdYieldFailed>(
        mockEvent(FEE_ROUTER, first, 3, 31, [
          pUint('amount', wad(4)),
          pUint('failingSince', since),
        ]),
      ),
    )
    distributed(first, 4, 31, epoch, wad(10), ZERO_BI, ZERO_BI, wad(2), wad(8))
    const d1 = first.toHexString()
    assert.fieldEquals('Distribution', d1, 'bribesCarried', wad(4).toString())
    assert.fieldEquals('Distribution', d1, 'smusdCarried', wad(4).toString())
    assert.fieldEquals('Distribution', d1, 'smusdToTreasury', '0')
    assert.fieldEquals('Distribution', d1, 'smusdOutcome', 'FAILED')
    assert.fieldEquals('Distribution', d1, 'smusdFailingSince', since.toString())
    assert.fieldEquals('BribeCarry', eventIdHex(first, 1), 'distribution', d1)
    assert.fieldEquals('BribeCarry', eventIdHex(first, 1), 'reason', 'VOTE_WINDOW_CLOSED')
    assert.notInStore('PendingDistribution', d1)
    assert.fieldEquals('Protocol', 'baserate', 'feeRouterCarried', wad(8).toString())
    assert.fieldEquals('Protocol', 'baserate', 'smusdFailingSince', since.toString())

    // Two epochs later: 10 new + 8 carried. The bribe posts 8; sMUSD still fails, so its 8 go to the treasury.
    const second = txHash(62)
    handleBribePosted(
      changetype<BribePosted>(
        mockEvent(FEE_ROUTER, second, 1, 32, [
          pAddress('gauge', GAUGE),
          pAddress('bribe', BRIBE),
          pUint('epochStart', epoch),
          pUint('amount', wad(8)),
        ]),
      ),
    )
    handleSmusdShareToTreasury(
      changetype<SmusdShareToTreasury>(
        mockEvent(FEE_ROUTER, second, 3, 32, [
          pAddress('treasury', TREASURY),
          pUint('amount', wad(8)),
          pUint('failingSince', since),
        ]),
      ),
    )
    distributed(second, 4, 32, epoch, wad(18), ZERO_BI, wad(8), wad(10), ZERO_BI)
    const d2 = second.toHexString()
    assert.fieldEquals('Distribution', d2, 'smusdToTreasury', wad(8).toString())
    assert.fieldEquals('Distribution', d2, 'smusdOutcome', 'TO_TREASURY')
    assert.fieldEquals('Distribution', d2, 'bribesCarried', '0')
    assert.fieldEquals('Protocol', 'baserate', 'totalSmusdToTreasury', wad(8).toString())
    assert.fieldEquals('Protocol', 'baserate', 'totalToTreasury', wad(12).toString())
    assert.fieldEquals('Protocol', 'baserate', 'feeRouterCarried', '0')

    // A full donation ends the failure streak.
    distributed(txHash(63), 2, 33, epoch, wad(10), wad(4), wad(4), wad(2), ZERO_BI)
    assert.fieldEquals('Distribution', txHash(63).toHexString(), 'smusdOutcome', 'DONATED')
    assert.fieldEquals('Protocol', 'baserate', 'smusdFailingSince', '0')
    assert.entityCount('PendingDistribution', 0)
  })
})

function distributed(
  tx: Bytes,
  logIndex: i32,
  block: i32,
  epoch: BigInt,
  total: BigInt,
  toSmusd: BigInt,
  toBribes: BigInt,
  toTreasury: BigInt,
  retained: BigInt,
): void {
  handleDistributed(
    changetype<Distributed>(
      mockEvent(FEE_ROUTER, tx, logIndex, block, [
        pAddress('caller', KEEPER),
        pUint('epochStart', epoch),
        pUint('total', total),
        pUint('toSmusd', toSmusd),
        pUint('toBribes', toBribes),
        pUint('toTreasury', toTreasury),
        pUint('retained', retained),
      ]),
    ),
  )
}

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
    assert.fieldEquals('RedeemRequest', '0', 'status', 'PENDING')
    assert.fieldEquals('RedeemRequest', '0', 'sharesLeft', wad(40).toString())
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
    assert.fieldEquals('RedeemRequest', '0', 'status', 'CLAIMED')
    assert.fieldEquals('RedeemRequest', '0', 'claimedAssets', wad(40).toString())
    assert.fieldEquals('RedeemRequest', '0', 'sharesLeft', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'totalSupply', wad(60).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'reservedAssets', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'pendingRedeemCount', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'sharePrice', WAD.toString())
    const point = Bytes.fromHexString(BACKSTOP).concatI32(80).toHexString()
    assert.fieldEquals('SharePricePoint', point, 'sharePrice', WAD.toString())
  })

  test('a partial claim keeps the request open with the remainder; the last payment closes it', () => {
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
    // The deposit's closing Checkpoint (after Deposit) sets the exact book.
    checkpoint(wad(100), 70, 2)
    redeemRequested(wad(100), wad(100), 71)

    // Cash covers 30: pays 30, burns ceil(100 x 30 / 100) = 30 shares, keeps 70 shares (NAV cap 70) queued.
    checkpoint(wad(70), 80, 1)
    redeemClaimed(wad(30), wad(30), 80, 2)
    handleRedeemPartiallyClaimed(
      changetype<RedeemPartiallyClaimed>(
        mockEvent(BACKSTOP, txHash(80), 3, 80, [
          pUint('id', ZERO_BI),
          pUint('sharesLeft', wad(70)),
          pUint('assetsLeft', wad(70)),
        ]),
      ),
    )
    assert.fieldEquals('RedeemRequest', '0', 'status', 'PARTIALLY_CLAIMED')
    assert.fieldEquals('RedeemRequest', '0', 'claimed', 'false')
    assert.fieldEquals('RedeemRequest', '0', 'shares', wad(100).toString())
    assert.fieldEquals('RedeemRequest', '0', 'sharesLeft', wad(70).toString())
    assert.fieldEquals('RedeemRequest', '0', 'assetsLeft', wad(70).toString())
    assert.fieldEquals('RedeemRequest', '0', 'paidAssets', wad(30).toString())
    assert.fieldEquals('RedeemRequest', '0', 'burnedShares', wad(30).toString())
    assert.fieldEquals('RedeemRequest', '0', 'claimCount', '1')
    assert.fieldEquals('RedeemRequest', '0', 'lastClaimTransactionHash', txHash(80).toHexString())
    assert.fieldEquals('Vault', BACKSTOP, 'reservedAssets', wad(70).toString())
    assert.fieldEquals('Vault', BACKSTOP, 'pendingRedeemCount', '1')
    assert.fieldEquals('Vault', BACKSTOP, 'totalSupply', wad(70).toString())
    assert.fieldEquals('VaultFlow', eventIdHex(txHash(80), 2), 'redeemRequest', '0')

    // Later the book is 65 for the 70 shares left: the claim pays min(70, 65) and burns the rest.
    checkpoint(ZERO_BI, 90, 1)
    redeemClaimed(wad(70), wad(65), 90, 2)
    assert.fieldEquals('RedeemRequest', '0', 'status', 'CLAIMED')
    assert.fieldEquals('RedeemRequest', '0', 'claimed', 'true')
    assert.fieldEquals('RedeemRequest', '0', 'claimedAssets', wad(95).toString())
    assert.fieldEquals('RedeemRequest', '0', 'paidAssets', wad(95).toString())
    assert.fieldEquals('RedeemRequest', '0', 'sharesLeft', '0')
    assert.fieldEquals('RedeemRequest', '0', 'assetsLeft', '0')
    assert.fieldEquals('RedeemRequest', '0', 'claimCount', '2')
    assert.fieldEquals('RedeemRequest', '0', 'claimTransactionHash', txHash(90).toHexString())
    assert.fieldEquals('Vault', BACKSTOP, 'reservedAssets', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'pendingRedeemCount', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'totalSupply', '0')
    assert.fieldEquals('Vault', BACKSTOP, 'withdrawCount', '2')
    assert.fieldEquals('Vault', BACKSTOP, 'totalWithdrawn', wad(95).toString())
  })
})

function redeemRequested(shares: BigInt, assets: BigInt, block: i32): void {
  handleRedeemRequested(
    changetype<RedeemRequested>(
      mockEvent(BACKSTOP, txHash(block), 1, block, [
        pUint('id', ZERO_BI),
        pAddress('owner', OWNER),
        pAddress('receiver', OWNER),
        pUint('shares', shares),
        pUint('assets', assets),
        pUint('claimableAt', BigInt.fromI32(1760999999)),
      ]),
    ),
  )
}

function redeemClaimed(shares: BigInt, assets: BigInt, block: i32, logIndex: i32): void {
  handleRedeemClaimed(
    changetype<RedeemClaimed>(
      mockEvent(BACKSTOP, txHash(block), logIndex, block, [
        pUint('id', ZERO_BI),
        pAddress('receiver', OWNER),
        pUint('shares', shares),
        pUint('assets', assets),
      ]),
    ),
  )
}

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
    assert.fieldEquals('TimelockSubmission', id, 'expiresAt', '1761382400')
    assert.entityCount('GovernanceEvent', 2)
  })

  test('PendingInvalidated closes only the calls queued for the decreased parameter', () => {
    const cap = Bytes.fromHexString(SET_CAP + word('0de0b6b3a7640000'))
    const canary = Bytes.fromHexString(
      SET_LIMITS + word('01') + word('0de0b6b3a7640000') + word('1c84'),
    )
    const standard = Bytes.fromHexString(
      SET_LIMITS + word('00') + word('0de0b6b3a7640000') + word('1c84'),
    )
    submitted(cap, 110)
    submitted(canary, 111)
    submitted(standard, 112)
    const capId = eventIdHex(txHash(110), 0)
    const canaryId = eventIdHex(txHash(111), 0)
    const standardId = eventIdHex(txHash(112), 0)
    assert.fieldEquals('TimelockSubmission', capId, 'param', ZERO_WORD)
    assert.fieldEquals('TimelockSubmission', canaryId, 'param', '0x' + word('01'))

    // A cap cut invalidates the queued cap raise only (its param is always zero).
    invalidated(SET_CAP, ZERO_WORD, 113)
    assert.fieldEquals('TimelockSubmission', capId, 'status', 'INVALIDATED')
    assert.fieldEquals(
      'TimelockSubmission',
      capId,
      'resolveTransactionHash',
      txHash(113).toHexString(),
    )
    assert.fieldEquals('TimelockSubmission', canaryId, 'status', 'PENDING')
    assert.fieldEquals('TimelockSubmission', standardId, 'status', 'PENDING')
    assert.fieldEquals(
      'GovernanceEvent',
      eventIdHex(txHash(113), 0),
      'kind',
      'TIMELOCK_INVALIDATED',
    )
    assert.fieldEquals('GovernanceEvent', eventIdHex(txHash(113), 0), 'value', '1')

    // A CANARY limits cut leaves the STANDARD raise queued.
    invalidated(SET_LIMITS, '0x' + word('01'), 114)
    assert.fieldEquals('TimelockSubmission', canaryId, 'status', 'INVALIDATED')
    assert.fieldEquals('TimelockSubmission', standardId, 'status', 'PENDING')

    // The same cap raise can be queued again, and its execution resolves the new submission.
    submitted(cap, 115)
    handleAccepted(
      changetype<Accepted>(
        mockEvent(FACTORY, txHash(116), 0, 116, [pFixed('selector', SET_CAP), pBytes('data', cap)]),
      ),
    )
    assert.fieldEquals('TimelockSubmission', eventIdHex(txHash(115), 0), 'status', 'ACCEPTED')
    assert.fieldEquals('TimelockSubmission', capId, 'status', 'INVALIDATED')
  })

  test('an expired submission is marked EXPIRED when resubmitted or invalidated', () => {
    const cap = Bytes.fromHexString(SET_CAP + word('0de0b6b3a7640000'))
    const limits = Bytes.fromHexString(
      SET_LIMITS + word('00') + word('0de0b6b3a7640000') + word('1c84'),
    )
    // executableAt far in the past: the 14-day window ended before these blocks.
    submittedAt(cap, 120, BigInt.fromI32(1000))
    submittedAt(limits, 121, BigInt.fromI32(1000))
    submitted(cap, 122)
    assert.fieldEquals('TimelockSubmission', eventIdHex(txHash(120), 0), 'status', 'EXPIRED')
    assert.fieldEquals('TimelockSubmission', eventIdHex(txHash(122), 0), 'status', 'PENDING')

    invalidated(SET_LIMITS, ZERO_WORD, 123)
    assert.fieldEquals('TimelockSubmission', eventIdHex(txHash(121), 0), 'status', 'EXPIRED')
    assert.fieldEquals('GovernanceEvent', eventIdHex(txHash(123), 0), 'value', '0')
  })
})

const SET_CAP = '0xfccdf210' // setGlobalBorrowCap(uint256)
const SET_LIMITS = '0x8c793536' // setLimits(uint8,uint128,uint16)
const ZERO_WORD = '0x0000000000000000000000000000000000000000000000000000000000000000'

/** A 32-byte ABI word (hex, no 0x) holding `hex`, left-padded. */
function word(hex: string): string {
  return '0000000000000000000000000000000000000000000000000000000000000000'.slice(hex.length) + hex
}

function submittedAt(data: Bytes, n: i32, executableAt: BigInt): void {
  handleSubmitted(
    changetype<Submitted>(
      mockEvent(FACTORY, txHash(n), 0, n, [
        pFixed('selector', data.toHexString().slice(0, 10)),
        pBytes('data', data),
        pUint('executableAt', executableAt),
      ]),
    ),
  )
}

function submitted(data: Bytes, n: i32): void {
  submittedAt(data, n, BigInt.fromI32(1760172800))
}

function invalidated(selector: string, param: string, n: i32): void {
  handlePendingInvalidated(
    changetype<PendingInvalidated>(
      mockEvent(FACTORY, txHash(n), 0, n, [pFixed('selector', selector), pFixed('param', param)]),
    ),
  )
}
