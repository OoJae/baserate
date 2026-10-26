import { repoFile } from '../links'

/*
 * Every file in public/brand, served at /brand/*, with what it is for (docs/brand/BRAND.md). Previews load lazily
 * and only for the light files; the heavy renders (the coin PNG and WebP, the X header) are listed without one.
 */

interface Asset {
  file: string
  use: string
  /** Show a preview, on this ground. */
  preview?: 'paper' | 'ink'
}

interface Group {
  name: string
  assets: readonly Asset[]
}

const GROUPS: readonly Group[] = [
  {
    name: 'Mark',
    assets: [
      { file: 'mark.svg', use: 'Full colour on paper, 168 px and up', preview: 'paper' },
      { file: 'mark-reverse.svg', use: 'Full colour on ink', preview: 'ink' },
      {
        file: 'mark-mono-ink.svg',
        use: 'One colour in ink: print, emboss, foil',
        preview: 'paper',
      },
      {
        file: 'mark-mono-paper.svg',
        use: 'One colour in paper: photography, dark grounds',
        preview: 'ink',
      },
    ],
  },
  {
    name: 'Lockups',
    assets: [
      { file: 'lockup-horizontal.svg', use: 'The signature, 32 px tall and up', preview: 'paper' },
      { file: 'lockup-horizontal-reverse.svg', use: 'The signature on ink', preview: 'ink' },
      { file: 'lockup-stacked.svg', use: 'Stacked, 52 px tall and up', preview: 'paper' },
      { file: 'lockup-stacked-reverse.svg', use: 'Stacked, on ink', preview: 'ink' },
    ],
  },
  {
    name: 'Wordmark',
    assets: [
      { file: 'wordmark.svg', use: 'Engraved, 48 px capital height and up', preview: 'paper' },
      { file: 'wordmark-reverse.svg', use: 'Engraved, on ink', preview: 'ink' },
      { file: 'wordmark-solid.svg', use: 'Solid, 24 to 48 px capital height', preview: 'paper' },
      { file: 'wordmark-solid-reverse.svg', use: 'Solid, on ink', preview: 'ink' },
    ],
  },
  {
    name: 'Icons',
    assets: [
      { file: 'favicon.svg', use: 'Browser tabs, drawn on a 16-pixel grid', preview: 'paper' },
      { file: 'icon.svg', use: 'App icon, full-bleed tile', preview: 'paper' },
      { file: 'icon-512.png', use: 'App icon, 512 px, maskable', preview: 'paper' },
      { file: 'icon-192.png', use: 'App icon, 192 px, maskable' },
      { file: 'apple-touch-icon.png', use: 'Home screen on iOS' },
      { file: 'favicon-32.png', use: 'PNG fallback, 32 px' },
      { file: 'favicon-16.png', use: 'PNG fallback, 16 px' },
      { file: 'site.webmanifest', use: 'Name, colours and icons for installs' },
    ],
  },
  {
    name: 'Coin and engraving',
    assets: [
      { file: 'coin.svg', use: 'The coin, vector: film and deck', preview: 'ink' },
      { file: 'coin.png', use: 'The coin, 1024 px' },
      { file: 'coin.webp', use: 'The coin, 1024 px, smaller file' },
      { file: 'band.svg', use: 'The woven band, Guilloche, for ink', preview: 'ink' },
      { file: 'band-on-note.svg', use: 'The woven band, Mint, for paper', preview: 'paper' },
      { file: 'grain.svg', use: 'The paper fibre tile, 240 px' },
    ],
  },
  {
    name: 'Social',
    assets: [
      { file: 'og.png', use: 'Link card, 1200 × 630', preview: 'ink' },
      { file: 'x-header.png', use: 'X header, 1500 × 500' },
    ],
  },
]

const SOURCES = [
  { path: 'apps/web/src/brand/tokens.css', use: 'The tokens, for the web' },
  { path: 'apps/web/src/brand/tokens.json', use: 'The same values, for the film and the deck' },
  { path: 'apps/web/src/brand/guilloche.ts', use: 'The line-work generator' },
  { path: 'docs/brand/BRAND.md', use: 'The written guide' },
] as const

const slug = (name: string) => `dl-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

function kind(file: string): string {
  return file.split('.').pop()?.toUpperCase() ?? ''
}

export function Downloads() {
  return (
    <div className="sp-downloads">
      {GROUPS.map((group) => (
        <div key={group.name} className="sp-dl">
          <h3 id={slug(group.name)} className="sp-serial sp-dl__head">
            {group.name}
          </h3>
          <ul className="sp-dl__list">
            {group.assets.map((a) => (
              <li key={a.file} className="sp-dl__item">
                {a.preview ? (
                  <span
                    className="sp-dl__preview"
                    data-ground={a.preview === 'ink' ? 'intaglio' : 'note'}
                    aria-hidden
                  >
                    <img src={`/brand/${a.file}`} alt="" loading="lazy" decoding="async" />
                  </span>
                ) : null}
                <a className="sp-dl__link" href={`/brand/${a.file}`} download>
                  <span className="sp-code">{a.file}</span>
                  <span className="sp-dl__kind">{kind(a.file)}</span>
                </a>
                <span className="sp-small">{a.use}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="sp-dl">
        <h3 id="dl-source" className="sp-serial sp-dl__head">
          Source
        </h3>
        <ul className="sp-dl__list">
          {SOURCES.map((src) => (
            <li key={src.path} className="sp-dl__item">
              <a className="sp-dl__link" href={repoFile(src.path)}>
                <span className="sp-code">{src.path.split('/').pop()}</span>
                <span className="sp-dl__kind">GitHub ↗</span>
              </a>
              <span className="sp-small">{src.use}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
