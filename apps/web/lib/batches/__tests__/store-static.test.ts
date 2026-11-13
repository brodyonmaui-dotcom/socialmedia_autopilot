import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
/** Every string/template literal in the file (where the SQL lives). */
const literals = (src: string) => src.match(/`[^`]*`|"(?:[^"\\]|\\.)*"/g) ?? [];

describe("batch store SQL (static)", () => {
  for (const f of ["pg-store.ts", "context.ts"]) {
    it(`${f}: no DELETE in any SQL string`, () => {
      for (const s of literals(read(f))) expect(s).not.toMatch(/\bdelete\b/i);
    });
  }

  it("apply is one transaction with a conditional update", () => {
    const src = read("pg-store.ts");
    const body = src.slice(src.indexOf("async apply("), src.indexOf("async addItem("));
    expect(body).toContain('"begin"');
    expect(body).toContain('"commit"');
    expect(body).toContain('"rollback"');
    expect(body).toContain("and status = $");
    expect(body).toContain("release()");
    expect(body).toMatch(/rowCount !== 1\) throw new ConflictError/);
  });
});
