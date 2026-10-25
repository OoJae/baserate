import { createRootRoute, createRoute, createRouter, Link, redirect } from '@tanstack/react-router'
import { AppShell } from './components/AppShell'
import { BorrowPage } from './pages/BorrowPage'
import { EvidencePage } from './pages/EvidencePage'
import { SavePage } from './pages/SavePage'

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-display text-3xl text-ink">Page not found</p>
      <p className="mt-2 text-muted">That page does not exist in this release.</p>
      <Link to="/borrow" className="mt-6 inline-block font-semibold text-brand hover:underline">
        Go to Borrow
      </Link>
    </div>
  )
}

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/borrow', replace: true })
  },
})

const borrowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/borrow',
  component: BorrowPage,
})

const saveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/save',
  component: SavePage,
})

const evidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/evidence',
  component: EvidencePage,
})

const routeTree = rootRoute.addChildren([indexRoute, borrowRoute, saveRoute, evidenceRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
