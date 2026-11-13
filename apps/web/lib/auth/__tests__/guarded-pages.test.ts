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
    return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : [p];
  });
}

/**
 * Exported async functions, each from `export async function name(` up to the next export. A signature
 * can't contain `await`, so the first `await` in a chunk is the first one in that function's body.
 */
function exportedAsyncFunctions(src: string): Array<{ name: string; body: string }> {
  return src
    .split(/export async function /)
    .slice(1)
    .map((chunk) => ({ name: /^(\w+)/.exec(chunk)?.[1] ?? "?", body: chunk.split(/\nexport /)[0]! }));
}

/** Problems with one app file (empty = fine). Pure, so the rules can be tested on synthetic sources. */
export function guardProblems(file: string, src: string): string[] {
  if (ALLOW.has(file)) return [];
  const problems: string[] = [];
  const isRoute = /(^|\/)route\.ts$/.test(file);
  const isActions = /(^|\/)actions\.ts$/.test(file);
  // Route handlers are reachable by URL like pages, so they need a session whether or not they touch the DB.
  if ((isRoute || src.includes("getPool")) && !src.includes("requireSession()")) problems.push("no requireSession()");
  if (isActions || isRoute) {
    const fns = isRoute
      ? [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]!)
      : [];
    for (const { name, body } of exportedAsyncFunctions(src)) {
      const firstAwait = /\bawait\s+([^;\n]*)/.exec(body)?.[1]?.trim() ?? "";
      if (!firstAwait.startsWith("requireSession()")) problems.push(`${name}: first await is not requireSession() (got "${firstAwait.slice(0, 40)}")`);
    }
    // `export const GET = …` handlers aren't async function declarations: require the declaration form.
    for (const m of fns) if (!new RegExp(`export async function ${m}\\b`).test(src)) problems.push(`${m}: declare route handlers as export async function`);
  }
  return problems;
}

describe("every DB page/action/route requires a session", () => {
  const files = walk(appDir)
    .filter((f) => /(^|\/)(page\.tsx|actions\.ts|route\.ts)$/.test(f))
    .map((f) => relative(webRoot, f));

  it("finds the existing pages", () => {
    expect(files).toContain("app/library/page.tsx");
    expect(files).toContain("app/research/actions.ts");
    expect(files).toContain("app/batches/[id]/actions.ts");
    expect(files).toContain("app/inbox/actions.ts");
  });

  for (const f of files) {
    it(f, () => {
      expect(guardProblems(f, readFileSync(join(webRoot, f), "utf8"))).toEqual([]);
    });
  }
});

describe("the guard rules themselves", () => {
  it("flags a route.ts without requireSession(), even without getPool", () => {
    const src = `export async function GET() { return Response.json({ ok: true }); }`;
    expect(guardProblems("app/api/x/route.ts", src)).toContain("no requireSession()");
  });

  it("flags a route handler declared as a const", () => {
    const src = `import { requireSession } from "x"; export const POST = async () => { await requireSession(); };`;
    expect(guardProblems("app/api/x/route.ts", src)).toEqual(["POST: declare route handlers as export async function"]);
  });

  it("accepts a route whose handler awaits requireSession() first", () => {
    const src = `export async function GET(req: Request): Promise<Response> {\n  await requireSession();\n  const r = await fetchThing();\n  return r;\n}`;
    expect(guardProblems("app/api/x/route.ts", src)).toEqual([]);
  });

  it("flags an action whose first await is not requireSession()", () => {
    const src = `"use server";\nexport async function a(fd: FormData): Promise<void> {\n  const pool = getPool();\n  await pool.query("x");\n  await requireSession();\n}`;
    expect(guardProblems("app/x/actions.ts", src)).toEqual([`a: first await is not requireSession() (got "pool.query("x")")`]);
  });

  it("flags an action with no await at all", () => {
    const src = `"use server";\nexport async function a(): Promise<void> {\n  getPool();\n}\nexport async function b() {\n  const session = await requireSession();\n}`;
    // a's chunk runs into b's export only via split, so a has no await of its own.
    expect(guardProblems("app/x/actions.ts", src)).toEqual([`a: first await is not requireSession() (got "")`]);
  });

  it("accepts `const session = await requireSession()` and typed return values", () => {
    const src = `"use server";\nexport async function a(id: string, fd?: FormData): Promise<{ ok: boolean }> {\n  const session = await requireSession();\n  await getPool().query("x");\n  return { ok: true };\n}`;
    expect(guardProblems("app/x/actions.ts", src)).toEqual([]);
  });
});
