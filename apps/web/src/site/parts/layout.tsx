import { Link } from '@tanstack/react-router'
import { type CSSProperties, isValidElement, type ReactNode } from 'react'
import { Rosette } from './engraving'
import './site.css'

/*
 * The frame every site page shares (How it works, Security, Brand): a masthead on the Intaglio ground, then plates,
 * either on ink or on a paper sheet. One base-rate line, the rail, runs down the left margin of the page: it draws
 * in with the masthead (the page's one load) and then follows the reader down (the page's one scroll scene, scrubbed
 * by CSS scroll timelines where the browser has them; drawn complete everywhere else and under reduced motion).
 */

/** The page root: sets the rail and gutter geometry. */
export function SitePage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `sp ${className}` : 'sp'}>{children}</div>
}

/** The stretch of the base-rate line beside one section. `node`: mark the section's start with a rosette. */
function Rail({ node = true, load = false }: { node?: boolean; load?: boolean }) {
  return (
    <div className="sp-rail" aria-hidden>
      <span className={load ? 'sp-rail__line sp-rail__line--load' : 'sp-rail__line'} />
      {node ? <Rosette px={15} petals={10} lines={3} className="sp-rail__node" /> : null}
    </div>
  )
}

/** A serial label: Plex Mono caps, for labels and true data (never sentences). */
export function Serial({
  children,
  className,
  as: Tag = 'p',
}: {
  children: ReactNode
  className?: string
  as?: 'p' | 'span' | 'dt' | 'figcaption' | 'div'
}) {
  return <Tag className={className ? `sp-serial ${className}` : 'sp-serial'}>{children}</Tag>
}

export interface MastheadProps {
  /** The page's label (left of the serial row). */
  label: string
  /** True data for the right of the serial row: a network, a source file, a count. */
  meta?: ReactNode
  /** The h1, one masked line per entry. Give each a trailing space so the accessible name reads as words. */
  lines: ReactNode[]
  lead: ReactNode
  /** The engraved object that breaks the right edge (aria-hidden inside). */
  figure?: ReactNode
  /** Below the lead: figures, stamps, a contents list. */
  children?: ReactNode
}

/** A headline line's key: its text, or the key of the element it is (an <em> phrase carries one). */
function lineKey(line: ReactNode): string {
  if (typeof line === 'string') return line
  if (isValidElement(line) && line.key !== null) return `el-${line.key}`
  return 'line'
}

/** The page's masthead and h1. The figure bleeds off the right edge; the page never scrolls sideways. */
export function Masthead({ label, meta, lines, lead, figure, children }: MastheadProps) {
  return (
    <header className="sp-mast">
      <Rail node={false} load />
      <div className="sp-inset sp-mast__row">
        <Serial>{label}</Serial>
        {meta ? <Serial className="sp-mast__meta">{meta}</Serial> : null}
      </div>
      {figure ? <div className="sp-mast__fig">{figure}</div> : null}
      <div className="sp-inset sp-mast__text">
        <h1 className="sp-title" tabIndex={-1}>
          {lines.map((line, i) => (
            <span
              key={lineKey(line)}
              className="sp-title__line"
              style={{ '--i': i } as CSSProperties}
            >
              <span>{line}</span>
            </span>
          ))}
        </h1>
        <p className="sp-lead sp-mast__lead">{lead}</p>
        {children}
      </div>
    </header>
  )
}

/** "On this page": in-page links to each plate, as a serial strip under the masthead. */
export function OnThisPage({ items }: { items: readonly { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="sp-toc">
      <Rail node={false} />
      <div className="sp-inset">
        <Serial as="div" className="sp-toc__label">
          On this page
        </Serial>
        <ul className="sp-toc__list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="sp-toc__link">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

export interface PlateProps {
  id: string
  /** The serial label above the title (what this plate is). */
  label: string
  /** True data for the right of the label row: the contracts or files this plate describes. */
  source?: ReactNode
  title: ReactNode
  /** Ink (the page ground) or a paper sheet with its grain and double hairline frame. */
  ground?: 'ink' | 'paper'
  /** A short standfirst under the title. */
  intro?: ReactNode
  children: ReactNode
}

/** One section of a site page: a labelled region with its own stretch of the rail. */
export function Plate({ id, label, source, title, ground = 'ink', intro, children }: PlateProps) {
  const titleId = `${id}-title`
  const head = (
    <>
      <div className="sp-plate__row">
        <Serial>{label}</Serial>
        {source ? <Serial className="sp-plate__source">{source}</Serial> : null}
      </div>
      <h2 id={titleId} className="sp-h2">
        {title}
      </h2>
      {intro ? <div className="sp-plate__intro">{intro}</div> : null}
    </>
  )
  return (
    <section id={id} aria-labelledby={titleId} className={`sp-plate sp-plate--${ground}`}>
      <Rail />
      {ground === 'paper' ? (
        <div className="sp-sheet" data-ground="note">
          <span className="sp-sheet__marks" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
          <div className="sp-sheet__inner">
            {head}
            <div className="sp-plate__body">{children}</div>
          </div>
        </div>
      ) : (
        <div className="sp-inset sp-plate__inner">
          {head}
          <div className="sp-plate__body">{children}</div>
        </div>
      )}
    </section>
  )
}

/** A hairline call to action into the app or the site (a router link, so it is prefetched on intent). */
export function Cta({
  to,
  children,
  variant = 'line',
}: {
  to:
    | '/borrow'
    | '/save'
    | '/lend'
    | '/liquidate'
    | '/risk'
    | '/fees'
    | '/evidence'
    | '/security'
    | '/how-it-works'
    | '/brand'
    | '/'
  children: ReactNode
  variant?: 'line' | 'solid'
}) {
  return (
    <Link to={to} className={variant === 'solid' ? 'sp-cta sp-cta--solid' : 'sp-cta'}>
      <span>{children}</span>
      <svg viewBox="0 0 16 16" className="sp-cta__arrow" aria-hidden focusable="false">
        <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </Link>
  )
}

/** A row of calls to action. */
export function Ctas({ children }: { children: ReactNode }) {
  return <div className="sp-ctas">{children}</div>
}

/** A woven band divider (the brand's band.svg as a mask, painted in the ground's engraving colour). */
export function Band({ className }: { className?: string }) {
  return <div className={className ? `sp-band ${className}` : 'sp-band'} aria-hidden />
}
