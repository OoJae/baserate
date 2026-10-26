/**
 * The five denominations: each product as a banknote that links into the app. A face value is live only where it is
 * cheap to read (Borrow's rate, Lend's split); the others are fixed attributes of the contract, true by construction.
 * The serial is the contract's address on the app chain (read from the registry with the live reads).
 */

export type NoteKey = 'borrow' | 'save' | 'lend' | 'liquidate' | 'fees'

/** The registry key (src/chain.ts `registry.contracts`) of the contract a note's serial shows. */
export type NoteContract = 'factory' | 'wsMusd' | 'vMusd' | 'flashLiquidator' | 'feeRouter'

export interface Denomination {
  key: NoteKey
  name: string
  to: '/borrow' | '/save' | '/lend' | '/liquidate' | '/fees'
  /** `apr` and `split` are live; `fixed` is printed. */
  face: { kind: 'apr' } | { kind: 'split' } | { kind: 'fixed'; text: string; spoken?: string }
  /** The small word under the face value. */
  unit: string
  caption: string
  contract: NoteContract
  /** The contract's name, beside its address. */
  contractName: string
  /** The note's rosette: petals and the starting phase of its waves. */
  rosette: { petals: number; phase: number }
}

export const DENOMINATIONS: readonly Denomination[] = [
  {
    key: 'borrow',
    name: 'Borrow',
    to: '/borrow',
    face: { kind: 'apr' },
    unit: 'M1 borrow APR, live',
    caption: 'Borrow MUSD against your BTC, with no redemption queue.',
    contract: 'factory',
    contractName: 'BorrowAccountFactory',
    rosette: { petals: 24, phase: 0 },
  },
  {
    key: 'save',
    name: 'Save',
    to: '/save',
    face: { kind: 'fixed', text: '4626', spoken: 'ERC-4626' },
    unit: 'ERC-4626 vault',
    caption: 'wsMUSD holds sMUSD’s savings rate as a token any vault can use.',
    contract: 'wsMusd',
    contractName: 'WsMUSD',
    rosette: { petals: 18, phase: 0.6 },
  },
  {
    key: 'lend',
    name: 'Lend',
    to: '/lend',
    face: { kind: 'split' },
    unit: 'M1 / wsMUSD, live',
    caption: 'vMUSD lends your MUSD to M1 borrowers and keeps the rest in wsMUSD.',
    contract: 'vMusd',
    contractName: 'vMUSD',
    rosette: { petals: 30, phase: 1.2 },
  },
  {
    key: 'liquidate',
    name: 'Liquidate',
    to: '/liquidate',
    face: { kind: 'fixed', text: '0' },
    unit: 'MUSD of your own',
    caption: 'Liquidate an unhealthy M1 loan in one transaction: the seized BTC pays for it.',
    contract: 'flashLiquidator',
    contractName: 'FlashLiquidator',
    rosette: { petals: 12, phase: 0.3 },
  },
  {
    key: 'fees',
    name: 'Fees',
    to: '/fees',
    face: { kind: 'fixed', text: '40/40/20', spoken: '40, 40, 20' },
    unit: 'savers / voters / treasury',
    caption: 'Origination fees go to sMUSD savers, veBTC voters and the treasury.',
    contract: 'feeRouter',
    contractName: 'FeeRouter',
    rosette: { petals: 20, phase: 0.9 },
  },
]
