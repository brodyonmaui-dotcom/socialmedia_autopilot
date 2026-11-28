// "Make a reel" (F20 E, worker side). One queued media_edits row per tick (concurrency 1): download the clip
// (and the sound) from R2 → planReel/runReel (1080×1920, -14 LUFS, metadata always stripped) → QA → hash →
// upload library/<hash>.mp4 + posters/<hash>.jpg → new media row (derived_from = the clip) → ONE draft
// Instagram item (origin 'reel', never approved) + one 'ready-for-approval' alert → status 'done'.
// Nothing here publishes: listDue needs approved_at in an approved batch, and only the creator's tap sets it.
// Studio (F24): a row with kind = 'studio' carries an EDL in params → runEdl (every distinct clip + the sound
// downloaded once) → the same QA/hash/upload/poster steps → a media row in folder "Studio" (derived_from = the
// first clip). NO batch item: the result shows up in Ready to post, where the creator approves it.
// No delete statement in this file; the source clip and the sound are only read.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { addCalendarDays, assignSlots, diffCalendarDays, localDate, localToUtc, weekdayIndex, type ScheduleItem } from "@autopilot/core";
import { loadCadence, recentVideoUse } from "@autopilot/db";
import {
  FFMPEG_MISSING_MESSAGE,
  FixError,
  hasBinary,
  insertMediaRow,
  isReelAudio,
  makeCoverPoster,
  makePoster,
  parseEdl,
  planReel,
  runQa,
  runEdl,
  runReel,
  sha256File,
  studioFonts,
  type Edl,
  type RunEdlInputs,
  type FixStats,
  type MediaStorage,
  type QaResult,
  type ReelParams,
  type ReelPlan,
} from "@autopilot/media";
import { QUEUES } from "../queue.js";
import { raiseMediaConfigAlert, type Queryable } from "./media-fix.js";
import { fingerprintNewMedia, type Fingerprinter } from "./media-fingerprint.js";
import type { ConnectPool } from "./weekly-draft.js";

export const REEL_STORAGE_MISSING = "Storage (R2) is not set up in the worker, so reels can't be made";
export const REEL_STORAGE_ALERT = `Reels are paused: ${REEL_STORAGE_MISSING}. Set the R2_* env names (docs/runbooks/reels.md).`;
export const REEL_FFMPEG_ALERT = `Reels are paused: ${FFMPEG_MISSING_MESSAGE}. Rebuild the worker image (docs/runbooks/reels.md).`;
/** The reel's post goes out no sooner than this after it's made (time to look at it and approve). */
export const REEL_LEAD_MS = 2 * 3_600_000;
/** …and is placed within this many days. */
export const REEL_WINDOW_DAYS = 7;
const STALE_RUNNING = "2 hours";

/** The ffmpeg side, injectable so the job's DB behaviour is testable without ffmpeg. */
export interface ReelRunner {
  render(input: string, sound: string | null, out: string, plan: ReelPlan, opts: { timeoutMs?: number; capFps?: boolean }): Promise<{ after: FixStats }>;
  qa(path: string): Promise<QaResult>;
  poster(path: string, jpg: string, durationS: number): Promise<void>;
}

export const ffmpegReelRunner: ReelRunner = {
  render: (input, sound, out, plan, opts) => runReel(input, sound, out, plan, opts),
  qa: (path) => runQa(path),
  poster: (path, jpg, durationS) => makePoster(path, jpg, { durationS }),
};

/** The Studio ffmpeg side (F24), injectable like ReelRunner. */
export interface StudioRunner {
  render(edl: Edl, inputs: RunEdlInputs, opts: { timeoutMs?: number }): Promise<{ outPath: string; durationS: number; after: FixStats }>;
  qa(path: string): Promise<QaResult>;
  poster(path: string, jpg: string, opts: { durationS: number; coverS: number | null }): Promise<void>;
}

export const ffmpegStudioRunner: StudioRunner = {
  render: (edl, inputs, opts) => runEdl(edl, inputs, opts),
  qa: (path) => runQa(path),
  poster: (path, jpg, opts) => makeCoverPoster(path, jpg, opts),
};

/** Library folder every Studio export lands in. */
export const STUDIO_FOLDER = "Studio";

/** "<first clip's file stem>-studio.mp4" (file name only, never the laptop folders). */
export function studioSourcePath(firstSourcePath: string | null): string {
  const name = (firstSourcePath ?? "").split(/[\\/]/).pop() ?? "";
  const stem = name ? basename(name, extname(name)) : "";
  return stem ? `${stem}-studio.mp4` : "studio.mp4";
}

/** One transaction on its own pool client (the draft write's advisory lock needs one). */
export function poolTransaction(pool: ConnectPool): <T>(fn: (q: Queryable) => Promise<T>) => Promise<T> {
  return async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
}

export interface MediaReelDeps {
  db: Queryable;
  /** Runs the draft write in one transaction. Default: straight on `db` (tests pass a client already inside one). */
  transaction?: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;
  storage: MediaStorage | null;
  /** TZ_CREATOR. Unset → the draft item is left untimed (never a guessed zone). */
  timeZone: string | undefined;
  runner?: ReelRunner;
  studioRunner?: StudioRunner;
  /** Font lookup env (STUDIO_FONT_PATH / STUDIO_FONT_PLAIN_PATH); default process.env. */
  env?: Record<string, string | undefined>;
  hasFfmpeg?: () => Promise<boolean>;
  timeoutMs?: number;
  log?: (line: string) => void;
  tmpDir?: () => string;
  /** Tests only: claim only these edit ids. */
  onlyEditIds?: string[];
  now?: () => Date;
  /** F26 A: fingerprint of the rendered file (default ffmpeg; tests inject). */
  fingerprint?: Fingerprinter;
}

export type MediaReelOutcome =
  | { kind: "idle" }
  | { kind: "done"; editId: string; mediaId: string; batchItemId: string; scheduledFor: string | null }
  | { kind: "studio-done"; editId: string; mediaId: string }
  | { kind: "failed"; editId: string; reason: string };

export function reelIngestKey(editId: string): string {
  return `reel:${editId}:instagram`;
}

/** Pillar and platform only: no caption text, no clip name, no place. */
export function reelReadyMessage(pillar: string | null): string {
  return `New reel ready: ${pillar || "no topic"} · instagram`;
}

/** Laptop source path → "<dir>/<stem>-reel.mp4" so the library label says which copy it is. */
export function reelSourcePath(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  const ext = extname(sourcePath);
  const dir = dirname(sourcePath);
  const name = `${basename(sourcePath, ext)}-reel.mp4`;
  return dir && dir !== "." ? `${dir}${sourcePath.includes("\\") ? "\\" : "/"}${name}` : name;
}

const fail = async (db: Queryable, id: string, reason: string) => {
  await db.query(`update media_edits set status = 'failed', finished_at = now(), error = $2 where id = $1 and status = 'running'`, [id, reason]);
};

const mondayOf = (ymd: string) => addCalendarDays(ymd, -weekdayIndex(ymd));

/** Normalises the stored params (jsonb from the web form) into planReel input. */
export function reelParamsOf(raw: unknown): ReelParams | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (!isReelAudio(p.audio)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { trimStartS: num(p.trimStartS), trimEndS: num(p.trimEndS), audio: p.audio, soundVolume: num(p.soundVolume), originalVolume: num(p.originalVolume) };
}

export interface ReelDraftInput {
  editId: string;
  mediaId: string;
  pillar: string | null;
  caption: string;
  now: Date;
  timeZone: string | undefined;
}

// F20 E reel draft write (idempotency + editor-pipeline lock)
/**
 * Inside one transaction: lock the creator-local weeks the window touches ('batch-week:<monday>', sorted,
 * same key as weekly-draft / daily-instagram / the editor pipeline) → existing posts → assignSlots for one
 * Instagram item in [now + 2 h, now + 7 d) (flex grid fallback via sameDay) → newest non-archived batch of
 * that week, else a new draft batch → the item (ingest_key 'reel:<editId>:instagram', on conflict do
 * nothing) + an 'add' event + one 'ready-for-approval' alert. Status 'draft', approved_at never set.
 * No free slot or no TZ_CREATOR → the item is untimed in the window's first week (the creator picks a time).
 */
export async function writeReelDraft(q: Queryable, i: ReelDraftInput): Promise<{ batchItemId: string; scheduledFor: string | null; inserted: boolean; duplicate?: boolean }> {
  const key = reelIngestKey(i.editId);
  const notBefore = new Date(i.now.getTime() + REEL_LEAD_MS);
  const notAfter = new Date(i.now.getTime() + REEL_WINDOW_DAYS * 86_400_000);
  const tz = i.timeZone;
  const firstDay = localDate(notBefore, tz ?? "UTC");
  const lastDay = localDate(notAfter, tz ?? "UTC");
  const weeks = [...new Set([mondayOf(firstDay), mondayOf(lastDay)])].sort();
  for (const w of weeks) await q.query(`select pg_advisory_xact_lock(hashtext('batch-week:' || $1::text))`, [w]);

  const prior = await q.query(`select id, scheduled_for from batch_items where ingest_key = $1`, [key]);
  if (prior.rows[0]) {
    const at = prior.rows[0].scheduled_for;
    return { batchItemId: String(prior.rows[0].id), scheduledFor: at == null ? null : new Date(at).toISOString(), inserted: false };
  }

  let scheduledFor: string | null = null;
  if (tz) {
    const from = localToUtc(firstDay, "00:00", tz);
    const to = localToUtc(addCalendarDays(lastDay, 1), "00:00", tz);
    const span = await q.query(
      `select platform, scheduled_for from batch_items
        where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz and scheduled_for < $2::timestamptz`,
      [from.toISOString(), to.toISOString()],
    );
    const existing = span.rows.map((r) => ({ platform: r.platform as "instagram", scheduledFor: new Date(r.scheduled_for).toISOString() }));
    const item: ScheduleItem = {
      key: i.mediaId,
      pillar: i.pillar ?? undefined,
      platforms: ["instagram"],
      window: { notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() },
      sameDay: true,
    };
    const plan = assignSlots({ weekStart: firstDay, days: diffCalendarDays(firstDay, lastDay) + 1, items: [item], cadence: await loadCadence(q), timeZone: tz, existing, now: i.now });
    scheduledFor = plan.assignments[0]?.scheduledFor ?? null;
  }
  // Duplicate guard v2 (F26 A, recentVideoUse): the same video (this clip, its lineage without new edits, a fingerprint
  // or name match) already on Instagram within 90 days → no second draft; the edit points at the existing item instead.
  // A reel with ≥ 3 s of new edits (new sound, trim) is "derived": a warning in the calendar, not a block.
  const dup = await recentVideoUse(q, { mediaId: i.mediaId, platform: "instagram", at: scheduledFor, now: i.now });
  if (dup.level === "block" && dup.hit) return { batchItemId: dup.hit.id, scheduledFor: dup.hit.scheduledFor, inserted: false, duplicate: true };

  const week = scheduledFor && tz ? mondayOf(localDate(new Date(scheduledFor), tz)) : weeks[0]!;

  const found = await q.query(`select id from batches where week_start = $1::date and status <> 'archived' order by created_at desc, id desc limit 1`, [week]);
  let batchId = found.rows[0]?.id as string | undefined;
  if (!batchId) batchId = (await q.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [week])).rows[0].id as string;

  const ins = await q.query(
    `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, created_at, updated_at)
     values ($1, $2, 'instagram', $3, null, $4::timestamptz, 'draft', 'reel', $5, null, $6, $6)
     on conflict (ingest_key) where ingest_key is not null do nothing
     returning id`,
    [batchId, i.mediaId, i.caption, scheduledFor, key, i.now],
  );
  const id = ins.rows[0]?.id as string | undefined;
  if (!id) {
    const again = (await q.query(`select id, scheduled_for from batch_items where ingest_key = $1`, [key])).rows[0];
    return { batchItemId: String(again.id), scheduledFor: again.scheduled_for == null ? null : new Date(again.scheduled_for).toISOString(), inserted: false };
  }
  await q.query(
    `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, null, $3)`,
    [id, JSON.stringify({ origin: "reel", editId: i.editId }), i.now],
  );
  await q.query(
    `insert into alerts (kind, batch_item_id, platform, message, created_at) values ('ready-for-approval', $1, 'instagram', $2, $3)
     on conflict (kind, batch_item_id) do nothing`,
    [id, reelReadyMessage(i.pillar), i.now],
  );
  await q.query(`update batches set updated_at = $2 where id = $1`, [batchId, i.now]);
  return { batchItemId: id, scheduledFor, inserted: true };
}
// End of F20 E reel draft write.

export async function runMediaReelOnce(d: MediaReelDeps): Promise<MediaReelOutcome> {
  const log = d.log ?? ((l: string) => console.log(l));
  const only = d.onlyEditIds ?? null;
  const runner = d.runner ?? ffmpegReelRunner;
  const tx = d.transaction ?? (<T>(fn: (q: Queryable) => Promise<T>) => fn(d.db));
  await d.db.query(
    `update media_edits set status = 'failed', finished_at = now(), error = 'Making the reel was interrupted. Make it again.'
      where status = 'running' and started_at < now() - interval '${STALE_RUNNING}' and ($1::uuid[] is null or id = any($1))`,
    [only],
  );
  const claimed = await d.db.query(
    `update media_edits set status = 'running', started_at = now()
      where id = (select id from media_edits where status = 'queued' and ($1::uuid[] is null or id = any($1))
                   order by requested_at for update skip locked limit 1)
      returning id, kind, source_media_id, sound_id, params, caption`,
    [only],
  );
  const job = claimed.rows[0] as { id: string; kind: string; source_media_id: string; sound_id: string | null; params: unknown; caption: string } | undefined;
  if (!job) return { kind: "idle" };
  const failed = async (reason: string): Promise<MediaReelOutcome> => {
    await fail(d.db, job.id, reason);
    return { kind: "failed", editId: job.id, reason };
  };

  if (!d.storage) {
    await raiseMediaConfigAlert(d.db, REEL_STORAGE_ALERT, d.now?.());
    return failed(REEL_STORAGE_MISSING);
  }
  if (!(await (d.hasFfmpeg ?? (() => hasBinary("ffmpeg")))())) {
    await raiseMediaConfigAlert(d.db, REEL_FFMPEG_ALERT, d.now?.());
    return failed(FFMPEG_MISSING_MESSAGE);
  }
  if (job.kind === "studio") return runStudioJob(d, job, failed, log);

  const media = (await d.db.query("select id, r2_key, duration_s, qa, pillar, source_path, captured_at from media where id = $1", [job.source_media_id])).rows[0] as
    | { id: string; r2_key: string | null; duration_s: string | number | null; qa: QaResult | null; pillar: string | null; source_path: string | null; captured_at: Date | string | null }
    | undefined;
  if (!media?.r2_key) return failed("The clean file for this clip isn't in storage, so a reel can't be made from it.");
  const params = reelParamsOf(job.params);
  if (!params) return failed("The reel settings were incomplete. Make it again.");
  let soundKey: string | null = null;
  if (params.audio !== "original") {
    const s = job.sound_id ? (await d.db.query("select r2_key from sounds where id = $1", [job.sound_id])).rows[0] : null;
    if (!s?.r2_key) return failed("The sound for this reel is missing. Pick another one.");
    soundKey = String(s.r2_key);
  }
  const durationS = media.duration_s != null ? Number(media.duration_s) : Number(media.qa?.probe?.durationS ?? 0);
  const plan = planReel({ ...params, durationS, sourceHasAudio: media.qa?.probe?.hasAudio !== false });
  if (plan.refusal) return failed(plan.refusal);

  const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-reel-"))))();
  try {
    const input = join(tmp, "in.mp4");
    const sound = soundKey ? join(tmp, `sound${extname(soundKey) || ".m4a"}`) : null;
    const out = join(tmp, "reel.mp4");
    await d.storage.download(media.r2_key, input);
    if (soundKey && sound) await d.storage.download(soundKey, sound);
    const { after } = await runner.render(input, sound, out, plan, { timeoutMs: d.timeoutMs, capFps: Number(media.qa?.probe?.fps ?? 0) > 60.5 });

    // Same steps as a normal ingest: (strip done by runReel) → probe + QA → hash → upload → poster → row.
    const qa = await runner.qa(out);
    const hash = await sha256File(out);
    const key = `library/${hash}.mp4`;
    await d.storage.upload(key, out, "video/mp4");
    let posterKey: string | null = `posters/${hash}.jpg`;
    try {
      const jpg = join(tmp, "poster.jpg");
      await runner.poster(out, jpg, qa.probe?.durationS ?? after.durationS);
      await d.storage.upload(posterKey, jpg, "image/jpeg");
    } catch (err) {
      log(`[media-reel] poster skipped for edit ${job.id.slice(0, 8)}: ${String((err as Error).message).split("\n")[0]}`);
      posterKey = null;
    }
    const row = await insertMediaRow(d.db, {
      contentHash: hash,
      sourcePath: reelSourcePath(media.source_path),
      r2Key: key,
      durationS: qa.probe?.durationS ?? after.durationS,
      width: qa.probe?.width ?? after.width,
      height: qa.probe?.height ?? after.height,
      pillar: media.pillar,
      qa,
      capturedAt: media.captured_at ? new Date(media.captured_at).toISOString() : null,
      posterKey,
      derivedFrom: media.id,
    });
    if (row.inserted) await fingerprintNewMedia(d.db, row.id, out, qa.probe?.durationS ?? after.durationS, { fingerprint: d.fingerprint, log, tag: "media-reel" });
    const now = d.now?.() ?? new Date();
    const draft = await tx(async (q) => {
      // Link the result first, so the duplicate guard sees this reel's edits (sound / trim) when it relates it to its source.
      await q.query(`update media_edits set result_media_id = $2 where id = $1 and status = 'running'`, [job.id, row.id]);
      const w = await writeReelDraft(q, { editId: job.id, mediaId: row.id, pillar: media.pillar, caption: job.caption, now, timeZone: d.timeZone });
      await q.query(
        `update media_edits set status = 'done', finished_at = now(), result_media_id = $2, batch_item_id = $3, error = null where id = $1 and status = 'running'`,
        [job.id, row.id, w.batchItemId],
      );
      return w;
    });
    log(`[media-reel] done ${job.id.slice(0, 8)} · ${plan.audio} · ${plan.durationS}s · draft ${draft.scheduledFor ? "timed" : "untimed"}`);
    return { kind: "done", editId: job.id, mediaId: row.id, batchItemId: draft.batchItemId, scheduledFor: draft.scheduledFor };
  } catch (err) {
    // Plain words only; never echo paths, keys or upstream bodies.
    const reason = err instanceof FixError ? err.message : "Making the reel failed (storage or processing error). Nothing was posted.";
    if (err instanceof FixError && err.code === "ffmpeg-missing") await raiseMediaConfigAlert(d.db, REEL_FFMPEG_ALERT, d.now?.());
    if (!(err instanceof FixError)) log(`[media-reel] failed ${job.id.slice(0, 8)}: ${(err as Error)?.name ?? "error"}`);
    return failed(reason);
  } finally {
    rmSync(tmp, { recursive: true, force: true }); // the job's own temp dir only
  }
}

// F24 Studio render
type StudioMedia = { id: string; r2_key: string | null; pillar: string | null; source_path: string | null; captured_at: Date | string | null };

/**
 * The Studio branch: EDL from params (re-validated with the web's own parseEdl) → each distinct clip and the sound
 * downloaded once → runEdl → QA → hash → upload → poster at coverS → media row (folder "Studio", derived_from = the
 * first clip) → status 'done'. No batch item, no alert, nothing approved.
 */
async function runStudioJob(
  d: MediaReelDeps,
  job: { id: string; params: unknown },
  failed: (reason: string) => Promise<MediaReelOutcome>,
  log: (line: string) => void,
): Promise<MediaReelOutcome> {
  const runner = d.studioRunner ?? ffmpegStudioRunner;
  const parsed = parseEdl(job.params);
  if (!parsed.ok) return failed(`The Studio edit couldn't be used: ${parsed.error}`);
  const edl = parsed.edl;
  const ids = [...new Set(edl.clips.map((c) => c.mediaId))];
  const rows = (
    await d.db.query(`select id, r2_key, pillar, source_path, captured_at from media where id = any($1::uuid[]) and status <> 'archived' and r2_key is not null`, [ids])
  ).rows as StudioMedia[];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  if (ids.some((id) => !byId.get(id)?.r2_key)) return failed("A clip in this edit isn't in the library any more, so it can't be made.");
  let soundKey: string | null = null;
  if (edl.sound) {
    const s = (await d.db.query("select r2_key from sounds where id = $1", [edl.sound.soundId])).rows[0];
    if (!s?.r2_key) return failed("The sound for this edit is missing. Pick another one.");
    soundKey = String(s.r2_key);
  }
  const first = byId.get(edl.clips[0]!.mediaId)!;
  const storage = d.storage!;

  const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-studio-"))))();
  try {
    const local = new Map<string, string>();
    for (const [k, id] of ids.entries()) {
      const p = join(tmp, `clip-${k}.mp4`);
      await storage.download(byId.get(id)!.r2_key!, p); // each distinct clip once
      local.set(id, p);
    }
    const sound = soundKey ? join(tmp, `sound${extname(soundKey) || ".m4a"}`) : undefined;
    if (soundKey && sound) await storage.download(soundKey, sound);
    const fonts = studioFonts(d.env ?? process.env);
    const out = join(tmp, "studio.mp4");
    const r = await runner.render(
      edl,
      { clipPaths: edl.clips.map((c) => local.get(c.mediaId)!), soundPath: sound, fontPath: fonts.bold, plainFontPath: fonts.plain, outPath: out },
      { timeoutMs: d.timeoutMs },
    );

    const qa = await runner.qa(out);
    const hash = await sha256File(out);
    const key = `library/${hash}.mp4`;
    await storage.upload(key, out, "video/mp4");
    const durationS = qa.probe?.durationS ?? r.durationS;
    let posterKey: string | null = `posters/${hash}.jpg`;
    try {
      const jpg = join(tmp, "poster.jpg");
      await runner.poster(out, jpg, { durationS, coverS: edl.coverS });
      await storage.upload(posterKey, jpg, "image/jpeg");
    } catch (err) {
      log(`[media-reel] studio poster skipped for edit ${job.id.slice(0, 8)}: ${String((err as Error).message).split("\n")[0]}`);
      posterKey = null;
    }
    const row = await insertMediaRow(d.db, {
      contentHash: hash,
      sourcePath: studioSourcePath(first.source_path),
      r2Key: key,
      durationS,
      width: qa.probe?.width ?? r.after.width,
      height: qa.probe?.height ?? r.after.height,
      pillar: first.pillar,
      qa,
      capturedAt: first.captured_at ? new Date(first.captured_at).toISOString() : null,
      posterKey,
      derivedFrom: first.id,
      folder: STUDIO_FOLDER,
    });
    if (row.inserted) await fingerprintNewMedia(d.db, row.id, out, durationS, { fingerprint: d.fingerprint, log, tag: "media-reel" });
    await d.db.query(`update media_edits set status = 'done', finished_at = now(), result_media_id = $2, error = null where id = $1 and status = 'running'`, [job.id, row.id]);
    log(`[media-reel] studio done ${job.id.slice(0, 8)} · ${edl.clips.length} clips · ${r.durationS}s`);
    return { kind: "studio-done", editId: job.id, mediaId: row.id };
  } catch (err) {
    const reason = err instanceof FixError ? err.message : "The Studio export failed (storage or processing error). Nothing was posted.";
    if (err instanceof FixError && err.code === "ffmpeg-missing") await raiseMediaConfigAlert(d.db, REEL_FFMPEG_ALERT, d.now?.());
    if (!(err instanceof FixError)) log(`[media-reel] studio failed ${job.id.slice(0, 8)}: ${(err as Error)?.name ?? "error"}`);
    return failed(reason);
  } finally {
    rmSync(tmp, { recursive: true, force: true }); // the job's own temp dir only
  }
}
// End of F24 Studio render.

/** The pg-boss surface this job uses. */
export interface ReelBoss {
  createQueue(name: string): Promise<unknown>;
  work(name: string, options: { batchSize: number }, handler: (jobs: unknown) => Promise<unknown>): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: Record<string, unknown>): Promise<unknown>;
}

/** Every minute, one reel per tick, one worker at a time (batchSize 1 + skip locked). */
export async function registerMediaReelJob(boss: ReelBoss, deps: MediaReelDeps): Promise<void> {
  await boss.createQueue(QUEUES.mediaReel);
  await boss.work(QUEUES.mediaReel, { batchSize: 1 }, async () => {
    const r = await runMediaReelOnce(deps);
    if (r.kind === "failed") console.log(`[media-reel] failed ${r.editId.slice(0, 8)}: ${r.reason}`);
  });
  // A reel can take minutes: the job must not expire (and be retried) while ffmpeg is still running.
  await boss.schedule(QUEUES.mediaReel, "* * * * *", undefined, { singletonKey: "media-reel-tick", expireInSeconds: 60 * 60, retryLimit: 0 });
}
