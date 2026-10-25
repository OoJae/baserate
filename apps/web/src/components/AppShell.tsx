import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { type ComponentType, type SVGProps, useEffect, useState } from 'react'
import { NEXT_RELEASE } from '../lib/roadmap'
import { appChain, deployed } from '../wagmi'
import { IconBorrow, IconEvidence, IconLock, IconMore, IconSave, IconX } from './icons'
import { Wordmark } from './Logo'
import { NetworkGuard, useChainHead } from './NetworkGuard'
import { cx, Dot } from './ui'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const NAV: { to: '/borrow' | '/save' | '/evidence'; label: string; icon: Icon; blurb: string }[] = [
  { to: '/borrow', label: 'Borrow', icon: IconBorrow, blurb: 'MUSD against BTC' },
  { to: '/save', label: 'Save', icon: IconSave, blurb: 'wsMUSD savings' },
  { to: '/evidence', label: 'Evidence', icon: IconEvidence, blurb: 'Verify it on-chain' },
]

function NextReleaseList({ compact }: { compact?: boolean }) {
  return (
    <section aria-labelledby={compact ? 'next-release-m' : 'next-release'}>
      <h2
        id={compact ? 'next-release-m' : 'next-release'}
        className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
      >
        Coming in the next release
      </h2>
      <ul className="space-y-0.5">
        {NEXT_RELEASE.map((item) => (
          <li
            key={item.label}
            aria-disabled="true"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm"
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

function ChainStatus() {
  const head = useChainHead()
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Dot tone={head.isError ? 'bad' : head.data ? 'good' : 'neutral'} />
      <span className="truncate">
        {appChain.name}
        {head.data ? (
          <span className="num"> · #{head.data.toLocaleString('en-US')}</span>
        ) : head.isError ? (
          ' · RPC down'
        ) : null}
      </span>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-5 pt-5 pb-6">
        <Link to="/borrow" aria-label="Baserate home">
          <Wordmark />
        </Link>
      </div>
      <nav aria-label="Main" className="px-3">
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                activeProps={{ className: 'bg-brand-soft !text-brand', 'aria-current': 'page' }}
              >
                <item.icon className="size-5 shrink-0" />
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
      <div className="mt-6 border-t border-line px-0 pt-5">
        <NextReleaseList />
      </div>
      <div className="mt-auto space-y-2 border-t border-line px-5 py-4">
        <ChainStatus />
        <p className="text-xs text-faint">Built on Mezo · testnet funds only</p>
      </div>
    </aside>
  )
}

function MobileTabs({ onMore }: { onMore: () => void }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {NAV.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted"
              activeProps={{ className: '!text-brand', 'aria-current': 'page' }}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onMore}
            className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted"
          >
            <IconMore className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <ChainStatus />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-raised"
          >
            <IconX className="size-5" />
          </button>
        </div>
        <div className="-mx-3">
          <NextReleaseList compact />
        </div>
        <p className="mt-4 text-xs text-faint">Built on Mezo · testnet funds only</p>
      </div>
    </div>
  )
}

export function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the sheet on navigation
  useEffect(() => setMoreOpen(false), [pathname])

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link to="/borrow" className="lg:hidden" aria-label="Baserate home">
              <Wordmark />
            </Link>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                Testnet
              </span>
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
        <main
          id="main"
          className={cx('mx-auto max-w-6xl px-4 pt-5 pb-28 sm:px-6 sm:pt-8 lg:pb-16')}
        >
          <div className="mb-5 empty:hidden">
            <NetworkGuard />
          </div>
          <Outlet />
        </main>
        <footer className="mx-auto hidden max-w-6xl px-6 pb-10 text-xs text-muted lg:block">
          Baserate is experimental software on Mezo testnet. Test tokens have no value. Built on
          Mezo.
        </footer>
      </div>
      <MobileTabs onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  )
}
