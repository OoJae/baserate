import { Link } from '@tanstack/react-router'
import { STEPS, type Step } from '../content/steps'
import { AllocationSplitStation } from '../line/AllocationSplitStation'
import { LtvGaugeStation } from '../line/LtvGaugeStation'
import { NodeStation } from '../line/NodeStation'
import { Label } from '../ui/Label'
import { Section } from '../ui/Section'
import { ArrowRight } from './Hero'

function StepStation({ step, live }: { step: Step; live: boolean }) {
  switch (step.station) {
    case 'post':
      return (
        <NodeStation
          btc
          lines={['BTC in · wrapped 1:1', 'Collateral in M1']}
          caption="One transaction opens your account, posts the BTC and borrows."
        />
      )
    case 'ltv':
      return <LtvGaugeStation live={live} />
    case 'split':
      return <AllocationSplitStation live={live} />
    case 'exit':
      return (
        <NodeStation
          lines={[
            <span key="fn" className="normal-case">
              repayAndWithdraw()
            </span>,
            'No oracle read',
          ]}
          caption="With no debt left, Morpho releases collateral without asking the oracle for a price."
        />
      )
  }
}

/**
 * How it works, on paper: the page's one true sequence, so its one numbered list. The line runs beside the steps
 * and becomes each step's station: a node where BTC goes in, the LTV gauge, vMUSD's split, the oracle-free exit.
 */
export function Steps({ live }: { live: boolean }) {
  return (
    <Section labelledBy="steps-title" ground="note" className="pt-24 pb-20 lg:pt-36 lg:pb-32">
      <div className="rail-grid">
        <div>
          <Label>How it works</Label>
          <h2
            id="steps-title"
            className="mt-5 max-w-[15ch] text-balance font-display text-section text-ink"
          >
            From bitcoin to dollars, and back.
          </h2>
          <p className="mt-6 max-w-[36rem] text-lead text-muted">
            One transaction posts your BTC and borrows MUSD. Another repays it and sends your BTC
            home.
          </p>
        </div>
      </div>

      <ol className="mt-14 lg:mt-24">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="rail-grid relative gap-y-8 py-10 before:absolute before:top-0 before:right-(--gutter) before:left-(--inset) before:h-px before:bg-line before:content-[''] lg:py-14"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)] content-start items-baseline gap-x-5 self-start sm:gap-x-8 lg:gap-x-10">
              <p
                aria-hidden
                className="numeral text-[clamp(2.75rem,4.4vw,4.5rem)] leading-[0.85] text-ink"
              >
                {step.n}
              </p>
              <h3 className="font-display text-[clamp(1.75rem,2.4vw,2.5rem)] leading-[1.05] tracking-[-0.01em] text-ink">
                <span className="sr-only">Step {Number(step.n)}: </span>
                {step.title}
              </h3>
              <p className="col-span-2 mt-4 max-w-[36rem] text-pretty text-[length:var(--body-size)] leading-[1.6] text-muted sm:col-span-1 sm:col-start-2 sm:mt-3 lg:text-lead">
                {step.body}
              </p>
            </div>
            <StepStation step={step} live={live} />
          </li>
        ))}
      </ol>

      <div className="rail-grid mt-4">
        <p>
          <Link
            to="/how-it-works"
            className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand underline underline-offset-[6px] hover:no-underline"
          >
            Read how it works
            <ArrowRight className="size-4" />
          </Link>
        </p>
      </div>
    </Section>
  )
}
