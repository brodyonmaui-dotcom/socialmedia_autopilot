import type { ReadyDirSource } from "./sidecar.js";

export { sourceDefaults } from "./sidecar.js";

/**
 * The editors' ready-to-post folders. `source` null = the legacy INGEST_READY_DIR, whose sidecars
 * must carry pillar/platforms/source themselves.
 */
export interface ReadyDir {
  path: string;
  source: ReadyDirSource | null;
}

const DIR_SOURCES: readonly ReadyDirSource[] = ["trade-recaps", "workout-assembly"];

/** Short label for log lines: the source, or `ready` for the legacy folder. Never the path. */
export function dirLabel(dir: ReadyDir): string {
  return dir.source ?? "ready";
}

/**
 * INGEST_READY_DIRS: entries separated by `;` or newlines, each `<path>=<source>` split on the LAST
 * `=` (Windows paths carry `:` and `\`). Errors name the entry index, never the path (paths stay out
 * of logs). INGEST_READY_DIR (legacy) is added as `{ source: null }` unless the same path is listed.
 */
export function parseReadyDirs(env: Record<string, string | undefined>): { dirs: ReadyDir[]; errors: string[] } {
  const dirs: ReadyDir[] = [];
  const errors: string[] = [];
  const entries = (env.INGEST_READY_DIRS ?? "")
    .split(/[;\r\n]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  entries.forEach((entry, i) => {
    const n = i + 1;
    const eq = entry.lastIndexOf("=");
    if (eq < 0) {
      errors.push(`INGEST_READY_DIRS entry ${n}: expected <path>=<source>`);
      return;
    }
    const path = entry.slice(0, eq).trim();
    const source = entry.slice(eq + 1).trim();
    if (!path) {
      errors.push(`INGEST_READY_DIRS entry ${n}: empty path`);
      return;
    }
    if (!(DIR_SOURCES as readonly string[]).includes(source)) {
      errors.push(`INGEST_READY_DIRS entry ${n}: source must be ${DIR_SOURCES.join(" or ")}`);
      return;
    }
    if (dirs.some((d) => d.path === path)) {
      errors.push(`INGEST_READY_DIRS entry ${n}: duplicate path`);
      return;
    }
    dirs.push({ path, source: source as ReadyDirSource });
  });
  const legacy = env.INGEST_READY_DIR?.trim();
  if (legacy && !dirs.some((d) => d.path === legacy)) dirs.push({ path: legacy, source: null });
  return { dirs, errors };
}
