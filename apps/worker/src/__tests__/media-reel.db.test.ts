import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixError, type FixStats, type MediaStorage, type QaResult } from "@autopilot/media";
import { PgOutboxStore } from "../jobs/outbox.js";
import { REEL_STORAGE_ALERT, reelIngestKey, reelReadyMessage, reelSourcePath, runMediaReelOnce, type ReelRunner } from "../jobs/media-reel.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0015), everything inside ONE transaction that is rolled back,
 * so no row survives. Storage is a fake (a local folder) and so is the ffmpeg runner: this checks the job's
 * DB behaviour (media row, draft item, alert, never approved), not the encode (packages/media reel.test.ts).
 * Each run claims only its own fixture edits (onlyEditIds), never a seeded queued edit.
 */
const url = process.env.DATABASE_URL;
const ZONE = "UTC"; // a test zone only, never the creator's

describe.skipIf(!url)("media-reel job (db, fake storage + runner)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), "autopilot-media-reel-db-"));
  const objects = new Map<string, string>();
  const uploads: Array<{ key: string; type: string }> = [];
  const storage: MediaStorage = {
    async download(key, to) {
      const from = objects.get(key);
      if (!from) throw new Error("no such object");
      copyFileSync(from, to);
    },
    async upload(key, from, type) {
      const keep = join(dir, `up-${uploads.length}`);
      copyFileSync(from, keep);
      objects.set(key, keep);
      uploads.push({ key, type });
    },
  };
  const renders: Array<{ sound: string | null; durationS: number; audio: string }> = [];
  const stats: FixStats = { durationS: 9, loudnessLufs: -14, videoCodec: "h264", width: 1080, height: 1920, sizeBytes: 10 };
  const qa = { version: 2, issues: [], warnings: [], probe: { durationS: 9, width: 1080, height: 1920, hasAudio: true, fps: 30 } } as unknown as QaResult;
  let failNext: Error | null = null;
  const runner: ReelRunner = {
    async render(input, sound, out, plan) {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      renders.push({ sound, durationS: plan.durationS, audio: plan.audio });
      copyFileSync(input, out);
      appendFileSync(out, `reel-${run}-${renders.length}`); // unique bytes → unique hash per render
      return { after: stats };
    },
    qa: async () => qa,
    poster: async (_p, jpg) => writeFileSync(jpg, "jpg"),
  };
  const base = { runner, storage, timeZone: ZONE, hasFfmpeg: async () => true, log: () => {} };
  let mediaId: string;
  let soundId: string;

  const edit = async (over: { sound?: string | null; params?: object; caption?: string; media?: string } = {}) =>
    (
      await db.query(`insert into media_edits (source_media_id, sound_id, params, caption) values ($1, $2, $3::jsonb, $4) returning id`, [
        over.media ?? mediaId,
        over.sound === undefined ? soundId : over.sound,
        JSON.stringify(over.params ?? { trimStartS: 1, trimEndS: 10, audio: "sound", soundVolume: 1, originalVolume: null }),
        over.caption ?? `leg day, slow and steady #gym #legs ${run}`,
      ])
    ).rows[0].id as string;
  const count = async (sql: string, params: unknown[]) => Number((await db.query(sql, params)).rows[0].n);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    const clip = join(dir, "clip.mp4");
    writeFileSync(clip, `clip-${run}`);
    objects.set(`library/dbt-reel-${run}.mp4`, clip);
    const snd = join(dir, "s.m4a");
    writeFileSync(snd, "sound");
    objects.set(`sounds/dbt-${run}.m4a`, snd);
    mediaId = (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at)
         values ($1, $2, $3, 12, 1920, 1080, 'gym', 'ready', $4::jsonb, '2026-01-02T03:04:05Z') returning id`,
        [`dbt-reel-src-${run}`, `/clips/${run}.mov`, `library/dbt-reel-${run}.mp4`, JSON.stringify(qa)],
      )
    ).rows[0].id;
    soundId = (await db.query(`insert into sounds (name, r2_key, duration_s) values ('beat', $1, 30) returning id`, [`sounds/dbt-${run}.m4a`])).rows[0].id;
  });

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("done: a new media row derived from the clip, one DRAFT Instagram item in [now+2h, now+7d), one alert; never approved", async () => {
    const before = (await db.query("select * from media where id = $1", [mediaId])).rows[0];
    const id = await edit();
    const now = new Date();
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id], now: () => now });
    expect(r.kind).toBe("done");
    if (r.kind !== "done") return;
    expect(renders.at(-1)).toMatchObject({ durationS: 9, audio: "sound" });
    expect(renders.at(-1)!.sound).toMatch(/sound\.m4a$/);

    const e = (await db.query("select * from media_edits where id = $1", [id])).rows[0];
    expect(e).toMatchObject({ status: "done", result_media_id: r.mediaId, batch_item_id: r.batchItemId, error: null });

    const m = (await db.query("select * from media where id = $1", [r.mediaId])).rows[0];
    expect(m.derived_from).toBe(mediaId);
    expect(m.status).toBe("ready");
    expect(m.pillar).toBe("gym");
    expect(m.r2_key).toMatch(/^library\/[0-9a-f]{64}\.mp4$/);
    expect(m.poster_key).toMatch(/^posters\/[0-9a-f]{64}\.jpg$/);
    expect(m.source_path).toBe(`/clips/${run}-reel.mp4`);
    expect(uploads.map((u) => u.type)).toEqual(["video/mp4", "image/jpeg"]);
    expect((await db.query("select * from media where id = $1", [mediaId])).rows[0]).toEqual(before);

    const bi = (await db.query("select bi.*, b.status as batch_status, b.week_start from batch_items bi join batches b on b.id = bi.batch_id where bi.id = $1", [r.batchItemId])).rows[0];
    expect(bi).toMatchObject({ platform: "instagram", status: "draft", origin: "reel", ingest_key: reelIngestKey(id), media_id: r.mediaId, approved_at: null, trial: null });
    expect(bi.caption).toBe(`leg day, slow and steady #gym #legs ${run}`);
    expect(bi.batch_status).not.toBe("approved");
    const at = new Date(bi.scheduled_for).getTime();
    expect(at).toBeGreaterThanOrEqual(now.getTime() + 2 * 3_600_000);
    expect(at).toBeLessThan(now.getTime() + 7 * 86_400_000);
    expect(r.scheduledFor).toBe(new Date(bi.scheduled_for).toISOString());

    expect(await count(`select count(*)::int n from batch_item_events where batch_item_id = $1 and kind = 'add' and to_status = 'draft'`, [r.batchItemId])).toBe(1);
    const alerts = (await db.query(`select * from alerts where batch_item_id = $1`, [r.batchItemId])).rows;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "ready-for-approval", platform: "instagram", message: reelReadyMessage("gym") });
    expect(alerts[0].message).toBe("New reel ready: gym · instagram");
    expect(alerts[0].message).not.toContain("leg day");

    // The outbox never sees it: not approved, not in an approved batch (far-future "now" so time can't be the reason).
    const due = await new PgOutboxStore(db as unknown as ConstructorParameters<typeof PgOutboxStore>[0], "https://m", () => {}).listDue(new Date("2099-01-01T00:00:00Z"));
    expect(due.map((p) => p.id)).not.toContain(r.batchItemId);
    expect(due.filter((p) => p.mediaId === r.mediaId)).toEqual([]);

    // A second tick does not redo a done edit.
    const again = await runMediaReelOnce({ ...base, db, onlyEditIds: [id], now: () => now });
    expect(again.kind).toBe("idle");
    expect(await count(`select count(*)::int n from batch_items where ingest_key = $1`, [reelIngestKey(id)])).toBe(1);
    expect(await count(`select count(*)::int n from media where derived_from = $1`, [mediaId])).toBe(1);
  });

  it("original audio: no sound is downloaded", async () => {
    const id = await edit({ sound: null, params: { audio: "original" } });
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id] });
    expect(r.kind).toBe("done");
    expect(renders.at(-1)).toMatchObject({ sound: null, audio: "original", durationS: 12 });
  });

  it("failure: the runner's plain-words error is stored; no media row, no item", async () => {
    const id = await edit();
    const mediaBefore = await count(`select count(*)::int n from media where derived_from = $1`, [mediaId]);
    failNext = new FixError("ffmpeg couldn't make this reel.");
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id] });
    expect(r).toEqual({ kind: "failed", editId: id, reason: "ffmpeg couldn't make this reel." });
    expect((await db.query("select status, error, result_media_id, batch_item_id from media_edits where id = $1", [id])).rows[0]).toEqual({
      status: "failed",
      error: "ffmpeg couldn't make this reel.",
      result_media_id: null,
      batch_item_id: null,
    });
    expect(await count(`select count(*)::int n from media where derived_from = $1`, [mediaId])).toBe(mediaBefore);
    expect(await count(`select count(*)::int n from batch_items where ingest_key = $1`, [reelIngestKey(id)])).toBe(0);
    // Failed stays failed.
    expect((await runMediaReelOnce({ ...base, db, onlyEditIds: [id] })).kind).toBe("idle");
  });

  it("failure: a storage error never echoes keys; an archived/missing sound and a bad trim are refused before any download", async () => {
    const id = await edit({ media: (await db.query(`insert into media (content_hash, r2_key, duration_s, pillar, status) values ($1, $2, 12, 'gym', 'ready') returning id`, [`dbt-reel-gone-${run}`, `library/gone-${run}.mp4`])).rows[0].id });
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id] });
    expect(r.kind === "failed" && r.reason).toBe("Making the reel failed (storage or processing error). Nothing was posted.");

    const noSound = await edit({ sound: null });
    expect(await runMediaReelOnce({ ...base, db, onlyEditIds: [noSound] })).toMatchObject({ kind: "failed", reason: "The sound for this reel is missing. Pick another one." });
    const short = await edit({ params: { audio: "sound", trimStartS: 10, trimEndS: 11 } });
    expect(await runMediaReelOnce({ ...base, db, onlyEditIds: [short] })).toMatchObject({ kind: "failed", reason: "A reel must be at least 3 seconds long." });
  });

  it("no storage: failed with one config alert (deduped)", async () => {
    const a = await edit();
    const b = await edit();
    await runMediaReelOnce({ ...base, storage: null, db, onlyEditIds: [a] });
    await runMediaReelOnce({ ...base, storage: null, db, onlyEditIds: [b] });
    expect((await db.query("select status from media_edits where id = any($1)", [[a, b]])).rows.map((x) => x.status)).toEqual(["failed", "failed"]);
    expect(await count(`select count(*)::int n from alerts where kind = 'config' and message = $1 and acknowledged_at is null`, [REEL_STORAGE_ALERT])).toBe(1);
  });

  it("no TZ_CREATOR: the draft is left untimed (never a guessed zone)", async () => {
    const id = await edit();
    const r = await runMediaReelOnce({ ...base, timeZone: undefined, db, onlyEditIds: [id] });
    expect(r.kind === "done" && r.scheduledFor).toBeNull();
    expect((await db.query(`select status, scheduled_for, approved_at from batch_items where ingest_key = $1`, [reelIngestKey(id)])).rows[0]).toEqual({ status: "draft", scheduled_for: null, approved_at: null });
  });

  it("reelSourcePath labels the copy", () => {
    expect(reelSourcePath("/clips/a.mov")).toBe("/clips/a-reel.mp4");
    expect(reelSourcePath("a.mp4")).toBe("a-reel.mp4");
    expect(reelSourcePath(null)).toBeNull();
  });
});
