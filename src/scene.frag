#version 300 es
// Starfield: flying stars at full resolution over the nebula, which nebula.frag drew at half
// resolution into u_prepass. Stars and noise: common.glsl.
precision highp float;
#include "common.glsl"

uniform sampler2D u_prepass;  // the nebula, tone-mapped: N = 1 − e^(−nebula)

out vec4 fragColor;

void main() {
  // Centred coordinates, y from -0.5 to 0.5, square pixels.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec3 nebula = texture(u_prepass, gl_FragCoord.xy / u_resolution).rgb;
  // Tone-mapping nebula + stars together, 1 − e^(−(nebula + stars)), is 1 − (1 − N)·e^(−stars).
  vec3 col = 1.0 - (1.0 - nebula) * exp(-starfield(p, 0.3));

  // Transparent, premultiplied canvas: light on black, alpha = brightest channel.
  fragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
