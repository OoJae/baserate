import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'
import { LogoMark } from './components/Logo'
import { navTypes, RootLayout, useZone, VT_TYPES } from './RootLayout'
import { NotFoundPage } from './site/NotFoundPage'
import { LandingPage } from './site/pages/LandingPage'
import { SiteLayout } from './site/SiteLayout'

/*
 * Route tree. Two pathless layouts under the root:
 *   site (eager): /, /how-it-works, /security, /brand, and the 404 (NotFoundPage renders SiteLayout itself)
 *   app (lazy):   /borrow, /save, /lend, /liquidate, /risk, /fees, /evidence
 * The landing is the only page in the entry chunk. The app layout brings the wallet stack with it, so nothing on the
 * site downloads wagmi or RainbowKit. The seven app paths are unchanged: the e2e opens them directly.
 */

const SITE_DESCRIPTION =
  'Borrow dollars (MUSD) against your bitcoin with no redemption queue, save in wsMUSD, or lend through the vMUSD vault. Built on Mezo’s own Morpho Blue.'

/** Shown only while the app's chunks are still loading after the router's pending delay. */
function AppPending() {
  useZone('app')
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas" aria-busy="true">
      <LogoMark detail="medium" className="size-12" />
      <span className="sr-only">Opening the app</span>
    </div>
  )
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage })

const siteLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'site',
  component: SiteLayout,
})

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: lazyRouteComponent(() => import('./app/AppLayout'), 'AppLayout'),
  pendingComponent: AppPending,
})

// Site pages
const landingRoute = createRoute({
  getParentRoute: () => siteLayout,
  path: '/',
  component: LandingPage,
  staticData: {
    title: 'Baserate · Dollars against your bitcoin, at the base rate',
    description: SITE_DESCRIPTION,
  },
})

const howItWorksRoute = createRoute({
  getParentRoute: () => siteLayout,
  path: '/how-it-works',
  component: lazyRouteComponent(() => import('./site/pages/HowItWorksPage'), 'HowItWorksPage'),
  staticData: {
    title: 'How it works · Baserate',
    description:
      'How Baserate works: lock BTC, borrow MUSD from Mezo’s own Morpho market with no redemption queue, save in wsMUSD or lend through vMUSD.',
  },
})

const securityRoute = createRoute({
  getParentRoute: () => siteLayout,
  path: '/security',
  component: lazyRouteComponent(() => import('./site/pages/SecurityPage'), 'SecurityPage'),
  staticData: {
    title: 'Security · Baserate',
    description:
      'Baserate’s internal review rounds, the findings ledger and the fixes. No third-party audit yet.',
  },
})

const brandRoute = createRoute({
  getParentRoute: () => siteLayout,
  path: '/brand',
  component: lazyRouteComponent(() => import('./site/pages/BrandPage'), 'BrandPage'),
  staticData: {
    title: 'Brand · Baserate',
    description:
      'The Baserate brand, Intaglio: logo, colours, type, guilloche and motion, with downloads.',
  },
})

// App pages (each PageHeader sets the document title)
const borrowRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/borrow',
  component: lazyRouteComponent(() => import('./pages/BorrowPage'), 'BorrowPage'),
})

const saveRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/save',
  component: lazyRouteComponent(() => import('./pages/SavePage'), 'SavePage'),
})

const lendRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/lend',
  component: lazyRouteComponent(() => import('./pages/LendPage'), 'LendPage'),
})

const liquidateRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/liquidate',
  component: lazyRouteComponent(() => import('./pages/LiquidatePage'), 'LiquidatePage'),
})

const riskRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/risk',
  component: lazyRouteComponent(() => import('./pages/RiskPage'), 'RiskPage'),
})

const feesRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/fees',
  component: lazyRouteComponent(() => import('./pages/FeesPage'), 'FeesPage'),
})

const evidenceRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/evidence',
  component: lazyRouteComponent(() => import('./pages/EvidencePage'), 'EvidencePage'),
})

const routeTree = rootRoute.addChildren([
  siteLayout.addChildren([landingRoute, howItWorksRoute, securityRoute, brandRoute]),
  appLayout.addChildren([
    borrowRoute,
    saveRoute,
    lendRoute,
    liquidateRoute,
    riskRoute,
    feesRoute,
    evidenceRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  notFoundMode: 'root',
  // Typed view transitions only (see RootLayout): never on the first load, none under reduced motion.
  defaultViewTransition: VT_TYPES ? { types: navTypes } : false,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
