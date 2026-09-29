// @ts-check
/**
 * Picture visualizers — a picture as the nebula: its bright core pulses with the music, and the
 * stars painted into it (found at load) shimmer, twinkle and flare in place. `webgl2` renderer.
 * Every manifest entry using this module loads local/<its id>.jpg, which is git-ignored: use your
 * own art without committing it. Add a picture by adding an entry with a new id.
 */
import { createStarfield } from "./viz.js";

/** @type {import('../tidalviz').CreateVisualizer} */
export default function create(ctx) {
  return createStarfield(ctx, {
    fragment: "src/image.frag",
    image: `local/${ctx.id}.jpg`,
    sprites: { vertex: "src/sprites.vert", fragment: "src/sprites.frag" },
  });
}
