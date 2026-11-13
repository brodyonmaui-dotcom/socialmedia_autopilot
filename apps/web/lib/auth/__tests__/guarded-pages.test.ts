import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const appDir = join(webRoot, "app");
// The login flow is the only unauthenticated surface.
const ALLOW = new Set(["app/login/actions.ts", "app/login/page.tsx"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("every DB page/action requires a session", () => {
  const files = walk(appDir)
    .filter((f) => /(^|\/)(page\.tsx|actions\.ts)$/.test(f))
    .map((f) => relative(webRoot, f));

  it("finds the existing pages", () => {
    expect(files).toContain("app/library/page.tsx");
    expect(files).toContain("app/research/actions.ts");
  });

  for (const f of files) {
    it(f, () => {
      const src = readFileSync(join(webRoot, f), "utf8");
      if (!src.includes("getPool") || ALLOW.has(f)) return;
      expect(src).toContain("requireSession()");
      if (f.endsWith("actions.ts")) {
        // each exported action calls it
        const actions = src.split(/export async function /).slice(1);
        for (const a of actions) expect(a, a.slice(0, 40)).toContain("await requireSession()");
      }
    });
  }
});
