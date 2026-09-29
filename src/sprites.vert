#version 300 es
// One glow sprite per painted star (instanced: 6 vertices each), placed with the same mapping the
// picture uses, so it sits on its star while the picture churns and breathes. Each star listens to
// its own frequency band; on a beat a random share of them flare.
#include "common.glsl"
#include "image-map.glsl"

in vec4 a_star;   // u, v (0–1 from the picture's top-left), strength (0–1 contrast), big (0 or 1)
in vec3 a_color;  // the painted star's colour, 0–1

out vec2 v_q;             // position within the sprite, in star radii
flat out vec3 v_light;    // colour × brightness
flat out float v_flare;

const float EXTENT = 7.0;  // sprite half-size, in star radii: room for halo and spikes

void main() {
  int corner = gl_VertexID % 6;  // two triangles: (-,-) (+,-) (-,+) / (-,+) (+,-) (+,+)
  vec2 q = vec2(corner == 1 || corner == 4 || corner == 5 ? 1.0 : -1.0, corner == 2 || corner == 3 || corner == 5 ? 1.0 : -1.0);

  float id = float(gl_InstanceID);
  float h = hash(vec2(id, 1.3));
  float level = u_bands[int(hash(vec2(id, 3.7)) * 63.99)];
  float twinkle = twinkleOf(h, hash(vec2(id, 2.2)));
  float flare = step(1.0 - u_flares, hash(vec2(id, u_beats * 0.731 + 5.1))) * u_flare;

  // At rest the glow is faint, so the painting still reads as painted; the music lifts it.
  float b = (0.5 * u_twinkle * twinkle + u_shimmer * 0.8 * smoothstep(0.2, 0.9, level)) * (0.4 + a_star.z) + 2.0 * flare;
  b *= intensityBright();
  vec3 hue = a_color / max(max(a_color.r, a_color.g), max(a_color.b, 1e-3));
  v_light = mix(vec3(1.0), hue, 0.75) * b;
  v_flare = flare;
  v_q = q * EXTENT;

  // Radius follows the picture's scale; big stars get bigger glows, and flares swell a little.
  float imageHeight = imageWidth() / imageAspect();
  float r = max((a_star.w > 0.5 ? 0.005 : 0.0022) * imageHeight * intensitySize(), 1.5 / u_resolution.y) * (1.0 + 0.6 * flare);
  vec2 p = imageToScreen(a_star.xy) + q * r * EXTENT;
  gl_Position = vec4(p.x * 2.0 * u_resolution.y / u_resolution.x, p.y * 2.0, 0.0, 1.0);
}
