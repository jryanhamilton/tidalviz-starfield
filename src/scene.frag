#version 300 es
// Starfield over a procedural nebula: a bowl of gas lit from within by a glowing core.
// Domain-warped fractal noise for the gas, ridged noise for wisps, a second noise for dark dust in
// front of the light. The bass makes the core breathe. Stars and noise: common.glsl.
precision highp float;
#include "common.glsl"

uniform float u_nebula;     // nebula brightness (0 = off)
uniform float u_size;       // nebula size, 1 = the bowl's arms reach the top of the screen
uniform vec3 u_gas;         // gas far from the light
uniform vec3 u_rim;         // warm light on gas edges

out vec4 fragColor;

const vec2 CORE = vec2(0.03, -0.05);  // just right of and below centre

vec3 nebula(vec2 p) {
  vec2 s = p * 1.6;
  vec2 q = vec2(fbm(s + vec2(0.0, u_drift * 0.11), 4), fbm(s + vec2(5.2, 1.3) - u_drift * 0.07, 4));
  float warp = 1.6 + 0.6 * min(u_mid, 2.5);
  vec2 r = vec2(fbm(s + warp * q + vec2(1.7, 9.2), 4), fbm(s + warp * q + vec2(8.3, 2.8) + u_drift * 0.05, 4));
  float d = fbm(s + warp * r, 5);

  vec2 c = p - CORE;
  float dist = length(c * vec2(0.8, 1.15));

  // Composition: a bowl of gas around the core, heaviest along the lower lip, open above, and
  // fading out well before the edge of the bowl's space so it sits clear of the screen edges.
  float shell = exp(-pow((dist - 0.33) / 0.19, 2.0)) * (0.4 + 0.8 * smoothstep(0.2, -0.15, c.y));
  shell = max(shell, 0.2 * smoothstep(0.55, 0.1, dist));        // thin haze inside the bowl
  shell *= 0.45 + 0.8 * smoothstep(0.35, 0.65, fbm(s * 0.45 + vec2(3.1, 7.7), 3));
  shell *= smoothstep(0.68, 0.45, dist);

  // The core breathes gently with the bass level and pulses with the kicks (or swells with the bass).
  float glow = 1.0 + 0.15 * min(u_bass, 2.5) + 0.6 * u_pulse * u_corePulse;
  float light = exp(-dist * 3.4) * glow;                       // how brightly the core lights the gas here

  float gas = smoothstep(0.32, 0.75, d) * shell;
  // Rim light: sample the gas a step toward the core. Where it thins that way, this is a surface
  // facing the light, so it glows warm; mostly along the lower lip, as in a backlit cloud bank.
  vec2 toCore = -c / max(length(c), 1e-3);
  float facing = clamp((d - fbm(s + warp * r + toCore * 0.08, 5)) * 9.0, 0.0, 1.0);

  vec3 col = mix(u_gas, u_core, smoothstep(0.1, 0.8, light)) * gas * (0.25 + 1.0 * light);
  col += u_rim * facing * gas * light * 3.2 * (0.25 + 0.75 * smoothstep(0.1, -0.2, c.y));

  // Fine bright wisps: ridged noise (1 - |2n - 1|) sharpened into thin lines.
  float ridge = 1.0 - abs(2.0 * fbm(s * 2.2 + 1.5 * r + vec2(4.4, 0.9), 5) - 1.0);
  col += mix(u_core, vec3(1.0), 0.4) * pow(ridge, 16.0) * shell * light * (0.8 + 0.4 * min(u_mid, 2.5));

  // The light itself: a vivid cyan cavity with a hotter centre.
  col += u_core * exp(-dist * 4.0) * 1.5 * glow;
  col += mix(u_core, vec3(1.0), 0.5) * exp(-dist * 10.0) * 1.0 * glow;

  // Dark dust silhouetted against the glow.
  float dust = smoothstep(0.47, 0.64, fbm(s * 1.8 + 1.2 * q + vec2(7.3, 3.1), 4));
  col *= 1.0 - 0.9 * dust * smoothstep(0.7, 0.15, dist);

  // Deep navy sky around it.
  col += u_gas * 0.08 * smoothstep(1.0, 0.1, length(p));
  return col * smoothstep(0.95, 0.55, dist);
}

void main() {
  // Centred coordinates, y from -0.5 to 0.5, square pixels.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec3 col = nebula(p / u_size) * u_nebula;
  col += starfield(p, 0.3);

  col = 1.0 - exp(-col);  // tone map: bright, never clipped
  // Transparent, premultiplied canvas: light on black, alpha = brightest channel.
  fragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
