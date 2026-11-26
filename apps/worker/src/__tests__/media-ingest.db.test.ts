import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeLocationTagKeys, type QaResult } from "@autopilot/media";
import { HAS_FFMPEG } from "../../../../packages/media/src/__tests__/ffmpeg-available.js";
import { makeClip } from "../../../../packages/media/src/__tests__/synthetic-clips.js";
import { completeUpload, putPart, startUpload } from "../../../web/lib/uploads/data.js";
import { fakeStorage } from "../../../web/lib/uploads/__tests__/fake-storage.js";
import {
  cleanupIncoming,
  INGEST_FAILED,
  INGEST_FFMPEG_ALERT,
  INGEST_INTERRUPTED,
  INGEST_STORAGE_ALERT,
  LOCATION_SURVIVED,
  runMediaIngestOnce,
  stripUpload,
  UPLOAD_NEVER_FINISHED,
  type IngestRunner,
} from "../jobs/media-ingest.js";

/**
 * Browser upload → worker ingest on the real dev DB (DATABASE_URL, migrated through 0017), ONE rolled-back
 * transaction. Storage is the in-memory fake the web tests use; the ffmpeg side is a fake runner (strip = copy),
 * except the last block, which runs real ffmpeg on a clip carrying a `location` tag.
 */
const url = process.env.DATABASE_URL;
const quiet = () => {};
const FROZEN = { code: "frozen-tail", severity: "fix", fixable: true, detail: "Frozen end." };
const fakeQa = (issues: object[] = []) =>
  ({
    version: 2,
    probe: { width: 1080, height: 1920, fps: 30, durationS: 5, hasAudio: true, hasLocationTags: false },
    blackSegments: [],
    frozenSegments: [],
    warnings: [],
    issues,
    silenceSegments: [],
    checkedAt: "2026-11-26T00:00:00Z",
  }) as unknown as QaResult;

function fakeRunner(over: Partial<IngestRunner> = {}): IngestRunner & { stripped: number } {
  const r = {
    stripped: 0,
    async strip(input: string, out: string) {
      r.stripped++;
      copyFileSync(input, out);
      return { capturedAt: "2026-11-20T10:00:00.000Z" };
    },
    async locationKeys() {
      return [];
    },
    async qa() {
      return fakeQa([FROZEN]);
    },
    async poster(_p: string, jpg: string) {
      writeFileSync(jpg, "jpg");
    },
    ...over,
  };
  return r;
}

describe.skipIf(!url)("media-ingest job (db, fake storage + runner)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const storage = fakeStorage();
  const row = async (id: string) => (await db.query("select * from uploads where id = $1", [id])).rows[0];
  /** start → one part → complete, as the browser does. */
  const uploaded = async (content: string, f: { name?: string; relPath?: string } = {}) => {
    const body = new TextEncoder().encode(content);
    const s = await startUpload(db, storage, { name: f.name ?? `clip-${run}.mov`, size: body.byteLength, type: "video/quicktime", relPath: f.relPath }, quiet);
    if (!s.ok) throw new Error(s.error);
    expect(await putPart(db, storage, s.uploadId, 1, body, quiet)).toMatchObject({ ok: true });
    expect(await completeUpload(db, storage, s.uploadId, quiet)).toEqual({ ok: true, status: "uploaded" });
    return s.uploadId;
  };
  const ingest = (ids: string[], runner: IngestRunner = fakeRunner(), over: object = {}) =>
    runMediaIngestOnce({ db, storage, runner, hasFfmpeg: async () => true, onlyUploadIds: ids, log: quiet, ...over });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    await db.query("delete from settings where key = 'touchup_autofix'"); // default: auto-fix on
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("done: media row with the folder name + basename only, clean file + poster stored, raw incoming deleted, auto-fix queued", async () => {
    const id = await uploaded(`bytes-a-${run}`, { relPath: `Training 2026/Upper body/clip-${run}.mov` });
    const key = (await row(id)).r2_key;
    expect(storage.objects.has(key)).toBe(true);
    const r = await ingest([id]);
    expect(r).toEqual({ kind: "done", uploadId: id, mediaId: expect.any(String) });
    const u = await row(id);
    expect(u).toMatchObject({ status: "done", error: null, s3_upload_id: null });
    expect(u.finished_at).not.toBeNull();
    expect(u.media_id).toBe((r as { mediaId: string }).mediaId);
    const m = (await db.query("select * from media where id = $1", [u.media_id])).rows[0];
    expect(m).toMatchObject({ source_path: `clip-${run}.mov`, folder: "Upper body", status: "ready", derived_from: null, pillar: null });
    expect(m.r2_key).toMatch(/^library\/[0-9a-f]{64}\.mp4$/);
    expect(m.poster_key).toMatch(/^posters\/[0-9a-f]{64}\.jpg$/);
    expect(new Date(m.captured_at).toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(JSON.stringify(m)).not.toContain("Training 2026");
    expect(storage.objects.has(m.r2_key)).toBe(true);
    expect(storage.objects.has(key)).toBe(false);
    expect((await db.query("select status, ops from media_fixes where media_id = $1", [m.id])).rows).toEqual([{ status: "queued", ops: ["trim"] }]);
  });

  it("duplicate: same clean bytes → 'duplicate' pointing at the existing clip, no second media row, raw deleted", async () => {
    const first = await uploaded(`bytes-dup-${run}`, { name: `first-${run}.mp4` });
    const a = await ingest([first]);
    expect(a.kind).toBe("done");
    const second = await uploaded(`bytes-dup-${run}`, { name: `second-${run}.mp4`, relPath: `Other/second-${run}.mp4` });
    const key = (await row(second)).r2_key;
    const uploadsBefore = storage.calls.filter((c) => c === "upload").length;
    const b = await ingest([second]);
    expect(b).toEqual({ kind: "duplicate", uploadId: second, mediaId: (a as { mediaId: string }).mediaId });
    expect(await row(second)).toMatchObject({ status: "duplicate", media_id: (a as { mediaId: string }).mediaId, s3_upload_id: null });
    expect(storage.calls.filter((c) => c === "upload").length).toBe(uploadsBefore);
    expect(storage.objects.has(key)).toBe(false);
    expect((await db.query("select count(*)::int n from media where source_path = $1", [`second-${run}.mp4`])).rows[0].n).toBe(0);
  });

  it("failure: plain reason, no media row, raw kept 24 h, then the cleanup deletes it", async () => {
    const id = await uploaded(`bytes-fail-${run}`);
    const key = (await row(id)).r2_key;
    const r = await ingest([id], fakeRunner({ qa: async () => Promise.reject(new Error("/secret/path broke")) }));
    expect(r).toEqual({ kind: "failed", uploadId: id, reason: INGEST_FAILED });
    expect(await row(id)).toMatchObject({ status: "failed", error: INGEST_FAILED, media_id: null });
    expect(storage.objects.has(key)).toBe(true);
    expect(await ingest([id])).toEqual({ kind: "idle" });
    expect(storage.objects.has(key)).toBe(true);
    await db.query("update uploads set finished_at = now() - interval '25 hours' where id = $1", [id]);
    expect(await cleanupIncoming({ db, storage, onlyUploadIds: [id] })).toEqual({ closed: 0, cleaned: 1 });
    expect(storage.objects.has(key)).toBe(false);
    expect((await row(id)).s3_upload_id).toBeNull();
    expect(await cleanupIncoming({ db, storage, onlyUploadIds: [id] })).toEqual({ closed: 0, cleaned: 0 });
  });

  it("a location tag that survives the strip → failed, nothing stored, no media row", async () => {
    const id = await uploaded(`bytes-loc-${run}`);
    const before = storage.calls.filter((c) => c === "upload").length;
    const r = await ingest([id], fakeRunner({ locationKeys: async () => ["com.apple.quicktime.location.ISO6709"] }));
    expect(r).toEqual({ kind: "failed", uploadId: id, reason: LOCATION_SURVIVED });
    expect(await row(id)).toMatchObject({ status: "failed", error: LOCATION_SURVIVED, media_id: null });
    expect(storage.calls.filter((c) => c === "upload").length).toBe(before);
  });

  it("no storage / no ffmpeg: the upload waits (not failed) and ONE config alert is raised", async () => {
    const id = await uploaded(`bytes-cfg-${run}`);
    for (const msg of [INGEST_STORAGE_ALERT, INGEST_FFMPEG_ALERT]) await db.query("update alerts set acknowledged_at = now() where kind = 'config' and acknowledged_at is null and message = $1", [msg]);
    for (let i = 0; i < 2; i++) {
      expect((await ingest([id], fakeRunner(), { storage: null })).kind).toBe("paused");
      expect((await ingest([id], fakeRunner(), { hasFfmpeg: async () => false })).kind).toBe("paused");
    }
    expect((await row(id)).status).toBe("uploaded");
    for (const msg of [INGEST_STORAGE_ALERT, INGEST_FFMPEG_ALERT]) {
      expect((await db.query("select count(*)::int n from alerts where kind = 'config' and acknowledged_at is null and message = $1", [msg])).rows[0].n).toBe(1);
    }
    expect((await ingest([id])).kind).toBe("done");
  });

  it("stale processing → failed; unfinished uploads closed after 24 h; aborted rows' parts dropped", async () => {
    const stale = await uploaded(`bytes-stale-${run}`);
    await db.query("update uploads set status = 'processing', updated_at = now() - interval '3 hours' where id = $1", [stale]);
    expect(await ingest([stale])).toEqual({ kind: "idle" });
    expect(await row(stale)).toMatchObject({ status: "failed", error: INGEST_INTERRUPTED });

    const s = await startUpload(db, storage, { name: `open-${run}.mp4`, size: 10, type: "video/mp4" }, quiet);
    const open = (s as { uploadId: string }).uploadId;
    const mpu = (await row(open)).s3_upload_id;
    await db.query("update uploads set updated_at = now() - interval '25 hours' where id = $1", [open]);
    expect(await cleanupIncoming({ db, storage, onlyUploadIds: [open] })).toEqual({ closed: 1, cleaned: 1 });
    expect(await row(open)).toMatchObject({ status: "aborted", error: UPLOAD_NEVER_FINISHED, s3_upload_id: null });
    expect(storage.open.has(mpu)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("stripUpload (real ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-ingest-strip-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("an mp4 with a `location` metadata tag comes out without it (and without the device tag)", async () => {
    const clip = await makeClip(dir, "location-tag");
    expect(await probeLocationTagKeys(clip)).toContain("location");
    const out = join(dir, "clean.mp4");
    await stripUpload(clip, out);
    expect(await probeLocationTagKeys(out)).toEqual([]);
    expect(readFileSync(out).includes(Buffer.from("DemoPhone"))).toBe(false);
    expect(readFileSync(out).includes(Buffer.from("+00.0000+000.0000"))).toBe(false);
  }, 60_000);

  it.skipIf(!url)("the real runner end to end: upload → done, the stored clip has no location tag", async () => {
    const pool = new pg.Pool({ connectionString: url });
    const db = await pool.connect();
    await db.query("begin");
    try {
      const storage = fakeStorage();
      const clip = await makeClip(dir, "location-tag");
      const body = new Uint8Array(readFileSync(clip));
      const s = await startUpload(db, storage, { name: "gps.mp4", size: body.byteLength, type: "video/mp4" }, quiet);
      if (!s.ok) throw new Error(s.error);
      await putPart(db, storage, s.uploadId, 1, body, quiet);
      await completeUpload(db, storage, s.uploadId, quiet);
      const r = await runMediaIngestOnce({ db, storage, onlyUploadIds: [s.uploadId], log: quiet });
      expect(r.kind === "done" || r.kind === "duplicate").toBe(true);
      const key = (await db.query("select r2_key from media where id = $1", [(r as { mediaId: string }).mediaId])).rows[0].r2_key;
      const stored = join(dir, "stored.mp4");
      writeFileSync(stored, storage.objects.get(key)!);
      expect(await probeLocationTagKeys(stored)).toEqual([]);
    } finally {
      await db.query("rollback");
      db.release();
      await pool.end();
    }
  }, 120_000);
});
