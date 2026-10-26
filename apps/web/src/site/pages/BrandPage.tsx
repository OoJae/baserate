import { useMemo } from 'react'
import { ruling } from '../../brand/guilloche'
import tokens from '../../brand/tokens.json'
import { ContrastPairs, KEY_RATIOS, Palette, TEXT_COLOURS, Tints } from '../parts/brand/colour'
import { Downloads } from '../parts/brand/downloads'
import {
  ClearSpace,
  LogoDont,
  MARK_FLOORS,
  Mark,
  MarkPaths,
  WORD_CUTS,
  Word,
  wordWidth,
} from '../parts/brand/logo'
import { Durations, EaseCurve, MotionDemos } from '../parts/brand/motion'
import { GuillocheSpecimens, Lathe } from '../parts/brand/specimens'
import { Faces, Numerals, TypeScale } from '../parts/brand/type'
import { Medallion, useWide } from '../parts/engraving'
import { Band, Masthead, OnThisPage, Plate, Serial, SitePage } from '../parts/layout'
import { repoFile } from '../parts/links'

/*
 * /brand: the Intaglio brand as a banknote printer's specimen book. Every specimen is drawn live from the brand's
 * own sources (src/brand/guilloche.ts, wordmark.ts, tokens.json), every caption is the specimen's real
 * specification, and every contrast ratio is computed. Facts follow docs/brand/BRAND.md, with the app's binding
 * text colours (src/styles.css).
 */

const SECTIONS = [
  { id: 'idea', label: 'Idea' },
  { id: 'logo', label: 'Logo' },
  { id: 'colour', label: 'Colour' },
  { id: 'type', label: 'Type' },
  { id: 'guilloche', label: 'Guilloche' },
  { id: 'motion', label: 'Motion' },
  { id: 'voice', label: 'Voice' },
  { id: 'rules', label: 'Do and don’t' },
  { id: 'downloads', label: 'Downloads' },
] as const

const M = tokens.motion

function LatheFigure() {
  const wide = useWide()
  return (
    <Medallion
      wide={wide}
      spec={{ petals: 30, lines: 18, twist: 0.16 }}
      centre={
        <g className="sp-fade">
          <MarkPaths detail={wide ? 'fine' : 'medium'} transform="translate(350 350) scale(3)" />
        </g>
      }
    />
  )
}

/** Tone from line density: the same 0.6 px rule at three spacings. */
function ToneSpecimen() {
  const tones = useMemo(
    () =>
      [6, 2.4, 1.2].map((gap) => ({
        gap,
        share: Math.round((0.6 / gap) * 100),
        d: ruling(56, 56, 80, gap, Math.PI / 4),
      })),
    [],
  )
  return (
    <figure className="sp-figure sp-tone">
      <div className="sp-tone__row">
        {tones.map((t) => (
          <div key={t.gap} className="sp-tone__cell">
            <svg viewBox="0 0 112 112" className="sp-tone__art" aria-hidden focusable="false">
              <defs>
                <clipPath id={`sp-tone-${String(t.gap).replace('.', '-')}`}>
                  <rect width="112" height="112" />
                </clipPath>
              </defs>
              <g clipPath={`url(#sp-tone-${String(t.gap).replace('.', '-')})`}>
                <path d={t.d} fill="none" stroke="var(--engrave)" strokeWidth="0.6" />
              </g>
              <rect
                x="0.5"
                y="0.5"
                width="111"
                height="111"
                fill="none"
                stroke="var(--engrave)"
                strokeWidth="1"
              />
            </svg>
            <p className="sp-serial">
              {t.share}% ink
              <br />
              {t.gap} px pitch
            </p>
          </div>
        ))}
      </div>
      <figcaption className="sp-serial sp-source">
        Tone from line density · 0.6 px rules at 45° · Mint on paper
      </figcaption>
    </figure>
  )
}

export function BrandPage() {
  const display = WORD_CUTS.display
  const text = WORD_CUTS.text
  const floors = WORD_CUTS.floors
  return (
    <SitePage>
      <Masthead
        label="Brand · specimen book"
        meta={<>Intaglio · src/brand/tokens.css</>}
        lines={['Baserate is a ', <em key="note">living banknote.</em>]}
        lead={
          <>
            Baserate lends dollars against bitcoin, so its brand borrows from money itself:
            copperplate engraving, guilloche, microprint and serial numbers, with the bitcoin coin
            at the centre. Every specimen in this book is drawn live from the brand’s own source
            files.
          </>
        }
        figure={
          <>
            <LatheFigure />
            <span className="sp-specimen-stamp sp-mast__after" aria-hidden>
              Specimen
            </span>
          </>
        }
      />
      <OnThisPage items={SECTIONS} />

      <Plate
        id="idea"
        ground="paper"
        label="The idea"
        source="docs/brand/BRAND.md"
        title={
          <>
            The floor price <em>of money</em>
          </>
        }
      >
        <div className="sp-split sp-split--wide-text">
          <div className="sp-prose">
            <p className="sp-lead">
              A central bank sets the base rate, and every other rate is priced from it. Baserate
              lends from a floor that does not move under you: nothing can redeem you out of your
              position.
            </p>
            <p>
              Banknotes are where institutions make trust visible: copperplate intaglio, guilloche
              rosettes, microprint, serial numbers and rate sheets. Baserate’s brand uses the same
              vocabulary.
            </p>
            <p>
              Everything is engraved, and tone comes from line density: dense lines read light on
              ink and dark on paper. Living means the engraving moves. Lines draw on, rosettes turn,
              and the rate steps up.
            </p>
            <p>
              <strong>Never</strong> a gradient, a glow, glass, a soft shadow or a crypto blob.
            </p>
          </div>
          <ToneSpecimen />
        </div>
      </Plate>

      <Plate
        id="logo"
        label="Logo"
        source="guilloche.ts markParts · wordmark.ts"
        title={
          <>
            The rate steps up from <em>a solid base</em>
          </>
        }
        intro={
          <p className="sp-lead">
            The mark is the rate line stepping up from its base, cut from a Mint plate inside a
            guilloche rope. The word is Bodoni Moda, outlined, so it never waits for a font.
          </p>
        }
      >
        <div className="sp-stack">
          <div>
            <h3 className="sp-h3">The mark, by size</h3>
            <p className="sp-small sp-gap-sm">
              Each level of detail starts where its thinnest line reaches half a device pixel. Small
              marks carry fewer, heavier lines, never thinner ones.
            </p>
            <div className="sp-marks sp-gap">
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <Mark detail="fine" className="sp-marks__fine" />
                </div>
                <figcaption className="sp-serial">
                  Fine · from {MARK_FLOORS.fine} device px · the rope’s 0.3 units
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <Mark detail="medium" className="sp-marks__medium" />
                </div>
                <figcaption className="sp-serial">
                  Medium · from {MARK_FLOORS.medium} device px · 3 lines × 12 waves
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <Mark detail="small" className="sp-marks__small" />
                </div>
                <figcaption className="sp-serial">
                  Small · from {MARK_FLOORS.small} device px · one heavy rim
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage sp-specimen__stage--paper" data-ground="note">
                  <Mark detail="fine" className="sp-marks__fine" />
                </div>
                <figcaption className="sp-serial">On paper · mark.svg</figcaption>
              </figure>
            </div>
          </div>

          <div>
            <h3 className="sp-h3">The word, in two optical cuts</h3>
            <div className="sp-words sp-gap">
              <figure className="sp-specimen sp-specimen--wide">
                <div className="sp-specimen__stage">
                  <Word
                    cut={display}
                    engraved
                    className="sp-words__art"
                    style={{ width: `${wordWidth(display, 64)}px` }}
                  />
                </div>
                <figcaption className="sp-serial">
                  Display cut, engraved · {floors.engraved} px capital height and up · 36 rows of
                  paper
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <Word
                    cut={display}
                    className="sp-words__art"
                    style={{ width: `${wordWidth(display, 32)}px` }}
                  />
                </div>
                <figcaption className="sp-serial">
                  Display, solid · {floors.display} to {floors.engraved} px
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <Word
                    cut={text}
                    className="sp-words__art"
                    style={{ width: `${wordWidth(text, 16)}px` }}
                  />
                </div>
                <figcaption className="sp-serial">
                  Text cut · {floors.text} px and up · lockups, app
                </figcaption>
              </figure>
            </div>
          </div>

          <div>
            <h3 className="sp-h3">The lockups</h3>
            <p className="sp-small sp-gap-sm">
              The word’s capital height runs from the top of the rate step to the foot of its base,
              so the word stands on the same base as the step.
            </p>
            <div className="sp-lockups sp-gap">
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <img
                    src="/brand/lockup-horizontal-reverse.svg"
                    alt=""
                    className="sp-lockups__h"
                  />
                </div>
                <figcaption className="sp-serial">
                  Horizontal · on ink · 32 px tall and up
                </figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage">
                  <img src="/brand/lockup-stacked-reverse.svg" alt="" className="sp-lockups__s" />
                </div>
                <figcaption className="sp-serial">Stacked · on ink · 52 px tall and up</figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage sp-specimen__stage--paper" data-ground="note">
                  <img src="/brand/lockup-horizontal.svg" alt="" className="sp-lockups__h" />
                </div>
                <figcaption className="sp-serial">Horizontal · on paper</figcaption>
              </figure>
              <figure className="sp-specimen">
                <div className="sp-specimen__stage sp-specimen__stage--paper" data-ground="note">
                  <img src="/brand/lockup-stacked.svg" alt="" className="sp-lockups__s" />
                </div>
                <figcaption className="sp-serial">Stacked · on paper</figcaption>
              </figure>
            </div>
          </div>

          <div className="sp-split sp-split--even">
            <div>
              <h3 className="sp-h3">Clear space</h3>
              <p className="sp-small sp-gap-sm">
                A quarter of the mark’s diameter on every side, for the mark and for both lockups.
              </p>
              <div className="sp-gap">
                <ClearSpace />
              </div>
            </div>
            <div>
              <h3 className="sp-h3">Minimum sizes</h3>
              <table className="sp-table sp-gap">
                <caption className="sp-sr">The smallest size for each logo asset</caption>
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col" className="sp-table__num">
                      Minimum
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Horizontal lockup</th>
                    <td className="sp-table__num">32 px tall</td>
                  </tr>
                  <tr>
                    <th scope="row">Stacked lockup</th>
                    <td className="sp-table__num">52 px tall</td>
                  </tr>
                  <tr>
                    <th scope="row">Word alone, engraved</th>
                    <td className="sp-table__num">{floors.engraved} px cap height</td>
                  </tr>
                  <tr>
                    <th scope="row">Word alone, solid</th>
                    <td className="sp-table__num">{floors.display} px cap height</td>
                  </tr>
                  <tr>
                    <th scope="row">Mark on screen</th>
                    <td className="sp-table__num">16 CSS px</td>
                  </tr>
                  <tr>
                    <th scope="row">Mark in print</th>
                    <td className="sp-table__num">8 mm (fine: 35 mm)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="sp-h3">Never</h3>
            <ul className="sp-donts sp-gap">
              <li>
                <LogoDont kind="recolour" />
                <p className="sp-small">
                  Recolour it. Only Mint, Intaglio, Note and Guilloche touch the logo.
                </p>
              </li>
              <li>
                <LogoDont kind="rotate" />
                <p className="sp-small">Rotate, skew or tilt it.</p>
              </li>
              <li>
                <LogoDont kind="stretch" />
                <p className="sp-small">Stretch or re-space it.</p>
              </li>
              <li>
                <LogoDont kind="live" />
                <p className="sp-small">Set the word in live type next to the mark.</p>
              </li>
            </ul>
          </div>
        </div>
      </Plate>

      <Plate
        id="colour"
        ground="paper"
        label="Colour"
        source="tokens.json · styles.css · WCAG 2.2, computed"
        title={
          <>
            One accent, and it <em>means bitcoin</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Ink and paper carry the page. Mint is the brand on paper and Guilloche on ink. Satoshi
            Amber means bitcoin, and Seal Red means a liquidation, and neither is ever spent on
            anything else.
          </p>
        }
      >
        <div className="sp-stack">
          <Palette />
          <div className="sp-split">
            <div className="sp-prose">
              <h3 className="sp-h3">Text has its own shades</h3>
              <p>
                Satoshi Amber is never text on paper ({KEY_RATIOS.amberOnPaper}). Bitcoin figures on
                paper use <code className="sp-code">{TEXT_COLOURS.btcOnPaper}</code> (
                {KEY_RATIOS.btcOnPaper}), and liquidation text on paper uses{' '}
                <code className="sp-code">{TEXT_COLOURS.sealOnPaper}</code> (
                {KEY_RATIOS.sealOnPaper}
                ); Seal Red itself is for fills, strokes and large type. On ink the brand colour is
                Guilloche, because Mint on ink is only {KEY_RATIOS.mintOnInk}.
              </p>
              <p>
                Every ratio in the table is computed from the hex values with the WCAG 2.2 formula.
              </p>
            </div>
            <ContrastPairs />
          </div>
          <div>
            <h3 className="sp-h3">Support tints</h3>
            <p className="sp-small sp-gap-sm">Ink on paper, and paper on ink.</p>
            <div className="sp-gap">
              <Tints />
            </div>
          </div>
        </div>
      </Plate>

      <Plate
        id="type"
        label="Type"
        source="@fontsource · self-hosted, latin only"
        title={
          <>
            Three faces, <em>five sizes</em>
          </>
        }
        intro={
          <p className="sp-lead">
            All three are served from this site, latin only, and swap in over fallbacks reshaped to
            their measurements, so the page does not jump when they arrive.
          </p>
        }
      >
        <div className="sp-stack">
          <Faces />
          <div>
            <h3 className="sp-h3">The scale, set at your screen’s size</h3>
            <div className="sp-gap">
              <TypeScale />
            </div>
          </div>
          <Numerals />
        </div>
      </Plate>

      <Plate
        id="guilloche"
        ground="paper"
        label="Guilloche"
        source="src/brand/guilloche.ts · deterministic, no dependencies"
        title={
          <>
            Line work, <em>generated</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Every rosette, rope and band is drawn by one small generator. The same call returns the
            same lines in the browser, in Node and in the film.
          </p>
        }
      >
        <div className="sp-stack">
          <Lathe />
          <GuillocheSpecimens />
          <ul className="sp-list sp-prose sp-columns">
            <li>Line work is ink, never alpha. The paper grain is the one exception, at 3.5%.</li>
            <li>
              Every line is at least half a device pixel at the size it is shown. When small, draw
              fewer, heavier lines.
            </li>
            <li>Guilloche on ink, Mint on paper. Amber appears only inside the bitcoin centre.</li>
            <li>To animate a rosette, turn its phase slowly, if at all.</li>
          </ul>
        </div>
      </Plate>

      <Plate
        id="motion"
        label="Motion"
        source="tokens.css · --ease-out · --ease-in-out"
        title={
          <>
            Motion is the press, <em>not the screen</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Each page gets one choreographed load and one scroll scene; everything else is small. On
            this page the load engraved the plate at the top, and the line down the left margin
            follows you as you read.
          </p>
        }
      >
        <div className="sp-stack">
          <div className="sp-eases">
            <EaseCurve
              name="Arrivals"
              token="--ease-out"
              points={M.ease.out.bezier as unknown as [number, number, number, number]}
              gsap={M.ease.out.gsap}
              use={M.ease.out.use}
            />
            <EaseCurve
              name="Between two states"
              token="--ease-in-out"
              points={M.ease.inOut.bezier as unknown as [number, number, number, number]}
              gsap={M.ease.inOut.gsap}
              use={M.ease.inOut.use}
            />
            <div>
              <h3 className="sp-h3">Durations</h3>
              <div className="sp-gap">
                <Durations
                  rows={[
                    {
                      name: 'Stagger',
                      token: '--stagger',
                      ms: M.duration.stagger.default * 1000,
                      range: `${M.duration.stagger.range.join('–')} s`,
                    },
                    {
                      name: 'Micro',
                      token: '--dur-micro',
                      ms: M.duration.micro.default * 1000,
                      range: `${M.duration.micro.range.join('–')} s`,
                    },
                    {
                      name: 'Reveal',
                      token: '--dur-reveal',
                      ms: M.duration.reveal.default * 1000,
                      range: `${M.duration.reveal.range.join('–')} s`,
                    },
                    {
                      name: 'Hero',
                      token: '--dur-hero',
                      ms: M.duration.hero.default * 1000,
                      range: `${M.duration.hero.range.join('–')} s`,
                    },
                  ]}
                />
              </div>
            </div>
          </div>
          <div>
            <h3 className="sp-h3">The three signature motions</h3>
            <p className="sp-small sp-gap-sm">
              Transform, opacity and line offsets only. Each plays once, when something real
              happens.
            </p>
            <div className="sp-gap">
              <MotionDemos />
            </div>
          </div>
          <p className="sp-small">
            <strong className="sp-strong">Reduced motion:</strong> {M.reducedMotion}
          </p>
        </div>
      </Plate>

      <Plate
        id="voice"
        ground="paper"
        label="Voice"
        source="Plain verbs · sentence case · real numbers"
        title={
          <>
            Plain verbs, <em>real numbers</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Write from the borrower’s side, with the number they need. Borrow, repay, save, lend,
            liquidate.
          </p>
        }
      >
        <table className="sp-table sp-voice">
          <caption className="sp-sr">Voice: what to write, and what not to</caption>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Write</th>
              <th scope="col">Not</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Use plain verbs</th>
              <td className="sp-voice__do">Borrow MUSD against your BTC.</td>
              <td className="sp-voice__not">Unlock the power of your bitcoin.</td>
            </tr>
            <tr>
              <th scope="row">Write from the user’s side</th>
              <td className="sp-voice__do">
                Repay any time. Your BTC comes back in the same transaction.
              </td>
              <td className="sp-voice__not">The protocol facilitates seamless exits.</td>
            </tr>
            <tr>
              <th scope="row">Give the number</th>
              <td className="sp-voice__do">Limit raises wait 48 hours.</td>
              <td className="sp-voice__not">Robust, battle-tested governance.</td>
            </tr>
            <tr>
              <th scope="row">Sentence case, buttons too</th>
              <td className="sp-voice__do">Open the app</td>
              <td className="sp-voice__not">Open The App</td>
            </tr>
            <tr>
              <th scope="row">No hype</th>
              <td className="sp-voice__do">A 0.10% origination fee.</td>
              <td className="sp-voice__not">Next-gen, ultra-low fees.</td>
            </tr>
          </tbody>
        </table>
      </Plate>

      <Plate
        id="rules"
        label="Do and don’t"
        source="docs/brand/BRAND.md"
        title={
          <>
            The rules, <em>in one table</em>
          </>
        }
      >
        <table className="sp-table sp-rules">
          <caption className="sp-sr">Brand rules: do, and don’t</caption>
          <thead>
            <tr>
              <th scope="col">Do</th>
              <th scope="col">Don’t</th>
            </tr>
          </thead>
          <tbody>
            {[
              [
                'Engrave tone with line density',
                'Use gradients, glow, glass, blur or crypto blobs',
              ],
              ['Keep one accent: amber means BTC', 'Use amber for emphasis, links or the logo'],
              ['Keep Seal Red for liquidation', 'Spend Seal Red on decoration or emphasis'],
              ['Put Guilloche line work on ink', 'Put Guilloche on paper, where it fades away'],
              [
                'Write numbers in tabular figures and real values',
                'Round away the number the user needs',
              ],
              [
                'Use one Bodoni italic phrase per headline',
                'Use italic paragraphs, or live Bodoni below 24 px',
              ],
              ['Use hairline frames', 'Use drop shadows to lift cards'],
              [
                'Use one load, one scroll scene, and small motion elsewhere',
                'Fade and slide up everything',
              ],
              ['Respect reduced motion: things fade in place', 'Gate content behind animation'],
            ].map(([d, n]) => (
              <tr key={d}>
                <td className="sp-rules__do">{d}</td>
                <td className="sp-rules__not">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Plate>

      <Plate
        id="downloads"
        ground="paper"
        label="Downloads"
        source="public/brand · /brand/*"
        title={
          <>
            Take <em>the files</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Every asset, as it is served. The SVGs are the source; the PNGs are rendered from them.
            The written guide is{' '}
            <a className="sp-link" href={repoFile('docs/brand/BRAND.md')}>
              docs/brand/BRAND.md
            </a>
            .
          </p>
        }
      >
        <Downloads />
        <Serial className="sp-source">
          Rendered by apps/web/scripts/brand/render-assets.mjs · contrast checked by contrast.mjs
        </Serial>
      </Plate>
      <Band className="sp-end-band" />
    </SitePage>
  )
}
