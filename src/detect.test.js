// @ts-check
import { describe, expect, it } from "vitest";
import { findStars, mergeStars } from "./detect.js";

/**
 * An RGBA image from a per-pixel colour function.
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => [number, number, number]} rgb 0–255 per channel
 */
function image(w, h, rgb) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return data;
}

/** A round spot of `sigma` pixels at (cx, cy): 0–1 at each pixel. */
const spot = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ sigma) =>
  (/** @type {number} */ x, /** @type {number} */ y) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));

/** @param {number} v */
const grey = (v) => /** @type {[number, number, number]} */ ([v, v, v]);

describe("findStars", () => {
  it("finds a small star at its position, in 0–1 image coordinates from the top-left", () => {
    const s = spot(20, 30, 1);
    const stars = findStars(image(64, 48, (x, y) => grey(10 + 230 * s(x, y))), 64, 48);
    expect(stars).toHaveLength(1);
    expect(stars[0].u).toBeCloseTo(20.5 / 64, 3);
    expect(stars[0].v).toBeCloseTo(30.5 / 48, 3);
  });

  it("ignores a large soft glow, like a nebula's core", () => {
    const s = spot(32, 24, 12);
    expect(findStars(image(64, 48, (x, y) => grey(10 + 230 * s(x, y))), 64, 48)).toHaveLength(0);
  });

  it("ignores a flat bright area", () => {
    expect(findStars(image(64, 48, () => grey(200)), 64, 48)).toHaveLength(0);
  });

  it("finds a star in front of bright gas", () => {
    const s = spot(30, 20, 1);
    const stars = findStars(image(64, 48, (x, y) => grey(120 + 110 * s(x, y))), 64, 48);
    expect(stars).toHaveLength(1);
  });

  it("ignores a bright point on the edge of a cloud (bright on one side, dark on the other)", () => {
    const s = spot(32, 24, 1);
    const px = image(64, 48, (x, y) => grey((x >= 32 ? 150 : 10) + 100 * s(x, y)));
    expect(findStars(px, 64, 48)).toHaveLength(0);
  });

  it("can allow an uneven ring, for big stars whose wider ring crosses the gas around them", () => {
    const s = spot(32, 24, 1);
    const px = image(64, 48, (x, y) => grey((x >= 32 ? 100 : 10) + 150 * s(x, y)));
    expect(findStars(px, 64, 48)).toHaveLength(0);
    expect(findStars(px, 64, 48, { spread: 0.6 })).toHaveLength(1);
  });

  it("still finds a star with cross-shaped spikes", () => {
    const s = spot(30, 24, 1);
    /** Thin spikes along the row and column through the star, fading over 8 pixels. */
    const spikes = (/** @type {number} */ x, /** @type {number} */ y) =>
      Math.exp(-((y - 24) ** 2) / 0.5) * Math.exp(-Math.abs(x - 30) / 8) + Math.exp(-((x - 30) ** 2) / 0.5) * Math.exp(-Math.abs(y - 24) / 8);
    // Kept below white: a clipped star would be a flat plus-shaped plateau, not this test's point.
    const px = image(64, 48, (x, y) => grey(10 + 150 * s(x, y) + 40 * spikes(x, y)));
    const stars = findStars(px, 64, 48);
    expect(stars).toHaveLength(1);
    expect(stars[0].u).toBeCloseTo(30.5 / 64, 3);
  });

  it("reports one star for a flat-topped spot", () => {
    const stars = findStars(image(64, 48, (x, y) => grey(x >= 20 && x <= 21 && y >= 20 && y <= 21 ? 240 : 10)), 64, 48);
    expect(stars).toHaveLength(1);
  });

  it("lists the most prominent stars first and keeps at most `max`", () => {
    const a = spot(12, 12, 1);
    const b = spot(32, 30, 1);
    const c = spot(50, 16, 1);
    const px = image(64, 48, (x, y) => grey(10 + 100 * a(x, y) + 220 * b(x, y) + 160 * c(x, y)));
    const stars = findStars(px, 64, 48, { max: 2 });
    expect(stars).toHaveLength(2);
    expect(stars[0].u).toBeCloseTo(32.5 / 64, 3);
    expect(stars[1].u).toBeCloseTo(50.5 / 64, 3);
    expect(stars[0].strength).toBeGreaterThan(stars[1].strength);
  });

  it("records each star's colour, 0–1", () => {
    const s = spot(20, 20, 1);
    const [star] = findStars(image(64, 48, (x, y) => {
      const k = s(x, y);
      return [10 + 245 * k, 10 + 140 * k, 10 + 50 * k];
    }), 64, 48);
    expect(star.r).toBeGreaterThan(star.g);
    expect(star.g).toBeGreaterThan(star.b);
    expect(star.r).toBeLessThanOrEqual(1);
  });
});

describe("mergeStars", () => {
  /** @param {number} u @param {number} v @param {number} strength */
  const star = (u, v, strength) => ({ u, v, strength, r: 1, g: 1, b: 1 });

  it("keeps every big star, marked big, ahead of the small ones", () => {
    const merged = mergeStars([star(0.5, 0.5, 0.3)], [star(0.1, 0.1, 0.9)], 0.01);
    expect(merged.map((s) => [s.u, s.big])).toEqual([[0.5, true], [0.1, false]]);
  });

  it("drops small detections sitting on a big star", () => {
    const merged = mergeStars([star(0.5, 0.5, 0.3)], [star(0.505, 0.5, 0.9), star(0.2, 0.2, 0.5)], 0.01);
    expect(merged.map((s) => s.u)).toEqual([0.5, 0.2]);
  });

  it("measures the distance in square units, so wide images don't stretch it", () => {
    // 0.007 across a 2:1 image is 0.014 of its height: outside 0.01, though 0.007 alone is inside.
    const merged = mergeStars([star(0.5, 0.5, 0.3)], [star(0.507, 0.5, 0.9)], 0.01, 2);
    expect(merged).toHaveLength(2);
  });

  it("keeps at most `max`, big stars first", () => {
    const merged = mergeStars([star(0.5, 0.5, 0.3)], [star(0.1, 0.1, 0.9), star(0.2, 0.2, 0.5)], 0.01, 1, 2);
    expect(merged.map((s) => s.u)).toEqual([0.5, 0.1]);
  });
});
