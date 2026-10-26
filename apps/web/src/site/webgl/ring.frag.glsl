// The microtext ring's letters (the texture's alpha) in Note. The burin sets them last, clockwise from twelve; the
// unwind takes them with the outer family, by the same six o'clock sweep as the thread (coin.ts unwindAt).

precision highp float;

uniform sampler2D uText;
uniform vec3 uInk;
uniform float uEngrave;
uniform vec2 uEngraveWindow;
uniform float uProgress;
uniform vec4 uUnwind; // window start, window end, stagger, radial share
uniform float uOpacity;

in vec2 vUv;

out vec4 fragColor;

void main() {
  float u = vUv.x;
  float order = mix(uEngraveWindow.x, uEngraveWindow.y, u);
  float cut = step(order, uEngrave);
  float sweep = fract(u + 0.5);
  float tau = mix(uUnwind.x, uUnwind.y, (1.0 - uUnwind.z) * sweep + uUnwind.z * (1.0 - uUnwind.w));
  float kept = step(uProgress, tau);
  float a = texture(uText, vUv).a * cut * kept * uOpacity;
  if (a <= 0.002) discard;
  fragColor = vec4(uInk * a, a);
}
