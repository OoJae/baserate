import './brand/intaglio.css'

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { circle, ring, rosette } from '../brand/guilloche'
import { prefersReducedMotion } from '../theme/brand'
import { IconAlert, IconCheck, IconCopy, IconExternal, IconInfo } from './icons'

/*
 * App primitives in the Intaglio art direction (docs/brand/BRAND.md): paper cards framed by a double hairline, Bodoni
 * for page titles and big numerals only, Public Sans for every sentence and control, Plex Mono caps for labels,
 * stamps and serials. Accessible names, roles and the DOM boundaries the e2e reads are unchanged: a Stat is two
 * sibling <p>s, a Row is <dt> + <dd>, Segmented is a tablist, decorative pieces are text-free and aria-hidden, and
 * every pseudo-element has empty content.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// -------------------------------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------------------------------

/** A sheet of paper: hairline border, the inner rule of a note's frame, no drop shadow. */
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
      className={cx('frame rounded-[6px] border border-line bg-surface', 'p-4 sm:p-5', className)}
      {...rest}
    >
      {children}
    </As>
  )
}

/** The card's title row. The <h2> holds only the (aria-hidden) icon and the title: it names the card's region. */
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
        <h2
          id={id}
          className="flex items-center gap-2 text-[15px] leading-snug font-semibold text-ink"
        >
          {icon ? <span className="inline-flex shrink-0 text-brand">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-snug break-words text-muted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

/**
 * The page's title: a Plex Mono eyebrow, then the page's only <h1> in Bodoni (focusable, so the router can move
 * focus to it after a navigation), then the lede.
 */
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
    <div className="mb-6 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="serial mb-3 flex items-center gap-2.5 text-[11px] text-brand">
            <span aria-hidden="true" className="h-px w-6 bg-current" />
            {eyebrow}
          </p>
        ) : null}
        <h1
          tabIndex={-1}
          className="font-display text-[28px] leading-[1.1] font-medium tracking-[-0.012em] text-balance text-ink sm:text-[34px]"
        >
          {title}
        </h1>
        {lede ? (
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">{lede}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// Data display
// -------------------------------------------------------------------------------------------------

/** A label/value row in a definition list. `serial` sets the value in Plex Mono (rates, blocks, hex). */
export function Row({
  label,
  value,
  hint,
  tip,
  strong,
  serial,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tip?: ReactNode
  strong?: boolean
  serial?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      {/* The value gives way first: a long hint wraps before the label does. */}
      <dt className="flex min-w-0 shrink-[0.3] items-center gap-1 text-sm text-muted">
        {label}
        {tip ? (
          <InfoTip label={typeof label === 'string' ? label : 'Details'}>{tip}</InfoTip>
        ) : null}
      </dt>
      <dd
        className={cx(
          'num text-right text-sm',
          strong ? 'font-semibold text-ink' : 'text-ink',
          serial && 'font-mono text-[13px]',
        )}
      >
        {value}
        {hint ? (
          <span className="mt-0.5 block font-sans text-xs font-normal text-muted">{hint}</span>
        ) : null}
      </dd>
    </div>
  )
}

/** A figure with its label above it: two sibling <p>s (the e2e reads `p:text-is(label) + p`). */
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
      <p className="serial text-[10.5px] tracking-[0.09em] text-muted">{label}</p>
      <p
        className={cx(
          'num mt-1.5 truncate text-lg leading-tight font-semibold sm:text-xl',
          tone ? toneText[tone] : 'text-ink',
        )}
      >
        {value}
      </p>
      {sub ? <p className="num mt-1 truncate text-xs text-muted">{sub}</p> : null}
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

/** Stamps: a 1 px rule in the tone over its tint. Red and green always keep their words. */
const toneStamp: Record<Tone, string> = {
  neutral: 'border-line-strong/70 bg-transparent text-muted',
  brand: 'border-brand/55 bg-brand-soft/60 text-brand',
  good: 'border-good/55 bg-good-soft text-good',
  warn: 'border-warn/55 bg-warn-soft text-warn',
  bad: 'border-bad/55 bg-bad-soft text-bad',
  btc: 'border-btc/55 bg-btc-soft text-btc',
}

/**
 * A stamp: Plex Mono caps inside a hairline. The text is the label as written; CSS sets the case. Identifiers and
 * token names keep theirs: pass `normal-case` in `className` (the caps classes are then left out, since two
 * text-transform utilities would be ordered by name, not by the order they are written in).
 */
export function Badge({
  tone = 'neutral',
  children,
  className,
  size = 'sm',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  /** `md`: the token stamp inside an amount input. */
  size?: 'sm' | 'md'
}) {
  const caps = !className?.split(/\s+/).includes('normal-case')
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[3px] border font-mono leading-none font-medium whitespace-nowrap',
        size === 'md' ? 'px-2 py-1.5 text-[11px]' : 'px-1.5 py-[3px] text-[10.5px]',
        caps ? 'tracking-[0.07em] uppercase' : 'tracking-[0.02em]',
        toneStamp[tone],
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

/** A note set off by a 3 px rule in its tone. Warn and bad are alerts; everything else is a status. */
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
    neutral: 'border-l-line-strong bg-raised/70',
    brand: 'border-l-brand bg-brand-soft/70',
    good: 'border-l-good bg-good-soft',
    warn: 'border-l-warn bg-warn-soft',
    bad: 'border-l-seal bg-bad-soft',
    btc: 'border-l-btc-accent bg-btc-soft',
  }
  const Icon =
    tone === 'good' ? IconCheck : tone === 'warn' || tone === 'bad' ? IconAlert : IconInfo
  return (
    <div
      className={cx('flex gap-3 rounded-[3px] border-l-[3px] p-3 text-sm', box[tone], className)}
      role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', toneText[tone])} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cx('font-semibold', toneText[tone])}>{title}</p> : null}
        {children ? <div className="mt-0.5 leading-relaxed text-ink/90">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}

/** A value still loading: an engraved hatch that breathes. Text-free and aria-hidden (the e2e waits on it). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'hatch inline-block animate-pulse rounded-[2px] bg-raised align-middle',
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
    'border border-transparent bg-brand text-on-brand hover:bg-brand-strong disabled:border-line disabled:bg-raised disabled:text-faint',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-ink/50 hover:bg-raised disabled:border-line disabled:bg-surface disabled:text-faint',
  ghost:
    'border border-transparent bg-transparent text-brand hover:bg-brand-soft disabled:text-faint',
  danger:
    'border border-transparent bg-seal text-on-bad hover:bg-[color-mix(in_srgb,var(--seal)_86%,var(--intaglio))] disabled:border-line disabled:bg-raised disabled:text-faint',
}

/** The press ring's mask: a woven guilloche rope between two rims, drawn once. */
let ringMask: string | undefined
function ringMaskUrl(): string {
  if (!ringMask) {
    const rope = ring(43.5, 4.2, 14, 3, { cx: 50, cy: 50, segments: 3, precision: 1 })
    const rims = circle(50, 50, 48.8, 1) + circle(50, 50, 38, 1)
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g fill='none' stroke='#000'><path stroke-width='1.2' d='${rope}'/><path stroke-width='1.8' d='${rims}'/></g></svg>`
    ringMask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }
  return ringMask
}

/** One guilloche ring presses in at (x, y) of the button: the impression of an intaglio press. Never loops. */
function pressRing(el: HTMLButtonElement, x: number, y: number) {
  if (el.disabled || prefersReducedMotion()) return
  const size = Math.round(Math.min(168, Math.max(76, el.offsetHeight * 2.8)))
  el.style.setProperty('--ring-x', `${Math.round(x)}px`)
  el.style.setProperty('--ring-y', `${Math.round(y)}px`)
  el.style.setProperty('--ring-size', `${size}px`)
  el.style.setProperty('--ring-mask', ringMaskUrl())
  el.classList.remove('is-ringing')
  void el.offsetWidth // restart the animation
  el.classList.add('is-ringing')
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  onPointerDown,
  onKeyDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-5 text-[15px]',
  }
  return (
    <button
      type="button"
      className={cx(
        'btn inline-flex items-center justify-center gap-2 rounded-[3px] font-semibold disabled:cursor-not-allowed',
        sizes[size],
        buttonVariant[variant],
        className,
      )}
      onPointerDown={(e) => {
        onPointerDown?.(e)
        if (e.defaultPrevented || e.button !== 0) return
        const box = e.currentTarget.getBoundingClientRect()
        pressRing(e.currentTarget, e.clientX - box.left, e.clientY - box.top)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
        const el = e.currentTarget
        pressRing(el, el.offsetWidth / 2, el.offsetHeight / 2)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

/** A turning guilloche rosette. aria-hidden: the text beside it says what is happening. */
let spinnerPath: string | undefined
export function Spinner({ className }: { className?: string }) {
  spinnerPath ??= rosette(10.6, 5, 0, 2, {
    cx: 12,
    cy: 12,
    inner: 0.42,
    amplitude: 1.9,
    twist: 0.9,
    segments: 4,
  })
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cx(
        'inline-block shrink-0 animate-spin',
        /\bsize-/.test(className ?? '') ? null : 'size-4',
        className,
      )}
      style={{ animationDuration: '2.4s' }}
    >
      <path d={spinnerPath} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
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
        'inline-flex items-center gap-1 rounded-[2px] font-medium text-brand decoration-1 underline-offset-[3px] hover:underline',
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
      className="inline-flex size-7 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink"
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
      className="relative -my-1 inline-flex"
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
        className="inline-flex size-6 items-center justify-center rounded-full text-faint transition-colors hover:text-ink"
      >
        <IconInfo className="size-3.5" />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="frame absolute bottom-full left-1/2 z-30 mb-1.5 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[4px] border border-line-strong/60 bg-surface p-3 text-left text-xs leading-relaxed font-normal text-ink normal-case"
        >
          {children}
        </span>
      ) : null}
    </span>
  )
}

/** Decimal amount input with a token stamp, a Max button and a secondary line. */
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
          'flex items-center gap-1 rounded-[3px] border bg-surface pr-1.5 pl-3 transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-[0_0_0_1px_var(--brand)]',
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
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-[3px] px-2 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            Max
          </button>
        ) : null}
        <Badge tone={tokenTone} size="md" className="normal-case">
          {token}
        </Badge>
      </div>
      {footer ? <div className="num mt-1.5 text-xs text-muted">{footer}</div> : null}
    </div>
  )
}

/** Tabs within a card: a tablist over a hairline, a 2 px mint rule under the selected tab. */
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
    <div role="tablist" aria-label={label} className="flex border-b border-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'tab-rule relative min-h-11 flex-1 px-3 py-2 text-sm font-semibold transition-colors',
            value === o.value ? 'text-ink' : 'text-muted hover:text-ink',
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

/** A short address linking to the explorer, with an optional label before it. Hex keeps its case. */
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
      <span className="num font-mono text-xs tracking-[0.02em]">
        {address.length > 2 + chars * 2
          ? `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
          : address}
      </span>
    </ExternalLink>
  )
}

const segmentColor: Record<Tone, string> = {
  neutral: 'var(--line-strong)',
  brand: 'var(--brand)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  btc: 'var(--btc-accent)',
}

export interface Segment {
  key: string
  label: ReactNode
  /** Share of the bar; any unit, normalised against the sum. */
  value: bigint
  tone: Tone
  /** Lighter shade of the tone, to tell two related segments apart (e.g. lent vs parked MUSD): engraved as a hatch. */
  soft?: boolean
  /** Text shown in the legend next to the label, e.g. "1,234.56 MUSD". */
  detail?: ReactNode
}

/** A segment's ink: a solid fill, or (soft) the same tone engraved as a hatch. */
function segmentStyle(s: Segment): CSSProperties {
  const color = segmentColor[s.tone]
  return s.soft
    ? ({ '--hatch': color, backgroundColor: 'transparent' } as CSSProperties)
    : { backgroundColor: color }
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
        className="flex h-3 w-full gap-px overflow-hidden rounded-[2px] bg-raised"
      >
        {segments.map((s) =>
          pct(s.value) > 0 ? (
            <span
              key={s.key}
              className={cx('h-full', s.soft && 'hatch-tone')}
              style={{ ...segmentStyle(s), width: `${pct(s.value)}%`, minWidth: '3px' }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span
                aria-hidden
                className={cx(
                  'inline-block size-2.5 shrink-0 rounded-[1px]',
                  s.soft && 'hatch-tone ring-1 ring-inset',
                )}
                style={{
                  ...segmentStyle(s),
                  ...(s.soft ? { color: segmentColor[s.tone] } : null),
                }}
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

/** Small Plex Mono caps label inside a card. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="serial mb-2 text-[10.5px] text-muted">{children}</h3>
}
