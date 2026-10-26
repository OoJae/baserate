import { type ReactNode, useId, useMemo, useState } from 'react'
import {
  band,
  circle,
  fibres,
  hypotrochoid,
  microtextRing,
  reeding,
  ring,
  rosette,
  ruling,
} from '../../../brand/guilloche'
import { useSvgId } from '../engraving'

/*
 * Live specimens of src/brand/guilloche.ts: every figure on this sheet is generated in your browser by the same calls
 * the brand's render scripts make, and its caption is the call. Shown at 240 units ≈ 240 CSS px, so a 0.6-unit line
 * is 0.6 px or more (the brand's 0.5 device px floor). Mint on paper.
 */

const SIZE = 240
const C = SIZE / 2

interface SpecimenProps {
  name: string
  call: string
  children: ReactNode
}

function Specimen({ name, call, children }: SpecimenProps) {
  return (
    <figure className="sp-spec">
      <div className="sp-spec__plate">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="sp-spec__art" aria-hidden focusable="false">
          {children}
        </svg>
      </div>
      <figcaption className="sp-spec__cap">
        <span className="sp-spec__name">{name}</span>
        <code className="sp-code sp-spec__call">{call}</code>
      </figcaption>
    </figure>
  )
}

const stroke = { fill: 'none', stroke: 'var(--engrave)' } as const

export function GuillocheSpecimens() {
  const id = useSvgId()
  const art = useMemo(() => {
    const micro = microtextRing('BASERATE', 92, { cx: C, cy: C, numbered: 6, fontSize: 5.2 })
    return {
      woven: rosette(108, 30, 0, 18, {
        cx: C,
        cy: C,
        inner: 0.45,
        twist: 0.16,
        weave: true,
        segments: 3,
      }),
      single: rosette(108, 12, 0, 12, { cx: C, cy: C, inner: 0.36 }),
      rope: ring(96, 9, 24, 9, { cx: C, cy: C }),
      band: band(SIZE, 56, 3, 6, { y: C - 28, swell: [2, 0.45] }),
      micro,
      reed: reeding(C, C, 100, 112, 160),
      rule: ruling(C, C, 92, 3.6, Math.PI / 4),
      spiro: hypotrochoid(11, 7, 5, { cx: C, cy: C, size: 104, segments: 3 }),
      fibre: fibres(SIZE, { count: 200, seed: 7 }),
    }
  }, [])

  return (
    <div className="sp-specs">
      <Specimen name="Woven rosette" call="rosette(108, 30, 0, 18, { weave: true })">
        <path d={art.woven} {...stroke} strokeWidth="0.6" />
      </Specimen>
      <Specimen name="Rosette, one twist" call="rosette(108, 12, 0, 12)">
        <path d={art.single} {...stroke} strokeWidth="0.7" />
      </Specimen>
      <Specimen name="Rope" call="ring(96, 9, 24, 9)">
        <path d={circle(C, C, 108)} {...stroke} strokeWidth="1.4" />
        <path d={art.rope} {...stroke} strokeWidth="0.7" />
        <path d={circle(C, C, 84)} {...stroke} strokeWidth="1" />
      </Specimen>
      <Specimen name="Woven band" call="band(240, 56, 3, 6, { swell: [2, 0.45] })">
        <path d={art.band} {...stroke} strokeWidth="0.75" />
      </Specimen>
      <Specimen name="Microprint" call="microtextRing('BASERATE', 92, { numbered: 6 })">
        <defs>
          <path id={`${id}-micro`} d={art.micro.d} />
        </defs>
        <path d={circle(C, C, 100)} {...stroke} strokeWidth="1" />
        <path d={circle(C, C, 84)} {...stroke} strokeWidth="1" />
        <text
          fontSize={art.micro.fontSize}
          letterSpacing={art.micro.letterSpacing}
          className="sp-micro"
          fill="var(--engrave)"
          dominantBaseline="central"
        >
          <textPath href={`#${id}-micro`} textLength={art.micro.textLength} lengthAdjust="spacing">
            {art.micro.text}
          </textPath>
        </text>
      </Specimen>
      <Specimen name="Ruling and reeding" call="ruling(…, 3.6, π/4) · reeding(…, 160)">
        <path d={art.reed} {...stroke} strokeWidth="1" />
        <path d={circle(C, C, 96)} {...stroke} strokeWidth="1" />
        <path d={art.rule} {...stroke} strokeWidth="1.1" />
      </Specimen>
      <Specimen name="Hypotrochoid" call="hypotrochoid(11, 7, 5)">
        <path d={art.spiro} {...stroke} strokeWidth="0.7" />
      </Specimen>
      <Specimen name="Paper fibre, at full strength" call="fibres(240, { seed: 7 })">
        {art.fibre.map((g) => (
          <path key={g.width} d={g.d} {...stroke} strokeWidth={g.width} strokeLinecap="round" />
        ))}
      </Specimen>
    </div>
  )
}

/** The lathe: turn the dials and the rosette is re-engraved, by the same function, as you go. */
export function Lathe() {
  const ids = useId()
  const [petals, setPetals] = useState(30)
  const [lines, setLines] = useState(18)
  const [twist, setTwist] = useState(16)
  const [weave, setWeave] = useState(true)
  const d = useMemo(
    () =>
      rosette(186, petals, 0, lines, {
        cx: 200,
        cy: 200,
        inner: 0.45,
        twist: twist / 100,
        weave,
        segments: 3,
      }),
    [petals, lines, twist, weave],
  )
  const segments = petals * 3 * lines * (weave ? 2 : 1)
  const dials = [
    {
      key: 'petals',
      label: 'Petals',
      value: petals,
      min: 6,
      max: 48,
      step: 1,
      set: setPetals,
      show: String(petals),
    },
    {
      key: 'lines',
      label: 'Lines',
      value: lines,
      min: 2,
      max: 24,
      step: 1,
      set: setLines,
      show: String(lines),
    },
    {
      key: 'twist',
      label: 'Twist per line',
      value: twist,
      min: 0,
      max: 60,
      step: 1,
      set: setTwist,
      show: `${(twist / 100).toFixed(2)} rad`,
    },
  ] as const
  return (
    <div className="sp-lathe">
      <div className="sp-lathe__plate">
        <svg viewBox="0 0 400 400" className="sp-lathe__art" aria-hidden focusable="false">
          <path d={circle(200, 200, 196)} fill="none" stroke="var(--engrave)" strokeWidth="1.4" />
          <path d={d} fill="none" stroke="var(--engrave)" strokeWidth="0.75" />
        </svg>
      </div>
      <div className="sp-lathe__controls">
        <p className="sp-small">
          Turn the dials. The rosette is drawn again by the same function, here in your browser: the
          same numbers always give the same lines.
        </p>
        {dials.map((dial) => (
          <div key={dial.key} className="sp-dial">
            <label htmlFor={`${ids}-${dial.key}`} className="sp-dial__label">
              <span>{dial.label}</span>
              <span className="sp-dial__value sp-num">{dial.show}</span>
            </label>
            <input
              id={`${ids}-${dial.key}`}
              type="range"
              min={dial.min}
              max={dial.max}
              step={dial.step}
              value={dial.value}
              onChange={(e) => dial.set(Number(e.target.value))}
              className="sp-dial__input"
            />
          </div>
        ))}
        <label className="sp-check">
          <input type="checkbox" checked={weave} onChange={(e) => setWeave(e.target.checked)} />
          <span>Weave the counter-twisted family</span>
        </label>
        <p className="sp-lathe__readout">
          <code className="sp-code">
            rosette(186, {petals}, 0, {lines}, {'{'} twist: {(twist / 100).toFixed(2)}
            {weave ? ', weave: true' : ''} {'}'})
          </code>
          <span className="sp-serial">{segments.toLocaleString('en-US')} Bézier segments</span>
        </p>
      </div>
    </div>
  )
}
