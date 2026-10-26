/**
 * Values the page and the stage share. Kept apart from stage.ts so the landing's entry chunk can read them without
 * loading three.js.
 */

/**
 * The poster: the coin at rest, engraved by the same law as the WebGL coin (scripts/brand/render-coin.mjs writes it
 * from src/brand/coin.ts). Show it for reduced motion, without WebGL, and while WebGL is late. It is square: size
 * it to the coin's anchor box.
 */
export const STAGE_POSTER = {
  src: '/brand/coin-engraved.svg',
  width: 1000,
  height: 1000,
  alt: '',
} as const

/** How long after first paint WebGL may take before the poster shows (it then crossfades, without the intro). */
export const STAGE_READY_TIMEOUT_MS = 3000

/** The crossfade between the poster and a late canvas (both ways), ms, on --ease-out. */
export const STAGE_FADE_MS = 600

/** The footer's crossfade: over this range of the footer's progress the canvas emblem fades out; fade the SVG mark in. */
export const SPOOL_CROSSFADE = [0.86, 1] as const
