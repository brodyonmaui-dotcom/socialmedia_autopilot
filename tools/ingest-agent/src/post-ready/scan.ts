import { join, resolve } from "node:path";
import type { ReadyDir } from "../ready/dirs.js";
import { isSettled, MP4, readyNames, SIDECAR_SUFFIX, type ReadyFs } from "../ready/run.js";
import { sourceDefaults, type ReadyDirSource, type Sidecar } from "../ready/sidecar.js";

/**
 * `pnpm skill:post-ready scan`: the settled renders in the source folders that have no
 * `<name>.post.json` yet, with the facts Claude needs to draft captions (/post-ready). Read-only.
 * Legacy INGEST_READY_DIR folders are skipped: `write` only targets source folders (defaults + source).
 */

export interface ScanRender {
  /** Absolute path (stdout JSON for the local Claude session only; never logged by ingest:ready). */
  file: string;
  name: string;
  source: ReadyDirSource;
  defaults: { pillar: Sidecar["pillar"]; platforms: Sidecar["platforms"] };
  filenameDate: string | null;
  durationSec: number | null;
  hasAudio: boolean | null;
}

export interface ScanOutput {
  renders: ScanRender[];
  count: number;
}

export interface ScanDeps {
  dirs: ReadyDir[];
  env: Record<string, string | undefined>;
  now(): Date;
  fs: Pick<ReadyFs, "list" | "exists" | "mtimeMs">;
  /** ffprobe facts; may throw (then both are null). */
  probe(file: string): Promise<{ durationSec: number; hasAudio: boolean }>;
  /** One-line notes (stderr): never a path. */
  warn(line: string): void;
}

const DATE_FORMS = [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, /(?<!\d)(\d{4})_(\d{2})_(\d{2})(?!\d)/g, /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g];

/** First real calendar date in a basename as `YYYY-MM-DD` (forms YYYY-MM-DD, YYYY_MM_DD, YYYYMMDD), else null. */
export function filenameDate(name: string): string | null {
  const found: Array<{ index: number; ymd: string }> = [];
  for (const re of DATE_FORMS) {
    for (const m of name.matchAll(re)) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
      found.push({ index: m.index ?? 0, ymd: `${m[1]}-${m[2]}-${m[3]}` });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found[0]?.ymd ?? null;
}

export async function scanRenders(d: ScanDeps): Promise<ScanOutput> {
  const renders: ScanRender[] = [];
  const now = d.now();
  for (const dir of d.dirs) {
    if (dir.source === null) continue;
    const source = dir.source;
    if (!d.fs.exists(dir.path)) {
      d.warn(`post-ready: ${source} folder does not exist; skipped`);
      continue;
    }
    const names = readyNames(d.fs, dir.path);
    const present = new Set(names);
    for (const name of names.filter((n) => MP4.test(n))) {
      if (present.has(`${name.replace(MP4, "")}${SIDECAR_SUFFIX}`)) continue;
      const file = resolve(join(dir.path, name));
      if (!isSettled(d.fs, join(dir.path, name), now)) continue; // still being written
      let facts: { durationSec: number | null; hasAudio: boolean | null } = { durationSec: null, hasAudio: null };
      try {
        facts = await d.probe(file);
      } catch {
        // ffprobe missing or the file unreadable: keep going without the facts.
      }
      renders.push({ file, name, source, defaults: sourceDefaults(source, d.env), filenameDate: filenameDate(name), ...facts });
    }
  }
  return { renders, count: renders.length };
}
