import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const authDir = resolve(here, "..");
const repo = resolve(authDir, "../../../..");
const authFiles = readdirSync(authDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(authDir, f));
const adminFile = join(repo, "packages/db/src/auth-admin.ts");
const cliFile = join(repo, "apps/worker/src/cli/auth.ts");

/** String and template literals in a source file. */
function literals(src: string): string[] {
  return [...src.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

describe("auth static checks", () => {
  it("has auth sources to check", () => {
    expect(authFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("no SQL string deletes anything", () => {
    for (const f of [...authFiles, adminFile]) {
      const hits = literals(readFileSync(f, "utf8")).filter((l) => /\bdelete\b/i.test(l));
      expect(hits, f).toEqual([]);
    }
  });

  it("only the worker CLI console.logs the plain enrol code", () => {
    for (const f of [...authFiles, adminFile]) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.log/);
    expect(readFileSync(cliFile, "utf8")).toMatch(/console\.log\(`Enrol code[^`]*\$\{code\}/);
  });
});
