// @ts-check
/**
 * A minimal `#include "file"` for GLSL, which has none: each whole-line include is replaced by the
 * file's text, wrapped in `#line` directives so compile errors in the including file still report
 * its own line numbers (the included files become source strings 1, 2, …). One level only.
 */

const INCLUDE = /^#include "([^"]+)"\s*$/;

/**
 * @param {string} src
 * @param {(name: string) => Promise<string>} load
 * @returns {Promise<string>}
 */
export async function resolveIncludes(src, load) {
  const lines = src.split("\n");
  /** @type {string[]} */
  const out = [];
  let included = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = INCLUDE.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    let text;
    try {
      text = await load(m[1]);
    } catch (e) {
      throw new Error(`#include "${m[1]}": ${e instanceof Error ? e.message : String(e)}`);
    }
    included++;
    out.push(`#line 1 ${included}`, text, `#line ${i + 2} 0`);
  }
  return out.join("\n");
}
