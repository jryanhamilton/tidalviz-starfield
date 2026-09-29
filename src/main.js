// @ts-check
/** Starfield — fly through procedural stars over a procedural nebula. `webgl2` renderer. */
import { createStarfield } from "./viz.js";

/** @type {import('../tidalviz').CreateVisualizer} */
export default function create(ctx) {
  return createStarfield(ctx, { fragment: "src/scene.frag" });
}
