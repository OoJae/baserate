import type { ReactNode } from 'react'

/** Token symbols that keep their case inside an uppercase serial: wsMUSD, vMUSD, sMUSD, bcBTC, mUSDC. */
const TOKEN = /^(ws|v|s|bc|m)[A-Z]{3,5}[,.]?$/

/**
 * Serial text in caps, with token symbols kept as written ("M1 / wsMUSD", not "M1 / WSMUSD"): uppercase would
 * misspell them, as it would a hex address.
 */
export function SerialText({ children }: { children: string }) {
  const words = children.split(/(\s+)/)
  return (
    <>
      {words.map((w, i) =>
        TOKEN.test(w) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed string, in order
          <span key={i} className="normal-case">
            {w}
          </span>
        ) : (
          w
        ),
      )}
    </>
  )
}

/** A serial label: Plex Mono caps at 12 px, for eyebrows, sources and frame labels. Never a sentence. */
export function Label({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <p id={id} className={`serial text-balance text-faint ${className ?? ''}`}>
      {children}
    </p>
  )
}

/** The " · " between serial fields, silent for screen readers. */
export function Dot() {
  return (
    <span aria-hidden className="px-[0.5em] text-faint">
      ·
    </span>
  )
}
