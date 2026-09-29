// @ts-check
/**
 * Shared GL glue for both Starfield visualizers. The picture is one full-screen fragment shader;
 * the image version adds an instanced pass of glow sprites on the stars found in the picture
 * (./detect.js). This accumulates the audio-driven clocks (./motion.js) and uploads them and the
 * params as uniforms. Uniforms a shader doesn't declare resolve to null, and setting a null
 * location is a no-op, so every program shares one list. frame() allocates nothing.
 */
import { findStars, mergeStars } from "./detect.js";
import { createFlashLimiter } from "./flash.js";
import { resolveIncludes } from "./include.js";
import { createMotion, DEFAULT_TIMING } from "./motion.js";

// A single triangle that covers the screen, generated from gl_VertexID (no buffers needed).
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const UNIFORMS = /** @type {const} */ ([
  "u_resolution", "u_time", "u_travel", "u_drift", "u_beats", "u_flare", "u_bass", "u_mid",
  "u_treb", "u_bands", "u_density", "u_shimmer", "u_flares", "u_nebula", "u_size", "u_core",
  "u_gas", "u_rim", "u_image", "u_imageSize", "u_zoom", "u_fill", "u_pulse", "u_coreUv", "u_corePulse",
  "u_beatTime", "u_twinkleClock", "u_twinkle", "u_twinkleSync", "u_intensity", "u_dynamics",
  "u_prepass",
]);

/** @typedef {Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>} Locations */

/** Used for the stars' treble tint when the visualizer has no Core light param. */
const DEFAULT_CORE = "#64c8ff";

/** Star detection: the fine pass works on a copy this wide; the coarse pass (big stars) on a quarter of that. */
const DETECT_WIDTH = 1720;
/** Floats per star in the instance buffer: u, v, strength, big, r, g, b. */
const STAR_FLOATS = 7;

/**
 * @param {import('../tidalviz').VisualizerContext} ctx
 * @param {{ fragment: string, image?: string, sprites?: { vertex: string, fragment: string },
 *   prepass?: { fragment: string, scale: number } }} opts the picture's fragment shader;
 *   optionally a backdrop image, sprite shaders to light up the stars found in it, and a shader
 *   drawn first at `scale` × the screen size into a texture the picture reads as `u_prepass`
 *   (for soft, costly layers). All repo-relative.
 * @returns {Promise<import('../tidalviz').Visualizer>}
 */
export async function createStarfield(ctx, { fragment, image, sprites, prepass }) {
  const gl = /** @type {WebGL2RenderingContext} */ (ctx.gl);
  /** @param {string} path */
  const shader = async (path) => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return resolveIncludes(await ctx.assets.text(path), (name) => ctx.assets.text(dir + name));
  };
  const program = link(gl, VERTEX, "vertex shader", await shader(fragment), fragment);
  const u = locate(gl, program);
  const vao = gl.createVertexArray();
  /** @type {{ program: WebGLProgram, u: Locations, target: ReturnType<typeof createTarget>, scale: number } | null} */
  let pre = null;
  if (prepass) {
    const pp = link(gl, VERTEX, "vertex shader", await shader(prepass.fragment), prepass.fragment);
    pre = { program: pp, u: locate(gl, pp), target: createTarget(gl), scale: prepass.scale };
  }

  /** @type {WebGLTexture | null} */
  let texture = null;
  let imageW = 0;
  let imageH = 0;
  /** @type {{ program: WebGLProgram, u: Locations, vao: WebGLVertexArrayObject, buffer: WebGLBuffer, count: number } | null} */
  let starPass = null;
  if (image) {
    let bitmap;
    try {
      bitmap = await ctx.assets.image(image);
    } catch {
      throw new Error(
        `No backdrop image: put a picture at ${image} inside the plugin folder. The plugin's README ` +
          `("Credits and pictures") says where to download it.`,
      );
    }
    texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // ImageBitmaps upload top row first whatever UNPACK_FLIP_Y says; the shader expects that.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    imageW = bitmap.width;
    imageH = bitmap.height;
    if (sprites) {
      const vs = await shader(sprites.vertex);
      const sp = link(gl, vs, sprites.vertex, await shader(sprites.fragment), sprites.fragment);
      starPass = { program: sp, u: locate(gl, sp), ...uploadStars(gl, sp, detectStars(bitmap)) };
    }
    bitmap.close();
  }

  const core = new Float32Array(3);
  const gas = new Float32Array(3);
  const rim = new Float32Array(3);
  const motion = createMotion();
  const flash = createFlashLimiter();
  const pulseFlash = createFlashLimiter();
  let flare = 0;
  let corePulse = 0;
  /** @type {import('./motion.js').Timing} */
  const timing = { ...DEFAULT_TIMING };

  function readParams() {
    const p = ctx.params;
    hexToRgb(p.core ?? DEFAULT_CORE, core);
    hexToRgb(p.gas, gas);
    hexToRgb(p.rim, rim);
    timing.kickThreshold = Number(p.kickThreshold ?? DEFAULT_TIMING.kickThreshold);
    timing.pulseDecay = Number(p.pulseDecay ?? DEFAULT_TIMING.pulseDecay);
    timing.flaresOn = p.flaresOn === "kicks" ? "kicks" : "all beats";
    timing.twinkleSpeed = Number(p.twinkleSpeed ?? DEFAULT_TIMING.twinkleSpeed);
    timing.style = p.response === "beats" || p.response === "flowing" ? p.response : "auto";
  }
  readParams();

  /**
   * @param {Locations} u
   * @param {import('../tidalviz').AudioFrame} audio
   * @param {import('../tidalviz').FrameTime} time
   */
  function setUniforms(u, audio, time) {
    const p = ctx.params;
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.u_image, 0);
      gl.uniform2f(u.u_imageSize, imageW, imageH);
    }
    gl.uniform2f(u.u_resolution, ctx.size.width, ctx.size.height);
    gl.uniform1f(u.u_time, time.now);
    gl.uniform1f(u.u_travel, motion.travel);
    gl.uniform1f(u.u_drift, motion.drift);
    gl.uniform1f(u.u_beats, motion.beats);
    gl.uniform1f(u.u_flare, flare);
    gl.uniform1f(u.u_bass, audio.bassAtt);
    gl.uniform1f(u.u_mid, audio.midAtt);
    gl.uniform1f(u.u_treb, audio.trebAtt);
    gl.uniform1fv(u.u_bands, audio.bands); // zero-copy: the typed array goes straight to GL
    gl.uniform1f(u.u_density, Number(p.density ?? 0));
    gl.uniform1f(u.u_shimmer, Number(p.shimmer));
    gl.uniform1f(u.u_flares, Number(p.flares));
    gl.uniform1f(u.u_nebula, Number(p.nebula));
    gl.uniform1f(u.u_size, Number(p.size ?? 1));
    gl.uniform1f(u.u_zoom, Number(p.zoom ?? 1));
    gl.uniform1f(u.u_fill, p.fit === "fill screen" ? 1 : 0);
    gl.uniform1f(u.u_pulse, Number(p.pulse ?? 1));
    gl.uniform2f(u.u_coreUv, Number(p.coreX ?? 0.5), Number(p.coreY ?? 0.5));
    gl.uniform1f(u.u_corePulse, corePulse);
    gl.uniform1f(u.u_beatTime, motion.beatTime);
    gl.uniform1f(u.u_twinkleClock, motion.twinkle);
    gl.uniform1f(u.u_twinkle, Number(p.twinkle ?? 0.5));
    // Twinkle on the beat grid: always (tempo), never (free), or as much as the music grooves (auto).
    gl.uniform1f(u.u_twinkleSync, p.twinkleSync === "tempo" ? 1 : p.twinkleSync === "free" ? 0 : motion.groove);
    gl.uniform1f(u.u_intensity, motion.intensity);
    gl.uniform1f(u.u_dynamics, Number(p.dynamics ?? 0));
    gl.uniform3fv(u.u_core, core);
    gl.uniform3fv(u.u_gas, gas);
    gl.uniform3fv(u.u_rim, rim);
  }

  return {
    frame(audio, time) {
      motion.step(audio, time.dt, Number(ctx.params.speed), ctx.reduceMotion, timing);
      // Flaring stars and the kick-pulsed core brighten a good part of the screen together, so
      // both go through a limiter: at most 3 new rises a second when "Reduce flashing" is on.
      flare = flash.step(motion.flare, time.dt, ctx.reduceFlashing);
      corePulse = pulseFlash.step(motion.pulse, time.dt, ctx.reduceFlashing);

      gl.bindVertexArray(vao);
      if (pre) {
        // The pre-pass at its own (smaller) size; the target only reallocates when that changes.
        const t = pre.target;
        const w = Math.max(1, Math.round(ctx.size.width * pre.scale));
        const h = Math.max(1, Math.round(ctx.size.height * pre.scale));
        if (t.width !== w || t.height !== h) t.resize(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(pre.program);
        setUniforms(pre.u, audio, time);
        gl.uniform2f(pre.u.u_resolution, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.viewport(0, 0, ctx.size.width, ctx.size.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      setUniforms(u, audio, time);
      if (pre) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pre.target.tex);
        gl.uniform1i(u.u_prepass, 1);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (starPass) {
        const count = Math.min(starPass.count, Math.max(0, Math.round(Number(ctx.params.stars ?? starPass.count))));
        gl.useProgram(starPass.program);
        gl.bindVertexArray(starPass.vao);
        setUniforms(starPass.u, audio, time);
        // Screen blend of premultiplied light: result = src + dst × (1 − src).
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        gl.disable(gl.BLEND);
      }
    },

    params() {
      readParams();
    },

    dispose() {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      if (texture) gl.deleteTexture(texture);
      if (pre) {
        gl.deleteProgram(pre.program);
        pre.target.dispose();
      }
      if (starPass) {
        gl.deleteProgram(starPass.program);
        gl.deleteVertexArray(starPass.vao);
        gl.deleteBuffer(starPass.buffer);
      }
    },
  };
}

/**
 * Find the painted stars: small ones on a DETECT_WIDTH copy, big glowing ones on a quarter-size
 * copy, where they shrink to points.
 * @param {ImageBitmap} bitmap
 */
function detectStars(bitmap) {
  /** @param {number} width */
  const pixels = (width) => {
    const w = Math.min(width, bitmap.width);
    const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
    g.drawImage(bitmap, 0, 0, w, h);
    return { data: g.getImageData(0, 0, w, h).data, w, h };
  };
  const fine = pixels(DETECT_WIDTH);
  const coarse = pixels(Math.round(DETECT_WIDTH / 4));
  // The coarse ring reaches 4× further, across more of the surrounding gas: allow it more unevenness.
  const big = findStars(coarse.data, coarse.w, coarse.h, { max: 60, radius: 6, threshold: 0.12, spread: 0.6 });
  const small = findStars(fine.data, fine.w, fine.h, { max: 400 });
  return mergeStars(big, small, 0.02, bitmap.width / bitmap.height, 400);
}

/**
 * A colour texture + framebuffer for an offscreen pass: RGBA16F when the GPU can render to it,
 * else RGBA8 (fine for the nebula, which is stored tone-mapped, 0–1).
 * @param {WebGL2RenderingContext} gl
 */
function createTarget(gl) {
  const float = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const tex = /** @type {WebGLTexture} */ (gl.createTexture());
  const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of /** @type {const} */ ([
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ])) {
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  return {
    tex,
    fbo,
    width: 0,
    height: 0,
    /** (Re)allocate storage. @param {number} w @param {number} h */
    resize(w, h) {
      this.width = w;
      this.height = h;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
    },
  };
}

/**
 * Upload the stars as per-instance attributes for the sprite program.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {ReturnType<typeof mergeStars>} stars
 */
function uploadStars(gl, program, stars) {
  const data = new Float32Array(stars.length * STAR_FLOATS);
  stars.forEach((s, i) => data.set([s.u, s.v, s.strength, s.big ? 1 : 0, s.r, s.g, s.b], i * STAR_FLOATS));
  const vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
  const buffer = /** @type {WebGLBuffer} */ (gl.createBuffer());
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = STAR_FLOATS * 4;
  for (const [name, size, offset] of /** @type {const} */ ([["a_star", 4, 0], ["a_color", 3, 16]])) {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  return { vao, buffer, count: stars.length };
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @returns {Locations}
 */
function locate(gl, program) {
  /** @type {Locations} */
  const u = /** @type {any} */ ({});
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
  return u;
}

/**
 * `#rrggbb` → 0–1 floats in `out`.
 * @param {unknown} hex
 * @param {Float32Array} out
 */
function hexToRgb(hex, out) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
}

/**
 * Compile and link, throwing the GLSL log so it shows in the dev overlay.
 * @param {WebGL2RenderingContext} gl
 * @param {string} vs
 * @param {string} vsName shown in errors
 * @param {string} fs
 * @param {string} fsName shown in errors
 */
function link(gl, vs, vsName, fs, fsName) {
  const program = /** @type {WebGLProgram} */ (gl.createProgram());
  for (const [type, src, name] of /** @type {const} */ ([
    [gl.VERTEX_SHADER, vs, vsName],
    [gl.FRAGMENT_SHADER, fs, fsName],
  ])) {
    const shader = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`${name}: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
