import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static check (no Docker daemon here): each app's Dockerfile copies the manifest AND the source of every
 * workspace package the app needs, directly or through another package. "Needs" = workspace deps declared
 * in any package.json section, plus any `@autopilot/*` import found in non-test source (catches an
 * undeclared import that only works in the monorepo). The creator's first `docker compose up -d --build`
 * is still the real test.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** @autopilot/<name> → its directory, from the workspace's packages/ and apps/. */
const dirs = new Map<string, string>();
for (const base of ["packages", "apps"]) {
  for (const d of readdirSync(join(root, base))) {
    const pj = join(root, base, d, "package.json");
    if (existsSync(pj)) dirs.set(JSON.parse(readFileSync(pj, "utf8")).name, `${base}/${d}`);
  }
}

function sourceImports(dir: string): string[] {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const f of readdirSync(join(root, d))) {
      const rel = `${d}/${f}`;
      if (["node_modules", ".next", "dist", "__tests__", "public"].includes(f)) continue;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mts)$/.test(f) && !/\.test\./.test(f)) {
        for (const m of read(rel).matchAll(/from\s+["'](@autopilot\/[a-z-]+)/g)) out.add(m[1]!);
      }
    }
  };
  walk(dir);
  return [...out];
}

function needs(name: string): Set<string> {
  const seen = new Set<string>();
  const visit = (n: string) => {
    const dir = dirs.get(n);
    if (!dir) throw new Error(`unknown workspace package ${n}`);
    const pj = JSON.parse(read(`${dir}/package.json`));
    const declared = Object.entries({ ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies })
      .filter(([, v]) => String(v).startsWith("workspace:"))
      .map(([k]) => k);
    for (const d of [...declared, ...sourceImports(dir)]) {
      if (d === n || seen.has(d)) continue;
      seen.add(d);
      visit(d);
    }
  };
  visit(name);
  return seen;
}

const copies = (dockerfile: string) => {
  const lines = read(dockerfile).split("\n").filter((l) => /^COPY\s/.test(l) && !/--from=/.test(l));
  const manifests = new Set<string>();
  const sources = new Set<string>();
  for (const l of lines) {
    const src = l.split(/\s+/)[1]!;
    const m = /^(packages|apps)\/([^/]+)\/package\.json$/.exec(src);
    if (m) manifests.add(`${m[1]}/${m[2]}`);
    else if (/^(packages|apps)\/[^/]+$/.test(src)) sources.add(src);
  }
  return { manifests, sources };
};

describe.each([
  ["@autopilot/worker", "apps/worker/Dockerfile"],
  ["@autopilot/web", "apps/web/Dockerfile"],
])("%s Dockerfile", (app, dockerfile) => {
  const want = [...needs(app)].map((n) => dirs.get(n)!).concat(dirs.get(app)!).sort();
  const got = copies(dockerfile);

  it("copies the manifest of every workspace package it needs (transitively)", () => {
    expect(want).toEqual(expect.arrayContaining(["packages/core", "packages/research", dirs.get(app)!])); // the graph walk isn't vacuous
    expect([...got.manifests].sort()).toEqual(expect.arrayContaining(want));
  });

  it("copies the source of every workspace package it needs (transitively)", () => {
    expect([...got.sources].sort()).toEqual(expect.arrayContaining(want));
  });

  it("installs with the app's filter including its dependencies", () => {
    expect(read(dockerfile)).toContain(`pnpm install --frozen-lockfile --filter ${app}...`);
  });
});
