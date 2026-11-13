import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (f: string) => readFileSync(join(here, "..", f), "utf8");
/** Every string/template literal in the file (where the SQL lives). */
const literals = (src: string) => src.match(/`[^`]*`|"(?:[^"\\]|\\.)*"/g) ?? [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("engagement queries (static)", () => {
  for (const f of ["queries.ts", "settings.ts"]) {
    it(`${f}: no DELETE / TRUNCATE in any SQL string`, () => {
      for (const s of literals(read(f))) expect(s).not.toMatch(/\b(delete|truncate)\b/i);
    });
  }

  it("promoteShadow is conditional on status = 'shadow'", () => {
    const src = read("queries.ts");
    const fn = src.slice(src.indexOf("export async function promoteShadow("));
    expect(fn).toMatch(/where id = \$1 and status = 'shadow' returning id/);
  });

  it("createManualAction relies on the unique (comment_id, kind) guard", () => {
    expect(read("queries.ts")).toMatch(/on conflict \(comment_id, kind\) do nothing/);
  });
});

describe("inbox UI never sends a DM or anything else on its own", () => {
  const inboxDir = join(here, "../../../app/inbox");
  // The only allowed mentions: the manual reply button + its action, and the exact live-mode warning text.
  const ALLOWED = ["Send this reply", "sendManualAction", "Live sending also needs DRY_RUN=false on the worker"];
  const files = walk(inboxDir).filter((f) => /\.(ts|tsx)$/.test(f));

  it("finds the inbox files", () => {
    expect(files.some((f) => f.endsWith("dms/page.tsx"))).toBe(true);
  });

  for (const f of files) {
    it(f.slice(inboxDir.length + 1), () => {
      let src = readFileSync(f, "utf8");
      for (const a of ALLOWED) src = src.split(a).join("");
      expect(src).not.toMatch(/send/i);
    });
  }

  it("the DM page has no form action other than copy", () => {
    const src = readFileSync(join(inboxDir, "dms/page.tsx"), "utf8");
    expect(src).not.toMatch(/sendManualAction/);
    expect(src).not.toMatch(/<form/);
  });
});
