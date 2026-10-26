// The thread: one capsule quad per segment, in screen space, so a line keeps its engraved width at any depth.
// Each instance reads both ends of its segment (threadGeometry.ts: the same buffer at offsets 0 and STRIDE).
//
//   on the coin   projected through the camera; width from the relief light (the engraving law, coin.ts):
//                 mix(min, max, light^gamma) CSS px; edge strokes facing away are culled; the burin shows a
//                 segment once its order is reached, with a fresh cut at the front
//   pulled        (hero) tau < progress: the point has left the coin and hangs on the rail below the exit,
//                 travelling down at uConveyor px per unit of progress, in the rail's ink and width
//   unwound       (footer, uDir = -1) tau > progress: not wound yet; the supply line (three points the stage
//                 places: the rail, its turn, the entry on the rim) draws the thread feeding the spool
//   straddling    one end pulled: the taut line from the exit to the pull point on the coin
//
// Colours are raw sRGB from the brand tokens; the canvas blends with MAX (never order-dependent, no beading where
// round caps overlap), and the fragment writes premultiplied coverage.

precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec2 corner; // x: 0 at the start, 1 at the end; y: −1 or 1 across
in vec3 aA;
in vec3 aNA;
in vec4 aMA; // order, tau, weight, flags of the start
in vec3 aB;
in vec3 aNB;
in vec2 aMB; // order, tau of the end

uniform vec2 uViewport; // drawing buffer, device px
uniform float uDpr;
uniform vec3 uLight; // view space, unit
uniform vec3 uWidth; // min, max (CSS px), gamma
uniform float uWeight; // the tier's weight
uniform float uEngrave; // the burin's progress
uniform float uFresh; // the fresh cut's length, in order units
uniform float uProgress;
uniform float uDir; // 1 hero, −1 footer
uniform vec2 uExit; // device px, y down
uniform float uConveyor; // device px per unit of progress
uniform float uRail; // rail width, device px
uniform vec3 uInk[4]; // Note, Guilloche, Amber, Mint
uniform vec3 uRailInk;
uniform float uOpacity;
uniform vec2 uSupplyA; // the footer's supply: the rail above the slot, device px, y down
uniform vec2 uSupplyB; // the rail's turn towards the emblem (the entry, uExit, is the third point)

out vec2 vLocal; // px: x along the segment from its start, y across
out float vLen;
out vec2 vHalf; // half widths at the two ends, px
out vec3 vColor;
out float vAlpha;

const vec4 OFF = vec4(2.0, 2.0, 2.0, 1.0);

vec2 toScreen(vec3 p) {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vec2 ndc = clip.xy / clip.w;
  return vec2((ndc.x * 0.5 + 0.5) * uViewport.x, (0.5 - ndc.y * 0.5) * uViewport.y);
}

// How far past its tau a point is (> 0: it is on the rail).
float pulled(float tau) {
  return uDir * (uProgress - tau);
}

vec2 onRail(float s) {
  return uExit + vec2(0.0, uDir * s * uConveyor);
}

float lightOn(vec3 n) {
  vec3 nv = normalize(normalMatrix * n);
  return max(dot(nv, uLight), 0.0);
}

float engraved(float light, float weight) {
  return mix(uWidth.x, uWidth.y, pow(light, uWidth.z)) * weight * uWeight * uDpr;
}

vec2 supplyPoint(float i) {
  return i < 0.5 ? uSupplyA : i < 1.5 ? uSupplyB : uExit;
}

void main() {
  float flags = aMA.w;
  float supply = step(15.5, flags);
  float link = step(7.5, mod(flags, 16.0));
  float edge = step(3.5, mod(flags, 8.0));
  int ink = int(mod(flags, 4.0) + 0.5);
  float orderA = aMA.x;
  float orderB = aMB.x;
  float tauA = aMA.y;
  float tauB = aMB.y;
  float weight = aMA.z;

  float sA = pulled(tauA);
  float sB = pulled(tauB);
  // The hero pulls a point once progress reaches its tau (so at 1 the last points sit at the exit); the footer
  // winds it in once progress reaches its tau.
  bool railA = uDir > 0.0 ? sA >= 0.0 : sA > 0.0;
  bool railB = uDir > 0.0 ? sB >= 0.0 : sB > 0.0;

  vec2 pA;
  vec2 pB;
  float wA;
  float wB;
  vec3 color;
  float alpha = uOpacity;

  if (supply > 0.5) {
    // The footer's supply: the rail feeding the spool, at every progress.
    if (link > 0.5) {
      gl_Position = OFF;
      return;
    }
    pA = supplyPoint(aMA.x);
    pB = supplyPoint(aMB.x);
    wA = uRail;
    wB = uRail;
    color = uRailInk;
    // The supply stays when the spool hands over to the SVG mark: it is the rail, not the emblem.
    alpha = 1.0;
  } else if (uDir < 0.0 && railA && railB) {
    // The footer: thread not yet wound is the supply line's, which draws it.
    gl_Position = OFF;
    return;
  } else if (railA || railB) {
    // On the rail, or the taut line from the exit to the pull point.
    if (railA && railB) {
      pA = onRail(sA);
      pB = onRail(sB);
    } else {
      // Taut from the exit itself, so every pull point of a family lines up into one hand (the stretch of rail
      // below the exit is drawn by the segments already pulled).
      float f = clamp(railA ? sA / (sA - sB) : sB / (sB - sA), 0.0, 1.0);
      vec3 pull = railA ? mix(aA, aB, f) : mix(aB, aA, f);
      pA = railA ? uExit : toScreen(pull);
      pB = railA ? toScreen(pull) : uExit;
    }
    wA = uRail;
    wB = uRail;
    color = uRailInk;
    // Pen-lift links join the rail too (the line is one thread there), but never cross the coin.
    if (link > 0.5 && !(railA && railB)) {
      gl_Position = OFF;
      return;
    }
  } else {
    if (link > 0.5) {
      gl_Position = OFF;
      return;
    }
    // The burin: nothing is cut yet past uEngrave; a segment it is crossing is cut part way.
    bool cutA = orderA <= uEngrave;
    bool cutB = orderB <= uEngrave;
    if (!cutA && !cutB) {
      gl_Position = OFF;
      return;
    }
    vec3 a = aA;
    vec3 b = aB;
    if (!cutB) b = mix(aA, aB, clamp((uEngrave - orderA) / max(orderB - orderA, 1e-6), 0.0, 1.0));
    if (!cutA) a = mix(aB, aA, clamp((uEngrave - orderB) / max(orderA - orderB, 1e-6), 0.0, 1.0));

    if (edge > 0.5) {
      // The edge shows only where it faces the camera (no depth buffer needed).
      vec3 viewA = (modelViewMatrix * vec4(aA, 1.0)).xyz;
      vec3 nA = normalize(normalMatrix * aNA);
      if (dot(nA, -viewA) <= 0.0) {
        gl_Position = OFF;
        return;
      }
    }

    pA = toScreen(a);
    pB = toScreen(b);
    wA = engraved(lightOn(aNA), weight);
    wB = engraved(lightOn(aNB), weight);
    color = uInk[ink];

    // The fresh cut: just behind the burin the line is wider and catches the light.
    float fresh = 1.0 - smoothstep(0.0, uFresh, uEngrave - min(orderA, orderB));
    fresh *= step(uEngrave, 1.0 + uFresh);
    wA *= 1.0 + 0.9 * fresh;
    wB *= 1.0 + 0.9 * fresh;
    color = mix(color, uInk[0], 0.7 * fresh);
  }

  vec2 d = pB - pA;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);
  float reach = 0.5 * max(wA, wB) + 1.0; // half the widest end, plus a pixel for the coverage ramp
  float x = mix(-reach, len + reach, corner.x);
  float y = corner.y * reach;
  vec2 screen = pA + dir * x + across * y;

  vLocal = vec2(x, y);
  vLen = len;
  vHalf = 0.5 * vec2(wA, wB);
  vColor = color;
  vAlpha = alpha;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
}
