import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { IconAlert, IconCheck, IconExternal, IconX } from './icons'
import { cx, Spinner } from './ui'

export type ToastTone = 'pending' | 'success' | 'error' | 'info'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  message?: string
  href?: string
  hrefLabel?: string
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'> & { id?: string }) => string
  update: (id: string, t: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  pending: null,
  success: 9_000,
  info: 7_000,
  error: 14_000,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useMemo(() => new Map<string, ReturnType<typeof setTimeout>>(), [])

  const dismiss = useCallback(
    (id: string) => {
      const t = timers.get(id)
      if (t) clearTimeout(t)
      timers.delete(id)
      setToasts((list) => list.filter((x) => x.id !== id))
    },
    [timers],
  )

  const schedule = useCallback(
    (id: string, tone: ToastTone) => {
      const existing = timers.get(id)
      if (existing) clearTimeout(existing)
      const ms = AUTO_DISMISS_MS[tone]
      if (ms !== null)
        timers.set(
          id,
          setTimeout(() => dismiss(id), ms),
        )
    },
    [dismiss, timers],
  )

  const push = useCallback<ToastApi['push']>(
    (t) => {
      const id = t.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((list) => [...list.filter((x) => x.id !== id), { ...t, id }].slice(-4))
      schedule(id, t.tone)
      return id
    },
    [schedule],
  )

  const update = useCallback<ToastApi['update']>(
    (id, patch) => {
      setToasts((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      if (patch.tone) schedule(id, patch.tone)
    },
    [schedule],
  )

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 sm:top-auto sm:right-4 sm:bottom-4 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icon =
    toast.tone === 'pending' ? (
      <Spinner className="text-brand" />
    ) : toast.tone === 'success' ? (
      <IconCheck className="size-4 text-good" />
    ) : toast.tone === 'error' ? (
      <IconAlert className="size-4 text-bad" />
    ) : (
      <IconCheck className="size-4 text-brand" />
    )
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'toast-in pointer-events-auto flex w-full max-w-sm gap-3 rounded-xl border bg-surface p-3 shadow-card',
        toast.tone === 'error' ? 'border-bad/40' : 'border-line',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">{toast.title}</p>
        {toast.message ? <p className="mt-0.5 text-muted">{toast.message}</p> : null}
        {toast.href ? (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            {toast.hrefLabel ?? 'View on explorer'}
            <IconExternal className="size-3.5" />
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
      >
        <IconX className="size-4" />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
