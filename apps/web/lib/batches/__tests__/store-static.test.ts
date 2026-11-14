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

  it("F11: idempotency_key is never in any update … set clause or assigned anywhere; no delete from", () => {
    const src = read("pg-store.ts");
    const updates = src.match(/\bupdate\s+\w+\s+set\b[\s\S]*?\bwhere\b/gi) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(4); // apply's patch update, reset, record, alerts ack, batches
    for (const u of updates) expect(u).not.toMatch(/idempotency_key/i);
    // The patch loop builds its SET list from strings: no assignment to the key in any form either.
    expect(src).not.toMatch(/idempotency_key\s*=/i);
    expect(src).not.toMatch(/\bdelete\s+from\b/i);
    expect(src).not.toMatch(/\binsert\s+into\s+batch_items\b[\s\S]{0,200}idempotency_key/i);
  });

  it("F11: reset SQL is conditional on failed|unknown and no platform post id; record on failed|unknown", () => {
    const src = read("pg-store.ts");
    const body = src.slice(src.indexOf("Fable to review: F11"), src.indexOf("SET list built from the patch keys"));
    expect(body).toMatch(/set status = 'draft'[\s\S]*status in \('failed', 'unknown'\) and platform_post_id is null/);
    expect(body).toMatch(/set status = 'published'[\s\S]*status in \('failed', 'unknown'\)/);
    expect(body).toMatch(/update alerts set acknowledged_at[\s\S]*kind in \('final-failure', 'unknown-outcome'\) and acknowledged_at is null/);
    expect(body).toMatch(/rowCount !== 1\) throw new ConflictError/);
  });

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
