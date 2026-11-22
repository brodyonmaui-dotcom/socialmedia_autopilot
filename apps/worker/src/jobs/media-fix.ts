// Touch-up "Fix it" (worker side). One queued media_fixes row per tick (concurrency 1): download the clean
// file from R2 → planFix/runFix (always strips metadata) → QA → hash → upload under a NEW key → poster →
// new media row (derived_from = the original) → status 'done'. The original row and file are never changed.
// Nothing here publishes anything: a fixed clip only becomes postable when the creator taps "Keep the fix",
// and even then only draft calendar items are re-pointed (apps/web/lib/library).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import {
  FFMPEG_MISSING_MESSAGE,
  FIX_OP_ORDER,
  FixError,
  hasBinary,
  insertMediaRow,
  makePoster,
  OP_FOR_CODE,
  OPT_IN_OPS,
  planFix,
  runFix,
  runQa,
  sha256File,
  type FixOp,
  type MediaStorage,
  type QaResult,
} from "@autopilot/media";
import type PgBoss from "pg-boss";

export const MEDIA_FIX_QUEUE = "media-fix-tick";

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

// The R2 client moved to @autopilot/media (storage.ts) so the reel job and the web sound upload share it.
export { r2StorageFromEnv, type MediaStorage } from "@autopilot/media";

export const STORAGE_MISSING_MESSAGE = "Storage (R2) is not set up in the worker, so touch-up fixes can't run";
export const MEDIA_FIX_CONFIG_MESSAGE = `Touch-up fixes are paused: ${FFMPEG_MISSING_MESSAGE}. Rebuild the worker image (docs/runbooks/touch-up.md).`;
export const MEDIA_FIX_STORAGE_ALERT = `Touch-up fixes are paused: ${STORAGE_MISSING_MESSAGE}. Set the R2_* env names (docs/runbooks/touch-up.md).`;

/** One open 'config' alert per message (same not-exists dedupe as the outbox's config alert). */
export async function raiseMediaConfigAlert(db: Queryable, message: string, now: Date = new Date()): Promise<boolean> {
  const { rows } = await db.query(
    `insert into alerts (kind, batch_item_id, platform, message, created_at)
     select 'config', null, 'all', $1, $2
      where not exists (select 1 from alerts where kind = 'config' and acknowledged_at is null and message = $1)
     returning id`,
    [message, now.toISOString()],
  );
  return rows.length === 1;
}

/** Setting `touchup_autofix` (jsonb boolean, default ON): only an explicit `false` turns auto-queueing off. */
export async function isAutoFixOn(db: Queryable): Promise<boolean> {
  const { rows } = await db.query("select value from settings where key = 'touchup_autofix'");
  return rows[0]?.value !== false;
}

/**
 * Right after QA flags a clip: queue the default fix (fixable `fix` issues, not dismissed, opt-in ops off)
 * when the setting is on and the clip has no fix history at all (no open, failed, kept or discarded fix) and
 * is not itself a fixed copy. Same insert as the web's requestFix, on conflict do nothing. Originals are never
 * touched; keeping stays the creator's tap. Returns true when a fix was queued.
 */
export async function autoQueueFix(db: Queryable, mediaId: string, qa: QaResult): Promise<boolean> {
  if (qa?.version !== 2 || !Array.isArray(qa.issues)) return false;
  if (!(await isAutoFixOn(db))) return false;
  const dismissed = new Set(
    ((await db.query("select code from touchup_dismissals where media_id = $1 and undone_at is null", [mediaId])).rows as Array<{ code: string }>).map((r) => r.code),
  );
  const want = new Set(
    qa.issues.filter((i) => i.severity === "fix" && i.fixable && !dismissed.has(i.code)).flatMap((i) => (OP_FOR_CODE[i.code] ? [OP_FOR_CODE[i.code]!] : [])),
  );
  const ops = FIX_OP_ORDER.filter((o) => want.has(o) && !OPT_IN_OPS.includes(o));
  if (ops.length === 0) return false;
  const { rows } = await db.query(
    `insert into media_fixes (media_id, ops)
     select $1, $2::text[]
      where not exists (select 1 from media_fixes k where k.media_id = $1 and k.status in ('failed','kept','discarded'))
        and not exists (select 1 from media_fixes c where c.fixed_media_id = $1)
     on conflict (media_id) where status in ('queued','running','done') do nothing
     returning id`,
    [mediaId, ops],
  );
  return rows.length === 1;
}

export interface MediaFixDeps {
  db: Queryable;
  storage: MediaStorage | null;
  hasFfmpeg?: () => Promise<boolean>;
  /** Kill ffmpeg after this long (default: the fix engine's 15 min). */
  timeoutMs?: number;
  log?: (line: string) => void;
  tmpDir?: () => string;
  /** Tests only: claim only these fix ids. */
  onlyFixIds?: string[];
  now?: () => Date;
}

export type MediaFixOutcome = { kind: "idle" } | { kind: "done"; fixId: string; fixedMediaId: string } | { kind: "failed"; fixId: string; reason: string };

/** Fixes stuck in 'running' this long (worker crashed mid-run) are failed so "Fix it" can be tapped again. */
const STALE_RUNNING = "2 hours";

const fail = async (db: Queryable, id: string, reason: string) => {
  await db.query(`update media_fixes set status = 'failed', finished_at = now(), error = $2 where id = $1 and status = 'running'`, [id, reason]);
};

/** Laptop source path → "<dir>/<stem>-fixed<ext>" so the library label says which copy it is. */
export function fixedSourcePath(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  const ext = extname(sourcePath);
  const dir = dirname(sourcePath);
  const name = `${basename(sourcePath, ext)}-fixed${ext || ".mp4"}`;
  return dir && dir !== "." ? `${dir}${sourcePath.includes("\\") ? "\\" : "/"}${name}` : name;
}

export async function runMediaFixOnce(d: MediaFixDeps): Promise<MediaFixOutcome> {
  const log = d.log ?? ((l: string) => console.log(l));
  const only = d.onlyFixIds ?? null;
  await d.db.query(
    `update media_fixes set status = 'failed', finished_at = now(), error = 'The fix was interrupted. Tap Fix it to try again.'
      where status = 'running' and started_at < now() - interval '${STALE_RUNNING}' and ($1::uuid[] is null or id = any($1))`,
    [only],
  );
  const claimed = await d.db.query(
    `update media_fixes set status = 'running', started_at = now()
      where id = (select id from media_fixes where status = 'queued' and ($1::uuid[] is null or id = any($1))
                   order by requested_at for update skip locked limit 1)
      returning id, media_id, ops`,
    [only],
  );
  const job = claimed.rows[0] as { id: string; media_id: string; ops: string[] } | undefined;
  if (!job) return { kind: "idle" };

  if (!d.storage) {
    await fail(d.db, job.id, STORAGE_MISSING_MESSAGE);
    await raiseMediaConfigAlert(d.db, MEDIA_FIX_STORAGE_ALERT, d.now?.());
    return { kind: "failed", fixId: job.id, reason: STORAGE_MISSING_MESSAGE };
  }
  if (!(await (d.hasFfmpeg ?? (() => hasBinary("ffmpeg")))())) {
    await fail(d.db, job.id, FFMPEG_MISSING_MESSAGE);
    await raiseMediaConfigAlert(d.db, MEDIA_FIX_CONFIG_MESSAGE, d.now?.());
    return { kind: "failed", fixId: job.id, reason: FFMPEG_MISSING_MESSAGE };
  }

  const media = (await d.db.query("select id, r2_key, qa, pillar, source_path, captured_at from media where id = $1", [job.media_id])).rows[0] as
    | { id: string; r2_key: string | null; qa: QaResult | null; pillar: string | null; source_path: string | null; captured_at: Date | string | null }
    | undefined;
  if (!media?.r2_key) {
    const reason = "The clean file for this clip isn't in storage, so it can't be fixed.";
    await fail(d.db, job.id, reason);
    return { kind: "failed", fixId: job.id, reason };
  }

  const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-fix-"))))();
  try {
    const input = join(tmp, "in.mp4");
    const out = join(tmp, "fixed.mp4");
    await d.storage.download(media.r2_key, input);
    // A stored v2 result describes this same clean file; an older one is re-measured first.
    const qa = media.qa?.version === 2 && Array.isArray(media.qa.issues) ? media.qa : await runQa(input);
    const plan = planFix(qa, job.ops as FixOp[]);
    const { before, after } = await runFix(input, out, plan, { timeoutMs: d.timeoutMs });

    // Same steps as a normal ingest: (strip done by runFix) → probe + QA → hash → upload → poster → row.
    const fixedQa = await runQa(out);
    const hash = await sha256File(out);
    const key = `library/${hash}.mp4`;
    await d.storage.upload(key, out, "video/mp4");
    let posterKey: string | null = `posters/${hash}.jpg`;
    try {
      const jpg = join(tmp, "poster.jpg");
      await makePoster(out, jpg, { durationS: fixedQa.probe.durationS });
      await d.storage.upload(posterKey, jpg, "image/jpeg");
    } catch (err) {
      log(`[media-fix] poster skipped for fix ${job.id.slice(0, 8)}: ${String((err as Error).message).split("\n")[0]}`);
      posterKey = null;
    }
    const capturedAt = media.captured_at ? new Date(media.captured_at).toISOString() : null;
    const row = await insertMediaRow(d.db, {
      contentHash: hash,
      sourcePath: fixedSourcePath(media.source_path),
      r2Key: key,
      durationS: fixedQa.probe.durationS,
      width: fixedQa.probe.width,
      height: fixedQa.probe.height,
      pillar: media.pillar,
      qa: fixedQa,
      capturedAt,
      posterKey,
      derivedFrom: media.id,
    });
    await d.db.query(
      `update media_fixes set status = 'done', finished_at = now(), fixed_media_id = $2, before = $3::jsonb, after = $4::jsonb, ops = $5, error = null
        where id = $1 and status = 'running'`,
      [job.id, row.id, JSON.stringify(before), JSON.stringify(after), plan.ops],
    );
    log(`[media-fix] done ${job.id.slice(0, 8)} · ${plan.ops.join("+")} · ${before.durationS}s → ${after.durationS}s`);
    return { kind: "done", fixId: job.id, fixedMediaId: row.id };
  } catch (err) {
    // Plain words only; never echo paths, keys or upstream bodies.
    const reason = err instanceof FixError ? err.message : "The fix failed (storage or processing error). Nothing was changed.";
    if (err instanceof FixError && err.code === "ffmpeg-missing") await raiseMediaConfigAlert(d.db, MEDIA_FIX_CONFIG_MESSAGE, d.now?.());
    if (!(err instanceof FixError)) log(`[media-fix] failed ${job.id.slice(0, 8)}: ${(err as Error)?.name ?? "error"}`);
    await fail(d.db, job.id, reason);
    return { kind: "failed", fixId: job.id, reason };
  } finally {
    rmSync(tmp, { recursive: true, force: true }); // the job's own temp dir only
  }
}

/** Every minute, one fix per tick, one worker at a time (localConcurrency 1 + skip locked). */
export async function registerMediaFixJob(boss: PgBoss, deps: MediaFixDeps): Promise<void> {
  await boss.createQueue(MEDIA_FIX_QUEUE);
  await boss.work(MEDIA_FIX_QUEUE, { batchSize: 1 }, async () => {
    const r = await runMediaFixOnce(deps);
    if (r.kind === "failed") console.log(`[media-fix] failed ${r.fixId.slice(0, 8)}: ${r.reason}`);
  });
  // A fix can take minutes: the job must not expire (and be retried) while ffmpeg is still running.
  await boss.schedule(MEDIA_FIX_QUEUE, "* * * * *", undefined, { singletonKey: "media-fix-tick", expireInSeconds: 60 * 60, retryLimit: 0 });
}
