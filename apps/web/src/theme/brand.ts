import { useSyncExternalStore } from 'react'
import tokens from '../brand/tokens.json'

/*
 * The brand in TypeScript, for code that cannot use a CSS variable directly (WebGL uniforms, canvas textures, the
 * Web Animations API). The source of truth stays src/brand/tokens.css (mirrored in tokens.json): colours are read
 * from there, never re-typed here.
 */

function pickHex(t: typeof tokens) {
  const p = t.color.palette
  const s = t.color.support
  return {
    intaglio: p.intaglio.hex,
    note: p.note.hex,
    mint: p.mint.hex,
    guilloche: p.guilloche.hex,
    amber: p.amber.hex,
    amberInk: p.amberInk.hex,
    amberInkStrong: s.amberInkStrong.hex,
    seal: p.seal.hex,
    sealOnIntaglio: s.sealOnIntaglio.hex,
    noteRaised: s.noteRaised.hex,
    noteSunken: s.noteSunken.hex,
    intaglioRaised: s.intaglioRaised.hex,
    intaglioSunken: s.intaglioSunken.hex,
    ruleOnNote: s.ruleOnNote.hex,
    ruleOnIntaglio: s.ruleOnIntaglio.hex,
    ruleStrong: s.ruleStrong.hex,
  } as const
}

/**
 * The brand palette as hex strings. Importing it bundles tokens.json, so code in the landing's entry chunk should
 * prefer `readCssColor`. The app's text colours that differ from the palette (amber text on paper #96550C, Seal Red
 * text #A3392A) live in src/styles.css: read them with `readCssColor('--btc')` / `readCssColor('--bad')`.
 */
export const BRAND_HEX = /* @__PURE__ */ pickHex(tokens)
export type BrandColor = keyof typeof BRAND_HEX

/**
 * A colour token's current value on `element` (default: the root), e.g. `readCssColor('--mint')` → "#0b6e5f".
 * Semantic tokens follow the colour scheme and the nearest `data-ground`, so read them where they are used.
 */
export function readCssColor(name: `--${string}`, element?: Element): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(element ?? document.documentElement)
    .getPropertyValue(name)
    .trim()
}

/** "#0c1512" or "#0c1" → [r, g, b] in 0–1 sRGB (raw values for shader uniforms); null for anything else. */
export function hexToRgb01(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m?.[1]) return null
  const h =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1]
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
}

const DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

function subscribeMedia(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(query)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True when the reader asked for reduced motion. Read it at the moment of animating, not once at start-up. */
export function prefersReducedMotion(): boolean {
  return mediaMatches(REDUCED_MOTION_QUERY)
}

const subscribeReducedMotion = (onChange: () => void) =>
  subscribeMedia(REDUCED_MOTION_QUERY, onChange)

/** `prefersReducedMotion()` as React state: re-renders when the setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}

/** Calls `onChange` when the colour scheme flips (e.g. to re-read colour tokens into WebGL). Returns unsubscribe. */
export function subscribeColorScheme(onChange: () => void): () => void {
  return subscribeMedia(DARK_QUERY, onChange)
}

/** The motion tokens of src/brand/tokens.css and src/styles.css, for the Web Animations API and GSAP. */
export const EASE = {
  /** --ease-out (GSAP expo.out): arrivals, the line wipe, the press ring. */
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** --ease-in: departures (the old page leaving). */
  in: 'cubic-bezier(0.7, 0, 0.84, 0)',
  /** --ease-in-out (GSAP power2.inOut): moves between two states, scroll scenes. */
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const

/** Durations in ms (CSS: --dur-press, --dur-micro, --dur-ring, --dur-seal, --dur-page, --dur-reveal, --dur-hero, --stagger). */
export const DURATION_MS = {
  press: 120,
  micro: 300,
  ring: 420,
  seal: 500,
  page: 560,
  reveal: 800,
  hero: 1200,
  stagger: 80,
} as const
