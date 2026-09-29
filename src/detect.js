// @ts-check
/**
 * Find the stars painted into a picture, so the visualizer can light up the real ones.
 *
 * A star is a small point much brighter than its surroundings, and bright all the way round: a
 * pixel that beats the mean of the box around it by `threshold`, is the brightest within 2 pixels,
 * and whose ring about 3 pixels out is close to the background (ruling out soft glows and the
 * nebula's bright core, whose ring is nearly as bright as their centre) and even (ruling out
 * highlights on the edge of a cloud, bright on one side and dark on the other). The ring is sampled
 * between the horizontal, vertical and diagonal directions, so a star's own spikes don't count
 * against it. Runs once at load; allocates freely.
 */

/** @typedef {{ u: number, v: number, strength: number, r: number, g: number, b: number }} Star */

/** Offsets of the ring sampled about 3 pixels out, clear of the axes and diagonals (spikes). */
const RING = [
  [3, 1], [1, 3], [-1, 3], [-3, 1], [-3, -1], [-1, -3], [1, -3], [3, -1],
];

/** By default the ring may vary by at most this share of the star's contrast. */
const MAX_RING_SPREAD = 0.35;

/**
 * @param {Uint8ClampedArray} rgba image pixels, row by row from the top-left
 * @param {number} width
 * @param {number} height
 * @param {{ max?: number, radius?: number, threshold?: number, spread?: number }} [opts] at most
 *   `max` stars; background box radius in pixels; how far above the background (0–1 luminance) a
 *   star must be; how uneven its ring may be, as a share of its contrast
 * @returns {Star[]} strongest first; `u`, `v` are 0–1 from the top-left, colour is 0–1
 */
export function findStars(rgba, width, height, { max = 400, radius = 8, threshold = 0.08, spread = MAX_RING_SPREAD } = {}) {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2]) / 255;
  }

  // Summed-area table, so each background mean costs four lookups.
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sat[(y + 1) * w1 + x + 1] = lum[y * width + x] + sat[y * w1 + x + 1] + sat[(y + 1) * w1 + x] - sat[y * w1 + x];
    }
  }
  /** @param {number} x @param {number} y */
  const background = (x, y) => {
    const x0 = Math.max(0, x - radius);
    const y0 = Math.max(0, y - radius);
    const x1 = Math.min(width, x + radius + 1);
    const y1 = Math.min(height, y + radius + 1);
    const sum = sat[y1 * w1 + x1] - sat[y0 * w1 + x1] - sat[y1 * w1 + x0] + sat[y0 * w1 + x0];
    return sum / ((x1 - x0) * (y1 - y0));
  };

  /** @type {Star[]} */
  const stars = [];
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const l = lum[y * width + x];
      const bg = background(x, y);
      const contrast = l - bg;
      if (contrast < threshold || !isPeak(lum, width, x, y, l)) continue;

      let ring = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [dx, dy] of RING) {
        const n = lum[(y + dy) * width + x + dx];
        ring += n;
        lo = Math.min(lo, n);
        hi = Math.max(hi, n);
      }
      if (ring / RING.length - bg >= 0.5 * contrast || hi - lo > spread * contrast) continue;

      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * width + x + dx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      }
      stars.push({ u: (x + 0.5) / width, v: (y + 0.5) / height, strength: contrast, r: r / 2295, g: g / 2295, b: b / 2295 });
    }
  }
  stars.sort((a, b) => b.strength - a.strength);
  return stars.slice(0, max);
}

/**
 * Combine stars found at two scales: `big` from a smaller copy of the picture (where large, glowing
 * stars shrink to points) and `small` from a larger one. Big stars come first; small detections
 * within `radius` of a big star (the same star, or its spikes) are dropped.
 * @param {Star[]} big
 * @param {Star[]} small
 * @param {number} radius in units of the image's height
 * @param {number} [aspect=1] image width / height, so distances are measured in square units
 * @param {number} [max=Infinity]
 * @returns {(Star & { big: boolean })[]}
 */
export function mergeStars(big, small, radius, aspect = 1, max = Infinity) {
  const r2 = radius * radius;
  const clear = (/** @type {Star} */ s) => big.every((b) => ((s.u - b.u) * aspect) ** 2 + (s.v - b.v) ** 2 > r2);
  return [
    ...big.map((s) => ({ ...s, big: true })),
    ...small.filter(clear).map((s) => ({ ...s, big: false })),
  ].slice(0, max);
}

/**
 * The brightest pixel within 2 pixels. Ties go to the first in reading order, so a flat-topped
 * spot counts once.
 * @param {Float32Array} lum
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @param {number} l lum at (x, y)
 */
function isPeak(lum, width, x, y, l) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = lum[(y + dy) * width + x + dx];
      const earlier = dy < 0 || (dy === 0 && dx < 0);
      if (earlier ? n >= l : n > l) return false;
    }
  }
  return true;
}
