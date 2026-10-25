/** Baserate mark: a rate line stepping up from a solid base. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M8 23h16" stroke="var(--on-brand)" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M8 18.5h6.2l3.6-5h6.2"
        fill="none"
        stroke="var(--on-brand)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="size-8 shrink-0" />
      <span className="font-display text-[21px] leading-none tracking-tight text-ink">
        Baserate
      </span>
    </span>
  )
}
