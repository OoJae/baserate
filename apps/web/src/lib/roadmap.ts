/** Features of the next release. Shown as a clearly labelled roadmap, never as working screens. */
export const NEXT_RELEASE: { label: string; blurb: string }[] = [
  { label: 'Credit lines', blurb: 'Capped, revocable MUSD credit for apps and agents' },
  { label: 'Come back', blurb: 'Reclaim surplus BTC from redeemed troves into a position' },
]

/** Planned infrastructure without a page of its own (listed on Evidence → Built vs planned). */
export const PLANNED_INFRA: { label: string; blurb: string }[] = [
  { label: 'Keeper service', blurb: 'Automated rebalances, liquidations and fee distributions' },
  { label: 'Subgraph', blurb: 'Indexed history instead of reading logs in the browser' },
  { label: 'Mainnet proof mode', blurb: 'The same contracts on Mezo mainnet, caps ≤ 2,000 MUSD' },
]
