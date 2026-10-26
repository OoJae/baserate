import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { MarkStation } from '../line/MarkStation'
import { useFooterSpool } from '../webgl/useStage'
import { ArrowRight } from './Hero'

/**
 * The close, on ink: the line runs its last stretch and winds back into the mark, beside the one thing to do next.
 * The section draws its own short rail, which stops at the emblem instead of running to the section's foot.
 */
export function FooterCta() {
  const slot = useRef<HTMLDivElement>(null)
  const emblem = useRef<HTMLDivElement>(null)
  const { mode } = useFooterSpool(slot, emblem)
  return (
    <section
      aria-labelledby="cta-title"
      data-ground="intaglio"
      data-section
      data-spool={mode}
      className="relative bg-canvas pt-24 pb-24 text-ink [--rail-stop:8.5rem] lg:pt-32 lg:pb-36 lg:[--rail-stop:8.125rem]"
    >
      {/* The WebGL stage moves its canvas here when this section is on screen, to wind the line into the emblem. */}
      <div
        ref={slot}
        data-webgl-slot="footer"
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />
      <span aria-hidden data-rail data-footer-line className="rail bottom-auto h-(--rail-stop)" />
      <div className="rail-grid relative z-10 gap-y-10">
        <MarkStation emblem={emblem} />
        <div>
          <h2
            id="cta-title"
            className="max-w-[19ch] text-balance font-display text-section text-ink"
          >
            Borrow against your bitcoin, at the <em className="italic">base rate</em>.
          </h2>
          <p className="mt-6 max-w-[34rem] text-lead text-muted">
            It runs on Mezo testnet with test tokens, so trying it costs nothing. One faucet drip of
            BTC is enough to borrow, save, repay and get it back.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/borrow"
              className="inline-flex h-12 items-center gap-2.5 rounded-[3px] bg-ink px-5 text-[0.9375rem] font-semibold text-canvas transition-colors hover:bg-brand-strong"
            >
              Open the app
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex h-12 items-center rounded-[3px] border border-line-strong px-5 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-raised"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
