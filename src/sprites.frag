#version 300 es
// A painted star's glow: a soft core, a faint halo, and cross spikes while it flares. Drawn with a
// screen blend over the picture, as premultiplied light (alpha = brightest channel).
precision highp float;

in vec2 v_q;
flat in vec3 v_light;
flat in float v_flare;

out vec4 fragColor;

void main() {
  float d = length(v_q);  // in star radii
  float core = exp(-d * d * 1.5);
  float halo = 0.12 / (1.0 + d * d) * smoothstep(7.0, 3.0, d);
  float spikes = max(0.0, 1.0 - abs(v_q.x * v_q.y) * 1.2) * smoothstep(7.0, 0.0, d) * v_flare;
  vec3 c = 1.0 - exp(-v_light * (core + halo + 0.6 * spikes));
  fragColor = vec4(c, max(c.r, max(c.g, c.b)));
}
