#!/usr/bin/env python3
"""Writes one footage scene per entry of scenes.json into compositions/<id>.html.

Each scene plays one or more slices of 2160x1350 app recordings inside a camera wrapper. Camera framings are
rectangles of the recording ([x, y, w, h] in recording pixels, or "full"); the wrapper's x/y/scale that fit each
rectangle to the 1920x1080 canvas are computed here, so the scene's GSAP holds plain numbers. A framing with
"cut": true lands instantly (a punch-in cut); otherwise the camera moves there over `dur` seconds.

A scene is either one slice (`src`, `mediaStart`, optional `rate`, playing for the whole `duration`) or a list of
`segments` ({src, mediaStart, start, duration, rate?}) played back to back. Retiming a beat to the voiceover means
editing scenes.json (slot lengths, trims, framing times) and running this again.

    python3 tools/build_scenes.py
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W, H = 1920, 1080
SRC_W, SRC_H = 2160, 1350


def fit(rect):
    """Wrapper transform (x, y, scale) that shows `rect` of the recording centred and as large as fits."""
    if rect == "full":
        rect = [0, 0, SRC_W, SRC_H]
    x, y, w, h = rect
    s = min(W / w, H / h)
    s = max(s, W / SRC_W)  # never show beyond the recording's width
    tx = W / 2 - (x + w / 2) * s
    ty = H / 2 - (y + h / 2) * s
    tx = min(0.0, max(W - SRC_W * s, tx))
    ty = min(0.0, max(H - SRC_H * s, ty))
    return round(tx, 1), round(ty, 1), round(s, 4)


_lengths = {}


def clip_length(src):
    if src not in _lengths:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(ROOT / src)],
            capture_output=True,
            text=True,
            check=True,
        )
        _lengths[src] = float(out.stdout.strip())
    return _lengths[src]


def segments_of(sid, sc):
    if "segments" in sc:
        segs = sc["segments"]
    else:
        segs = [{"src": sc["src"], "mediaStart": sc["mediaStart"], "start": 0, "duration": sc["duration"],
                 "rate": sc.get("rate", 1)}]
    end = 0.0
    for i, seg in enumerate(segs):
        rate = seg.get("rate", 1)
        used = seg["mediaStart"] + seg["duration"] * rate
        if used > clip_length(seg["src"]) - 0.02:
            raise SystemExit(f"{sid} segment {i}: needs {used:.2f} s of {seg['src']} ({clip_length(seg['src']):.2f} s)")
        if abs(seg["start"] - end) > 1e-6:
            raise SystemExit(f"{sid} segment {i}: starts at {seg['start']} but the previous one ends at {end}")
        end = seg["start"] + seg["duration"]
    if abs(end - sc["duration"]) > 1e-6:
        raise SystemExit(f"{sid}: segments end at {end}, the scene lasts {sc['duration']}")
    return segs


def scene_html(sid, sc):
    dur = sc["duration"]
    segs = segments_of(sid, sc)
    cams = sc["cams"]
    x0, y0, s0 = fit(cams[0]["rect"])
    tweens = []
    for cam in cams[1:]:
        x, y, s = fit(cam["rect"])
        if cam.get("cut"):
            tweens.append(f'tl.set("#{sid}-cam", {{ x: {x}, y: {y}, scale: {s} }}, {cam["at"]});')
            continue
        d = cam.get("dur", 0.6)
        ease = cam.get("ease", "power2.inOut")
        tweens.append(
            f'tl.to("#{sid}-cam", {{ x: {x}, y: {y}, scale: {s}, duration: {d}, ease: "{ease}" }}, {cam["at"]});'
        )
    enter = sc.get("enter", "whip")
    exit_ = sc.get("exit", "whip")
    if enter == "whip":
        tweens.insert(
            0,
            f'tl.fromTo("#{sid}-stage", {{ yPercent: 9, filter: "blur(14px)", opacity: 0.4 }}, '
            f'{{ yPercent: 0, filter: "blur(0px)", opacity: 1, duration: 0.32, ease: "expo.out" }}, 0);',
        )
    elif enter == "settle":
        tweens.insert(
            0,
            f'tl.fromTo("#{sid}-stage", {{ scale: 1.04, opacity: 0 }}, '
            f'{{ scale: 1, opacity: 1, duration: 0.5, ease: "expo.out" }}, 0);',
        )
    if exit_ == "whip":
        tweens.append(
            f'tl.to("#{sid}-stage", {{ yPercent: -9, filter: "blur(14px)", opacity: 0.4, duration: 0.2, '
            f'ease: "power3.in" }}, {round(dur - 0.2, 3)});'
        )
    elif exit_ == "blur":
        tweens.append(
            f'tl.to("#{sid}-stage", {{ filter: "blur(8px)", opacity: 0, duration: 0.2, ease: "power3.in" }}, '
            f"{round(dur - 0.2, 3)});"
        )
    tweens_js = "\n    ".join(tweens)

    videos = []
    for i, seg in enumerate(segs):
        rate = seg.get("rate", 1)
        rate_attr = f'\n          data-playback-rate="{rate}"' if rate != 1 else ""
        videos.append(
            f"""        <video
          id="{sid}-v{i}"
          class="clip"
          src="{seg['src']}"
          data-start="{seg['start']}"
          data-hf-media-start-basis="local"
          data-duration="{seg['duration']}"
          data-media-start="{seg['mediaStart']}"{rate_attr}
          data-track-index="1"
          muted
          playsinline
        ></video>"""
        )
    videos_html = "\n".join(videos)
    return f"""<template>
  <style>
    #root {{
      position: absolute;
      inset: 0;
      background: #f6f5f1;
      overflow: hidden;
    }}
    #{sid}-stage {{
      position: absolute;
      inset: 0;
      transform-origin: 50% 50%;
    }}
    #{sid}-cam {{
      position: absolute;
      left: 0;
      top: 0;
      width: {SRC_W}px;
      height: {SRC_H}px;
      transform-origin: 0 0;
    }}
    #{sid}-cam video {{
      position: absolute;
      left: 0;
      top: 0;
      width: {SRC_W}px;
      height: {SRC_H}px;
    }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}">
    <div id="{sid}-stage">
      <div id="{sid}-cam">
{videos_html}
      </div>
    </div>
  </div>
  <script>
    // Generated by tools/build_scenes.py from scenes.json ({sc.get('note', sid)}).
    const tl = gsap.timeline({{ paused: true }});
    tl.set("#{sid}-cam", {{ x: {x0}, y: {y0}, scale: {s0} }}, 0);
    {tweens_js}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""


def main():
    scenes = json.loads((ROOT / "scenes.json").read_text())
    for sid, sc in scenes.items():
        if sid.startswith("_"):
            continue
        out = ROOT / "compositions" / f"{sid}.html"
        out.write_text(scene_html(sid, sc))
        segs = segments_of(sid, sc)
        print(f"wrote {out.relative_to(ROOT)}  ({sc['duration']} s, {len(segs)} segment(s))")


if __name__ == "__main__":
    main()
