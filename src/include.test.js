// @ts-check
import { describe, expect, it } from "vitest";
import { resolveIncludes } from "./include.js";

/** @param {Record<string, string>} files */
const loader = (files) => async (/** @type {string} */ name) => {
  if (!(name in files)) throw new Error(`404 ${name}`);
  return files[name];
};

describe("resolveIncludes", () => {
  it("leaves a source without includes unchanged", async () => {
    const src = "#version 300 es\nvoid main() {}\n";
    expect(await resolveIncludes(src, loader({}))).toBe(src);
  });

  it("splices the named file in, with #line directives so errors keep pointing at the right lines", async () => {
    const src = '#version 300 es\nprecision highp float;\n#include "common.glsl"\nvoid main() {}';
    const out = await resolveIncludes(src, loader({ "common.glsl": "float a;\nfloat b;" }));
    expect(out).toBe(
      "#version 300 es\nprecision highp float;\n#line 1 1\nfloat a;\nfloat b;\n#line 4 0\nvoid main() {}",
    );
  });

  it("only treats a whole #include line as an include", async () => {
    const src = '// see #include "x.glsl" below\nvoid main() {}';
    expect(await resolveIncludes(src, loader({}))).toBe(src);
  });

  it("numbers several includes as source strings 1, 2, …", async () => {
    const src = '#include "a"\n#include "b"';
    const out = await resolveIncludes(src, loader({ a: "A", b: "B" }));
    expect(out).toBe("#line 1 1\nA\n#line 2 0\n#line 1 2\nB\n#line 3 0");
  });

  it("names the missing file when an include can't be loaded", async () => {
    await expect(resolveIncludes('#include "gone.glsl"', loader({}))).rejects.toThrow(/gone\.glsl/);
  });
});
