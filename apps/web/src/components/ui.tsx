import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { IconAlert, IconCheck, IconCopy, IconExternal, IconInfo } from './icons'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// -------------------------------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: As = 'section',
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
  'aria-labelledby'?: string
}) {
  return (
    <As
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-card',
        'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  id,
  icon,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  id?: string
  icon?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon ? <span className="text-brand">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow?: string
  title: string
  lede?: ReactNode
  aside?: ReactNode
}) {
  useEffect(() => {
    document.title = eyebrow ? `${eyebrow} · Baserate` : 'Baserate'
  }, [eyebrow])
  return (
    <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[28px] leading-tight text-ink sm:text-[34px]">{title}</h1>
        {lede ? <p className="mt-2 text-[15px] leading-relaxed text-muted">{lede}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// Data display
// -------------------------------------------------------------------------------------------------

/** A label/value row in a definition list. */
export function Row({
  label,
  value,
  hint,
  tip,
  strong,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tip?: ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="flex min-w-0 items-center gap-1 text-sm text-muted">
        {label}
        {tip ? (
          <InfoTip label={typeof label === 'string' ? label : 'Details'}>{tip}</InfoTip>
        ) : null}
      </dt>
      <dd className={cx('num text-right text-sm', strong ? 'font-semibold text-ink' : 'text-ink')}>
        {value}
        {hint ? <span className="block text-xs font-normal text-muted">{hint}</span> : null}
      </dd>
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cx(
          'num mt-1 truncate text-lg font-semibold sm:text-xl',
          tone ? toneText[tone] : 'text-ink',
        )}
      >
        {value}
      </p>
      {sub ? <p className="num mt-0.5 truncate text-xs text-muted">{sub}</p> : null}
    </div>
  )
}

export type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad' | 'btc'

const toneText: Record<Tone, string> = {
  neutral: 'text-ink',
  brand: 'text-brand',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  btc: 'text-btc',
}

const toneChip: Record<Tone, string> = {
  neutral: 'bg-raised text-muted border-line',
  brand: 'bg-brand-soft text-brand border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  btc: 'bg-btc-soft text-btc border-transparent',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        toneChip[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: Tone }) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-faint',
    brand: 'bg-brand',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    btc: 'bg-btc',
  }
  return <span aria-hidden className={cx('inline-block size-2 rounded-full', bg[tone])} />
}

export function Notice({
  tone = 'neutral',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const box: Record<Tone, string> = {
    neutral: 'border-line bg-raised',
    brand: 'border-brand/25 bg-brand-soft',
    good: 'border-good/25 bg-good-soft',
    warn: 'border-warn/30 bg-warn-soft',
    bad: 'border-bad/30 bg-bad-soft',
    btc: 'border-btc/30 bg-btc-soft',
  }
  const Icon =
    tone === 'good' ? IconCheck : tone === 'warn' || tone === 'bad' ? IconAlert : IconInfo
  return (
    <div
      className={cx('flex gap-3 rounded-xl border p-3 text-sm', box[tone], className)}
      role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', toneText[tone])} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cx('font-semibold', toneText[tone])}>{title}</p> : null}
        {children ? <div className="mt-0.5 text-ink/90">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block animate-pulse rounded-md bg-raised align-middle',
        className ?? 'h-4 w-16',
      )}
    />
  )
}

/** Renders a value, a skeleton while loading, or an em dash when unavailable. */
export function Value({
  loading,
  children,
}: {
  loading?: boolean
  children: ReactNode | null | undefined
}) {
  if (loading) return <Skeleton />
  if (children === null || children === undefined || children === '')
    return <span className="text-faint">—</span>
  return <>{children}</>
}

// -------------------------------------------------------------------------------------------------
// Controls
// -------------------------------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariant: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-brand hover:bg-brand-strong disabled:bg-raised disabled:text-faint disabled:border-line border border-transparent',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-raised disabled:text-faint disabled:border-line',
  ghost:
    'bg-transparent text-brand hover:bg-brand-soft border border-transparent disabled:text-faint',
  danger: 'bg-bad text-white hover:opacity-90 border border-transparent disabled:opacity-50',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: 'h-8 px-3 text-sm rounded-lg',
    md: 'h-10 px-4 text-sm rounded-xl',
    lg: 'h-12 px-5 text-[15px] rounded-xl',
  }
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed',
        sizes[size],
        buttonVariant[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  )
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cx(
        'inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline',
        className,
      )}
    >
      {children}
      <IconExternal className="size-3.5 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true))
      }}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <IconCheck className="size-4 text-good" /> : <IconCopy className="size-4" />}
    </button>
  )
}

/** Tooltip that works on hover, focus and tap (tooltips become tap popovers on touch screens). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover is a pointer convenience; the inner button is the accessible control
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-5 items-center justify-center rounded-full text-faint hover:text-ink"
      >
        <IconInfo className="size-3.5" />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-xs leading-relaxed font-normal text-ink shadow-card"
        >
          {children}
        </span>
      ) : null}
    </span>
  )
}

/** Decimal amount input with a token label, a Max button and a secondary line. */
export function AmountInput({
  id,
  label,
  value,
  onChange,
  token,
  tokenTone = 'neutral',
  onMax,
  maxLabel,
  footer,
  invalid,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  token: string
  tokenTone?: Tone
  onMax?: () => void
  maxLabel?: ReactNode
  footer?: ReactNode
  invalid?: boolean
  disabled?: boolean
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {maxLabel ? <span className="num truncate text-xs text-muted">{maxLabel}</span> : null}
      </div>
      <div
        className={cx(
          'flex items-center gap-2 rounded-xl border bg-surface px-3 transition-colors focus-within:border-brand',
          invalid ? 'border-bad' : 'border-line-strong',
          disabled && 'opacity-60',
        )}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.00"
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (v === '' || /^\d*\.?\d*$/.test(v)) onChange(v)
          }}
          className="num h-12 min-w-0 flex-1 bg-transparent text-xl font-semibold text-ink outline-none placeholder:text-faint"
        />
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
          >
            Max
          </button>
        ) : null}
        <Badge tone={tokenTone} className="text-[13px]">
          {token}
        </Badge>
      </div>
      {footer ? <div className="num mt-1.5 text-xs text-muted">{footer}</div> : null}
    </div>
  )
}

/** Segmented control (tabs within a card). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-xl bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// Shared data pieces (Wave 2 pages)
// -------------------------------------------------------------------------------------------------

/** A short address linking to the explorer, with an optional label before it. */
export function AddressLink({
  href,
  address,
  label,
  chars = 4,
}: {
  href: string
  address: string
  label?: ReactNode
  chars?: number
}) {
  return (
    <ExternalLink href={href}>
      {label ? <span>{label}</span> : null}
      <span className="num font-mono text-xs">
        {address.length > 2 + chars * 2
          ? `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
          : address}
      </span>
    </ExternalLink>
  )
}

const segmentBg: Record<Tone, string> = {
  neutral: 'bg-line-strong',
  brand: 'bg-brand',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  btc: 'bg-btc',
}

export interface Segment {
  key: string
  label: ReactNode
  /** Share of the bar; any unit, normalised against the sum. */
  value: bigint
  tone: Tone
  /** Lighter shade of the tone, to tell two related segments apart (e.g. lent vs parked MUSD). */
  soft?: boolean
  /** Text shown in the legend next to the label, e.g. "1,234.56 MUSD". */
  detail?: ReactNode
}

/** A stacked horizontal bar with a legend (vault split, fee split). */
export function SplitBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((a, s) => a + (s.value > 0n ? s.value : 0n), 0n)
  const pct = (v: bigint) => (total > 0n && v > 0n ? Number((v * 10_000n) / total) / 100 : 0)
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${segments.map((s) => `${typeof s.label === 'string' ? s.label : s.key} ${pct(s.value).toFixed(1)}%`).join(', ')}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-raised"
      >
        {segments.map((s) =>
          pct(s.value) > 0 ? (
            <span
              key={s.key}
              className={cx(
                'h-full first:rounded-l-full last:rounded-r-full',
                segmentBg[s.tone],
                s.soft && 'opacity-45',
              )}
              style={{ width: `${pct(s.value)}%`, minWidth: '3px' }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span
                aria-hidden
                className={cx('inline-block size-2.5 shrink-0 rounded-sm', segmentBg[s.tone])}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="num shrink-0 text-right text-ink">
              {s.detail}
              <span className="ml-1.5 text-xs text-muted">{pct(s.value).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** RPC read failed: say so plainly, keep whatever is on screen, offer a retry. */
export function ReadError({
  what,
  onRetry,
  className,
}: {
  what: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <Notice
      tone="warn"
      className={className}
      title={`Could not read ${what} from Mezo testnet`}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      The public testnet RPC did not answer. Values refresh automatically when it recovers.
    </Notice>
  )
}

/** Small uppercase section label inside a card. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
      {children}
    </h3>
  )
}
