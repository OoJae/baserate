/*
 * Mezo allows 20 precompile calls per transaction (measured: an eth_call loop of Skip reads succeeds at 20 and reverts
 * at 21, docs/design/contracts.md §0.5). Each on-chain flow's count, from docs/design/contracts.md §5 and the
 * FlashLiquidator's NatSpec, as measured in round 2 of the review (docs/audit/FINDINGS.md): no flow uses more than 7.
 */

export const PRECOMPILE_LIMIT = 20

export interface Flow {
  flow: string
  calls: number
  /** What the calls are. */
  detail: string
  /** A read (eth_call), not a transaction. */
  read?: boolean
}

export const FLOWS: readonly Flow[] = [
  {
    flow: 'Open and borrow',
    calls: 2,
    detail: 'Two Skip price reads: Baserate’s check and Morpho’s',
  },
  { flow: 'Borrow more, or withdraw while you owe', calls: 2, detail: 'The same two Skip reads' },
  { flow: 'Add collateral, repay, repay and exit', calls: 0, detail: 'No price read at all' },
  { flow: 'wsMUSD deposit, redeem, sync', calls: 0, detail: 'MUSD and sMUSD only' },
  {
    flow: 'Liquidate through the backstop',
    calls: 3,
    detail: 'Three Skip reads; BTC moves as value',
  },
  {
    flow: 'Liquidate through Tigris CL200',
    calls: 6,
    detail: '2 Skip + 4 BTC precompile; one more when the router leaves approval unused',
  },
  {
    flow: 'Liquidate through Tigris vAMM',
    calls: 7,
    detail: '2 Skip + 5 BTC precompile: the most of any flow',
  },
  {
    flow: 'RiskLens snapshot',
    calls: 10,
    detail: 'A read the app and keeper make, never part of a transaction',
    read: true,
  },
]

/** One flow's calls as filled cells of the 20 a transaction may make. */
const CELLS = Array.from({ length: PRECOMPILE_LIMIT }, (_, i) => i + 1)

function Meter({ calls }: { calls: number }) {
  return (
    <span className="sp-meter" aria-hidden>
      {CELLS.map((n) => (
        <span
          key={n}
          className={n <= calls ? 'sp-meter__cell sp-meter__cell--on' : 'sp-meter__cell'}
        />
      ))}
    </span>
  )
}

export function PrecompileBudget() {
  return (
    <figure className="sp-figure sp-budget">
      <table className="sp-table sp-budget__table">
        <caption className="sp-sr">
          Precompile calls per flow, of the {PRECOMPILE_LIMIT} a Mezo transaction may make
        </caption>
        <thead>
          <tr>
            <th scope="col">Flow</th>
            <th scope="col" className="sp-budget__meter-col">
              <span className="sp-sr">Calls used, as cells of {PRECOMPILE_LIMIT}</span>
            </th>
            <th scope="col" className="sp-table__num">
              Calls
            </th>
          </tr>
        </thead>
        <tbody>
          {FLOWS.map((f) => (
            <tr key={f.flow} className={f.read ? 'sp-budget__read' : undefined}>
              <th scope="row" className={f.read ? 'sp-budget__dashed' : undefined}>
                <span className="sp-budget__flow">{f.flow}</span>
                <span className="sp-budget__detail">{f.detail}</span>
              </th>
              <td
                className={
                  f.read ? 'sp-budget__meter-col sp-budget__dashed' : 'sp-budget__meter-col'
                }
              >
                <Meter calls={f.calls} />
              </td>
              <td className={f.read ? 'sp-table__num sp-budget__dashed' : 'sp-table__num'}>
                {f.calls} <span className="sp-budget__of">of {PRECOMPILE_LIMIT}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="sp-serial sp-source">
        Mezo’s limit: 20 per transaction, reads included · contracts.md §0.5, §5 ·
        FlashLiquidator.sol · FINDINGS.md round 2
      </figcaption>
    </figure>
  )
}
