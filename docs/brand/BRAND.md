# Baserate brand

Art direction: **Intaglio**. Baserate is a living banknote.

The tokens are in `apps/web/src/brand/tokens.css` (web) and `tokens.json` (film and deck). The assets are in `apps/web/public/brand/`. To rebuild everything, including the `--grain` tile in `tokens.css`, run `node apps/web/scripts/brand/render-assets.mjs`. Run `python3 apps/web/scripts/brand/outline-fonts.py` before it only when the outlined type or the wordmark's engraving changes. To check the colours, run `node apps/web/scripts/brand/contrast.mjs`.

## The idea

The base rate is the floor price of money: the rate a central bank sets, from which every other rate is priced. Baserate lends dollars against bitcoin from a floor that does not move under you, because nothing can redeem you out of your position. So the brand borrows from money itself.

Banknotes are where institutions make trust visible: copperplate intaglio engraving, guilloche rosettes, microprint, serial numbers and rate sheets. In our version, the bitcoin coin sits at the centre.

Everything is engraved, and tone comes from line density: dense lines read light on ink and dark on paper. Nothing uses a gradient, glow, glass, a soft shadow or a crypto blob. "Living" means the engraving moves. Lines draw on, rosettes turn and the rate steps up.

## Logo

**The mark.** The rate line steps up from a solid base. Both are cut from a mint plate, which is ringed by plain rims and, at the fine and medium sizes, a woven guilloche rope. The small mark keeps one heavy rim and no rope.

**The wordmark** is "Baserate" in Bodoni Moda, outlined so it renders without the font. It comes in two optical cuts:

- **Text cut** (opsz 11): solid, holds down to a 10 px capital height. The lockups and the app header use it.
- **Display cut** (opsz 24): carries the brand's own detail at large sizes. Horizontal lines are engraved into its thick strokes, as on a banknote's lettering. There are 36 rows from the capital line to the baseline, and each gap is 1.1 units, kept 2.8 units inside the outline so the outline, hairlines and serifs stay solid (`WORDMARK_DISPLAY.engraving`).
  - **48 px capital height and up:** use it engraved. At 48 px the gaps reach 0.5 px.
  - **24 to 48 px:** use it solid. Below 24 px its e loses its bar.
  - **Choosing in code:** `wordmarkFor(capPx)` in `src/brand/wordmark.ts` picks the cut and whether to engrave, from `WORDMARK_FLOORS`. The render script refuses to write a wordmark file whose own size falls under its floor.

In the lockups, the word's capital height runs from the top of the rate step to the foot of its base, so the word stands on the same base as the step.

| File | Use |
| --- | --- |
| `mark.svg`, `mark-reverse.svg` | Full colour, on paper and on Intaglio. Fine detail, 168 px and up |
| `mark-mono-ink.svg`, `mark-mono-paper.svg` | One colour, with the step knocked out: print, emboss, foil, photography. Fine detail |
| `lockup-horizontal(-reverse).svg`, `lockup-stacked(-reverse).svg` | The signature. Text cut of the word, medium mark |
| `wordmark(-reverse).svg` | The word alone, display cut, engraved. 48 px capital height and up: the hero, the film, the deck |
| `wordmark-solid(-reverse).svg` | The word alone, display cut, solid. 24 to 48 px capital height |
| `favicon.svg` (also `/favicon.svg`) | Browser tabs. Drawn on a 16-pixel grid, so it is crisp at 16, 32 and 48 px. A mint disc in light chrome. In dark chrome its outer pixel turns Guilloche |
| `favicon-16.png`, `favicon-32.png` | PNG fallbacks, rendered with the Guilloche rim, which holds on light and dark chrome. Link each from `index.html` with its `sizes` |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | App icons: the medium mark on a full-bleed Intaglio tile. The mark's radius is 35 % of the tile, inside the 40 % maskable safe zone |
| `site.webmanifest` | Name, colours and icons for installs. The 192 and 512 tiles are listed both as `any` and as `maskable` |
| `coin.svg`, `coin.png`, `coin.webp` (1024) | The coin: fallback for the 3D coin, and the coin in the film and the deck |
| `band.svg`, `band-on-note.svg` | The woven band, in Guilloche for ink and in Mint for paper. For dividers and under serial strips. It tiles horizontally |
| `grain.svg` | The paper fibre tile (240 px). The same tile is `--grain` in `tokens.css` |
| `og.png` (1200 × 630), `x-header.png` (1500 × 500) | Social cards |

**In the app**, use `<LogoMark detail="fine" | "medium" | "small" />` and `<Wordmark />` from `src/components/Logo.tsx`.

- **Mark colours:** `<LogoMark>` follows the ground through `--emblem-line`, `--emblem-plate` and `--emblem-cut`.
- **Word colour:** the word's role is `--emblem-word`: Intaglio on paper, Note on ink. `<Wordmark />` still fills the word with `text-ink`, so it does not follow `data-ground` yet. Switch it to `var(--emblem-word)`.

- **Clear space:** a quarter of the mark's diameter on every side, for the mark and for both lockups.
- **Detail by size:** each level of detail starts where its thinnest line reaches 0.5 device px. `markFloor(detail)` computes the floor and `markDetailFor(size, devicePixelRatio)` picks the level.

  | Detail | From (device px) | On a 2x screen (CSS px) | Thinnest line |
  | --- | --- | --- | --- |
  | `fine` | 168 | 84 | the rope's 0.3 units |
  | `medium` | 32 | 16 | the rope's 1.6 units (3 lines × 12 waves) |
  | `small` | 16 | 8 | the rim's 3.2 units; the favicon redraws it on a 16-pixel grid |

  Never go below 16 CSS px. Small marks carry fewer, heavier lines, never thinner ones.
- **Minimum sizes:**

  | Asset | Minimum |
  | --- | --- |
  | Horizontal lockup | 32 px tall (the medium mark's floor) |
  | Stacked lockup | 52 px tall (a 32 px mark) |
  | Word alone, engraved (`wordmark.svg`) | 48 px capital height |
  | Word alone, solid (`wordmark-solid.svg`) | 24 px capital height |
  | Mark in print | 8 mm, drawn from `markParts('medium')`. The fine mark needs 35 mm, because its 0.3-unit rope must print at 0.1 mm or more |
- **Don't:**
  - Recolour the logo outside Mint, Intaglio, Note and Guilloche. Amber and Seal Red never touch it.
  - Add a gradient, glow, shadow, bevel or outline.
  - Rotate, skew, stretch or re-space the logo.
  - Set the word in live type next to the mark.
  - Fill the knockouts.
  - Put the colour mark on a busy photo. Use a mono mark instead.
  - Redraw the step.

## Colour

| Token | Hex | Role |
| --- | --- | --- |
| Intaglio `--intaglio` | `#0C1512` | Ink: text on paper and the dark ground |
| Note `--note` | `#F2EEE3` | Paper: the light ground; engraving and text on ink |
| Mint `--mint` | `#0B6E5F` | Brand: the emblem's plate, primary actions, links on paper |
| Guilloche `--guilloche` | `#7FB8A6` | Engraved line work on ink. Never small text |
| Satoshi Amber `--amber` | `#F0A23B` | The single accent, for BTC only, on ink |
| Amber ink `--amber-ink` | `#A65F0F` | BTC figures on paper, 24 px and up. Smaller BTC text uses `--amber-ink-strong` `#95560E` (the `--fg-btc` role) |
| Seal Red `--seal` | `#B8432F` | Liquidation only. On ink, text uses `--seal-on-intaglio` `#C46553` |

Support tints are ink on paper and paper on ink:

| Use | On paper | On ink |
| --- | --- | --- |
| Raised | `#F8F6EF` | `#121C18` |
| Sunken | `#E9E4D6` | `#070D0B` |
| Muted text | `#4C524D` | `#ADADA4` |
| Faint text | `#636761` | `#8B8C85` |
| Hairline | `#CDCBC2` | `#293E37` |
| Control border (both grounds) | `#7F827B` | `#7F827B` |

**Grounds.** These role tokens flip with the colour scheme: `--ground`, `--ground-raised`, `--ground-sunken`, `--fg`, `--fg-muted`, `--fg-faint`, `--fg-brand`, `--fg-btc`, `--fg-seal`, `--rule`, `--engrave`, `--focus-ring`, `--emblem-line`, `--emblem-plate`, `--emblem-cut`, `--emblem-word`, `--hairline`, `--frame` and `--grain`. Light mode is paper and dark mode is ink. Set `data-ground="intaglio"` or `"note"` to force a ground for one section.

**Grain.** `--grain` is paper fibre and appears on paper only (it is `none` on ink). Each 240 px tile holds:

- about 200 short curved Intaglio hairlines, 6 to 20 px long and 0.5 to 0.8 px wide, at 3.5 %
- five Mint security fibres at 10 %

The tile is seeded, so every render is identical. `render-assets.mjs` draws it from `PRESETS.grain` with `fibres()` and writes it into `tokens.css` and `grain.svg`. Change the preset, never the data URI.

**The band on any ground.** `band.svg` is Guilloche (for ink) and `band-on-note.svg` is Mint (for paper). To follow the ground in CSS, use either file as a mask and paint it with `--engrave`:

```css
.divider {
  height: 28px;
  background: var(--engrave);
  mask: url("/brand/band.svg") repeat-x 0 50% / auto 100%;
}
```

At 28 px tall, its lines are 0.55 px.

**Contrast.** Computed by `contrast.mjs` (WCAG 2.2). Text needs 4.5:1. Large text, graphics and control borders need 3:1.

| Foreground | Background | Ratio | Bar | Use |
| --- | --- | ---: | ---: | --- |
| Intaglio | Note | 16.01:1 | 4.5 | Body text on paper |
| Intaglio | raised paper `#F8F6EF` | 17.16:1 | 4.5 | Body text on cards |
| Intaglio | sunken paper `#E9E4D6` | 14.61:1 | 4.5 | Text in inputs |
| muted `#4C524D` | Note | 6.91:1 | 4.5 | Secondary text on paper |
| faint `#636761` | Note / sunken | 4.97 / 4.54:1 | 4.5 | Captions, placeholders |
| Mint | Note | 5.31:1 | 4.5 | Links and brand text on paper |
| Note | Mint | 5.31:1 | 4.5 | Labels on mint buttons; the emblem cut |
| Amber ink | Note | 4.25:1 | 3 | BTC figures on paper, 24 px and up only |
| Amber ink | raised paper | 4.55:1 | 4.5 | BTC text on cards, any size |
| Amber ink strong `#95560E` | Note | 5.01:1 | 4.5 | BTC text on paper below 24 px |
| Seal Red | Note (either way round) | 4.67:1 | 4.5 | Liquidation text; the seal stamp |
| control border `#7F827B` | Note / Intaglio | 3.37 / 4.76:1 | 3 | Input and control borders |
| Note | Intaglio / raised ink | 16.01 / 15.03:1 | 4.5 | Body text on ink |
| muted `#ADADA4` | Intaglio / raised ink | 8.21 / 7.71:1 | 4.5 | Secondary text on ink |
| faint `#8B8C85` | Intaglio / raised ink | 5.47 / 5.13:1 | 4.5 | Captions on ink |
| Satoshi Amber | Intaglio | 8.78:1 | 4.5 | BTC text on ink |
| Seal on ink `#C46553` | Intaglio | 4.71:1 | 4.5 | Liquidation text on ink |
| Seal Red | Intaglio | 3.43:1 | 3 | Seal Red fills and large type on ink |
| Guilloche | Intaglio | 8.23:1 | 3 | Line work on ink. Never text |
| Mint | Intaglio | 3.01:1 | 3 | Mint plates and buttons on ink |
| Intaglio | Satoshi Amber | 8.78:1 | 4.5 | The bitcoin sign on the coin |

## Type

| Role | Face | Size | Leading | Tracking |
| --- | --- | --- | --- | --- |
| Hero `--hero-*` | Bodoni Moda 400–500 | `clamp(3rem, 8.5vw, 9.5rem)` (48 → 152 px) | 0.92 | −0.025em |
| Section `--section-*` | Bodoni Moda | `clamp(2.25rem, 4.6vw, 4.75rem)` (36 → 76 px) | 1.0 | −0.02em |
| Lead `--lead-*` | Public Sans | `clamp(1.125rem, 1.4vw, 1.5rem)` (18 → 24 px) | 1.45 | 0 |
| Body `--body-*` | Public Sans | `clamp(1rem, 1.05vw, 1.125rem)` (16 → 18 px) | 1.6 | 0 |
| Serial `--serial-*` | IBM Plex Mono 500, uppercase labels, hex as written | `0.75rem` | 1.2 | +0.12em |

- **Bodoni Moda** is the engraver's Didone. Use it for headlines and big numerals only. It is variable, and its optical size follows the font size, so hero type reaches opsz 96. Use italic for one emphasised phrase per headline, never more.
- **Public Sans** carries every sentence and every control. Numbers are always `font-variant-numeric: var(--figures)` (tabular, lining).
- **IBM Plex Mono** is for serial strips only: addresses, block numbers, tx hashes and rates. Never use it for sentences.
- **Serial case:** labels and units are uppercase (`--serial-case`). Hex values (addresses, tx hashes) are the exception: they take `--serial-hex-case: none` and keep the lowercase `0x` and their EIP-55 checksum case. Uppercase would render `0X7A3F…`, which reads as wrong, destroys the checksum, and copies out as text that strict `^0x` validators reject. Plex's dotted zero keeps O and 0 apart at 12 px.
- **Hairlines:** Bodoni's hairlines thin as opsz rises, from 0.0195 em at opsz 11 to 0.002 em at opsz 96. When type is seen smaller than it is set (social cards, thumbnails, film), pin opsz to the size it is seen at. The social cards use opsz 36.
- **Loading:** fonts are self-hosted (the CSP allows only `'self'`), latin subset only, with `font-display: swap`. `index.html` preloads Bodoni roman and Public Sans roman. Fallback faces, Georgia and Arial reshaped to the brand faces' metrics, keep the swap from shifting the layout.

## Guilloche

`apps/web/src/brand/guilloche.ts` is deterministic and dependency-free. The same call returns the same path data in the browser, in Node and in the film.

| Function | Draws | Used for |
| --- | --- | --- |
| `rosette(r, petals, phase, lines)` | Stacked waving lines twisted into petals; `weave` adds the counter-twisted family | The coin's field: woven, so it reads as a lace lattice and not a turbine |
| `ring(radius, amplitude, waves, lines)` | A woven rope around a circle | The emblem's rope; the coin's rope and braid |
| `band(width, height, waves, lines)` | A woven band | Dividers, under serial strips, the foot of the social cards |
| `microtextRing(text, radius)` | Microprint, optionally `numbered` | The coin's microprint: "BASERATE 000001 · BASERATE 000002 · …" |
| `fibres(size)` | Short curved hairlines on a seamless tile | The paper grain |
| `ruling`, `reeding` | A flat tint, a milled edge | Shading a field; the coin's edge |
| `hypotrochoid(R, r, d)` | A spirograph curve | Available. No current asset uses it, because it vanished at the sizes the coin is shown |
| `markParts(detail)`, `markFloor(detail)`, `markDetailFor(size, dpr)` | The emblem and its size floors | The mark's three levels of detail |

`PRESETS` holds the mark, coin, band and grain parameters.

**The coin, from the edge in:**

1. **Reeding.**
2. **Microprint:** set at 7 units, about 3.6 px in the Open Graph card, so it reads as a textured line and only reads as text under a loupe.
3. **A fine braid** in Guilloche.
4. **The rope** in Note.
5. **The woven rosette:** 30 petals, 18 lines and both twists.
6. **The amber centre.** Real intaglio is struck over the amber underprint: concentric ink rules 1.7 units wide on a 5.2-unit pitch, about a third ink, so the amber stays bright. A keyline 0.14 of the sign's capital height cuts the rules back around the bitcoin sign, and the sign's counters stay clean amber. The sign's bars end inside the hairlines they cross, never in a counter.

At 500 px across and up, the coin's thinnest lines are 0.5 px. In a feed thumbnail, its engraving resolves to tone.

**Rules:**

- Line work is ink, never alpha. The grain is the one exception: it is a 3.5 % texture.
- Where an asset is authored and shown in the product, every line is at least 0.5 device px at that size (`MIN_LINE_PX`). Thumbnails, such as a social card in a feed, may resolve to tone. When small, draw fewer, heavier lines.
- Use Guilloche on ink and Mint on paper. Amber appears only inside the bitcoin centre.
- To animate a rosette, turn its `phase` slowly, if at all.

## Social cards

`og.png` and `x-header.png` are seen at about 42 % in a feed (506 × 265 on X, smaller on phones). X shows only the image and a domain chip, so whatever has to be read is sized for that:

- **The lockup** is 88 px tall. The word's capital height is 30 px, about 13 px in a feed.
- **A Public Sans lead line** says Mezo and what is different: "Borrow MUSD on Mezo. No redemption queue."
- **The frame** is a 3 px Guilloche rule with a 1 px rule inside it, so it survives the 40 % scale.
- **The serial strip** is a serial number ("MEZO TESTNET · No. 000001"), not the URL, which X already shows.
- **The headline** pins Bodoni to opsz 36, the size it is read at.
- **The X header** has no lockup, because the avatar carries the mark. Its words stay above the avatar, which covers the bottom left from about y 333.

## Motion

Motion is the press, not the screen. Each page gets one choreographed load and one scroll scene. Everything else is micro.

**Eases**

| Token | Curve | GSAP | Use |
| --- | --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | `expo.out` | Arrivals |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | `power2.inOut` | Moves between two states |

**Durations**

| Token | Range | Default |
| --- | --- | --- |
| micro | 0.2–0.4 s | 0.3 s |
| reveal | 0.6–1.0 s | 0.8 s |
| hero | 0.9–1.4 s | 1.2 s |
| stagger | 0.05–0.12 s | 0.08 s |

**Choreography**

- **The load:** the hero lands once (`--dur-hero`). The base draws, then the rate step, then the headline in staggered lines, then the coin engraving draws inward from the rim.
- **The scroll scene:** one per page. The coin turns as you read (`--ease-in-out`, scrubbed), and nothing else is pinned.
- **The base-rate line wipe:** the rate step draws left to right. Flat, rise, flat, with the base first. 0.8 s, `--ease-out`. Use it on load and whenever a rate changes.
- **The press ring:** on a confirmed transaction, one guilloche ring presses in. Scale goes from 1.04 to 1 as its lines come in, over 0.6 s with `--ease-out`. It plays once, like the impression of an intaglio press, and never loops.
- **The seal stamp:** liquidation only. A Seal Red seal lands at scale 1.08 → 1 with a 2° settle, in 0.3 s, with no bounce.
- **Reduced motion:** `--travel` falls to 0, durations to 0.2 s or less, and the stagger to 0. Draws become fades, the coin stops turning and nothing parallaxes.

## Voice

- Use plain verbs: borrow, repay, save, lend, liquidate.
- Use sentence case everywhere, including buttons.
- Give specific numbers: "4.2% APR", "liquidates at $58,410", "48 h timelock".
- Write from the user's side: "your bitcoin", "you can repay any time".
- Never use hype, "unlock", "next-gen" or "revolutionary".

## Do and don't

| Do | Don't |
| --- | --- |
| Engrave tone with line density | Use gradients, glow, glass, blur or crypto blobs |
| Keep one accent: amber means BTC | Use amber for emphasis, links or the logo |
| Keep Seal Red for liquidation | Spend Seal Red on decoration or emphasis |
| Put Guilloche line work on ink | Set text in Guilloche |
| Write numbers in tabular figures and real values | Round away the number the user needs |
| Use one Bodoni italic phrase per headline | Use italic paragraphs, or live Bodoni below 24 px |
| Use hairline frames (`--hairline`, `--frame`) | Use drop shadows to lift cards |
| Use one load, one scroll scene, and micro everywhere else | Fade and slide up everything |
| Respect reduced motion: things fade in place | Gate content behind animation |
