import { basename, dirname, extname, join } from "node:path";
import { INGESTED_DIR } from "./ready/run.js";

/**
 * Poster frames (small metadata-free JPEGs the web app shows as thumbnails). Everything with side
 * effects is injected so "a poster failure never fails the ingest" and the backfill are testable.
 */

/** A safe file stem: letters, digits, "_", "-", inner dots; never a leading dot or "..". */
const STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** R2 key of a clip's poster, derived from its clean file's key: `library/<hash>.mp4` → `posters/<hash>.jpg`. Null if the key is odd. */
export function posterKeyFor(cleanKey: string): string | null {
  const name = cleanKey.split("/").pop() ?? "";
  const stem = name.replace(/\.[^.]+$/, "");
  return stem && STEM.test(stem) && !stem.includes("..") ? `posters/${stem}.jpg` : null;
}

export interface PosterDeps {
  makePoster(inputPath: string, outPath: string, opts: { durationS: number }): Promise<void>;
  /** Upload a JPEG (content type image/jpeg). */
  uploadPoster(key: string, jpgPath: string): Promise<void>;
  log(line: string): void;
}

const oneLine = (err: unknown): string => String((err as Error)?.message ?? err).split(/\r?\n/)[0]!.slice(0, 160);

/**
 * Make + upload one poster from `videoPath` (the clean copy) into `tmpDir`. Never throws: any failure logs
 * one `POSTER skipped <name> — <reason>` line and returns null, so the caller stores poster_key = null.
 */
export async function tryPoster(d: PosterDeps, a: { videoPath: string; tmpDir: string; cleanKey: string; durationS: number | null; name: string }): Promise<string | null> {
  try {
    const key = posterKeyFor(a.cleanKey);
    if (!key) throw new Error("no poster key for this clip");
    const out = join(a.tmpDir, "poster.jpg");
    await d.makePoster(a.videoPath, out, { durationS: a.durationS ?? 0 });
    await d.uploadPoster(key, out);
    return key;
  } catch (err) {
    d.log(`POSTER skipped ${a.name} — ${oneLine(err)}`);
    return null;
  }
}

// ---- Backfill: `pnpm ingest:posters [--write]` ----

export interface PosterRow {
  id: string;
  contentHash: string;
  sourcePath: string;
  r2Key: string | null;
  durationS: number | null;
}

export interface BackfillDeps extends PosterDeps {
  write: boolean;
  rows: PosterRow[];
  exists(path: string): boolean;
  hash(path: string): Promise<string>;
  /** Sets poster_key only where it is still null. */
  update(id: string, posterKey: string): Promise<void>;
  tmpDir(): string;
  cleanup(dir: string): void;
}

export interface BackfillSummary {
  made: number;
  missing: number;
  failed: number;
}

/**
 * Where the original may be on the laptop: where it was ingested from, or (ingest:ready) the
 * `_ingested/` folder it was moved to, possibly with the `-<hash8>` collision suffix.
 */
export function originalCandidates(sourcePath: string, contentHash: string): string[] {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const stem = basename(sourcePath, ext);
  return [sourcePath, join(dir, INGESTED_DIR, `${stem}${ext}`), join(dir, INGESTED_DIR, `${stem}-${contentHash.slice(0, 8)}${ext}`)];
}

/** For each row: find the original (content hash must match, so a replaced file never gives a wrong poster), then make + upload + update. Originals are only read. */
export async function runPosterBackfill(d: BackfillDeps): Promise<BackfillSummary> {
  const s: BackfillSummary = { made: 0, missing: 0, failed: 0 };
  for (const row of d.rows) {
    const name = basename(row.sourcePath);
    let found: string | null = null;
    try {
      for (const p of originalCandidates(row.sourcePath, row.contentHash)) {
        if (d.exists(p) && (await d.hash(p)) === row.contentHash) {
          found = p;
          break;
        }
      }
    } catch (err) {
      d.log(`POSTER failed ${name} — ${oneLine(err)}`);
      s.failed++;
      continue;
    }
    if (!found) {
      s.missing++;
      continue;
    }
    if (!d.write) {
      s.made++;
      continue;
    }
    const tmp = d.tmpDir();
    try {
      const key = await tryPoster(d, { videoPath: found, tmpDir: tmp, cleanKey: row.r2Key ?? `library/${row.contentHash}.mp4`, durationS: row.durationS, name });
      if (!key) {
        s.failed++;
        continue;
      }
      await d.update(row.id, key);
      s.made++;
    } catch (err) {
      d.log(`POSTER failed ${name} — ${oneLine(err)}`);
      s.failed++;
    } finally {
      d.cleanup(tmp);
    }
  }
  return s;
}

export function backfillSummaryLine(s: BackfillSummary, write: boolean): string {
  return write
    ? `posters: made ${s.made}, missing-file ${s.missing}, failed ${s.failed}`
    : `posters (dry run): would make ${s.made}, missing-file ${s.missing}, failed ${s.failed} (add --write to do it)`;
}
