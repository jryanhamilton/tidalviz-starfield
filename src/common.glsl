// Shared by scene.frag and image.frag (spliced in by src/include.js): noise, and the flying stars.
// Stars live one per grid cell (a hash decides whether a cell has one, where, how bright and which
// frequency band it listens to); four layers at different scales cycle far → near as u_travel
// grows, which reads as flying forward, over a static layer of fine star dust.

uniform vec2 u_resolution;  // drawing-buffer pixels
uniform float u_time;       // seconds, for idle twinkle only
uniform float u_travel;     // distance flown (accumulated in JS; bass sets the rate)
uniform float u_drift;      // nebula clock (accumulated in JS; mids set the rate)
uniform float u_beats;      // onset counter: reseeds which stars flare on each beat
uniform float u_flare;      // beat flare envelope, rate-limited when "Reduce flashing" is on
uniform float u_bass;       // audio.bassAtt
uniform float u_mid;        // audio.midAtt
uniform float u_treb;       // audio.trebAtt
uniform float u_bands[64];  // audio.bands, 0–1, low to high
uniform float u_density;    // share of grid cells holding a star
uniform float u_shimmer;    // how strongly stars follow their band
uniform float u_flares;     // share of stars that flare on a beat
uniform vec3 u_core;        // the nebula's light; highs tint the stars toward it
uniform float u_corePulse;  // 0–1: kick hits with a steady beat, the bass followed without one; rate-limited like u_flare
uniform float u_pulse;      // how strongly the core reacts to kicks
uniform float u_beatTime;   // beats elapsed, locked to the song's tempo once it is detected
uniform float u_twinkleClock; // free-running twinkle clock (Twinkle speed)
uniform float u_twinkle;    // twinkle amount
uniform float u_twinkleSync; // 1 = twinkle on the beat grid, 0 = free-running, between = a blend
uniform float u_intensity;  // 0–1: how intense the music is against its recent level (0.5 = usual)
uniform float u_dynamics;   // how much star brightness and size follow u_intensity (0 = not at all)

const int LAYERS = 4;

// Stars shine dimmer and smaller in quiet passages, brighter and bigger when the music builds.
// At the song's usual level they are close to their Dynamics-off look.
float intensityBright() { return mix(1.0, 0.15 + 1.35 * u_intensity, u_dynamics); }
float intensitySize() { return mix(1.0, 0.55 + 0.9 * u_intensity, u_dynamics); }

// Dave Hoskins' hash12: no visible repeats on the integer lattice the noise and star grid use.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float v = 0.0, a = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);  // rotate each octave so the grid never lines up
  for (int i = 0; i < octaves; i++) {
    v += a * noise(p);
    p = turn * p * 2.03 + 17.0;
    a *= 0.5;
  }
  return v;
}

// A star's twinkle, 0–1, from its personality h (0–1) and a seed. In time with the music, each star
// blinks at half, normal or double time on its own sixteenth of the beat, then fades; free, it
// swells and fades smoothly at its own rate. u_twinkleSync blends the two (auto: by the groove).
float twinkleOf(float h, float seed) {
  float rate = h < 0.35 ? 0.5 : h < 0.8 ? 1.0 : 2.0;
  float offset = floor(hash(vec2(seed, 8.3)) * 4.0) * 0.25;
  float onBeat = exp(-fract(u_beatTime * rate + offset) * 6.0);
  float freeRunning = 0.5 + 0.5 * sin(u_twinkleClock * (1.5 + h * 6.0) + h * 40.0);
  return mix(freeRunning, onBeat, u_twinkleSync);
}

// One layer of stars. uv is in cell units; returns light added by the star in this cell.
vec3 stars(vec2 uv, float seed, float near) {
  vec2 id = floor(uv);
  vec2 f = fract(uv) - 0.5;
  float h = hash(id + seed);
  if (h > u_density) return vec3(0.0);
  h /= u_density;  // reuse as 0–1 personality

  vec2 off = vec2(hash(id + seed + 1.3), hash(id + seed + 7.1)) - 0.5;
  vec2 d2 = f - off * 0.5;  // star stays in the middle half, so its glow fits in the cell
  float d = length(d2);

  float level = u_bands[int(hash(id + seed + 3.7) * 63.99)];
  float twinkle = twinkleOf(h, hash(id + seed + 2.2));
  float flare = step(1.0 - u_flares, hash(id + seed + u_beats * 0.731)) * u_flare;

  float b = 0.12 + 0.4 * u_twinkle * twinkle + u_shimmer * 1.4 * smoothstep(0.2, 0.9, level) + 2.5 * flare;
  b *= intensityBright();
  float size = intensitySize();
  float ds = d / size;                          // distance in this star's own (scaled) units
  float edge = 1.0 - smoothstep(0.1, 0.25, d);  // the cell's limit stays put
  float glow = 0.0012 / (ds * ds + 0.0006) * edge;
  // Cross-shaped spikes on near, bright stars.
  float spikes = max(0.0, 1.0 - abs(d2.x * d2.y) / (size * size) * 2200.0) * edge * near * (0.3 * b - 0.1);

  // Mostly blue-white; about one in six is a warm orange star with a soft halo.
  float kind = hash(id + seed + 9.1);
  float warm = step(0.83, kind);
  vec3 tint = mix(mix(vec3(0.66, 0.8, 1.0), vec3(0.95, 0.96, 1.0), kind / 0.83), vec3(1.0, 0.6, 0.36), warm);
  tint = mix(tint, u_core, 0.25 * smoothstep(0.9, 1.6, u_treb));  // highs cool the whole field
  float halo = warm * 0.012 / (ds + 0.03) * edge * edge;
  return tint * (b * (glow + halo) + max(spikes, 0.0));
}

// Static star dust plus the flying layers, at centred point p (y from -0.5 to 0.5).
vec3 starfield(vec2 p, float dust) {
  vec3 col = stars(p * 110.0, 5.0, 0.0) * dust;
  for (int i = 0; i < LAYERS; i++) {
    float fi = float(i) / float(LAYERS);
    float depth = fract(fi + u_travel);          // 0 = far, 1 = here
    float scale = mix(28.0, 1.2, depth);         // far layers are small and dense
    float fade = smoothstep(0.0, 0.3, depth) * smoothstep(1.0, 0.85, depth);
    float a = fi * 2.4;                          // rotate layers so their grids don't align
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    col += stars(rot * p * scale, fi * 91.7 + floor(fi + u_travel) * 13.1, depth) * fade;
  }
  return col;
}
