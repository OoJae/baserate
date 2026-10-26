import data from '../../content/findings.gen.json'
import type { Token } from '../Rich'

/*
 * The security ledger as typed data: src/site/content/findings.gen.json, generated from docs/audit/FINDINGS.md by
 * scripts/gen-findings.mjs (run it after editing the ledger; `--check` fails CI when they drift). The page reads
 * nothing at runtime: the ledger is in the bundle.
 */

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info'
export type FindingState =
  | 'deployed'
  | 'fixed'
  | 'mitigated'
  | 'known'
  | 'documented'
  | 'open'
  | 'other'

export interface Finding {
  id: string
  ids: string[]
  severity: Severity
  qualifier: string | null
  severityLabel: string
  title: Token[]
  location: Token[]
  state: FindingState
  stateLabel: string
  note: Token[]
}

export interface Counts {
  findings: number
  bySeverity: Record<Severity, number>
  byState: Record<FindingState, number>
}

export interface Round {
  n: number
  title: string
  date: string
  dateIso: string
  reviewers: number | null
  intro: Token[][]
  limits: Token[] | null
  areas: { area: Token[]; scope: Token[]; poc: Token[] }[]
  findings: Finding[]
  notes: { intro: Token[]; items: Token[][] } | null
  sound: { area: Token[]; verified: Token[] }[]
  confirmed: Token[][]
  counts: Counts
}

export interface Ledger {
  source: string
  title: string
  intro: Token[][]
  totals: {
    rounds: number
    findings: number
    bySeverity: Record<Severity, number>
    byState: Record<FindingState, number>
  }
  rounds: Round[]
  staticAnalysis: {
    title: Token[]
    tool: string | null
    results: number | null
    detectors: number | null
    intro: Token[][]
    rows: { detector: Token[]; verdict: string | null; note: Token[] }[]
  }
  secretScanning: { title: Token[]; tool: string | null; items: Token[][] }
}

export const LEDGER = data as Ledger

export const SEVERITIES: readonly Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info']

/** The word a reader sees for each state (the ledger's own label stays in the note column). */
export const STATE_LABEL: Record<FindingState, string> = {
  deployed: 'Deployed',
  fixed: 'Fixed',
  mitigated: 'Mitigated',
  known: 'Known limit',
  documented: 'Documented',
  open: 'Open',
  other: 'See note',
}

/** Number words for small counts in running text ("three rounds"). */
export function countWord(n: number): string {
  return (
    ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ??
    n.toLocaleString('en-US')
  )
}

/** "1 finding" / "42 findings". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}
