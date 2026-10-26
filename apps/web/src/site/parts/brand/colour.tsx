import tokens from '../../../brand/tokens.json'
import { carries, contrast, ratioLabel } from './contrast'

/*
 * Colour specimens. The palette and the support tints come from src/brand/tokens.json (the same values as
 * tokens.css); the text colours that differ from the palette (BTC and Seal Red text on paper) are the app's,
 * from src/styles.css. Every ratio is computed here with the WCAG 2.2 formula.
 */

const P = tokens.color.palette
const S = tokens.color.support

/** Text colours that are not palette entries (src/styles.css): the binding corrections. */
export const TEXT_COLOURS = {
  btcOnPaper: '#96550C',
  sealOnPaper: '#A3392A',
} as const

/** The ratios the colour notes quote, computed. */
export const KEY_RATIOS = {
  amberOnPaper: ratioLabel(contrast(P.amber.hex, P.note.hex)),
  btcOnPaper: ratioLabel(contrast(TEXT_COLOURS.btcOnPaper, P.note.hex)),
  sealOnPaper: ratioLabel(contrast(TEXT_COLOURS.sealOnPaper, P.note.hex)),
  mintOnInk: ratioLabel(contrast(P.mint.hex, P.intaglio.hex)),
} as const

interface Chip {
  key: string
  name: string
  hex: string
  role: string
  /** The chip's own ground, for the label colour on it. */
  dark: boolean
}

const PALETTE: readonly Chip[] = [
  {
    key: 'intaglio',
    name: P.intaglio.name,
    hex: P.intaglio.hex,
    role: 'Ink: text on paper, and the dark ground.',
    dark: true,
  },
  {
    key: 'note',
    name: P.note.name,
    hex: P.note.hex,
    role: 'Paper: the light ground; text and engraving on ink.',
    dark: false,
  },
  {
    key: 'mint',
    name: P.mint.name,
    hex: P.mint.hex,
    role: 'Brand: the emblem’s plate, primary actions, links on paper.',
    dark: true,
  },
  {
    key: 'guilloche',
    name: P.guilloche.name,
    hex: P.guilloche.hex,
    role: 'Line work on ink, and the brand colour on ink: links and focus.',
    dark: false,
  },
  {
    key: 'amber',
    name: P.amber.name,
    hex: P.amber.hex,
    role: 'The one accent. It means bitcoin, and only bitcoin.',
    dark: false,
  },
  {
    key: 'seal',
    name: P.seal.name,
    hex: P.seal.hex,
    role: 'Liquidation only. Never decoration, never emphasis.',
    dark: true,
  },
]

export function Palette() {
  return (
    <ul className="sp-palette">
      {PALETTE.map((c) => (
        <li key={c.key} className="sp-chip">
          <span
            className={c.dark ? 'sp-chip__swatch sp-chip__swatch--dark' : 'sp-chip__swatch'}
            style={{ background: c.hex }}
          >
            <span className="sp-chip__hex">{c.hex}</span>
          </span>
          <span className="sp-chip__name">{c.name}</span>
          <span className="sp-small">{c.role}</span>
        </li>
      ))}
    </ul>
  )
}

interface Pair {
  fg: string
  bg: string
  fgName: string
  bgName: string
  use: string
}

const PAIRS: readonly Pair[] = [
  {
    fg: P.intaglio.hex,
    bg: P.note.hex,
    fgName: 'Intaglio',
    bgName: 'Note',
    use: 'Body text on paper',
  },
  {
    fg: P.note.hex,
    bg: P.intaglio.hex,
    fgName: 'Note',
    bgName: 'Intaglio',
    use: 'Body text on ink',
  },
  {
    fg: S.inkMuted.hex,
    bg: P.note.hex,
    fgName: 'Muted',
    bgName: 'Note',
    use: 'Secondary text on paper',
  },
  {
    fg: S.paperMuted.hex,
    bg: P.intaglio.hex,
    fgName: 'Muted',
    bgName: 'Intaglio',
    use: 'Secondary text on ink',
  },
  {
    fg: P.mint.hex,
    bg: P.note.hex,
    fgName: 'Mint',
    bgName: 'Note',
    use: 'Links and brand text on paper',
  },
  { fg: P.note.hex, bg: P.mint.hex, fgName: 'Note', bgName: 'Mint', use: 'Labels on Mint buttons' },
  {
    fg: P.guilloche.hex,
    bg: P.intaglio.hex,
    fgName: 'Guilloche',
    bgName: 'Intaglio',
    use: 'The brand on ink: links, focus, line work',
  },
  {
    fg: TEXT_COLOURS.btcOnPaper,
    bg: P.note.hex,
    fgName: 'BTC text',
    bgName: 'Note',
    use: 'Bitcoin figures on paper, any size',
  },
  {
    fg: P.amber.hex,
    bg: P.intaglio.hex,
    fgName: 'Satoshi Amber',
    bgName: 'Intaglio',
    use: 'Bitcoin figures on ink',
  },
  {
    fg: TEXT_COLOURS.sealOnPaper,
    bg: P.note.hex,
    fgName: 'Seal text',
    bgName: 'Note',
    use: 'Liquidation text on paper',
  },
  {
    fg: S.sealOnIntaglio.hex,
    bg: P.intaglio.hex,
    fgName: 'Seal on ink',
    bgName: 'Intaglio',
    use: 'Liquidation text on ink',
  },
  {
    fg: P.seal.hex,
    bg: P.intaglio.hex,
    fgName: 'Seal Red',
    bgName: 'Intaglio',
    use: 'Seal fills and large type on ink',
  },
  {
    fg: P.mint.hex,
    bg: P.intaglio.hex,
    fgName: 'Mint',
    bgName: 'Intaglio',
    use: 'Mint plates and buttons on ink, never text',
  },
  {
    fg: P.amber.hex,
    bg: P.note.hex,
    fgName: 'Satoshi Amber',
    bgName: 'Note',
    use: 'Never text on paper',
  },
  {
    fg: P.guilloche.hex,
    bg: P.note.hex,
    fgName: 'Guilloche',
    bgName: 'Note',
    use: 'Never on paper',
  },
]

const VERDICT = {
  text: 'Any text',
  large: 'Large text and graphics',
  decoration: 'Not for text',
} as const

export function ContrastPairs() {
  return (
    <table className="sp-table sp-pairs">
      <caption className="sp-sr">Colour pairs and their WCAG 2.2 contrast ratios</caption>
      <thead>
        <tr>
          <th scope="col">Pair</th>
          <th scope="col" className="sp-table__num">
            Ratio
          </th>
        </tr>
      </thead>
      <tbody>
        {PAIRS.map((p) => {
          const ratio = contrast(p.fg, p.bg)
          const verdict = carries(ratio)
          return (
            <tr key={`${p.fg}-${p.bg}`}>
              <th scope="row">
                <span className="sp-pairs__row">
                  <span
                    className="sp-pairs__sample"
                    style={{ color: p.fg, background: p.bg }}
                    aria-hidden
                  >
                    Aa 0.0009
                  </span>
                  <span>
                    <span className="sp-pairs__names">
                      {p.fgName} on {p.bgName}
                    </span>
                    <span className="sp-pairs__use">{p.use}</span>
                  </span>
                </span>
              </th>
              <td className="sp-table__num">
                <span className="sp-pairs__ratio">{ratioLabel(ratio)}</span>
                <span
                  className={
                    verdict === 'text'
                      ? 'sp-stamp sp-stamp--good'
                      : verdict === 'large'
                        ? 'sp-stamp'
                        : 'sp-stamp sp-stamp--quiet'
                  }
                >
                  {VERDICT[verdict]}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const TINTS = [
  { name: 'Raised', paper: S.noteRaised.hex, ink: S.intaglioRaised.hex },
  { name: 'Sunken', paper: S.noteSunken.hex, ink: S.intaglioSunken.hex },
  { name: 'Muted text', paper: S.inkMuted.hex, ink: S.paperMuted.hex },
  { name: 'Faint text', paper: S.inkFaint.hex, ink: S.paperFaint.hex },
  { name: 'Hairline', paper: S.ruleOnNote.hex, ink: S.ruleOnIntaglio.hex },
  { name: 'Control border', paper: S.ruleStrong.hex, ink: S.ruleStrong.hex },
] as const

/** Support tints: ink on paper, paper on ink. */
export function Tints() {
  return (
    <table className="sp-table sp-tints">
      <caption className="sp-sr">Support tints on paper and on ink</caption>
      <thead>
        <tr>
          <th scope="col">Tint</th>
          <th scope="col">On paper</th>
          <th scope="col">On ink</th>
        </tr>
      </thead>
      <tbody>
        {TINTS.map((t) => (
          <tr key={t.name}>
            <th scope="row">{t.name}</th>
            <td>
              <span className="sp-tint" style={{ background: t.paper }} aria-hidden />
              <code className="sp-code">{t.paper}</code>
            </td>
            <td>
              <span className="sp-tint" style={{ background: t.ink }} aria-hidden />
              <code className="sp-code">{t.ink}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
