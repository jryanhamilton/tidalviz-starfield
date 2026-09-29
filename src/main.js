// @ts-check
/** Starfield — fly through procedural stars over a procedural nebula. `webgl2` renderer. */
import { createStarfield } from "./viz.js";

/** @type {import('../tidalviz').CreateVisualizer} */
export default function create(ctx) {
  // The nebula is soft and most of the cost: draw it at half resolution, the stars at full.
  return createStarfield(ctx, { fragment: "src/scene.frag", prepass: { fragment: "src/nebula.frag", scale: 0.5 } });
}
