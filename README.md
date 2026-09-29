# Starfield

Visualizers of a nebula whose stars play along with the music:

- **Starfield**: the nebula is procedural, a bowl of gas lit from within by a glowing core, and
  you fly through procedural stars.
- **Picture visualizers** (`aogm-imagine-nebula-3a`, `-3b`, `-3c`, built on Greg Martin's
  *Nebulae III*; see [Credits and pictures](#credits-and-pictures)): the nebula is a picture, loaded
  from `local/<visualizer id>.jpg`. That folder is git-ignored and the pictures are not in the repo.
  The picture is shown whole (Fit: whole image), with any spare screen filled by a blurred mirror of
  its outer sky, or fills the screen (Fit: fill screen); its bright core pulses with the music. The
  stars are the ones painted into the picture: at load, `detect.js` finds them (small points much
  brighter than their surroundings and bright all the way round, so highlights on cloud edges don't
  count; at two scales so big glowing stars count too), and each gets a glow sprite that shimmers
  with its own frequency band and flares on beats, in place.

## Credits and pictures

The three picture visualizers are built on **_Nebulae III_ by Greg Martin**, from his /Imagine
collections at [Art of Greg Martin](https://www.artofgregmartin.com/imagine/ai) (made with
Midjourney and Photoshop). All rights to the pictures are his. He provides these wallpapers
"freely for your personal use and enjoyment", so they are **not included in this repo**: download
your own copies from his page.

1. Open [Nebulae III](https://www.artofgregmartin.com/imagine/nebulae-iii) and download its three
   wallpapers (3440 × 1440).
2. Save them in `plugins/starfield/local/` under these names, in the order they appear on the page:

   | Page order | Save as |
   | --- | --- |
   | 1st: teal, a glowing gap between dark cloud banks | `local/aogm-imagine-nebula-3a.jpg` |
   | 2nd: violet and red, around a blue-white glow | `local/aogm-imagine-nebula-3b.jpg` |
   | 3rd: a glowing blue cavity in a bowl of gas | `local/aogm-imagine-nebula-3c.jpg` |

   Another format (AVIF, PNG) converts on a Mac with
   `sips -s format jpeg <file> --out plugins/starfield/local/<name>.jpg`.

Until a picture is in place its visualizer shows "No backdrop image" with the path it expects.

To add a picture of your own: save it as `local/<new id>.jpg` and copy one of the `aogm-imagine-*`
entries in `tidalviz.json` with that id. Set **Core position X/Y** (0–1 from the top-left) to its
brightest spot.

## Files

| File | What it is |
| --- | --- |
| `src/common.glsl` | Shared by both shaders: noise, and the flying stars (one star per grid cell, four depth layers over static dust) |
| `src/nebula.frag` | Starfield's procedural nebula, drawn at half resolution: domain-warped gas, rim light, wisps and dark dust |
| `src/scene.frag` | Starfield's final pass: the stars at full resolution over the half-resolution nebula |
| `src/image.frag` | Picture visualizers: the whole picture, churned by slow noise, with a bass-driven swell and bloom |
| `src/image-map.glsl` | Where the picture sits on screen, both ways, so the star sprites follow its churn and swell |
| `src/sprites.vert`, `src/sprites.frag` | A glow sprite on each painted star (instanced) |
| `src/detect.js` | Finds the stars painted into the picture. Tested |
| `src/viz.js` | Shared GL glue: compiles the shader, uploads audio, params and the image as uniforms |
| `src/main.js`, `src/image.js` | Entry points: Starfield, and every picture visualizer |
| `src/include.js` | `#include "file"` for GLSL, with `#line` directives so errors keep their line numbers. Tested |
| `src/motion.js` | Audio-driven clocks: flight distance (bass), nebula drift (mids), beat counter and flare envelope. Tested |
| `src/flash.js` | Photosensitivity limiter, copied from the template |

## How the music maps to the picture

| Music | Picture |
| --- | --- |
| Each of the 64 bands | Shimmer of the stars assigned to that band |
| Intensity: loudness now (`rms`, ~0.08 s up, ~0.4 s down) against the song's last ~20 s | With **Dynamics**, stars shine dimmer and smaller in quiet passages, brighter and bigger as the music builds; near silence they fade out. Relative to the song, so it's the same at any overall volume |
| Kicks (instant `bass` jumping above **Kick threshold**) | With a steady beat, the core pulses on each kick, fading over **Pulse decay** |
| Bass above its usual level, followed continuously | Without a steady beat (orchestral, ambient), the core swells and fades with the bass instead, so slow attacks aren't answered late |
| Groove: how steadily the tempo tracker has held a beat (~1.5 s) | **Response: auto** blends between the two above by the groove; **beats** and **flowing** pick one. Also blends **Twinkle timing: auto**, and **Flares on: kicks** falls back to onsets without a groove |
| Onsets (any beat), or kicks only (**Flares on**) | A random handful of stars flare (**Beat flares** sets how many) |
| Tempo (`bpm`, `beatPhase`) | With **Twinkle timing: tempo**, each star blinks at half, normal or double time on its own sixteenth of the beat; with **free**, stars twinkle at **Twinkle speed**; **auto** blends by the groove |
| Bass level (`bassAtt`) | Flight speed (procedural); the core breathes gently |
| Mids (`midAtt`) | How fast and how hard the gas churns |
| Treble (`trebAtt`) | Cools the stars toward the core colour |

Core pulses and flares are rate-limited by "Reduce flashing" (at most 3 new rises a second).

## Running

Run with hot reload: `uv run tidalviz --dev plugins/starfield`. Or without the app:
`python3 -m http.server 8765 --bind 127.0.0.1` from the repo root, then open
`http://127.0.0.1:8765/plugins/_harness/index.html?repo=starfield&viz=starfield&audio=music`
(or e.g. `viz=aogm-imagine-nebula-3a`).
