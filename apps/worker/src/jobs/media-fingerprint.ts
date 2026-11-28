// F26 A: video fingerprints (duplicate guard v2). Every job that creates a media row (media-ingest, media-fix,
// media-reel, Studio) fingerprints the clean file it just made (fingerprintNewMedia, best effort), and this backfill
// tick fills the rest (rows from before 0018, the laptop's editor renders, anything that failed): at most 20 clips per
// tick, one ffmpeg at a time, every 5 minutes, from the clean file in R2. Only media.fingerprint and
// media.fingerprint_at change; fingerprint_at is stamped on failure too, so a bad file is tried once, not every tick.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintFromFrames } from "@autopilot/core";
import { storeFingerprint } from "@autopilot/db";
import { grabFingerprintFrames, hasBinary } from "@autopilot/media";
import type PgBoss from "pg-boss";
import type { MediaStorage, Queryable } from "./media-fix.js";

export const MEDIA_FINGERPRINT_QUEUE = "media-fingerprint";
export const FINGERPRINT_PER_TICK = 20;

/** The stored fingerprint text for a local clean file, or null (unreadable / too short / too flat). Never throws. */
export async function fingerprintFile(path: string, durationS?: number | null): Promise<string | null> {
  try {
    const g = await grabFingerprintFrames(path, { durationS });
    return fingerprintFromFrames(g.durationS, g.frames);
  } catch {
    return null;
  }
}

export type Fingerprinter = (path: string, durationS?: number | null) => Promise<string | null>;

/**
 * Right after a media row is created from `path`: store its fingerprint. Best effort: a failure logs one line (no
 * path, no id beyond 8 chars) and leaves fingerprint_at null, so the backfill tick tries again from R2.
 */
export async function fingerprintNewMedia(
  db: Queryable,
  mediaId: string,
  path: string,
  durationS: number | null | undefined,
  o: { fingerprint?: Fingerprinter; log?: (line: string) => void; tag?: string } = {},
): Promise<string | null> {
  try {
    const fp = await (o.fingerprint ?? fingerprintFile)(path, durationS);
    if (fp) await storeFingerprint(db, mediaId, fp);
    return fp;
  } catch (err) {
    (o.log ?? console.log)(`[${o.tag ?? "media"}] fingerprint skipped for ${mediaId.slice(0, 8)}: ${(err as Error)?.name ?? "error"} (the backfill tick retries)`);
    return null;
  }
}

export interface MediaFingerprintDeps {
  db: Queryable;
  storage: MediaStorage | null;
  hasFfmpeg?: () => Promise<boolean>;
  fingerprint?: Fingerprinter;
  limit?: number;
  tmpDir?: () => string;
  /** Tests only: consider only these media ids. */
  onlyMediaIds?: string[];
}

export interface FingerprintSummary {
  done: number;
  /** Attempted, but no fingerprint could be made (stamped, not retried). */
  empty: number;
  failed: number;
  skipped: "no-storage" | "no-ffmpeg" | null;
}

export async function runMediaFingerprintOnce(d: MediaFingerprintDeps): Promise<FingerprintSummary> {
  if (!d.storage) return { done: 0, empty: 0, failed: 0, skipped: "no-storage" };
  if (!(await (d.hasFfmpeg ?? (() => hasBinary("ffmpeg")))())) return { done: 0, empty: 0, failed: 0, skipped: "no-ffmpeg" };
  const { rows } = await d.db.query(
    `select id, r2_key, duration_s from media
      where fingerprint_at is null and r2_key is not null and r2_key like 'library/%'
        and ($2::uuid[] is null or id = any($2))
      order by created_at desc
      limit $1`,
    [Math.min(d.limit ?? FINGERPRINT_PER_TICK, FINGERPRINT_PER_TICK), d.onlyMediaIds ?? null],
  );
  const s: FingerprintSummary = { done: 0, empty: 0, failed: 0, skipped: null };
  for (const row of rows as Array<{ id: string; r2_key: string; duration_s: string | number | null }>) {
    const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-fp-"))))();
    try {
      const file = join(tmp, "clip.mp4");
      await d.storage.download(row.r2_key, file);
      const fp = await (d.fingerprint ?? fingerprintFile)(file, row.duration_s == null ? null : Number(row.duration_s));
      await storeFingerprint(d.db, row.id, fp);
      if (fp) s.done++;
      else s.empty++;
    } catch {
      await d.db.query("update media set fingerprint_at = now() where id = $1", [row.id]);
      s.failed++;
    } finally {
      rmSync(tmp, { recursive: true, force: true }); // the tick's own temp dir only
    }
  }
  return s;
}

export async function registerMediaFingerprintJob(boss: PgBoss, deps: MediaFingerprintDeps): Promise<void> {
  await boss.createQueue(MEDIA_FINGERPRINT_QUEUE);
  await boss.work(MEDIA_FINGERPRINT_QUEUE, { batchSize: 1 }, async () => {
    const r = await runMediaFingerprintOnce(deps);
    if (r.done || r.empty || r.failed) console.log(`[media-fingerprint] ${r.done} fingerprinted, ${r.empty} without one, ${r.failed} failed`);
  });
  await boss.schedule(MEDIA_FINGERPRINT_QUEUE, "*/5 * * * *", undefined, { singletonKey: "media-fingerprint", expireInSeconds: 60 * 60, retryLimit: 0 });
}
