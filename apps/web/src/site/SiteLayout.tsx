import { Link, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { LogoMark, Wordmark } from '../components/Logo'
import { APP_CHAIN_ID } from '../queryClient'
import { useZone } from '../RootLayout'

/*
 * Site chrome for the landing, /how-it-works, /security, /brand and the 404: quiet, on the Intaglio ground. The
 * header's height is fixed per breakpoint and published as --site-header-h (6.25rem below md, two rows; 4.5rem from
 * md, one row), so a full-height hero can size itself without measuring. Paper sections inside set
 * data-ground="note".
 */

const SITE_NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/security', label: 'Security' },
  { to: '/brand', label: 'Brand' },
  { to: '/evidence', label: 'Evidence' },
] as const

const FOOTER_NAV = [
  {
    heading: 'Baserate',
    links: [
      { to: '/how-it-works', label: 'How it works' },
      { to: '/security', label: 'Security' },
      { to: '/brand', label: 'Brand' },
    ],
  },
  {
    heading: 'The app',
    links: [
      { to: '/borrow', label: 'Borrow' },
      { to: '/save', label: 'Save' },
      { to: '/lend', label: 'Lend' },
      { to: '/evidence', label: 'Evidence' },
    ],
  },
] as const

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function SiteHeader() {
  return (
    <header className="relative z-20 h-(--site-header-h) shadow-[inset_0_-1px_0_var(--line)]">
      <div className="mx-auto flex h-full max-w-[90rem] flex-wrap items-center gap-x-3 px-4 sm:gap-x-6 sm:px-6 md:flex-nowrap lg:px-10">
        <Link
          to="/"
          aria-label="Baserate home"
          className="flex h-14 shrink-0 items-center rounded-[3px] md:h-full [&_svg]:h-8 sm:[&_svg]:h-9"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="order-2 w-full md:order-none md:ml-auto md:w-auto">
          <ul className="-mx-1.5 flex h-11 items-stretch justify-between md:mx-0 md:h-auto md:justify-end md:gap-2">
            {SITE_NAV.map((item) => (
              <li key={item.to} className="flex">
                <Link
                  to={item.to}
                  className="flex min-h-11 items-center rounded-[3px] px-1.5 text-sm font-medium text-muted underline-offset-[6px] transition-colors hover:text-ink hover:underline data-[status=active]:text-ink data-[status=active]:underline md:px-2 md:text-[0.9375rem]"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          to="/borrow"
          className="order-1 ml-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-[3px] border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-raised sm:px-4 sm:text-[0.9375rem] md:order-none md:ml-0"
        >
          Open the app
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="shadow-[inset_0_1px_0_var(--line)]">
      <div className="mx-auto grid max-w-[90rem] gap-10 px-4 pt-12 pb-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-10">
        <div className="flex max-w-md items-start gap-4">
          <LogoMark detail="medium" className="size-10 shrink-0" />
          <p className="text-sm leading-relaxed text-muted">
            Baserate is experimental software on Mezo testnet. Test tokens have no value.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-6">
          {FOOTER_NAV.map((group) => (
            <div key={group.heading}>
              <p className="serial text-faint">{group.heading}</p>
              <ul className="mt-2">
                {group.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="flex min-h-11 items-center text-sm text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="serial text-faint md:col-span-2">
          Mezo testnet · chain {APP_CHAIN_ID} · built on Mezo
        </p>
      </div>
    </footer>
  )
}

/** The site layout route; NotFoundPage renders it around its own content. */
export function SiteLayout({ children }: { children?: ReactNode }) {
  useZone('site')
  return (
    <div
      data-ground="intaglio"
      className="flex min-h-dvh flex-col bg-canvas text-ink [--site-header-h:6.25rem] md:[--site-header-h:4.5rem]"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-[3px] focus:bg-surface focus:px-4 focus:py-3 focus:text-ink"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children ?? <Outlet />}
      </main>
      <SiteFooter />
    </div>
  )
}
