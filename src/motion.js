// @ts-check
/**
 * Audio-driven clocks and envelopes for the starfield. The shader never multiplies time by a live
 * audio level (a jump in the level would jerk everything backwards); instead these accumulate a
 * rate each frame, so louder passages speed things up and quiet ones slow them, always moving
 * forward. Also here: the kick envelope (bass hits only), the beat flare, and a beat clock locked
 * to the detected tempo so stars can twinkle in time.
 */

/** The beat counter wraps here so `u_beats` stays small enough for the shader's float hash. */
export const BEAT_WRAP = 997;

/** bassAtt / midAtt above this count as this: sharp hits read 4–6 and would lurch the view. */
export const LEVEL_CAP = 3;

/** Star layers flown per second: a floor so silence still drifts, plus a share per unit bass. */
export const TRAVEL_BASE = 0.04;
export const TRAVEL_PER_BASS = 0.06;

/** Nebula clock per second: a floor plus a share per unit mids. */
export const DRIFT_BASE = 0.35;
export const DRIFT_PER_MID = 0.5;

/** Motion multiplier under macOS "Reduce motion". */
export const REDUCED = 0.3;

/** Flare envelope decay rate, per second. */
export const FLARE_DECAY = 5;

/** A kick this far above the threshold (in units of average bass) pulses at full strength. */
export const KICK_RANGE = 1.5;
/** After a kick, the bass must fall below this share of the threshold before the next one counts. */
export const KICK_REARM = 0.85;

/** Beats per second of the beat clock before the analysis is confident of a tempo (120 BPM). */
export const FREE_BEATS_PER_S = 2;

/**
 * Intensity: loudness now against the song's recent level (LONG_S). "Now" rises fast
 * (SHORT_ATTACK_S), so an entrance registers at once, and falls slower (SHORT_RELEASE_S).
 */
export const SHORT_ATTACK_S = 0.08;
export const SHORT_RELEASE_S = 0.4;
export const LONG_S = 20;

/** Flowing pulse: how fast it follows the bass up (down is the Pulse decay). */
export const FOLLOW_ATTACK_S = 0.03;
/** Groove: how steadily the tempo tracker has held a beat, averaged over about this long. */
export const GROOVE_S = 1.5;
/** This many dB above the recent level reads 1, as many below reads 0. */
export const RANGE_DB = 10;
/** Below FLOOR_LO_DB (dBFS) intensity is 0 whatever the song has been doing; above FLOOR_HI_DB, no effect. */
export const FLOOR_LO_DB = -50;
export const FLOOR_HI_DB = -35;

/** @param {number} ms mean square */
const db = (ms) => 10 * Math.log10(ms + 1e-12);
/** @param {number} lo @param {number} hi @param {number} x */
const smoothstep = (lo, hi, x) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * @typedef {{ rms: number, silent?: boolean, bass: number, bassAtt: number, midAtt: number,
 *   onset: boolean, onsetStrength: number, bpm: number, beatPhase: number }} MotionAudio
 * @typedef {{
 *   kickThreshold: number, // instant bass level (1 = its recent average) that counts as a kick
 *   pulseDecay: number,    // seconds for a kick pulse to fall to about a third
 *   flaresOn: "all beats" | "kicks",
 *   twinkleSpeed: number,  // free-running twinkle clock rate
 *   style: "auto" | "beats" | "flowing", // pulse on kicks, follow the bass, or blend by groove
 * }} Timing
 */

/** @type {Timing} */
export const DEFAULT_TIMING = { kickThreshold: 1.5, pulseDecay: 0.25, flaresOn: "all beats", twinkleSpeed: 1, style: "auto" };

/** @param {number} x */
const level = (x) => (x > LEVEL_CAP ? LEVEL_CAP : x > 0 ? x : 0);

export function createMotion() {
  let armed = true;
  let locked = false;
  let wholeBeats = 0;
  let lastPhase = 0;
  let shortMs = -1; // -1 until the first frame: both averages start at the first level heard
  let longMs = 0;
  let longFrames = 0;

  const motion = {
    /** Distance flown, in star layers (the shader takes its fractional part per layer). */
    travel: 0,
    /** Nebula clock. */
    drift: 0,
    /** Flare triggers seen (onsets or kicks, per `flaresOn`), modulo {@link BEAT_WRAP}. */
    beats: 0,
    /** Beat flare envelope, 0–1: jumps on a trigger, then decays. */
    flare: 0,
    /** Kick pulse envelope, 0–1: jumps when the bass hits, then decays over `pulseDecay`. */
    kick: 0,
    /** Kicks seen. */
    kicks: 0,
    /** Bass above its usual level, followed continuously: fast up, down over `pulseDecay`. */
    follow: 0,
    /**
     * How steadily the music has a beat, 0–1: the share of the last ~GROOVE_S seconds the tempo
     * tracker held a tempo (style auto), or fixed at 1 (beats) or 0 (flowing).
     */
    groove: 0,
    /** What the core pulses with: the kick envelope in time with a groove, the bass follower without. */
    pulse: 0,
    /** Beats elapsed, locked to the analysis' beat phase once it has a tempo; never decreases. */
    beatTime: 0,
    /** Free-running twinkle clock. */
    twinkle: 0,
    /**
     * How intense the music is compared with the song's last ~20 s: 0.5 at its usual level, 1 at
     * +RANGE_DB, 0 at −RANGE_DB, and 0 near silence. Uses the raw rms, so it's the same at any
     * overall volume.
     */
    intensity: 0.5,

    /**
     * @param {MotionAudio} audio
     * @param {number} dt seconds since the previous frame
     * @param {number} speed the Speed param
     * @param {boolean} reduceMotion
     * @param {Partial<Timing>} [timing]
     */
    step(audio, dt, speed, reduceMotion, timing = {}) {
      // Read fields rather than merging objects: this runs every frame and must not allocate.
      const threshold = timing.kickThreshold ?? DEFAULT_TIMING.kickThreshold;
      const pulseDecay = timing.pulseDecay ?? DEFAULT_TIMING.pulseDecay;
      const flaresOn = timing.flaresOn ?? DEFAULT_TIMING.flaresOn;
      const s = speed * (reduceMotion ? REDUCED : 1);
      motion.travel += dt * s * (TRAVEL_BASE + TRAVEL_PER_BASS * level(audio.bassAtt));
      motion.drift += dt * s * (DRIFT_BASE + DRIFT_PER_MID * level(audio.midAtt));
      motion.twinkle += dt * (timing.twinkleSpeed ?? DEFAULT_TIMING.twinkleSpeed);

      // Intensity: short-term loudness against the recent level, in dB. The recent level is a
      // running mean until it would move slower than its 20 s average (no start-up bias), and it
      // holds through silence so a pause doesn't make the next note read as a huge jump.
      const ms = audio.rms * audio.rms;
      if (shortMs < 0) {
        shortMs = ms;
        longMs = ms;
      }
      shortMs += (ms - shortMs) * (1 - Math.exp(-dt / (ms > shortMs ? SHORT_ATTACK_S : SHORT_RELEASE_S)));
      if (!audio.silent) {
        longFrames++;
        longMs += (ms - longMs) * Math.max(1 / longFrames, 1 - Math.exp(-dt / LONG_S));
      }
      const now = db(shortMs);
      const relative = Math.min(1, Math.max(0, 0.5 + (now - db(longMs)) / (2 * RANGE_DB)));
      motion.intensity = relative * smoothstep(FLOOR_LO_DB, FLOOR_HI_DB, now);

      // Kick: the instant bass level crossing the threshold, once per hit (re-armed when it falls
      // back), so hats and snares that trip the onset detector don't pulse the core.
      motion.kick *= Math.exp(-dt / Math.max(pulseDecay, 1e-3));
      let kickHit = 0;
      if (armed && audio.bass > threshold) {
        armed = false;
        kickHit = 0.6 + 0.4 * Math.min(1, (audio.bass - threshold) / KICK_RANGE);
        motion.kick = Math.max(motion.kick, kickHit);
        motion.kicks++;
      } else if (audio.bass < threshold * KICK_REARM) {
        armed = true;
      }

      // Flowing: follow the bass above its usual level, so a slow swell (timpani, basses) swells
      // the core from its start instead of popping once the kick threshold is finally crossed.
      const above = Math.min(1, Math.max(0, (audio.bass - 1) / KICK_RANGE));
      const tau = above > motion.follow ? FOLLOW_ATTACK_S : Math.max(pulseDecay, 1e-3);
      motion.follow += (above - motion.follow) * (1 - Math.exp(-dt / tau));

      // Groove decides the mix: kicks for music with a steady beat, following for music without.
      const style = timing.style ?? DEFAULT_TIMING.style;
      if (style === "beats") motion.groove = 1;
      else if (style === "flowing") motion.groove = 0;
      else motion.groove += ((audio.bpm > 0 ? 1 : 0) - motion.groove) * (1 - Math.exp(-dt / GROOVE_S));
      motion.pulse = motion.groove * motion.kick + (1 - motion.groove) * motion.follow;

      // Exact exponential decay, so 60 Hz and 120 Hz displays flare alike.
      motion.flare *= Math.exp(-dt * FLARE_DECAY);
      // Flares on kicks only while the music has a groove: without one, a "kick" is the bass slowly
      // crossing the threshold, late in the note, so onsets (which catch attacks sooner) take over.
      const onKicks = flaresOn === "kicks" && motion.groove >= 0.5;
      const trigger = onKicks ? kickHit : audio.onset ? Math.min(1, 0.5 + audio.onsetStrength) : 0;
      if (trigger > 0) {
        motion.beats = (motion.beats + 1) % BEAT_WRAP;
        motion.flare = Math.max(motion.flare, trigger);
      }

      // Beat clock: whole beats counted from the phase wrapping, plus the phase. When the tempo
      // first locks in, pick up at the next beat boundary rather than jump back.
      if (audio.bpm > 0) {
        const phase = audio.beatPhase;
        if (!locked) {
          locked = true;
          wholeBeats = Math.floor(motion.beatTime);
          if (wholeBeats + phase < motion.beatTime) wholeBeats++;
        } else if (phase < lastPhase - 0.5) {
          wholeBeats++;
        }
        lastPhase = phase;
        motion.beatTime = Math.max(motion.beatTime, wholeBeats + phase);
      } else {
        locked = false;
        motion.beatTime += dt * FREE_BEATS_PER_S;
      }
    },
  };
  return motion;
}
