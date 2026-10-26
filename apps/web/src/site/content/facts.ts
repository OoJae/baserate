/**
 * Facts the proof section states as fixed numbers, each checked in the repo on 26 Oct 2026. They change only when
 * the repo does; update them together with the source named beside each.
 */
export const FACTS = {
  /**
   * Foundry tests in contracts/test: README.md "Tests" (754: unit, fuzz, invariant, audit PoCs, mainnet and testnet
   * forks), matching docs/audit/FINDINGS.md (547 non-fork + 188 fork after round 2, plus round 3's 19 PoCs).
   */
  foundryTests: 754,
  /** docs/audit/FINDINGS.md: Round 1 (25 Oct), Round 2 and Round 3 (26 Oct). Internal; no third-party audit yet. */
  reviewRounds: 3,
  /** docs/audit/FINDINGS.md, round 3: no Critical, High or Medium findings against the deployed v2 stack. */
  round3Severe: 0,
} as const

/** The keeper's public status page, for the proof section's keeper line. */
export const KEEPER_STATUS_PATH = '/status'
