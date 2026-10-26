import { Link, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SiteLayout } from './SiteLayout'

/** Any path no route matches: the site chrome, an h1, and a way back to the landing and into the app. */
export function NotFoundPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  useEffect(() => {
    document.title = 'Page not found · Baserate'
  }, [])
  return (
    <SiteLayout>
      <section className="mx-auto max-w-[90rem] px-4 py-20 sm:px-6 md:py-28 lg:px-10">
        <p className="serial text-faint">
          Not found · <span className="break-all normal-case">{pathname}</span>
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-section text-ink">Page not found</h1>
        <p className="mt-5 max-w-xl text-lead text-muted">
          There is no page at this address. Start from the home page, or open the app to borrow,
          save and lend.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/borrow"
            className="inline-flex h-11 items-center rounded-[3px] bg-ink px-5 text-[0.9375rem] font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            Open the app
          </Link>
          <Link
            to="/"
            className="inline-flex h-11 items-center rounded-[3px] border border-line-strong px-5 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-raised"
          >
            Go to the home page
          </Link>
        </div>
      </section>
    </SiteLayout>
  )
}
