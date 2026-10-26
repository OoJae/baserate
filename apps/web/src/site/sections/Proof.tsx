import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FACTS } from '../content/facts'
import { useNear } from '../data/useLive'
import { Label } from '../ui/Label'
import { Section } from '../ui/Section'
import { ArrowRight } from './Hero'
import { ProofRow } from './ProofRow'
import { ProofLiveRows } from './proofCopy'

const ProofLive = lazy(() => import('./ProofLive'))

const empty = (
  <ProofLiveRows
    txs={null}
    txTotal={null}
    v1Count={null}
    sources={null}
    sourcesTotal={null}
    sourcesError={false}
    keeper={null}
  />
)

/**
 * Proof, on paper: "Don't trust the page." The line becomes the evidence tally. Live: the recorded transactions and
 * contract sources (ProofLive, loaded within a screen of the section), and the keeper. From the repo: the test count
 * and the review rounds, labelled as internal (no third-party audit yet).
 */
export function Proof({ live }: { live: boolean }) {
  const ref = useRef<HTMLDListElement>(null)
  const near = useNear(ref)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (live && near) setMounted(true)
  }, [live, near])

  return (
    <Section labelledBy="proof-title" ground="note" className="pt-24 pb-20 lg:pt-36 lg:pb-32">
      <div className="rail-grid">
        <div>
          <Label>Proof · read live</Label>
          <h2
            id="proof-title"
            className="mt-5 max-w-[13ch] text-balance font-display text-section text-ink"
          >
            Don’t trust the page. Check the chain.
          </h2>
          <p className="mt-6 max-w-[36rem] text-lead text-muted">
            The counts below are read from Mezo testnet, its explorer and our keeper as you scroll.
            The two that are not live come straight from the repo.
          </p>
          <p className="mt-8">
            <Link
              to="/evidence"
              className="inline-flex h-12 items-center gap-2.5 rounded-[3px] bg-brand px-5 text-[0.9375rem] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              Check the chain
              <ArrowRight className="size-4" />
            </Link>
          </p>
        </div>
      </div>

      <dl ref={ref} className="mt-14 lg:mt-24">
        {mounted ? (
          <Suspense fallback={empty}>
            <ProofLive active={near} />
          </Suspense>
        ) : (
          empty
        )}
        <ProofRow
          label="Foundry tests"
          value={FACTS.foundryTests.toLocaleString('en-US')}
          body="Unit, fuzz and invariant tests, a proof-of-concept test for every audit finding, and forks of Mezo mainnet and testnet."
          source="contracts/test · README.md"
        />
        <ProofRow
          label="Internal review rounds"
          value={FACTS.reviewRounds}
          body={
            <>
              Three internal review rounds, each finding proven by a test before it was fixed. Round
              3 found nothing above Low in the deployed contracts; its Lows are open and scheduled.{' '}
              <strong className="font-semibold">No third-party audit yet.</strong>
            </>
          }
          source={
            <Link to="/security" className="underline underline-offset-4 hover:no-underline">
              docs/audit/FINDINGS.md · Security
            </Link>
          }
        />
      </dl>
    </Section>
  )
}
