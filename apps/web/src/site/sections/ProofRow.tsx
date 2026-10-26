import type { ReactNode } from 'react'

/**
 * One line of the proof ledger: what is counted (left of the line), the count (hanging on the line, in Bodoni), what
 * it means, and where it comes from. The same shape as the problem's rate sheet, so the page's claims and its
 * evidence read as one document.
 */
export function ProofRow({
  label,
  value,
  body,
  source,
  figure,
}: {
  label: string
  value: ReactNode
  body: ReactNode
  source: ReactNode
  /** Line work under the value, on the rail (the evidence tally). */
  figure?: ReactNode
}) {
  return (
    <div className="rail-grid relative py-8 before:absolute before:top-0 before:right-(--gutter) before:left-(--inset) before:h-px before:bg-line before:content-[''] lg:py-10">
      <dt className="serial text-faint lg:row-start-1 lg:col-[2/4] lg:flex lg:items-center lg:gap-4 lg:after:h-0 lg:after:flex-1 lg:after:border-t lg:after:border-dotted lg:after:border-line-strong lg:after:content-['']">
        {label}
      </dt>
      <dd className="at-rail mt-3 lg:row-span-3 lg:row-start-1 lg:mt-0 lg:pl-6">
        <span className="numeral block text-[clamp(2.75rem,4.4vw,4.5rem)] leading-[0.9] tracking-[-0.02em] text-ink">
          {value}
        </span>
        {figure ? <div className="mt-5">{figure}</div> : null}
      </dd>
      <dd className="mt-4 max-w-[36rem] text-[length:var(--body-size)] leading-[1.6] text-ink lg:row-start-2 lg:mt-3">
        {body}
      </dd>
      <dd className="serial mt-3 text-faint normal-case tracking-[0.04em]">
        <span className="sr-only">Source: </span>
        {source}
      </dd>
    </div>
  )
}
