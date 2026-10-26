import type { CSSProperties } from 'react'
import { Medallion, useWide } from '../parts/engraving'
import { Band, Cta, Ctas, Masthead, OnThisPage, Plate, Serial, SitePage } from '../parts/layout'
import { REPO_URL, repoDir, repoFile } from '../parts/links'
import { Rich } from '../parts/Rich'
import { PRECOMPILE_LIMIT, PrecompileBudget } from '../parts/security/Budget'
import { LedgerTable } from '../parts/security/LedgerTable'
import { countWord, LEDGER, plural } from '../parts/security/ledger'
import { FoundSound, ReviewAreas, RoundCards } from '../parts/security/Rounds'

/*
 * /security: the internal review rounds and every finding, generated at build time from docs/audit/FINDINGS.md
 * (scripts/gen-findings.mjs → src/site/content/findings.gen.json), plus what pauses, what never does, and what is
 * not solved (docs/SECURITY.md). Counts are computed from the ledger, never typed.
 */

const SECTIONS = [
  { id: 'rounds', label: 'Rounds' },
  { id: 'findings', label: 'Findings' },
  { id: 'limits', label: 'Measured limits' },
  { id: 'pauses', label: 'Pauses' },
  { id: 'analysis', label: 'Static analysis' },
  { id: 'known', label: 'Known limitations' },
  { id: 'sources', label: 'Sources' },
] as const

const totals = LEDGER.totals
const severe = totals.bySeverity.Critical + totals.bySeverity.High
const fixedLive = totals.byState.deployed + totals.byState.fixed
const open = totals.byState.open + totals.byState.other
const lastRound = LEDGER.rounds.at(-1)
const lastOpen = lastRound ? lastRound.counts.byState.open + lastRound.counts.byState.other : 0

/** The ledger engraved around the rim: each round's date and count, as microprint. */
const MICROTEXT = `${LEDGER.rounds
  .map((r) => `${r.title} ${r.date} ${plural(r.counts.findings, 'finding')}`)
  .join(' · ')} · no third-party audit yet`.toUpperCase()

function LedgerFigure() {
  const wide = useWide()
  return (
    <Medallion
      wide={wide}
      spec={{ petals: 22, lines: 14, twist: 0.2, microtext: MICROTEXT }}
      centre={
        <g className="sp-fade">
          <text x="500" y="492" className="sp-medal__num" textAnchor="middle">
            {totals.findings}
          </text>
          <text x="500" y="566" className="sp-medal__label" textAnchor="middle">
            FINDINGS LOGGED
          </text>
        </g>
      }
    />
  )
}

export function SecurityPage() {
  return (
    <SitePage>
      <Masthead
        label="Security"
        meta={<>Ledger · {LEDGER.source}</>}
        lines={['What we checked, ', 'what we fixed, ', <em key="open">what is still open.</em>]}
        lead={
          <>
            Baserate has had no third-party audit yet. It has been through{' '}
            {countWord(totals.rounds)} internal review rounds by independent AI reviewers, and every
            confirmed finding came with a test that proves it. Every finding and where it stands is
            below, generated from the ledger in the repository.
          </>
        }
        figure={<LedgerFigure />}
      >
        <dl
          className="sp-figures sp-mast__after sp-mast__figures"
          style={{ '--cols': 4 } as CSSProperties}
        >
          <div>
            <dt>Findings logged over {countWord(totals.rounds)} rounds</dt>
            <dd className="sp-numeral">{totals.findings}</dd>
          </div>
          <div>
            <dt>Critical or high</dt>
            <dd className="sp-numeral">{severe}</dd>
          </div>
          <div>
            <dt>Fixed and live on testnet</dt>
            <dd className="sp-numeral">{fixedLive}</dd>
          </div>
          <div>
            <dt>Still open</dt>
            <dd className="sp-numeral">{open}</dd>
          </div>
        </dl>
      </Masthead>
      <OnThisPage items={SECTIONS} />

      <Plate
        id="rounds"
        label="Rounds"
        source={`${countWord(totals.rounds)} rounds · ${LEDGER.rounds[0]?.date ?? ''}–${lastRound?.date ?? ''}`}
        title={
          <>
            Reviewed {countWord(totals.rounds)} times, <em>fixes included</em>
          </>
        }
        intro={
          <div className="sp-prose">
            {LEDGER.intro.map((para) => (
              <p
                key={para
                  .map((t) => t.v)
                  .join('')
                  .slice(0, 40)}
              >
                <Rich tokens={para} />
              </p>
            ))}
          </div>
        }
      >
        <div className="sp-stack">
          <div className="sp-notice">
            <span className="sp-stamp sp-stamp--solid">No third-party audit yet</span>
            <p className="sp-small">
              These are internal reviews, not an audit. A third-party audit comes before any cap
              increase, and the planned mainnet launch caps all borrowing at 2,000 MUSD.
            </p>
          </div>
          <RoundCards />
          <ReviewAreas />
        </div>
      </Plate>

      <Plate
        id="findings"
        ground="paper"
        label="The ledger"
        source={`${plural(totals.findings, 'finding')} · ${LEDGER.source}`}
        title={
          <>
            Every finding, and <em>where it stands</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Each confirmed finding has a proof-of-concept test, and each fix a regression test that
            keeps it fixed. Filter by severity, or by where the finding stands now.
          </p>
        }
      >
        <div className="sp-stack">
          <LedgerTable />
          <FoundSound />
        </div>
      </Plate>

      <Plate
        id="limits"
        label="Measured limits"
        source="Mezo: 20 precompile calls per transaction · 10M block gas"
        title={
          <>
            Mezo’s limits, <em>measured</em>
          </>
        }
        intro={
          <p className="sp-lead">
            A Mezo transaction may make at most {PRECOMPILE_LIMIT} calls to the chain’s precompiles,
            the built-in contracts behind the BTC token and the Skip price. Past that it reverts, so
            every flow’s count was measured, reverted calls included.
          </p>
        }
      >
        <div className="sp-split sp-split--wide-text">
          <PrecompileBudget />
          <div className="sp-prose">
            {LEDGER.rounds
              .filter((r) => r.limits)
              .map((r) => (
                <p key={r.n}>
                  <strong>Measured in {r.title.toLowerCase()}: </strong>
                  <Rich tokens={r.limits ?? []} />
                </p>
              ))}
            <p>
              Mezo’s own gas estimate leaves out what precompile calls cost, so both the app and the
              keeper send each transaction with at least twice the estimate. Unused gas is not
              charged.
            </p>
          </div>
        </div>
      </Plate>

      <Plate
        id="pauses"
        ground="paper"
        label="Pauses and timelocks"
        source="BorrowAccountFactory · Vault V2 · Backstop · WsMUSD"
        title={
          <>
            What can stop, and what <em>never does</em>
          </>
        }
        intro={
          <p className="sp-lead">
            A sentinel can stop new risk at once. Nothing can stop you from leaving: exits never
            pause, and every increase waits in public.
          </p>
        }
      >
        <div className="sp-stack">
          <div className="sp-pauses">
            <div className="sp-pauses__col">
              <Serial>Instantly</Serial>
              <h3 className="sp-h3">The sentinel can</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>Pause new borrowing and credit draws.</li>
                <li>
                  Cut caps and LTV ceilings. A cut also cancels every raise of that limit queued
                  before it.
                </li>
                <li>Remove modules and canary operators, and revoke pending raises.</li>
                <li>Lower vMUSD’s caps and pull its allocations.</li>
                <li>Pause backstop deposits.</li>
              </ul>
              <p className="sp-small sp-gap">Unpausing takes the governor.</p>
            </div>
            <div className="sp-pauses__col sp-pauses__col--never">
              <Serial>Never paused</Serial>
              <h3 className="sp-h3">Nobody can stop</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>Repaying, and adding collateral.</li>
                <li>The full exit: repay and withdraw, in one transaction.</li>
                <li>Unwrapping bcBTC, and redeeming wsMUSD, which has no pause at all.</li>
                <li>Liquidations, and the backstop’s exit queue.</li>
                <li>
                  Withdrawing part of your BTC, as long as the position stays within its LTV limit.
                </li>
              </ul>
            </div>
            <div className="sp-pauses__col">
              <Serial>In public</Serial>
              <h3 className="sp-h3">Every increase waits</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>
                  Cap and ceiling raises, fee-recipient changes, module approvals and
                  canary-operator grants wait 48 hours.
                </li>
                <li>wsMUSD cap raises wait 72 hours.</li>
                <li>A queued raise lapses 14 days after it becomes executable.</li>
              </ul>
            </div>
          </div>
          <div className="sp-split sp-split--even">
            <div className="sp-prose">
              <h3 className="sp-h3">Nothing to upgrade</h3>
              <p>
                None of Baserate’s contracts sits behind a proxy. The oracle, wsMUSD, bcBTC, the
                BorrowAccount implementation and its factory are immutable; the FeeRouter has no
                owner at all.
              </p>
            </div>
            <div className="sp-prose">
              <h3 className="sp-h3">No meta-transactions</h3>
              <p>
                No ERC-2771, no <code className="sp-code">_msgSender()</code>, no{' '}
                <code className="sp-code">tx.origin</code>. A forwarder bug was behind the October
                2026 veBTC exploit; Baserate has no forwarder to get wrong.
              </p>
            </div>
          </div>
        </div>
      </Plate>

      <Plate
        id="analysis"
        label="Static analysis and secrets"
        source={`${LEDGER.staticAnalysis.tool ?? 'Slither'} · ${LEDGER.secretScanning.tool ?? 'gitleaks'}`}
        title={
          <>
            Every warning, <em>triaged</em>
          </>
        }
        intro={
          <p className="sp-lead">
            {LEDGER.staticAnalysis.tool ?? 'Slither'} ran over the contracts, dependencies excluded:{' '}
            {LEDGER.staticAnalysis.results?.toLocaleString('en-US') ?? 'all its'} results across{' '}
            {LEDGER.staticAnalysis.detectors ?? 'its'} detectors, triaged below.
          </p>
        }
      >
        <div className="sp-split sp-split--wide-text">
          <table className="sp-table sp-triage">
            <caption className="sp-sr">
              Static analysis results by detector, with the verdict
            </caption>
            <thead>
              <tr>
                <th scope="col">Detector, count</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {LEDGER.staticAnalysis.rows.map((row) => (
                <tr key={row.detector.map((t) => t.v).join('')}>
                  <th scope="row" className="sp-triage__det">
                    <Rich tokens={row.detector} />
                  </th>
                  <td>
                    {row.verdict ? (
                      <strong className="sp-triage__verdict">{row.verdict}. </strong>
                    ) : null}
                    <Rich tokens={row.note} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h3 className="sp-h3">
              Secret scanning:{' '}
              <span className="sp-nowrap">{LEDGER.secretScanning.tool ?? 'gitleaks'}</span>
            </h3>
            <ul className="sp-list sp-prose sp-gap">
              {LEDGER.secretScanning.items.map((item) => (
                <li
                  key={item
                    .map((t) => t.v)
                    .join('')
                    .slice(0, 40)}
                >
                  <Rich tokens={item} />
                </li>
              ))}
            </ul>
            <p className="sp-small sp-gap">
              The web app holds no secrets at all: only public, prefixed build variables reach the
              bundle.
            </p>
          </div>
        </div>
      </Plate>

      <Plate
        id="known"
        ground="paper"
        label="Known limitations"
        source="docs/SECURITY.md"
        title={
          <>
            What we have <em>not solved</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Each of these is tested as a known case and written up in full in the security notes.
          </p>
        }
      >
        <ul className="sp-known">
          <li>
            <h3 className="sp-h4">No third-party audit yet</h3>
            <p className="sp-small">
              {countWord(totals.rounds)[0]?.toUpperCase()}
              {countWord(totals.rounds).slice(1)} internal rounds are logged
              {lastOpen
                ? `; ${plural(lastOpen, 'finding')} from the last ${lastOpen === 1 ? 'is' : 'are'} still open`
                : ''}
              . A third-party audit comes before any cap increase.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">Thin liquidation depth</h3>
            <p className="sp-small">
              About 0.1 BTC clears cleanly on Mezo mainnet today, which is why mainnet caps are
              deliberately tiny.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">Price feed outages</h3>
            <p className="sp-small">
              A Skip outage has no time limit: borrowing and liquidations wait until it is back. The
              exit reads no price and stays open.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">Upgradeable dependencies</h3>
            <p className="sp-small">
              sMUSD, MUSD’s BorrowerOperationsSignatures and Pyth can be upgraded by their owners.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">A broken sMUSD withdraw</h3>
            <p className="sp-small">
              It would strand the part of vMUSD held in wsMUSD until fixed; the part in M1 still
              exits. A 72-hour adapter rescue hands the wsMUSD shares to the vault’s owner to
              unwind.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">Backstop deposits pause while it holds BTC</h3>
            <p className="sp-small">
              Normally only until the 6-hour auction sells it. While sMUSD’s withdraw is broken,
              exits arrive as wsMUSD shares rather than MUSD.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">The allocator lags, by design</h3>
            <p className="sp-small">
              The 7-day trailing rule follows real rate changes slowly, and anyone touching M1 first
              in a block skips that block’s rate move. That costs liveness, never funds.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">Yield still vesting is shared</h3>
            <p className="sp-small">
              Someone who joins wsMUSD while harvested yield is still vesting, and stays until it
              has vested, gets a share of it. The keeper harvests at least every 6 hours.
            </p>
          </li>
          <li>
            <h3 className="sp-h4">The FeeRouter’s sMUSD leg can be sandwiched</h3>
            <p className="sp-small">
              MUSD parked in sMUSD around a distribution takes a share of that leg. It dilutes sMUSD
              holders’ yield from the fee; no principal is at risk.
            </p>
          </li>
        </ul>
        <Ctas>
          <a className="sp-cta" href={repoFile('docs/SECURITY.md')}>
            <span>Read docs/SECURITY.md</span>
            <svg viewBox="0 0 16 16" className="sp-cta__arrow" aria-hidden focusable="false">
              <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </a>
        </Ctas>
      </Plate>

      <Plate
        id="sources"
        label="Sources"
        source={REPO_URL.replace('https://', '')}
        title={
          <>
            Read the sources, <em>then the chain</em>
          </>
        }
      >
        <div className="sp-split sp-split--wide-text">
          <ul className="sp-sources">
            {[
              {
                path: 'docs/audit/FINDINGS.md',
                href: repoFile('docs/audit/FINDINGS.md'),
                what: 'The ledger this page is generated from',
              },
              {
                path: 'docs/SECURITY.md',
                href: repoFile('docs/SECURITY.md'),
                what: 'Threat model, invariants and known limitations',
              },
              {
                path: 'contracts/test/audit/',
                href: repoDir('contracts/test/audit'),
                what: 'Every proof of concept and regression test',
              },
              {
                path: 'docs/design/contracts.md',
                href: repoFile('docs/design/contracts.md'),
                what: 'The contracts’ specification',
              },
              {
                path: 'docs/design/red-team.md',
                href: repoFile('docs/design/red-team.md'),
                what: 'The threat model the reviewers worked from',
              },
              {
                path: '.gitleaks.toml',
                href: repoFile('.gitleaks.toml'),
                what: 'The secret-scan rules',
              },
              {
                path: 'apps/web/scripts/check-bundle.mjs',
                href: repoFile('apps/web/scripts/check-bundle.mjs'),
                what: 'The scan of the built app on every CI run',
              },
            ].map((src) => (
              <li key={src.path}>
                <a className="sp-sources__link" href={src.href}>
                  <span className="sp-code">{src.path}</span>
                  <span aria-hidden className="sp-link__out">
                    ↗
                  </span>
                </a>
                <span className="sp-small">{src.what}</span>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="sp-h3">Found something?</h3>
            <p className="sp-prose sp-gap">
              Please report vulnerabilities privately, through a{' '}
              <a className="sp-link" href={`${REPO_URL}/security/advisories/new`}>
                GitHub security advisory
              </a>{' '}
              on the repository.
            </p>
            <Ctas>
              <Cta to="/evidence" variant="solid">
                Check the chain
              </Cta>
              <Cta to="/how-it-works">How it works</Cta>
            </Ctas>
          </div>
        </div>
      </Plate>
      <Band className="sp-end-band" />
    </SitePage>
  )
}
