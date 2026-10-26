/**
 * The problem section: four figures from Mezo mainnet, read on 23–24 Oct 2026 for the research brief. They are
 * dated facts, not live values; change them only together with their source in docs/research/brief.md §0 and
 * docs/design/concept.md §2.
 */

export interface ProblemFigure {
  id: string
  /** The figure as it is set in Bodoni. */
  value: string
  /** What a screen reader says instead of `value`, when the glyphs read badly ("104 → 1"). */
  spoken?: string
  /** The row's label: what the figure counts. */
  label: string
  /** One sentence, from the borrower's side. */
  body: string
  /** Where the number comes from: the read, then the repo document that records it. */
  source: string
}

/** The read's date, kept on one line (non-breaking spaces) when the label wraps. */
export const PROBLEM_AS_OF = 'Mezo mainnet · read\u00a023–24\u00a0Oct\u00a02026'

export const PROBLEM: readonly ProblemFigure[] = [
  {
    id: 'troves',
    value: '104 → 1',
    spoken: '104 to 1',
    label: 'Open MUSD troves',
    body: '104 borrowers had an MUSD trove open on 30 Nov 2025. By 23 Oct 2026, one was left.',
    source: 'TroveManager.getTroveOwnersCount() · docs/research/brief.md §0',
  },
  {
    id: 'price',
    value: '$0.989',
    label: 'MUSD price',
    body: 'That is under the $0.9925 floor set by the 0.75% redemption fee, so redeeming MUSD against an open trove pays. It has traded at $0.9885–0.9911 for 60 days.',
    source: 'Pyth MUSD/USD 0.98938 · CoinGecko 60-day range · brief.md §0',
  },
  {
    id: 'redeemed',
    value: '1.28M',
    spoken: '1.28 million',
    label: 'MUSD redeemed in 30 days',
    body: '681 redemptions burned 1,276,615 MUSD, and each one was paid in a borrower’s bitcoin.',
    source: 'TroveManager redemption events · brief.md §0',
  },
  {
    id: 'morpho',
    value: '0',
    label: 'MUSD lent on Mezo’s Morpho',
    body: 'Mezo’s Morpho Blue has one market, and it lends mUSDC. Nothing on Mezo lends MUSD.',
    source: 'Morpho Blue 0x5658…A311 · brief.md §0 · concept.md §2',
  },
]
