import { plainText, Rich } from '../Rich'
import { countWord, LEDGER, plural, type Round, SEVERITIES } from './ledger'

/*
 * The review rounds side by side: when, who, what they found by severity, and what happened to it. All of it is the
 * ledger's (findings.gen.json); the only words added here are the column labels.
 */

function SeverityLine({ round }: { round: Round }) {
  const parts = SEVERITIES.filter((s) => round.counts.bySeverity[s] > 0).map(
    (s) => `${round.counts.bySeverity[s]} ${s}`,
  )
  const severe = round.counts.bySeverity.Critical + round.counts.bySeverity.High
  return (
    <p className="sp-serial sp-round__sev">
      {severe === 0 ? 'No critical or high · ' : ''}
      {parts.join(' · ')}
    </p>
  )
}

function StateLine({ round }: { round: Round }) {
  const s = round.counts.byState
  const live = s.deployed + s.fixed
  const parts = [
    live ? `${live} fixed and live` : null,
    s.mitigated ? `${s.mitigated} mitigated` : null,
    s.known + s.documented ? `${s.known + s.documented} known limits, documented` : null,
    s.open + s.other ? `${s.open + s.other} open` : null,
  ].filter(Boolean)
  return <p className="sp-round__state">{parts.join(' · ')}</p>
}

export function RoundCards() {
  return (
    <ol className="sp-rounds">
      {LEDGER.rounds.map((round) => (
        <li key={round.n} className="sp-round">
          <p className="sp-serial">
            {round.title} · <time dateTime={round.dateIso}>{round.date}</time>
          </p>
          <p className="sp-round__count">
            <span className="sp-numeral">{round.counts.findings}</span>
            <span className="sp-round__unit">
              {round.counts.findings === 1 ? 'finding' : 'findings'}
              {round.reviewers ? `, ${countWord(round.reviewers)} reviewers` : ''}
            </span>
          </p>
          <SeverityLine round={round} />
          <StateLine round={round} />
          <div className="sp-prose sp-small sp-round__intro">
            {round.intro.map((para) => (
              <p key={plainText(para).slice(0, 48)}>
                <Rich tokens={para} />
              </p>
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Round 1's split of the code between four reviewers, from the ledger's own table. */
export function ReviewAreas() {
  const first = LEDGER.rounds.find((r) => r.areas.length)
  if (!first) return null
  return (
    <div className="sp-areas">
      <h3 className="sp-h3">
        {first.title}: {countWord(first.areas.length)} reviewers, one area each
      </h3>
      <table className="sp-table sp-gap">
        <caption className="sp-sr">
          {first.title} review areas, their scope and the proof-of-concept file
        </caption>
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">Scope</th>
            <th scope="col">Proofs of concept</th>
          </tr>
        </thead>
        <tbody>
          {first.areas.map((a) => (
            <tr key={a.area.map((t) => t.v).join('')}>
              <th scope="row">
                <Rich tokens={a.area} />
              </th>
              <td>
                <Rich tokens={a.scope} />
              </td>
              <td>
                <Rich tokens={a.poc} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What the reviewers checked and found sound (round 1's table, round 3's paragraph). */
export function FoundSound() {
  const table = LEDGER.rounds.find((r) => r.sound.length)
  const later = LEDGER.rounds.filter((r) => r.confirmed.length)
  return (
    <div className="sp-sound">
      {table ? (
        <div>
          <h3 className="sp-h3">What {table.title.toLowerCase()} found sound</h3>
          <dl className="sp-sound__list sp-gap">
            {table.sound.map((row) => (
              <div key={row.area.map((t) => t.v).join('')}>
                <dt>
                  <Rich tokens={row.area} />
                </dt>
                <dd>
                  <Rich tokens={row.verified} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {later.map((round) => (
        <div key={round.n} className="sp-prose sp-small sp-gap">
          {round.confirmed.map((para) => (
            <p key={plainText(para).slice(0, 48)}>
              <strong>{round.title}. </strong>
              <Rich tokens={para} />
            </p>
          ))}
        </div>
      ))}
      {LEDGER.rounds
        .filter((r) => r.notes)
        .map((round) =>
          round.notes ? (
            <div key={`notes-${round.n}`} className="sp-gap">
              <p className="sp-small">
                <Rich tokens={round.notes.intro} />
              </p>
              <ul className="sp-list sp-small sp-gap-sm">
                {round.notes.items.map((item) => (
                  <li key={item.map((t) => t.v).join('')}>
                    <Rich tokens={item} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      <p className="sp-serial sp-source">
        {plural(LEDGER.totals.findings, 'finding')} over {countWord(LEDGER.totals.rounds)} rounds ·
        generated from {LEDGER.source}
      </p>
    </div>
  )
}
