import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FFMPEG_MISSING_MESSAGE, runQa } from "@autopilot/media";
import { HAS_FFMPEG } from "../../../../packages/media/src/__tests__/ffmpeg-available.js";
import { makeClip } from "../../../../packages/media/src/__tests__/synthetic-clips.js";
import { fixedSourcePath, MEDIA_FIX_CONFIG_MESSAGE, runMediaFixOnce, STORAGE_MISSING_MESSAGE, type MediaStorage } from "../jobs/media-fix.js";
import { runMediaRecheckOnce } from "../jobs/media-recheck.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0014), everything inside ONE transaction that is rolled back,
 * so no row survives. Storage is a fake (a local folder); ffmpeg is real. Each run claims only its own
 * fixture rows (onlyFixIds / onlyMediaIds), never a seeded queued fix.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url || !HAS_FFMPEG)("media-fix + media-recheck jobs (db, needs ffmpeg)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), "autopilot-media-fix-db-"));
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
  let mediaId: string;

  const media = async (hash: string, r2Key: string, qa: unknown) =>
    (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at)
         values ($1, $2, $3, 12, 540, 960, 'gym', 'ready', $4::jsonb, '2026-01-02T03:04:05Z') returning id`,
        [hash, `/clips/${hash}.mp4`, r2Key, qa === null ? null : JSON.stringify(qa)],
      )
    ).rows[0].id as string;
  const fix = async (id: string, ops: string[]) => (await db.query("insert into media_fixes (media_id, ops) values ($1, $2) returning id", [id, ops])).rows[0].id as string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    const clip = await makeClip(dir, "frozen-tail-3s");
    objects.set(`library/dbt-${run}.mp4`, clip);
    mediaId = await media(`dbt-fix-${run}`, `library/dbt-${run}.mp4`, await runQa(clip));
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("done: a new media row derived from the original, uploaded under a new key with a poster; the original is untouched", async () => {
    const before = (await db.query("select * from media where id = $1", [mediaId])).rows[0];
    const fixId = await fix(mediaId, ["trim"]);
    const r = await runMediaFixOnce({ db, storage, onlyFixIds: [fixId], log: () => {} });
    expect(r.kind).toBe("done");
    const f = (await db.query("select * from media_fixes where id = $1", [fixId])).rows[0];
    expect(f.status).toBe("done");
    expect(f.ops).toEqual(["trim", "strip"]);
    expect(f.before.durationS).toBeCloseTo(12, 0);
    expect(f.after.durationS).toBeCloseTo(9, 0);
    const fixed = (await db.query("select * from media where id = $1", [f.fixed_media_id])).rows[0];
    expect(fixed.derived_from).toBe(mediaId);
    expect(fixed.status).toBe("ready");
    expect(fixed.r2_key).toMatch(/^library\/[0-9a-f]{64}\.mp4$/);
    expect(fixed.poster_key).toMatch(/^posters\/[0-9a-f]{64}\.jpg$/);
    expect(fixed.source_path).toBe(`/clips/dbt-fix-${run}-fixed.mp4`);
    expect(fixed.qa.version).toBe(2);
    expect(fixed.qa_checked_at).not.toBeNull();
    expect(uploads.map((u) => u.type)).toEqual(["video/mp4", "image/jpeg"]);
    const after = (await db.query("select * from media where id = $1", [mediaId])).rows[0];
    expect(after).toEqual(before);
  }, 120_000);

  it("ffmpeg missing: the fix fails with the plain message and ONE config alert, however many fixes fail", async () => {
    await db.query("update alerts set acknowledged_at = now() where kind = 'config' and acknowledged_at is null and message = $1", [MEDIA_FIX_CONFIG_MESSAGE]);
    const other = await media(`dbt-nof-${run}`, `library/dbt-${run}.mp4`, null);
    const ids = [await fix(other, ["strip"])];
    const second = await media(`dbt-nof2-${run}`, `library/dbt-${run}.mp4`, null);
    ids.push(await fix(second, ["strip"]));
    for (const id of ids) {
      const r = await runMediaFixOnce({ db, storage, onlyFixIds: [id], hasFfmpeg: async () => false });
      expect(r).toEqual({ kind: "failed", fixId: id, reason: FFMPEG_MISSING_MESSAGE });
    }
    const st = (await db.query("select status, error from media_fixes where id = any($1)", [ids])).rows;
    expect(st).toEqual([
      { status: "failed", error: FFMPEG_MISSING_MESSAGE },
      { status: "failed", error: FFMPEG_MISSING_MESSAGE },
    ]);
    const alerts = (await db.query("select platform from alerts where kind = 'config' and acknowledged_at is null and message = $1", [MEDIA_FIX_CONFIG_MESSAGE])).rows;
    expect(alerts).toEqual([{ platform: "all" }]);
  });

  it("no storage configured: fails in plain words; a second open fix for the same clip is refused by the index", async () => {
    const m = await media(`dbt-nos-${run}`, `library/dbt-${run}.mp4`, null);
    const id = await fix(m, ["strip"]);
    await db.query("savepoint dup");
    await expect(fix(m, ["strip"])).rejects.toThrow(/media_fixes_open_uq/);
    await db.query("rollback to savepoint dup");
    expect((await runMediaFixOnce({ db, storage: null, onlyFixIds: [id] })).kind).toBe("failed");
    expect((await db.query("select error from media_fixes where id = $1", [id])).rows[0].error).toBe(STORAGE_MISSING_MESSAGE);
  });

  it("refusal (> 30% cut) is stored as the reason; nothing new is uploaded", async () => {
    const short = await makeClip(dir, "black-head-1s");
    objects.set(`library/dbt-short-${run}.mp4`, short);
    const qa = await runQa(short);
    // Pretend the tail froze for most of the clip: the guard must refuse rather than cut 6 of 8 s.
    qa.issues.push({ code: "frozen-tail", severity: "fix", fixable: true, detail: "x", segments: [{ start: 2, end: 8 }] });
    const m = await media(`dbt-ref-${run}`, `library/dbt-short-${run}.mp4`, qa);
    const id = await fix(m, ["trim"]);
    const n = uploads.length;
    const r = await runMediaFixOnce({ db, storage, onlyFixIds: [id], log: () => {} });
    expect(r.kind).toBe("failed");
    expect((await db.query("select error from media_fixes where id = $1", [id])).rows[0].error).toMatch(/more than 30%/);
    expect(uploads.length).toBe(n);
  }, 60_000);

  it("media-recheck: re-runs QA v2 on a legacy clip from storage and stores it", async () => {
    const legacy = await media(`dbt-legacy-${run}`, `library/dbt-${run}.mp4`, { warnings: ["3 frozen-frame segment(s)", "effectively silent (-60.0 LUFS)"] });
    const s = await runMediaRecheckOnce({ db, storage, onlyMediaIds: [legacy] });
    expect(s).toEqual({ checked: 1, failed: 0, queued: expect.any(Number), skipped: null });
    const row = (await db.query("select qa, qa_checked_at from media where id = $1", [legacy])).rows[0];
    expect(row.qa.version).toBe(2);
    expect(row.qa.issues.map((i: { code: string }) => i.code)).toContain("frozen-tail");
    expect(row.qa_checked_at).not.toBeNull();
    expect(await runMediaRecheckOnce({ db, storage: null })).toEqual({ checked: 0, failed: 0, queued: 0, skipped: "no-storage" });
  }, 60_000);

  it("fixedSourcePath keeps the folder and adds -fixed", () => {
    expect(fixedSourcePath("C:\\clips\\leg day.mov")).toBe("C:\\clips\\leg day-fixed.mov");
    expect(fixedSourcePath("demo/demo-0001.mp4")).toBe("demo/demo-0001-fixed.mp4");
    expect(fixedSourcePath(null)).toBeNull();
    expect(existsSync(dir)).toBe(true);
  });
});
