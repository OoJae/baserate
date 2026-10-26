// A tapered capsule's coverage of the pixel: the overlap of a one-pixel box with the line's width, measured from
// the nearest point of the segment (round caps beyond the ends). A line thinner than a pixel covers it in
// proportion to its width, so thin lines read darker, never broken: line density is light.

precision highp float;

in vec2 vLocal;
in float vLen;
in vec2 vHalf;
in vec3 vColor;
in float vAlpha;

out vec4 fragColor;

void main() {
  float along = clamp(vLocal.x, 0.0, vLen);
  float d = length(vec2(vLocal.x - along, vLocal.y));
  float hw = mix(vHalf.x, vHalf.y, vLen > 0.0 ? along / vLen : 0.0);
  float cover = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0);
  float a = cover * vAlpha;
  if (a <= 0.002) discard;
  fragColor = vec4(vColor * a, a);
}
