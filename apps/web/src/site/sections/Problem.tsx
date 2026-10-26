import { PROBLEM, PROBLEM_AS_OF, type ProblemFigure } from '../content/problem'
import { Label } from '../ui/Label'
import { Section } from '../ui/Section'

/** "104 → 1" with the arrow engraved as a hairline (Bodoni's latin subset has no →). */
function FigureValue({ figure }: { figure: ProblemFigure }) {
  const [from, to] = figure.value.split(' → ')
  return (
    <>
      <span aria-hidden className="inline-flex items-center gap-[0.12em]">
        {to === undefined ? (
          figure.value
        ) : (
          <>
            {from}
            <svg
              aria-hidden
              viewBox="0 0 40 12"
              className="h-[0.32em] w-[0.9em] translate-y-[0.06em] text-[var(--engrave)]"
              fill="none"
            >
              <path
                d="M0 6h38M32 1l6 5-6 5"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {to}
          </>
        )}
      </span>
      <span className="sr-only">{figure.spoken ?? figure.value}</span>
    </>
  )
}

/**
 * The problem, on ink: four mainnet figures set like a rate sheet. Each row's label and reading sit left of the
 * line, its figure hangs on the line, and every figure names its read and the repo document that records it.
 */
export function Problem() {
  return (
    <Section labelledBy="problem-title" ground="intaglio" className="pt-24 pb-20 lg:pt-36 lg:pb-32">
      <div className="rail-grid">
        <div>
          <Label>The problem · {PROBLEM_AS_OF}</Label>
          <h2
            id="problem-title"
            className="mt-5 max-w-[14ch] text-balance font-display text-section text-ink"
          >
            Redemptions emptied MUSD credit.
          </h2>
          <p className="mt-6 max-w-[38rem] text-lead text-muted">
            While MUSD trades under its $0.9925 redemption floor, anyone can hand in MUSD and take
            bitcoin from the open trove with the lowest collateral ratio. A new trove joins that
            queue.
          </p>
        </div>
      </div>

      <dl className="mt-14 lg:mt-24">
        {PROBLEM.map((f) => (
          <div
            key={f.id}
            className="rail-grid relative py-8 before:absolute before:top-0 before:right-(--gutter) before:left-(--inset) before:h-px before:bg-line before:content-[''] lg:py-10"
          >
            <dt className="serial text-faint lg:row-start-1 lg:col-[2/4] lg:flex lg:items-center lg:gap-4 lg:after:h-0 lg:after:flex-1 lg:after:border-t lg:after:border-dotted lg:after:border-line-strong lg:after:content-['']">
              {f.label}
            </dt>
            <dd className="at-rail mt-3 numeral text-[clamp(3.25rem,5.6vw,5.75rem)] leading-[0.9] tracking-[-0.02em] text-ink lg:row-span-3 lg:row-start-1 lg:mt-0 lg:pl-6">
              <FigureValue figure={f} />
            </dd>
            <dd className="mt-4 max-w-[36rem] text-[length:var(--body-size)] leading-[1.6] text-ink lg:row-start-2 lg:mt-3">
              {f.body}
            </dd>
            <dd className="serial mt-3 text-faint normal-case tracking-[0.04em]">
              <span className="sr-only">Source: </span>
              {f.source}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
