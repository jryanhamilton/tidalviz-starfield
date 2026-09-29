// @ts-check
import { describe, expect, it } from "vitest";
import { BEAT_WRAP, createMotion } from "./motion.js";

/**
 * A quiet frame: bass at its recent average, no onset, no tempo yet.
 * @param {Partial<import('./motion.js').MotionAudio>} a
 */
const audio = (a = {}) => ({
  rms: 0.1, bass: 1, bassAtt: 1, midAtt: 1, onset: false, onsetStrength: 0, bpm: 0, beatPhase: 0, ...a,
});

/** Step a fresh motion through `n` frames of `dt` with the same audio. */
function run(/** @type {number} */ n, /** @type {number} */ dt, a = audio(), speed = 1, reduce = false) {
  const m = createMotion();
  for (let i = 0; i < n; i++) m.step(a, dt, speed, reduce);
  return m;
}

describe("travel", () => {
  it("flies faster when the bass is heavier", () => {
    expect(run(60, 1 / 60, audio({ bassAtt: 2 })).travel).toBeGreaterThan(run(60, 1 / 60, audio({ bassAtt: 0.5 })).travel);
  });

  it("keeps drifting in silence (bassAtt 0)", () => {
    expect(run(60, 1 / 60, audio({ bassAtt: 0 })).travel).toBeGreaterThan(0);
  });

  it("covers the same distance at 60 Hz and 120 Hz", () => {
    expect(run(120, 1 / 120).travel).toBeCloseTo(run(60, 1 / 60).travel, 10);
  });

  it("scales with the speed param and stops at 0", () => {
    expect(run(60, 1 / 60, audio(), 2).travel).toBeCloseTo(2 * run(60, 1 / 60, audio(), 1).travel, 10);
    expect(run(60, 1 / 60, audio(), 0).travel).toBe(0);
  });

  it("is gentler with reduce motion", () => {
    expect(run(60, 1 / 60, audio(), 1, true).travel).toBeLessThan(0.5 * run(60, 1 / 60).travel);
  });

  it("caps a spiky bass so one hit can't lurch the view", () => {
    expect(run(1, 1 / 60, audio({ bassAtt: 10 })).travel).toBeCloseTo(run(1, 1 / 60, audio({ bassAtt: 3 })).travel, 10);
  });
});

describe("drift", () => {
  it("churns faster with busier mids and never runs backwards", () => {
    const calm = run(60, 1 / 60, audio({ midAtt: 0.2 })).drift;
    const busy = run(60, 1 / 60, audio({ midAtt: 2 })).drift;
    expect(busy).toBeGreaterThan(calm);
    expect(calm).toBeGreaterThan(0);
  });
});

describe("beats and flares", () => {
  it("counts each onset once", () => {
    const m = createMotion();
    m.step(audio({ onset: true, onsetStrength: 0.5 }), 1 / 60, 1, false);
    m.step(audio(), 1 / 60, 1, false);
    m.step(audio({ onset: true, onsetStrength: 0.5 }), 1 / 60, 1, false);
    expect(m.beats).toBe(2);
  });

  it("wraps the beat counter so the shader's hash keeps float precision", () => {
    const m = createMotion();
    for (let i = 0; i < BEAT_WRAP + 3; i++) m.step(audio({ onset: true }), 1 / 60, 1, false);
    expect(m.beats).toBe(3);
  });

  it("flares on an onset and decays the same at any frame rate", () => {
    const hit = audio({ onset: true, onsetStrength: 1 });
    const a = createMotion();
    const b = createMotion();
    a.step(hit, 1 / 60, 1, false);
    b.step(hit, 1 / 60, 1, false);
    expect(a.flare).toBe(1);
    for (let i = 0; i < 30; i++) a.step(audio(), 1 / 60, 1, false);
    for (let i = 0; i < 60; i++) b.step(audio(), 1 / 120, 1, false);
    expect(a.flare).toBeGreaterThan(0);
    expect(a.flare).toBeLessThan(0.2);
    expect(b.flare).toBeCloseTo(a.flare, 10);
  });

  it("flares harder on stronger onsets", () => {
    const soft = createMotion();
    soft.step(audio({ onset: true, onsetStrength: 0 }), 1 / 60, 1, false);
    expect(soft.flare).toBeGreaterThan(0.3);
    expect(soft.flare).toBeLessThan(1);
  });
});

describe("kick", () => {
  /**
   * Step a fresh motion through a list of bass levels, one 60 Hz frame each.
   * @param {number[]} levels
   * @param {Partial<import('./motion.js').Timing>} [timing]
   * @param {number} [dt]
   */
  function bassline(levels, timing = {}, dt = 1 / 60) {
    const m = createMotion();
    for (const bass of levels) m.step(audio({ bass }), dt, 1, false, timing);
    return m;
  }
  const hold = (/** @type {number} */ level, /** @type {number} */ n) => Array(n).fill(level);

  it("pulses when the bass jumps above the threshold", () => {
    expect(bassline([1, 2.5]).kick).toBeGreaterThan(0.5);
  });

  it("ignores onsets with no bass behind them (hats, snares)", () => {
    const m = createMotion();
    m.step(audio({ onset: true, onsetStrength: 1, bass: 1 }), 1 / 60, 1, false);
    expect(m.kick).toBe(0);
  });

  it("stays quiet below the threshold, which is adjustable", () => {
    expect(bassline([1, 1.8], { kickThreshold: 2 }).kick).toBe(0);
    expect(bassline([1, 1.8], { kickThreshold: 1.5 }).kick).toBeGreaterThan(0);
  });

  it("fires once per hit, however long the bass stays up", () => {
    const m = bassline([1, ...hold(2.5, 30)], { pulseDecay: 0.25 });
    expect(m.kicks).toBe(1);
    expect(m.kick).toBeLessThan(0.2);
  });

  it("re-arms once the bass falls back", () => {
    expect(bassline([1, 2.5, 2.5, 1, 1, 2.5]).kicks).toBe(2);
  });

  it("pulses harder on a harder hit", () => {
    expect(bassline([1, 3.5]).kick).toBeGreaterThan(bassline([1, 1.7]).kick);
  });

  it("lasts longer with a longer pulse decay", () => {
    const after = [1, 2.5, ...hold(1, 18)];
    expect(bassline(after, { pulseDecay: 0.5 }).kick).toBeGreaterThan(bassline(after, { pulseDecay: 0.1 }).kick);
  });

  it("decays the same at 60 Hz and 120 Hz", () => {
    const a = bassline([1, 2.5, ...hold(1, 30)]);
    const b = bassline([1, 2.5, ...hold(1, 60)], {}, 1 / 120);
    expect(b.kick).toBeCloseTo(a.kick, 10);
  });
});

describe("pulse and response style", () => {
  /**
   * A slow swell, like a timpani roll or the double basses: bass ramps 0.8 → 2.5 over 300 ms at
   * 60 Hz, then holds. Returns the motion after `ms` milliseconds of it.
   * @param {number} ms
   * @param {Partial<import('./motion.js').Timing>} timing
   */
  function swell(ms, timing) {
    const m = createMotion();
    for (let f = 0; f * (1000 / 60) <= ms; f++) {
      const t = (f * (1000 / 60)) / 300;
      m.step(audio({ bass: 0.8 + 1.7 * Math.min(1, t) }), 1 / 60, 1, false, timing);
    }
    return m;
  }

  it("beats: pulses only once the kick fires, partway into a slow swell", () => {
    expect(swell(100, { style: "beats" }).pulse).toBe(0);
    expect(swell(150, { style: "beats" }).pulse).toBeGreaterThan(0.5);
  });

  it("flowing: rises with a slow swell from its start, before a kick would fire", () => {
    expect(swell(100, { style: "flowing" }).pulse).toBeGreaterThan(0.1);
  });

  it("flowing: follows the bass up and down instead of firing once", () => {
    const m = swell(600, { style: "flowing" });
    expect(m.pulse).toBeGreaterThan(0.8);
    for (let i = 0; i < 30; i++) m.step(audio({ bass: 0.8 }), 1 / 60, 1, false, { style: "flowing", pulseDecay: 0.25 });
    expect(m.pulse).toBeLessThan(0.2);
  });

  it("auto: steady tempo reads as groove, and the pulse acts like beats", () => {
    const m = createMotion();
    for (let i = 0; i < 300; i++) m.step(audio({ bpm: 120, beatPhase: (i / 30) % 1 }), 1 / 60, 1, false);
    expect(m.groove).toBeGreaterThan(0.8);
    m.step(audio({ bpm: 120, bass: 2.5 }), 1 / 60, 1, false);
    expect(m.pulse).toBeCloseTo(m.kick, 1);
  });

  it("auto: with no tempo the groove fades within seconds, and the pulse flows", () => {
    const m = createMotion();
    for (let i = 0; i < 300; i++) m.step(audio({ bpm: 120, beatPhase: (i / 30) % 1 }), 1 / 60, 1, false);
    for (let i = 0; i < 300; i++) m.step(audio({ bpm: 0 }), 1 / 60, 1, false);
    expect(m.groove).toBeLessThan(0.2);
  });

  it("beats and flowing ignore the groove", () => {
    const beats = createMotion();
    beats.step(audio(), 1 / 60, 1, false, { style: "beats" });
    expect(beats.groove).toBe(1);
    const flowing = createMotion();
    flowing.step(audio({ bpm: 120 }), 1 / 60, 1, false, { style: "flowing" });
    expect(flowing.groove).toBe(0);
  });
});

describe("flares on kicks", () => {
  const kicks = { flaresOn: /** @type {const} */ ("kicks"), style: /** @type {const} */ ("beats") };

  it("fall back to onsets without a groove, where a kick would only fire late in a swell", () => {
    const m = createMotion();
    m.step(audio({ onset: true, onsetStrength: 1 }), 1 / 60, 1, false, { flaresOn: "kicks", style: "flowing" });
    expect(m.flare).toBeGreaterThan(0.5);
  });

  it("ignores onsets without a kick", () => {
    const m = createMotion();
    m.step(audio({ onset: true, onsetStrength: 1 }), 1 / 60, 1, false, kicks);
    expect(m.flare).toBe(0);
    expect(m.beats).toBe(0);
  });

  it("flares and counts a beat on each kick", () => {
    const m = createMotion();
    m.step(audio({ bass: 2.5 }), 1 / 60, 1, false, kicks);
    expect(m.flare).toBeGreaterThan(0.5);
    expect(m.beats).toBe(1);
  });
});

describe("beat clock", () => {
  /** @param {number[]} phases one 60 Hz frame each, at 120 BPM */
  function onTempo(phases, m = createMotion()) {
    for (const beatPhase of phases) m.step(audio({ bpm: 120, beatPhase }), 1 / 60, 1, false);
    return m;
  }

  it("follows the tempo's beat phase, counting whole beats", () => {
    const m = onTempo([0.2, 0.6, 0.9]);
    expect(m.beatTime).toBeCloseTo(0.9, 10);
    onTempo([0.1], m);
    expect(m.beatTime).toBeCloseTo(1.1, 10);
  });

  it("runs at 2 beats a second until there is a tempo", () => {
    expect(run(30, 1 / 60).beatTime).toBeCloseTo(1, 10);
  });

  it("never runs backwards: not when the tempo locks in, nor on a jittery phase", () => {
    const m = run(45, 1 / 60); // 1.5 beats, free-running
    onTempo([0.1], m);
    expect(m.beatTime).toBeGreaterThanOrEqual(1.5);
    const locked = m.beatTime;
    onTempo([0.3], m);
    expect(m.beatTime).toBeCloseTo(locked + 0.2, 10);
    onTempo([0.28], m);
    expect(m.beatTime).toBeCloseTo(locked + 0.2, 10);
  });
});

describe("intensity", () => {
  /**
   * Step through [rms, seconds] passages at 60 Hz (or `dt`), on one motion.
   * @param {[number, number][]} passages
   * @param {number} [dt]
   */
  function play(passages, dt = 1 / 60, m = createMotion()) {
    for (const [rms, seconds] of passages) {
      for (let i = 0; i < Math.round(seconds / dt); i++) m.step(audio({ rms }), dt, 1, false);
    }
    return m;
  }

  it("starts in the middle", () => {
    expect(play([[0.1, 1 / 60]]).intensity).toBeCloseTo(0.5, 10);
  });

  it("reads the middle for music at its usual level", () => {
    expect(play([[0.1, 10]]).intensity).toBeCloseTo(0.5, 5);
  });

  it("rises when the music gets louder than it has been", () => {
    expect(play([[0.05, 20], [0.2, 1]]).intensity).toBeGreaterThan(0.8);
  });

  it("catches a sudden entrance within about a tenth of a second", () => {
    // +6 dB reads 0.8 once settled; a 0.3 s symmetric smoother would still be near 0.63 here.
    expect(play([[0.03, 20], [0.06, 0.1]]).intensity).toBeGreaterThan(0.7);
  });

  it("falls in a quiet passage", () => {
    expect(play([[0.1, 20], [0.02, 2]]).intensity).toBeLessThan(0.2);
  });

  it("settles back to the middle over tens of seconds at a new level", () => {
    expect(play([[0.05, 20], [0.2, 60]]).intensity).toBeCloseTo(0.5, 1);
  });

  it("is the same at any overall volume (a quieter master, or the system volume)", () => {
    const loud = play([[0.1, 20], [0.2, 1]]).intensity;
    const soft = play([[0.025, 20], [0.05, 1]]).intensity;
    expect(soft).toBeCloseTo(loud, 6);
  });

  it("goes dark near silence, however quiet the song has been", () => {
    expect(play([[0.0005, 30]]).intensity).toBeLessThan(0.02);
  });

  it("follows the music the same at 60 Hz and 120 Hz", () => {
    const a = play([[0.05, 20], [0.2, 1]]).intensity;
    const b = play([[0.05, 20], [0.2, 1]], 1 / 120).intensity;
    expect(b).toBeCloseTo(a, 2);
  });
});

describe("twinkle clock", () => {
  it("runs at the twinkle speed, and stops at 0", () => {
    const m = createMotion();
    for (let i = 0; i < 60; i++) m.step(audio(), 1 / 60, 1, false, { twinkleSpeed: 2 });
    expect(m.twinkle).toBeCloseTo(2, 10);
    const still = createMotion();
    still.step(audio(), 1 / 60, 1, false, { twinkleSpeed: 0 });
    expect(still.twinkle).toBe(0);
  });
});
