// biome-ignore-all lint/a11y/noRedundantRoles: the roles are explicit on purpose. On a phone each row is laid out as a
// card (CSS display changes), and some browsers drop a table's implicit roles when its display changes.
import { useId, useMemo, useState } from 'react'
import { Rich } from '../Rich'
import {
  type Finding,
  type FindingState,
  LEDGER,
  plural,
  type Round,
  type Severity,
  STATE_LABEL,
} from './ledger'

/*
 * Every finding in the ledger, round by round, with two filters (severity and where it stands). The tables keep their
 * table roles at every width: on a phone each row is laid out as a card, so the roles are set explicitly (a CSS
 * display change would otherwise drop them in some browsers).
 */

type SeverityFilter = 'all' | Severity
type StateFilter = 'all' | 'live' | 'open' | 'known'

const STATE_GROUPS: Record<Exclude<StateFilter, 'all'>, readonly FindingState[]> = {
  live: ['deployed', 'fixed', 'mitigated'],
  open: ['open', 'other'],
  known: ['known', 'documented'],
}

function matches(f: Finding, severity: SeverityFilter, state: StateFilter): boolean {
  if (severity !== 'all' && f.severity !== severity) return false
  if (state !== 'all' && !STATE_GROUPS[state].includes(f.state)) return false
  return true
}

function SeverityStamp({ finding }: { finding: Finding }) {
  const tone =
    finding.severity === 'Critical' || finding.severity === 'High' || finding.severity === 'Medium'
      ? 'sp-stamp sp-stamp--solid'
      : finding.severity === 'Low'
        ? 'sp-stamp'
        : 'sp-stamp sp-stamp--quiet'
  return <span className={tone}>{finding.severityLabel.replace(/\s*\(([^)]+)\)/, ' · $1')}</span>
}

function StateStamp({ state }: { state: FindingState }) {
  const tone =
    state === 'deployed' || state === 'fixed'
      ? 'sp-stamp sp-stamp--good'
      : state === 'mitigated'
        ? 'sp-stamp sp-stamp--brand'
        : state === 'open' || state === 'other'
          ? 'sp-stamp sp-stamp--warn'
          : 'sp-stamp sp-stamp--quiet'
  return <span className={tone}>{STATE_LABEL[state]}</span>
}

function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string
  name: string
  value: T
  options: readonly { value: T; label: string; count: number }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="sp-seg">
      <legend className="sp-serial sp-seg__legend">{legend}</legend>
      <div className="sp-seg__options">
        {options.map((option) => (
          <label key={option.value} className="sp-seg__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sp-seg__input"
            />
            <span className="sp-seg__face">
              {option.label}
              <span className="sp-seg__count">{option.count}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function RoundTable({ round, rows }: { round: Round; rows: Finding[] }) {
  const captionId = useId()
  return (
    <div className="sp-ledger__round">
      <div className="sp-ledger__head">
        <h3 className="sp-h3" id={captionId}>
          {round.title}
        </h3>
        <p className="sp-serial">
          {round.date} · {plural(round.counts.findings, 'finding')}
        </p>
      </div>
      {rows.length ? (
        <table className="sp-ledger" role="table" aria-labelledby={captionId}>
          <thead className="sp-ledger__thead" role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                ID
              </th>
              <th scope="col" role="columnheader">
                Severity
              </th>
              <th scope="col" role="columnheader">
                Finding
              </th>
              <th scope="col" role="columnheader">
                Where it stands
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((f) => (
              <tr key={f.id} role="row" className="sp-ledger__row">
                <th scope="row" role="rowheader" className="sp-ledger__id">
                  {f.ids.map((id) => (
                    <span key={id}>{id}</span>
                  ))}
                </th>
                <td role="cell" className="sp-ledger__sev">
                  <SeverityStamp finding={f} />
                </td>
                <td role="cell" className="sp-ledger__finding">
                  <p className="sp-ledger__title">
                    <Rich tokens={f.title} />
                  </p>
                  <p className="sp-ledger__where">
                    <Rich tokens={f.location} />
                  </p>
                </td>
                <td role="cell" className="sp-ledger__status">
                  <StateStamp state={f.state} />
                  {f.note.length ? (
                    <p className="sp-ledger__note">
                      <Rich tokens={f.note} />
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="sp-small sp-ledger__empty">No findings in this round match.</p>
      )}
    </div>
  )
}

export function LedgerTable() {
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [state, setState] = useState<StateFilter>('all')
  const all = useMemo(() => LEDGER.rounds.flatMap((r) => r.findings), [])
  const shown = all.filter((f) => matches(f, severity, state)).length
  const countSeverity = (s: SeverityFilter) => all.filter((f) => matches(f, s, state)).length
  const countState = (s: StateFilter) => all.filter((f) => matches(f, severity, s)).length
  // Severities that occur in the ledger (no empty Critical or High buttons).
  const severities = (['Critical', 'High', 'Medium', 'Low', 'Info'] as const).filter((s) =>
    all.some((f) => f.severity === s),
  )

  return (
    <div className="sp-ledger-wrap">
      <div className="sp-ledger__filters">
        <Segmented<SeverityFilter>
          legend="Severity"
          name="ledger-severity"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: 'all', label: 'All', count: countSeverity('all') },
            ...severities.map((s) => ({ value: s, label: s, count: countSeverity(s) })),
          ]}
        />
        <Segmented<StateFilter>
          legend="Where it stands"
          name="ledger-state"
          value={state}
          onChange={setState}
          options={[
            { value: 'all', label: 'All', count: countState('all') },
            { value: 'live', label: 'Fixed or mitigated', count: countState('live') },
            { value: 'open', label: 'Open', count: countState('open') },
            { value: 'known', label: 'Known limits', count: countState('known') },
          ]}
        />
      </div>
      <p className="sp-serial sp-ledger__shown" aria-live="polite">
        Showing {shown} of {plural(all.length, 'finding')}
      </p>
      <div className="sp-ledger__rounds">
        {LEDGER.rounds.map((round) => (
          <RoundTable
            key={round.n}
            round={round}
            rows={round.findings.filter((f) => matches(f, severity, state))}
          />
        ))}
      </div>
    </div>
  )
}
