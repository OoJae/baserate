/**
 * How it works: the one true sequence on the page, so the only numbered list. Steps 01 and 02 are one transaction
 * (`factory.openAndBorrow`); step 04 is `repayAndWithdraw`, which never reads the oracle (docs/design/concept.md §3).
 */

export type StepStation = 'post' | 'ltv' | 'split' | 'exit'

export interface Step {
  n: '01' | '02' | '03' | '04'
  title: string
  body: string
  /** What the base-rate line becomes beside this step. */
  station: StepStation
}

export const STEPS: readonly Step[] = [
  {
    n: '01',
    title: 'Post BTC',
    body: 'Your BTC goes into a borrow account only you control. It is wrapped 1:1 as bcBTC and posted as collateral in M1, the BTC/MUSD market on Mezo’s own Morpho Blue.',
    station: 'post',
  },
  {
    n: '02',
    title: 'Borrow MUSD',
    body: 'In the same transaction, borrow MUSD at M1’s rate, up to the limit on the gauge. No redemption queue can close your loan. Only the liquidation threshold can.',
    station: 'ltv',
  },
  {
    n: '03',
    title: 'Save or lend',
    body: 'Hold MUSD as wsMUSD to earn sMUSD’s savings rate, or deposit it in vMUSD, which lends to M1 borrowers and keeps the rest in wsMUSD.',
    station: 'split',
  },
  {
    n: '04',
    title: 'Repay and exit',
    body: 'Repay in full and your BTC comes back in the same transaction. The exit never reads the price oracle, so it still works if prices freeze.',
    station: 'exit',
  },
]
