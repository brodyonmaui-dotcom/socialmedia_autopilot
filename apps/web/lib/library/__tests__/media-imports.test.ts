import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The web bundle must never pull in @autopilot/media's ffmpeg side (exec.ts/probe.ts use node:child_process
 * and node:fs). Only these may be imported from the web app: the import-free `qa-types`, `reel-plan` and `edl` (Studio, F24), and
 * `storage` (the R2 client for sound uploads: aws-sdk + node:fs streams, no ffmpeg / child_process).
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP = new Set(["node_modules", "__tests__", "public"]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx|mts|js|mjs|jsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("web imports of @autopilot/media", () => {
  const files = sources(web);

  it("scans the web sources", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(join("lib", "library", "qa-issues.ts")))).toBe(true);
  });

  it("only via @autopilot/media/src/qa-types, reel-plan, edl or storage", () => {
    const bad: string[] = [];
    let ok = 0;
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](@autopilot\/media(?:\/[^"']*)?)["']/g)) {
        if (/^@autopilot\/media\/src\/(qa-types|reel-plan|edl|storage)(\.js|\.ts)?$/.test(m[1]!)) ok++;
        else bad.push(`${relative(web, f)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
    expect(ok).toBeGreaterThan(0);
  });

  it("the allowed reel-plan and storage files never reach for ffmpeg", () => {
    for (const f of ["reel-plan.ts", "edl.ts", "storage.ts"]) {
      const src = readFileSync(resolve(web, "../../packages/media/src", f), "utf8");
      expect(src).not.toMatch(/from\s+["'](node:)?child_process["']|from\s+["']\.\/(exec|probe|fix|qa|poster)\.js["']/);
    }
    for (const f of ["reel-plan.ts", "edl.ts"]) expect(readFileSync(resolve(web, "../../packages/media/src", f), "utf8")).not.toMatch(/^import /m);
  });
});
