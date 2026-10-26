import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SVGProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { NEXT_RELEASE } from '../lib/roadmap'
import { deployed } from '../wagmi'
import { SerialStrip } from './brand/SerialStrip'
import {
  IconBorrow,
  IconEvidence,
  IconFees,
  IconLend,
  IconLiquidate,
  IconLock,
  IconMore,
  IconRisk,
  IconSave,
  IconX,
} from './icons'
import { Wordmark } from './Logo'
import { NetworkGuard } from './NetworkGuard'
import { cx } from './ui'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

type NavPath = '/borrow' | '/save' | '/lend' | '/liquidate' | '/risk' | '/fees' | '/evidence'

const NAV: { to: NavPath; label: string; icon: Icon; blurb: string }[] = [
  { to: '/borrow', label: 'Borrow', icon: IconBorrow, blurb: 'MUSD against BTC' },
  { to: '/save', label: 'Save', icon: IconSave, blurb: 'wsMUSD savings' },
  { to: '/lend', label: 'Lend', icon: IconLend, blurb: 'vMUSD lending vault' },
  { to: '/liquidate', label: 'Liquidate', icon: IconLiquidate, blurb: 'Zero-capital liquidations' },
  { to: '/risk', label: 'Risk', icon: IconRisk, blurb: 'RiskLens dashboard' },
  { to: '/fees', label: 'Fees', icon: IconFees, blurb: 'Fee router and bribes' },
  { to: '/evidence', label: 'Evidence', icon: IconEvidence, blurb: 'Verify it on-chain' },
]

/** The bottom tab bar holds three pages plus More; the rest live in the More sheet. */
const MOBILE_TABS: NavPath[] = ['/borrow', '/save', '/lend']

/** The tab bar's height, shared with the sticky TxButton offset (TxButton reads --tabbar-h). */
const SHELL_VARS = { '--tabbar-h': '4rem' } as CSSProperties

/** The active page: a 2 px mint rule at the left edge (an empty ::before), aria-current unchanged. */
const ACTIVE_RULE =
  'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand'

function NextReleaseList({ compact }: { compact?: boolean }) {
  return (
    <section aria-labelledby={compact ? 'next-release-m' : 'next-release'}>
      <h2
        id={compact ? 'next-release-m' : 'next-release'}
        className="serial mb-2 px-3 text-[10.5px] text-faint"
      >
        Coming in the next release
      </h2>
      <ul className="space-y-0.5">
        {NEXT_RELEASE.map((item) => (
          <li
            key={item.label}
            aria-disabled="true"
            className="flex items-start gap-2.5 rounded-[3px] px-3 py-2 text-sm"
          >
            <IconLock className="mt-0.5 size-4 shrink-0 text-faint" />
            <span className="min-w-0">
              <span className="font-medium text-muted">{item.label}</span>
              <span className="block text-xs leading-snug text-faint">{item.blurb}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The specimen stamp: a hairline of ink around Plex Mono caps, like the overprint on a specimen note. */
function SpecimenStamp() {
  return (
    <span className="serial inline-flex -rotate-2 items-center rounded-[2px] border border-ink/70 px-2 py-[3px] text-[10px] leading-none text-ink">
      Testnet
    </span>
  )
}

function Sidebar() {
  return (
    <aside
      data-vt-name="sidebar"
      className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto border-r border-line bg-surface lg:flex"
    >
      {/* The engraved band: the lockup with the engraved emblem, over the woven band. */}
      <div className="px-5 pt-6">
        <Link
          to="/"
          aria-label="Baserate home"
          className="inline-flex rounded-[3px] transition-opacity hover:opacity-85"
        >
          <Wordmark engraved className="h-12" />
        </Link>
        <span aria-hidden="true" className="band -mx-5 mt-5 block" />
      </div>
      <nav aria-label="Main" className="mt-3 px-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group relative flex items-center gap-3 rounded-[3px] px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-raised/70 hover:text-ink"
                activeProps={{
                  className: cx('bg-brand-soft/55 !text-ink', ACTIVE_RULE),
                  'aria-current': 'page',
                }}
              >
                <item.icon className="size-5 shrink-0 text-brand" />
                <span>
                  {item.label}
                  <span className="block text-xs font-normal text-faint group-hover:text-muted">
                    {item.blurb}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-5 border-t border-line pt-4">
        <NextReleaseList />
      </div>
      <div className="mt-auto space-y-2.5 border-t border-line px-5 pt-4 pb-5">
        <SerialStrip stacked />
        <p className="text-xs text-faint">Built on Mezo · testnet funds only</p>
      </div>
    </aside>
  )
}

function MobileTabs({
  onMore,
  moreRef,
}: {
  onMore: () => void
  moreRef: RefObject<HTMLButtonElement | null>
}) {
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  // The More tab reads as current while one of its pages is open.
  const inMore = NAV.some((n) => !MOBILE_TABS.includes(n.to) && pathname.startsWith(n.to))
  return (
    <nav
      aria-label="Main"
      data-vt-name="tabbar"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {NAV.filter((item) => MOBILE_TABS.includes(item.to)).map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="relative flex h-(--tabbar-h) flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted transition-colors"
              activeProps={{
                className:
                  '!text-brand before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:bg-brand',
                'aria-current': 'page',
              }}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <button
            ref={moreRef}
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            className={cx(
              'relative flex h-(--tabbar-h) w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
              inMore
                ? 'text-brand before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:bg-brand'
                : 'text-muted',
            )}
          >
            <IconMore className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function MoreSheet({
  open,
  onClose,
  returnFocus,
}: {
  open: boolean
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const sheet = panel.current
    sheet?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      // Keep Tab inside the sheet while it is open.
      if (e.key !== 'Tab' || !sheet) return
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const trigger = returnFocus.current
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      // Back to the More tab (a navigation then moves focus on to the new page's h1).
      trigger?.focus({ preventScroll: true })
    }
  }, [open, onClose, returnFocus])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="sheet-fade absolute inset-0 bg-[color-mix(in_srgb,var(--intaglio)_42%,transparent)]"
        onClick={onClose}
      />
      <div
        ref={panel}
        className="sheet-in absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[10px] border-t border-line-strong/60 bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <SerialStrip />
          <button
            type="button"
            data-autofocus=""
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-ink"
          >
            <IconX className="size-5" />
          </button>
        </div>
        <nav aria-label="More pages" className="-mx-1 mb-4">
          <ul className="grid grid-cols-2 gap-1">
            {NAV.filter((item) => !MOBILE_TABS.includes(item.to)).map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onClose}
                  className="relative flex min-h-12 items-center gap-3 rounded-[3px] px-3 py-2.5 text-sm font-medium text-muted hover:bg-raised hover:text-ink"
                  activeProps={{
                    className: cx('bg-brand-soft/55 !text-ink', ACTIVE_RULE),
                    'aria-current': 'page',
                  }}
                >
                  <item.icon className="size-5 shrink-0 text-brand" />
                  <span className="min-w-0">
                    {item.label}
                    <span className="block truncate text-xs font-normal text-faint">
                      {item.blurb}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="-mx-3 border-t border-line pt-4">
          <NextReleaseList compact />
        </div>
        <p className="mt-4 text-xs text-faint">Built on Mezo · testnet funds only</p>
      </div>
    </div>
  )
}

/**
 * The app's chrome around the page: the app layout route renders it with the matched page (`<Outlet/>`), or pass
 * `children` to render other content in the same shell. `data-vt-name` marks the chrome the `rate-wipe` view
 * transition holds still; `.rate-sweep` is the base-rate line it draws on the topbar's bottom rule
 * (src/styles/motion.css).
 */
export function AppShell({ children }: { children?: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the sheet on navigation
  useEffect(() => setMoreOpen(false), [pathname])
  const closeMore = useCallback(() => setMoreOpen(false), [])

  return (
    <div className="min-h-dvh bg-canvas [background-image:var(--grain)]" style={SHELL_VARS}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[3px] focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-64">
        <header
          data-vt-name="topbar"
          className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm"
        >
          <span aria-hidden="true" className="rate-sweep" />
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link to="/" className="rounded-[3px] lg:hidden" aria-label="Baserate home">
              <Wordmark />
            </Link>
            <div className="hidden items-center gap-3 sm:flex">
              <SpecimenStamp />
              {!deployed.factory ? (
                <span className="text-xs text-muted">
                  Contracts deploy soon; live Mezo data is shown now.
                </span>
              ) : null}
            </div>
            <ConnectButton
              accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
              chainStatus={{ smallScreen: 'none', largeScreen: 'icon' }}
              showBalance={{ smallScreen: false, largeScreen: true }}
            />
          </div>
        </header>
        <main id="main" className={cx('mx-auto max-w-6xl px-4 pt-6 pb-10 sm:px-6 sm:pt-9')}>
          <div className="mb-5 empty:hidden">
            <NetworkGuard />
          </div>
          {children ?? <Outlet />}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1.75rem)] sm:px-6 lg:pb-10">
          <span aria-hidden="true" className="band block" />
          <div className="mt-3 flex flex-col gap-2">
            <SerialStrip className="lg:hidden" />
            <p className="text-xs text-muted">
              Baserate is experimental software on Mezo testnet. Test tokens have no value. Built on
              Mezo.
            </p>
          </div>
        </footer>
      </div>
      <MobileTabs onMore={() => setMoreOpen(true)} moreRef={moreButton} />
      <MoreSheet open={moreOpen} onClose={closeMore} returnFocus={moreButton} />
    </div>
  )
}
