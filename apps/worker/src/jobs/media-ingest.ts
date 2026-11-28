// Browser upload → Library (F23, worker side). One 'uploaded' row per tick (concurrency 1, skip locked): download
// the raw file from the private incoming/<id>.<ext> key → remux with ALL metadata dropped (runFix's strip plan:
// -map_metadata -1 -map_chapters -1) → re-check no location tag survived → QA → poster → sha256 → upload
// library/<sha256>.mp4 → media row (basename only as source_path, the folder NAME as folder; on conflict
// content_hash → 'duplicate') → delete the raw object → 'done'. Nothing here publishes anything.
// The raw object is only ever deleted: after done/duplicate, on abort (cleanup), and 24 h after a failure.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  FFMPEG_MISSING_MESSAGE,
  FixError,
  hasBinary,
  insertMediaRow,
  makePoster,
  planFix,
  probe,
  probeLocationTagKeys,
  runFix,
  runQa,
  sha256File,
  type MediaStorage,
  type MultipartStorage,
  type QaResult,
} from "@autopilot/media";
import { QUEUES } from "../queue.js";
import { autoQueueFix, raiseMediaConfigAlert, type Queryable } from "./media-fix.js";
import { fingerprintNewMedia, type Fingerprinter } from "./media-fingerprint.js";
import type { ReelBoss } from "./media-reel.js";

export const INGEST_STORAGE_MISSING = "Storage (R2) is not set up in the worker, so uploads can't be processed";
export const INGEST_STORAGE_ALERT = `Uploads are waiting: ${INGEST_STORAGE_MISSING}. Set the R2_* env names (docs/runbooks/uploads.md).`;
export const INGEST_FFMPEG_ALERT = `Uploads are waiting: ${FFMPEG_MISSING_MESSAGE}. Rebuild the worker image (docs/runbooks/uploads.md).`;
export const LOCATION_SURVIVED = "Location details survived the clean-up, so the clip was not kept. Export it again without location and re-upload.";
export const INGEST_FAILED = "Processing failed (storage error or a damaged file). Upload it again.";
export const INGEST_INTERRUPTED = "Processing was interrupted. Upload the file again.";
export const UPLOAD_NEVER_FINISHED = "The upload was never finished.";
const STALE_PROCESSING = "2 hours";
/** A failed upload's raw object is kept this long (to look into it), then deleted. Also: an unfinished upload is closed after it. */
const KEEP_FAILED = "24 hours";
const CLEANUP_BATCH = 20;

export type IngestStorage = MediaStorage & Pick<MultipartStorage, "abortMultipart" | "deleteObject">;

/** The ffmpeg side, injectable so the job's DB behaviour is testable without ffmpeg. */
export interface IngestRunner {
  /** Writes `out` with all metadata stripped (never over `input`). Returns the camera's capture time from the raw file, if any (a date, not a place). */
  strip(input: string, out: string, opts: { timeoutMs?: number }): Promise<{ capturedAt: string | null }>;
  /** Location-capable tag keys still in a file (keys only). */
  locationKeys(path: string): Promise<string[]>;
  qa(path: string): Promise<QaResult>;
  poster(path: string, jpg: string, durationS: number): Promise<void>;
}

/** Strip = the touch-up engine's strip-only plan (stream copy); if the codecs can't be copied into mp4, re-encode once. */
export async function stripUpload(input: string, out: string, opts: { timeoutMs?: number } = {}): Promise<{ capturedAt: string | null }> {
  const p = await probe(input);
  const plan = planFix({ probe: p, blackSegments: [], frozenSegments: [], warnings: [], issues: [] }, []);
  try {
    await runFix(input, out, plan, opts);
  } catch (err) {
    if (!(err instanceof FixError) || err.code !== "ffmpeg-failed") throw err;
    await runFix(input, out, { ...plan, reencodeVideo: true }, opts);
  }
  return { capturedAt: p.capturedAt ?? null };
}

export const ffmpegIngestRunner: IngestRunner = {
  strip: stripUpload,
  locationKeys: (path) => probeLocationTagKeys(path),
  qa: (path) => runQa(path),
  poster: (path, jpg, durationS) => makePoster(path, jpg, { durationS }),
};

export interface MediaIngestDeps {
  db: Queryable;
  storage: IngestStorage | null;
  runner?: IngestRunner;
  hasFfmpeg?: () => Promise<boolean>;
  timeoutMs?: number;
  log?: (line: string) => void;
  tmpDir?: () => string;
  /** Tests only: touch only these upload ids (claim, stale and cleanup). */
  onlyUploadIds?: string[];
  now?: () => Date;
  /** F26 A: fingerprint of the clean file (default ffmpeg; tests inject). */
  fingerprint?: Fingerprinter;
}

export type MediaIngestOutcome =
  | { kind: "idle" }
  | { kind: "paused"; reason: string }
  | { kind: "done"; uploadId: string; mediaId: string }
  | { kind: "duplicate"; uploadId: string; mediaId: string }
  | { kind: "failed"; uploadId: string; reason: string };

const fail = async (db: Queryable, id: string, reason: string) => {
  await db.query(`update uploads set status = 'failed', error = $2, updated_at = now(), finished_at = now() where id = $1 and status = 'processing'`, [id, reason]);
};

/**
 * Raw objects no longer needed: done/duplicate/aborted rows still holding one (any age), failed rows after 24 h.
 * Unfinished uploads untouched for 24 h are closed (aborted) first. Clearing s3_upload_id marks a row cleaned.
 */
export async function cleanupIncoming(d: Pick<MediaIngestDeps, "db" | "storage" | "log" | "onlyUploadIds">): Promise<{ closed: number; cleaned: number }> {
  const only = d.onlyUploadIds ?? null;
  const closed = await d.db.query(
    `update uploads set status = 'aborted', error = $2, updated_at = now(), finished_at = now()
      where status = 'uploading' and updated_at < now() - interval '${KEEP_FAILED}' and ($1::uuid[] is null or id = any($1))
      returning id`,
    [only, UPLOAD_NEVER_FINISHED],
  );
  if (!d.storage) return { closed: closed.rows.length, cleaned: 0 };
  const { rows } = await d.db.query(
    `select id, r2_key, s3_upload_id from uploads
      where s3_upload_id is not null and ($1::uuid[] is null or id = any($1))
        and (status in ('done','duplicate','aborted') or (status = 'failed' and coalesce(finished_at, updated_at) < now() - interval '${KEEP_FAILED}'))
      order by updated_at limit ${CLEANUP_BATCH}`,
    [only],
  );
  let cleaned = 0;
  for (const r of rows as Array<{ id: string; r2_key: string; s3_upload_id: string }>) {
    try {
      await d.storage.abortMultipart(r.r2_key, r.s3_upload_id); // parts of an unfinished upload (no-op once completed)
      await d.storage.deleteObject(r.r2_key);
      await d.db.query("update uploads set s3_upload_id = null where id = $1 and s3_upload_id = $2", [r.id, r.s3_upload_id]);
      cleaned++;
    } catch (err) {
      d.log?.(`[media-ingest] cleanup deferred for ${r.id.slice(0, 8)}: ${(err as Error)?.name ?? "error"}`);
    }
  }
  return { closed: closed.rows.length, cleaned };
}

export async function runMediaIngestOnce(d: MediaIngestDeps): Promise<MediaIngestOutcome> {
  const log = d.log ?? ((l: string) => console.log(l));
  const runner = d.runner ?? ffmpegIngestRunner;
  const only = d.onlyUploadIds ?? null;
  await d.db.query(
    `update uploads set status = 'failed', error = $2, updated_at = now(), finished_at = now()
      where status = 'processing' and updated_at < now() - interval '${STALE_PROCESSING}' and ($1::uuid[] is null or id = any($1))`,
    [only, INGEST_INTERRUPTED],
  );
  await cleanupIncoming({ ...d, log });

  // Config first, without claiming: a missing R2/ffmpeg must not fail (and lose) an upload of up to 2 GB.
  const waiting = (await d.db.query(`select 1 from uploads where status = 'uploaded' and ($1::uuid[] is null or id = any($1)) limit 1`, [only])).rows.length > 0;
  if (!waiting) return { kind: "idle" };
  if (!d.storage) {
    await raiseMediaConfigAlert(d.db, INGEST_STORAGE_ALERT, d.now?.());
    return { kind: "paused", reason: INGEST_STORAGE_MISSING };
  }
  if (!(await (d.hasFfmpeg ?? (() => hasBinary("ffmpeg")))())) {
    await raiseMediaConfigAlert(d.db, INGEST_FFMPEG_ALERT, d.now?.());
    return { kind: "paused", reason: FFMPEG_MISSING_MESSAGE };
  }

  const claimed = await d.db.query(
    `update uploads set status = 'processing', updated_at = now()
      where id = (select id from uploads where status = 'uploaded' and ($1::uuid[] is null or id = any($1))
                   order by updated_at for update skip locked limit 1)
      returning id, original_name, folder, r2_key`,
    [only],
  );
  const job = claimed.rows[0] as { id: string; original_name: string; folder: string | null; r2_key: string } | undefined;
  if (!job) return { kind: "idle" };
  const tag = job.id.slice(0, 8);

  const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-ingest-"))))();
  try {
    const input = join(tmp, "raw");
    const out = join(tmp, "clean.mp4");
    await d.storage.download(job.r2_key, input);
    const { capturedAt } = await runner.strip(input, out, { timeoutMs: d.timeoutMs });
    rmSync(input, { force: true }); // the raw copy (may carry location) leaves disk as soon as the clean one exists
    if ((await runner.locationKeys(out)).length) {
      await fail(d.db, job.id, LOCATION_SURVIVED);
      return { kind: "failed", uploadId: job.id, reason: LOCATION_SURVIVED };
    }
    const qa = await runner.qa(out);
    const hash = await sha256File(out);

    const existing = (await d.db.query("select id from media where content_hash = $1", [hash])).rows[0] as { id: string } | undefined;
    let mediaId: string;
    let inserted = false;
    if (existing) {
      mediaId = String(existing.id);
    } else {
      const key = `library/${hash}.mp4`;
      await d.storage.upload(key, out, "video/mp4");
      let posterKey: string | null = `posters/${hash}.jpg`;
      try {
        const jpg = join(tmp, "poster.jpg");
        await runner.poster(out, jpg, qa.probe.durationS);
        await d.storage.upload(posterKey, jpg, "image/jpeg");
      } catch (err) {
        log(`[media-ingest] poster skipped for ${tag}: ${String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 80)}`);
        posterKey = null;
      }
      const row = await insertMediaRow(d.db, {
        contentHash: hash,
        sourcePath: basename(job.original_name.replace(/\\/g, "/")),
        r2Key: key,
        durationS: qa.probe.durationS,
        width: qa.probe.width,
        height: qa.probe.height,
        pillar: null,
        qa,
        capturedAt,
        posterKey,
        derivedFrom: null,
        folder: job.folder,
      });
      mediaId = row.id;
      inserted = row.inserted;
      if (inserted) await fingerprintNewMedia(d.db, mediaId, out, qa.probe.durationS, { fingerprint: d.fingerprint, log, tag: "media-ingest" });
    }
    const status = inserted ? "done" : "duplicate";
    await d.db.query(`update uploads set status = $2, media_id = $3, error = null, updated_at = now(), finished_at = now() where id = $1 and status = 'processing'`, [
      job.id,
      status,
      mediaId,
    ]);
    if (inserted) {
      try {
        await autoQueueFix(d.db, mediaId, qa);
      } catch (err) {
        log(`[media-ingest] auto-fix not queued for ${tag}: ${(err as Error)?.name ?? "error"}`);
      }
    }
    // The raw object is no longer needed; if storage refuses now, the next tick's cleanup retries.
    await cleanupIncoming({ db: d.db, storage: d.storage, log, onlyUploadIds: [job.id] });
    log(`[media-ingest] ${status} ${tag}`);
    return inserted ? { kind: "done", uploadId: job.id, mediaId } : { kind: "duplicate", uploadId: job.id, mediaId };
  } catch (err) {
    // Plain words only; never echo paths, keys or upstream bodies. The raw object stays 24 h, then cleanup deletes it.
    const reason = err instanceof FixError ? (err.code === "unsafe" && /Location/.test(err.message) ? LOCATION_SURVIVED : err.message) : INGEST_FAILED;
    if (err instanceof FixError && err.code === "ffmpeg-missing") await raiseMediaConfigAlert(d.db, INGEST_FFMPEG_ALERT, d.now?.());
    if (!(err instanceof FixError)) log(`[media-ingest] failed ${tag}: ${(err as Error)?.name ?? "error"}`);
    await fail(d.db, job.id, reason);
    return { kind: "failed", uploadId: job.id, reason };
  } finally {
    rmSync(tmp, { recursive: true, force: true }); // the job's own temp dir only
  }
}

/** Every minute, one upload per tick, one worker at a time (batchSize 1 + skip locked). */
export async function registerMediaIngestJob(boss: ReelBoss, deps: MediaIngestDeps): Promise<void> {
  await boss.createQueue(QUEUES.mediaIngest);
  await boss.work(QUEUES.mediaIngest, { batchSize: 1 }, async () => {
    const r = await runMediaIngestOnce(deps);
    if (r.kind === "failed") console.log(`[media-ingest] failed ${r.uploadId.slice(0, 8)}: ${r.reason}`);
  });
  // A 2 GB remux + QA can take minutes: the job must not expire (and be retried) while ffmpeg is still running.
  await boss.schedule(QUEUES.mediaIngest, "* * * * *", undefined, { singletonKey: "media-ingest-tick", expireInSeconds: 60 * 60, retryLimit: 0 });
}
