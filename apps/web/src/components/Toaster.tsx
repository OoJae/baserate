import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { Seal, type SealTone } from './brand/Seal'
import { IconAlert, IconExternal, IconInfo, IconX } from './icons'
import { cx, Spinner } from './ui'

export type ToastTone = 'pending' | 'success' | 'error' | 'info'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  message?: string
  href?: string
  hrefLabel?: string
  /** The seal a success stamps: mint (default), or Seal Red for a liquidation. */
  seal?: SealTone
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
      {/* A dismissed toast leaves at once: no exit animation, so a leaving toast is never still read. */}
      <section
        aria-label="Notifications"
        aria-live="polite"
        data-vt-name="toasts"
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
  // A fixed 32 px slot, so the text never moves when a pending toast turns into a success.
  const icon =
    toast.tone === 'pending' ? (
      <Spinner className="size-5 text-brand" />
    ) : toast.tone === 'success' ? (
      <Seal key="success" tone={toast.seal ?? 'mint'} className="size-8" />
    ) : toast.tone === 'error' ? (
      <IconAlert className="size-5 text-bad" />
    ) : (
      <IconInfo className="size-5 text-brand" />
    )
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'toast-in frame pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[6px] border bg-surface py-3 pr-2 pl-3',
        toast.tone === 'error' ? 'border-bad/60' : 'border-line-strong/70',
      )}
    >
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <p className="font-semibold text-ink">{toast.title}</p>
        {toast.message ? (
          <p className="mt-0.5 leading-snug break-words text-muted">{toast.message}</p>
        ) : null}
        {toast.href ? (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex items-center gap-1 font-medium text-brand underline-offset-[3px] hover:underline"
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
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink"
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
