import registry from '@baserate/sdk/deployments/31611.json'
import tokens from '../../../brand/tokens.json'

/*
 * Type specimens: the three faces and the fluid scale, set live in the page's own fonts at the size your screen gives
 * them. The scale's values come from src/brand/tokens.json.
 */

const F = tokens.type.families
const SCALE = tokens.type.scale

export function Faces() {
  return (
    <div className="sp-faces">
      <figure className="sp-face sp-face--display">
        <p className="sp-face__glyphs" aria-hidden>
          Aa<em>Aa</em>
        </p>
        <figcaption>
          <p className="sp-h4">Bodoni Moda</p>
          <p className="sp-serial">
            Display · {F.display.axes.wght.join('–')} weight · optical size{' '}
            {F.display.axes.opsz.join('–')}
          </p>
          <p className="sp-small sp-gap-sm">
            The engraver’s Didone, for headlines and big numerals only. Its optical size follows the
            font size, so hairlines thin as it grows. One italic phrase per headline, never more.
          </p>
        </figcaption>
      </figure>
      <figure className="sp-face sp-face--body">
        <p className="sp-face__glyphs" aria-hidden>
          Aa
        </p>
        <figcaption>
          <p className="sp-h4">Public Sans</p>
          <p className="sp-serial">Body and controls · {F.body.axes.wght.join('–')} weight</p>
          <p className="sp-small sp-gap-sm">
            A civic face for every sentence and every control. Numbers always use tabular, lining
            figures, so columns of amounts line up.
          </p>
        </figcaption>
      </figure>
      <figure className="sp-face sp-face--mono">
        <p className="sp-face__glyphs" aria-hidden>
          0x
        </p>
        <figcaption>
          <p className="sp-h4">IBM Plex Mono</p>
          <p className="sp-serial">Serial strips · {F.mono.weights.join(', ')}</p>
          <p className="sp-small sp-gap-sm">
            For addresses, blocks, hashes and rates, never sentences. Labels run in capitals; hex
            keeps its lowercase 0x and checksum case. The dotted zero keeps 0 and O apart.
          </p>
        </figcaption>
      </figure>
    </div>
  )
}

interface ScaleRow {
  key: keyof typeof SCALE
  name: string
  sample: string
  className: string
}

const ROWS: readonly ScaleRow[] = [
  { key: 'hero', name: 'Hero', sample: 'At the base rate.', className: 'sp-scale__hero' },
  {
    key: 'section',
    name: 'Section',
    sample: 'Every finding, logged.',
    className: 'sp-scale__section',
  },
  {
    key: 'lead',
    name: 'Lead',
    sample: 'Borrow MUSD against your BTC, and repay when you choose.',
    className: 'sp-scale__lead',
  },
  {
    key: 'body',
    name: 'Body',
    sample:
      'Your position closes when you repay it, or if it crosses the liquidation line. Nothing else can close it.',
    className: 'sp-scale__body',
  },
  {
    key: 'serial',
    name: 'Serial',
    sample: 'Mezo testnet · chain 31611 · fee 10 bps',
    className: 'sp-scale__serial',
  },
]

export function TypeScale() {
  return (
    <ol className="sp-scale">
      {ROWS.map((row) => {
        const t = SCALE[row.key]
        return (
          <li key={row.key} className="sp-scale__row">
            <div className="sp-scale__spec">
              <p className="sp-h4">{row.name}</p>
              <p className="sp-serial">{t.size}</p>
              <p className="sp-serial">
                Leading {t.lineHeight} · tracking {t.tracking}
              </p>
            </div>
            <p className={`sp-scale__sample ${row.className}`}>{row.sample}</p>
          </li>
        )
      })}
    </ol>
  )
}

/** bcBTC's testnet address from the registry, shortened as the app writes addresses. */
const BCBTC = registry.markets.M1.collateralToken
const BCBTC_SHORT = `${BCBTC.slice(0, 8)}…${BCBTC.slice(-4)}`

export function Numerals() {
  return (
    <div className="sp-numerals">
      <p className="sp-numerals__display" aria-hidden>
        0123456789
      </p>
      <p className="sp-numerals__mono" aria-hidden>
        0123456789 · {BCBTC_SHORT}
      </p>
      <p className="sp-small">
        Bodoni’s lining, tabular numerals for big figures; Plex Mono’s dotted zero for serials. The
        address is bcBTC’s on Mezo testnet, as it is written: lowercase 0x, checksum case kept.
      </p>
    </div>
  )
}
