#!/usr/bin/env python3
"""Outline Baserate's brand type into SVG path data, so the wordmark, the coin's bitcoin sign and the microtext
render the same everywhere without a font loaded.

    python3 apps/web/scripts/brand/outline-fonts.py            # write the two outputs below
    python3 apps/web/scripts/brand/outline-fonts.py --metrics  # also print the fallback @font-face metrics (macOS:
                                                               # it measures the system's Georgia and Arial)

Needs Python 3.9+ and fontTools with WOFF2 support (`pip install 'fonttools[woff]'`, which brings brotli). Reads the
fontsource WOFF2 files in apps/web/node_modules (run `pnpm install` first) and writes

    apps/web/src/brand/wordmark.ts             "Baserate" in Bodoni Moda, two optical cuts (display and text), the
                                               display cut's engraving, and the sizes each is drawn at
    apps/web/scripts/brand/data/outlines.json  IBM Plex Mono 500 capitals and figures for microtext, and the Bodoni
                                               Moda capital B that the coin's bitcoin sign is built from

Both outputs are committed. Run this again only when a cut's instance or the microtext alphabet changes, then run
render-assets.mjs. Bodoni Moda and IBM Plex Mono are SIL OFL 1.1: outlining them into artwork is allowed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent
FONTS = WEB / "node_modules"
BODONI = FONTS / "@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-opsz-normal.woff2"
PUBLIC_SANS = FONTS / "@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2"
PLEX_MONO = FONTS / "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"
SYSTEM_FONTS = Path("/System/Library/Fonts/Supplemental")

WORDMARK_OUT = WEB / "src/brand/wordmark.ts"
OUTLINES_OUT = HERE / "data/outlines.json"
BIOME = WEB.parent.parent / "node_modules/.bin/biome"

WORD = "Baserate"
# Optical cuts of the wordmark. A Didone's hairlines vanish when small (Bodoni Moda's are 0.0195 em at opsz 11 and
# 0.002 em at opsz 96), so the text cut uses the text optical size and the display cut a moderate one: the word is a
# logo and has to hold up at the sizes logos are used, not just at headline size.
CUTS = {
    "display": {"axes": {"opsz": 24, "wght": 560}, "tracking": -0.01, "engrave": True},
    "text": {"axes": {"opsz": 11, "wght": 580}, "tracking": 0.005},
}
CAP = 100.0  # each cut is scaled so its capital height is 100 units

# The display cut's engraving, as on a banknote's lettering: horizontal lines of paper struck into the thick strokes.
# A gap every `pitch` units (36 rows from the capital line to the baseline), kept `border` units inside the outline so
# the outline, the hairlines and the serifs stay solid; runs shorter than `shortest` are dropped. Its gaps reach 0.5 px
# at a capital height of about 46 px, so the engraving is drawn from 48 px (WORDMARK_FLOORS).
ENGRAVE = {"pitch": CAP / 36, "gap": 1.1, "border": 2.8, "shortest": 3.0}
# Capital heights (CSS px) each cut is drawn from: the text cut holds to 10 px, the display cut needs 24 px for its
# hairlines (below that its e loses its bar), and its engraving needs 48 px.
FLOORS = {"text": 10, "display": 24, "engraved": 48}

MICROTEXT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·-./:%+#&,"
BITCOIN_B_AXES = {"opsz": 11, "wght": 700}

# English character frequencies (capsize's weighting) for the average advance that sets a fallback's size-adjust.
FREQUENCIES = {
    "a": 0.0668, "b": 0.0122, "c": 0.0228, "d": 0.0348, "e": 0.1039, "f": 0.0182, "g": 0.0165, "h": 0.0499,
    "i": 0.057, "j": 0.0013, "k": 0.0063, "l": 0.0329, "m": 0.0197, "n": 0.0552, "o": 0.0614, "p": 0.0158,
    "q": 0.0008, "r": 0.049, "s": 0.0518, "t": 0.0741, "u": 0.0226, "v": 0.008, "w": 0.0193, "x": 0.0012,
    "y": 0.0162, "z": 0.0006, " ": 0.1818,
}


def num(value: float, places: int) -> str:
    text = f"{value:.{places}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


class PathDataPen(BasePen):
    """Absolute M/L/Q/C/Z path data. TrueType quadratic runs are split into single Q segments."""

    def __init__(self, glyph_set, places: int = 2):
        super().__init__(glyph_set)
        self.parts: list[str] = []
        self.places = places

    def _pt(self, pt) -> str:
        return f"{num(pt[0], self.places)} {num(pt[1], self.places)}"

    def _moveTo(self, pt):
        self.parts.append("M" + self._pt(pt))

    def _lineTo(self, pt):
        self.parts.append("L" + self._pt(pt))

    def _qCurveToOne(self, pt1, pt2):
        self.parts.append("Q" + self._pt(pt1) + " " + self._pt(pt2))

    def _curveToOne(self, pt1, pt2, pt3):
        self.parts.append("C" + " ".join(self._pt(p) for p in (pt1, pt2, pt3)))

    def _closePath(self):
        self.parts.append("Z")

    def _endPath(self):
        pass

    @property
    def d(self) -> str:
        return "".join(self.parts)


class PolylinePen(BasePen):
    """The outline as closed polylines, curves divided into short straight steps, for scanline tests."""

    def __init__(self, glyph_set, steps: int = 16):
        super().__init__(glyph_set)
        self.polylines: list[list[tuple[float, float]]] = []
        self.steps = steps

    def _moveTo(self, pt):
        self.polylines.append([tuple(pt)])

    def _lineTo(self, pt):
        self.polylines[-1].append(tuple(pt))

    def _qCurveToOne(self, pt1, pt2):
        (x0, y0), (x1, y1), (x2, y2) = self._getCurrentPoint(), pt1, pt2
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self.polylines[-1].append((u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2))

    def _curveToOne(self, pt1, pt2, pt3):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = self._getCurrentPoint(), pt1, pt2, pt3
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            a, b, c, d = u**3, 3 * u * u * t, 3 * u * t * t, t**3
            self.polylines[-1].append((a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3))

    def _closePath(self):
        pass

    def _endPath(self):
        pass


def inside_spans(polylines, y: float) -> list[tuple[float, float]]:
    """Where the horizontal line at y is inside the filled outline (nonzero winding, so overlaps merge)."""
    hits = []
    for poly in polylines:
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            if (y0 <= y < y1) or (y1 <= y < y0):
                hits.append((x0 + (y - y0) / (y1 - y0) * (x1 - x0), 1 if y1 > y0 else -1))
    hits.sort()
    spans, winding, start = [], 0, 0.0
    for x, turn in hits:
        before, winding = winding, winding + turn
        if before == 0 and winding != 0:
            start = x
        elif before != 0 and winding == 0:
            spans.append((start, x))
    return spans


def engraving(polylines, height: float) -> str:
    """The gaps of the display cut's engraving as rectangles: each row's spans, eroded by the border along x and y."""
    pitch, gap, border, shortest = ENGRAVE["pitch"], ENGRAVE["gap"], ENGRAVE["border"], ENGRAVE["shortest"]
    rects = []
    row = 0
    while (pitch * (row + 0.5)) < height:
        y0 = pitch * (row + 0.5) - gap / 2
        y1 = y0 + gap
        row += 1
        kept = None
        for i in range(9):
            y = y0 - border + (y1 - y0 + 2 * border) * i / 8
            spans = [(a + border, b - border) for a, b in inside_spans(polylines, y) if b - a > 2 * border]
            kept = spans if kept is None else [
                (max(a, c), min(b, d)) for a, b in kept for c, d in spans if min(b, d) > max(a, c)
            ]
            if not kept:
                break
        for a, b in kept or []:
            if b - a >= shortest:
                rects.append(f"M{num(a, 2)} {num(y0, 2)}H{num(b, 2)}V{num(y1, 2)}H{num(a, 2)}Z")
    return "".join(rects)


class CommandPen(BasePen):
    """The same outline as command arrays (["M", x, y], ["Q", x1, y1, x, y], ...), for scripts that transform it."""

    def __init__(self, glyph_set, places: int = 4):
        super().__init__(glyph_set)
        self.commands: list[list] = []
        self.places = places

    def _r(self, pt) -> list[float]:
        return [round(pt[0], self.places) + 0.0, round(pt[1], self.places) + 0.0]

    def _moveTo(self, pt):
        self.commands.append(["M", *self._r(pt)])

    def _lineTo(self, pt):
        self.commands.append(["L", *self._r(pt)])

    def _qCurveToOne(self, pt1, pt2):
        self.commands.append(["Q", *self._r(pt1), *self._r(pt2)])

    def _curveToOne(self, pt1, pt2, pt3):
        self.commands.append(["C", *self._r(pt1), *self._r(pt2), *self._r(pt3)])

    def _closePath(self):
        self.commands.append(["Z"])

    def _endPath(self):
        pass


def instance(path: Path, axes: dict) -> TTFont:
    font = TTFont(str(path))
    return instantiateVariableFont(font, axes, inplace=False) if "fvar" in font else font


def glyph_bounds(font: TTFont, name: str, dx: float = 0.0):
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(TransformPen(pen, (1, 0, 0, 1, dx, 0)))
    return pen.bounds


def kern_lookups(font: TTFont):
    """GPOS lookups of the 'kern' feature for Latin (default language), else the DFLT script."""
    if "GPOS" not in font:
        return []
    gpos = font["GPOS"].table
    scripts = {sr.ScriptTag: sr.Script for sr in gpos.ScriptList.ScriptRecord}
    script = scripts.get("latn") or scripts.get("DFLT")
    if script is None or script.DefaultLangSys is None:
        return []
    indices: set[int] = set()
    for fi in script.DefaultLangSys.FeatureIndex:
        record = gpos.FeatureList.FeatureRecord[fi]
        if record.FeatureTag == "kern":
            indices.update(record.Feature.LookupListIndex)
    return [gpos.LookupList.Lookup[i] for i in sorted(indices)]


def x_advance(value) -> float:
    return float(getattr(value, "XAdvance", 0) or 0) if value is not None else 0.0


def pair_kern(lookups, left: str, right: str) -> float:
    """Sum of the pair adjustments each kern lookup applies to (left, right); the first matching subtable wins."""
    total = 0.0
    for lookup in lookups:
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                if sub.ExtensionLookupType != 2:
                    continue
                sub = sub.ExtSubTable
            elif lookup.LookupType != 2:
                continue
            covered = sub.Coverage.glyphs
            if left not in covered:
                continue
            if sub.Format == 1:
                pairs = sub.PairSet[covered.index(left)].PairValueRecord
                match = next((p for p in pairs if p.SecondGlyph == right), None)
                if match is None:
                    continue
                total += x_advance(match.Value1)
                break
            if sub.Format == 2:
                c1 = sub.ClassDef1.classDefs.get(left, 0)
                c2 = sub.ClassDef2.classDefs.get(right, 0)
                total += x_advance(sub.Class1Record[c1].Class2Record[c2].Value1)
                break
    return total


def outline_word(axes: dict, tracking: float, engrave: bool = False) -> dict:
    font = instance(BODONI, axes)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    lookups = kern_lookups(font)
    names = [cmap[ord(ch)] for ch in WORD]

    placed: list[tuple[str, float]] = []
    x = 0.0
    for i, name in enumerate(names):
        if i:
            x += pair_kern(lookups, names[i - 1], name) + tracking * upm
        placed.append((name, x))
        x += font["hmtx"][name][0]

    bounds = [glyph_bounds(font, name, dx) for name, dx in placed]
    x_min = min(b[0] for b in bounds if b)
    y_min = min(b[1] for b in bounds if b)
    x_max = max(b[2] for b in bounds if b)
    y_max = max(b[3] for b in bounds if b)
    cap_height = glyph_bounds(font, cmap[ord("H")])[3]
    x_height = glyph_bounds(font, cmap[ord("x")])[3]
    scale = CAP / cap_height

    pen = PathDataPen(glyph_set, places=2)
    lines = PolylinePen(glyph_set)
    for name, dx in placed:
        at = (scale, 0, 0, -scale, (dx - x_min) * scale, y_max * scale)
        glyph_set[name].draw(TransformPen(pen, at))
        glyph_set[name].draw(TransformPen(lines, at))

    cut = {
        "width": round((x_max - x_min) * scale, 2),
        "height": round((y_max - y_min) * scale, 2),
        "baseline": round(y_max * scale, 2),
        "capTop": round((y_max - cap_height) * scale, 2),
        "xHeightTop": round((y_max - x_height) * scale, 2),
        "opsz": axes["opsz"],
        "wght": axes["wght"],
        "tracking": tracking,
        "d": pen.d,
    }
    if engrave:
        cut["engraving"] = engraving(lines.polylines, (y_max - y_min) * scale)
    return cut


def glyph_commands(font: TTFont, name: str) -> list:
    """A glyph in em units, y down, origin at the pen position on the baseline."""
    upm = font["head"].unitsPerEm
    pen = CommandPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(TransformPen(pen, (1 / upm, 0, 0, -1 / upm, 0, 0)))
    return pen.commands


def vertical_stems(commands: list, min_length: float) -> list[float]:
    """x of the long vertical line segments of an outline (a capital's stem edges)."""
    xs: list[float] = []
    cx = cy = 0.0
    for cmd in commands:
        if cmd[0] in ("M", "L"):
            nx, ny = cmd[1], cmd[2]
            if cmd[0] == "L" and abs(nx - cx) < 1e-3 and abs(ny - cy) >= min_length:
                xs.append(nx)
            cx, cy = nx, ny
        elif cmd[0] in ("Q", "C"):
            cx, cy = cmd[-2], cmd[-1]
    return sorted(set(round(x, 4) for x in xs))


def outline_microtext() -> dict:
    font = TTFont(str(PLEX_MONO))
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    glyphs = {}
    for ch in MICROTEXT_ALPHABET:
        name = cmap.get(ord(ch))
        if name is None:
            sys.exit(f"IBM Plex Mono has no glyph for {ch!r}")
        glyphs[ch] = glyph_commands(font, name)
    cap = glyph_bounds(font, cmap[ord("H")])[3]
    return {
        "font": "IBM Plex Mono 500 (OFL-1.1)",
        "advance": font["hmtx"][cmap[ord("H")]][0] / upm,
        "capHeight": round(cap / upm, 4),
        "glyphs": glyphs,
    }


def outline_bitcoin_b() -> dict:
    font = instance(BODONI, BITCOIN_B_AXES)
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    name = cmap[ord("B")]
    commands = glyph_commands(font, name)
    x_min, y_min, x_max, y_max = glyph_bounds(font, name)
    stems = vertical_stems(commands, min_length=0.4 * y_max / upm)
    if len(stems) < 2:
        sys.exit("could not find the stem of Bodoni Moda's B")
    return {
        "font": f"Bodoni Moda opsz {BITCOIN_B_AXES['opsz']} wght {BITCOIN_B_AXES['wght']} (OFL-1.1)",
        "advance": round(font["hmtx"][name][0] / upm, 4),
        "bounds": [round(x_min / upm, 4), round(-y_max / upm, 4), round(x_max / upm, 4), round(-y_min / upm, 4)],
        "capHeight": round(glyph_bounds(font, cmap[ord("H")])[3] / upm, 4),
        "stem": [stems[0], stems[1]],
        "commands": commands,
    }


def ts_cut(name: str, doc: str, cut: dict) -> str:
    keys = ("width", "height", "baseline", "capTop", "xHeightTop", "opsz", "wght", "tracking")
    fields = "\n".join(f"  {key}: {num(float(cut[key]), 3)}," for key in keys)
    engraving_field = f"  engraving: '{cut['engraving']}',\n" if cut.get("engraving") else ""
    return f"/** {doc} */\nexport const {name}: WordmarkCut = {{\n{fields}\n  d: '{cut['d']}',\n{engraving_field}}}\n"


def write_wordmark(display: dict, text: dict) -> None:
    floors = FLOORS
    source = (
        "// Generated by scripts/brand/outline-fonts.py from Bodoni Moda (SIL OFL 1.1). Do not edit by hand.\n\n"
        "/**\n"
        " * One optical cut of the outlined \"Baserate\" wordmark. Units: the capital height is 100 and y grows downwards;\n"
        " * the SVG viewBox is `0 0 width height`, the tight box around the ink.\n"
        " */\n"
        "export interface WordmarkCut {\n"
        "  readonly width: number\n"
        "  readonly height: number\n"
        "  /** y of the baseline, the capital height and the x-height inside the box. */\n"
        "  readonly baseline: number\n"
        "  readonly capTop: number\n"
        "  readonly xHeightTop: number\n"
        "  /** The Bodoni Moda instance and tracking (em) the cut was outlined from. */\n"
        "  readonly opsz: number\n"
        "  readonly wght: number\n"
        "  readonly tracking: number\n"
        "  readonly d: string\n"
        "  /**\n"
        "   * The engraving struck into the thick strokes, as on a note's lettering: rectangles of paper inside the ink.\n"
        "   * Cut them out with a clip path of the box plus these rectangles, clip-rule evenodd (the outline overlaps\n"
        "   * itself, so they cannot simply be added to `d`). Display cut only; draw it from WORDMARK_FLOORS.engraved.\n"
        "   */\n"
        "  readonly engraving?: string\n"
        "}\n\n"
        "/**\n"
        " * The smallest capital height, in CSS px, each cut is drawn at. Below `display` the display cut's e loses its\n"
        " * bar; below `engraved` the engraving's gaps fall under half a pixel and turn to tone.\n"
        " */\n"
        "export const WORDMARK_FLOORS = {\n"
        f"  text: {floors['text']},\n"
        f"  display: {floors['display']},\n"
        f"  engraved: {floors['engraved']},\n"
        "} as const\n\n"
        + ts_cut(
            "WORDMARK_DISPLAY",
            "wordmark.svg, the film and the deck: a capital height of 24 px and up, engraved from 48 px.",
            display,
        )
        + "\n"
        + ts_cut("WORDMARK_TEXT", "The app header and the lockup files: holds up down to a 10 px capital height.", text)
        + "\n"
        "/** The cut for a capital height of `capPx` CSS px, and whether to draw its engraving. */\n"
        "export function wordmarkFor(capPx: number): { cut: WordmarkCut; engraved: boolean } {\n"
        "  if (capPx >= WORDMARK_FLOORS.engraved) return { cut: WORDMARK_DISPLAY, engraved: true }\n"
        "  if (capPx >= WORDMARK_FLOORS.display) return { cut: WORDMARK_DISPLAY, engraved: false }\n"
        "  return { cut: WORDMARK_TEXT, engraved: false }\n"
        "}\n"
    )
    WORDMARK_OUT.write_text(source)


def average_advance(font: TTFont) -> float:
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    total = sum(hmtx[cmap[ord(ch)]][0] * weight for ch, weight in FREQUENCIES.items())
    return total / sum(FREQUENCIES.values()) / font["head"].unitsPerEm


def fallback_face(family: str, web: TTFont, local_name: str, local_file: Path) -> str:
    """An @font-face that reshapes a local font to the web font's width and vertical metrics (less layout shift)."""
    system = TTFont(str(local_file), fontNumber=0)
    size_adjust = average_advance(web) / average_advance(system)
    upm = web["head"].unitsPerEm
    hhea = web["hhea"]

    def pct(value: float) -> str:
        return f"{value * 100:.2f}%"

    return (
        "@font-face {\n"
        f'  font-family: "{family}";\n'
        f'  src: local("{local_name}");\n'
        f"  size-adjust: {pct(size_adjust)};\n"
        f"  ascent-override: {pct(hhea.ascent / upm / size_adjust)};\n"
        f"  descent-override: {pct(abs(hhea.descent) / upm / size_adjust)};\n"
        f"  line-gap-override: {pct(hhea.lineGap / upm / size_adjust)};\n"
        "}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--metrics", action="store_true", help="print fallback @font-face metrics for tokens.css")
    args = parser.parse_args()

    for path in (BODONI, PUBLIC_SANS, PLEX_MONO):
        if not path.exists():
            sys.exit(f"missing {path.relative_to(WEB)}: run pnpm install first")

    display = outline_word(**CUTS["display"])
    text = outline_word(**CUTS["text"])
    write_wordmark(display, text)

    OUTLINES_OUT.parent.mkdir(parents=True, exist_ok=True)
    outlines = {
        "generatedBy": "scripts/brand/outline-fonts.py",
        "units": "em, y down, origin at the pen position on the baseline",
        "mono": outline_microtext(),
        "bitcoinB": outline_bitcoin_b(),
    }
    OUTLINES_OUT.write_text(json.dumps(outlines, separators=(",", ":")) + "\n")
    # Leave the outputs in the repo's own format, so `biome check` stays clean after a regeneration.
    if BIOME.exists():
        subprocess.run([str(BIOME), "format", "--write", str(WORDMARK_OUT), str(OUTLINES_OUT)], check=True,
                       capture_output=True)
    print(f"wrote {WORDMARK_OUT.relative_to(WEB)} and {OUTLINES_OUT.relative_to(WEB)}")

    if args.metrics:
        georgia, arial = SYSTEM_FONTS / "Georgia.ttf", SYSTEM_FONTS / "Arial.ttf"
        if not (georgia.exists() and arial.exists()):
            sys.exit(f"--metrics measures Georgia and Arial in {SYSTEM_FONTS}, which this system does not have")
        print(fallback_face("Bodoni Moda Fallback", instance(BODONI, {"opsz": 96, "wght": 450}), "Georgia", georgia))
        print(fallback_face("Public Sans Fallback", instance(PUBLIC_SANS, {"wght": 400}), "Arial", arial))


if __name__ == "__main__":
    main()
