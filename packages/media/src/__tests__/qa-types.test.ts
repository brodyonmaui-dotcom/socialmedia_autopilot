import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as fix from "../fix.js";
import * as types from "../qa-types.js";

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../qa-types.ts"), "utf8");

describe("qa-types.ts stays import-free (the web app deep-imports it)", () => {
  it("has no import / require / dynamic import", () => {
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/^\s*export\s[^;]*\bfrom\s*["']/m);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });

  it("fix.ts re-exports the same values", () => {
    expect(fix.FIX_OP_ORDER).toBe(types.FIX_OP_ORDER);
    expect(fix.OP_FOR_CODE).toBe(types.OP_FOR_CODE);
    expect(fix.OPT_IN_OPS).toBe(types.OPT_IN_OPS);
  });
});
