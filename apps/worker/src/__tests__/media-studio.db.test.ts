import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixError, type Edl, type FixStats, type MediaStorage, type QaResult, type RunEdlInputs } from "@autopilot/media";
import { runMediaReelOnce, STUDIO_FOLDER, studioSourcePath, type StudioRunner } from "../jobs/media-reel.js";

/**
 * Studio branch of the media-reel job (F24). Real dev DB (DATABASE_URL, migrated through 0016) inside ONE rolled-back
 * transaction; fake storage (a local folder) and a fake ffmpeg runner. Checks: each distinct clip downloaded once,
 * media row in folder "Studio" derived from the first clip, NO batch item, failures stored in plain words.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("media-reel job, kind = 'studio' (db, fake storage + runner)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), "autopilot-media-studio-db-"));
  const objects = new Map<string, string>();
  const downloads: string[] = [];
  const uploads: Array<{ key: string; type: string }> = [];
  const storage: MediaStorage = {
    async download(key, to) {
      const from = objects.get(key);
      if (!from) throw new Error(`no such object ${key}`);
      downloads.push(key);
      copyFileSync(from, to);
    },
    async upload(key, from, type) {
      const keep = join(dir, `up-${uploads.length}`);
      copyFileSync(from, keep);
      objects.set(key, keep);
      uploads.push({ key, type });
    },
  };
  const renders: Array<{ edl: Edl; inputs: RunEdlInputs }> = [];
  const posters: Array<{ coverS: number | null }> = [];
  const stats: FixStats = { durationS: 6, loudnessLufs: -14, videoCodec: "h264", width: 1080, height: 1920, sizeBytes: 10 };
  const qa = { version: 2, issues: [], warnings: [], probe: { durationS: 6, width: 1080, height: 1920, hasAudio: true, fps: 30 } } as unknown as QaResult;
  let failNext: Error | null = null;
  const studioRunner: StudioRunner = {
    async render(edl, inputs) {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      renders.push({ edl, inputs });
      copyFileSync(inputs.clipPaths[0]!, inputs.outPath);
      appendFileSync(inputs.outPath, `studio-${run}-${renders.length}`);
      return { outPath: inputs.outPath, durationS: 6, after: stats };
    },
    qa: async () => qa,
    poster: async (_p, jpg, opts) => {
      posters.push({ coverS: opts.coverS });
      writeFileSync(jpg, "jpg");
    },
  };
  const env = { STUDIO_FONT_PATH: "/fonts/test-bold.ttf" };
  const base = { studioRunner, storage, env, timeZone: "UTC", hasFfmpeg: async () => true, log: () => {} };
  let clipA: string;
  let clipB: string;
  let soundId: string;

  const edl = (over: Partial<Edl> = {}): Edl => ({
    v: 1,
    fit: "fit",
    clips: [
      { mediaId: clipA, inS: 0, outS: 2, speed: 1 },
      { mediaId: clipB, inS: 1, outS: 3, speed: 1 },
      { mediaId: clipA, inS: 2, outS: 3, speed: 0.5 },
    ],
    texts: [{ text: "leg day", startS: 0, endS: 2, position: "bottom", style: "bold" }],
    sound: { soundId, offsetS: 0, volume: 0.5 },
    originalVolume: 1,
    coverS: 1.5,
    ...over,
  });
  const queue = async (params: unknown) =>
    (await db.query(`insert into media_edits (kind, source_media_id, sound_id, params) values ('studio', $1, $2, $3::jsonb) returning id`, [clipA, soundId, JSON.stringify(params)])).rows[0]
      .id as string;
  const clipRow = async (tag: string, extra = "") =>
    (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at${extra ? ", folder" : ""})
         values ($1, $2, $3, 12, 1920, 1080, 'gym', 'ready', $4::jsonb, '2026-01-02T03:04:05Z'${extra ? ", $5" : ""}) returning id`,
        [`dbt-studio-${tag}-${run}`, `/clips/day1/${tag}-${run}.mov`, `library/dbt-studio-${tag}-${run}.mp4`, JSON.stringify(qa), ...(extra ? [extra] : [])],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    for (const tag of ["a", "b"]) {
      const p = join(dir, `${tag}.mp4`);
      writeFileSync(p, `clip-${tag}-${run}`);
      objects.set(`library/dbt-studio-${tag}-${run}.mp4`, p);
    }
    const snd = join(dir, "s.m4a");
    writeFileSync(snd, "sound");
    objects.set(`sounds/dbt-studio-${run}.m4a`, snd);
    clipA = await clipRow("a");
    clipB = await clipRow("b", "Week 1");
    soundId = (await db.query(`insert into sounds (name, r2_key, duration_s) values ('beat', $1, 30) returning id`, [`sounds/dbt-studio-${run}.m4a`])).rows[0].id;
  });

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("done: each distinct clip downloaded once, media row in 'Studio' derived from the first clip, no batch item", async () => {
    const id = await queue(edl());
    downloads.length = 0;
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id] });
    expect(r).toMatchObject({ kind: "studio-done", editId: id });
    if (r.kind !== "studio-done") return;
    expect(downloads.sort()).toEqual([`library/dbt-studio-a-${run}.mp4`, `library/dbt-studio-b-${run}.mp4`, `sounds/dbt-studio-${run}.m4a`].sort());
    const { inputs } = renders.at(-1)!;
    expect(inputs.clipPaths).toHaveLength(3);
    expect(inputs.clipPaths[0]).toBe(inputs.clipPaths[2]); // the same local file, read twice
    expect(inputs.clipPaths[1]).not.toBe(inputs.clipPaths[0]);
    expect(inputs.soundPath).toMatch(/sound\.m4a$/);
    expect(inputs.fontPath).toBe("/fonts/test-bold.ttf");
    expect(posters.at(-1)).toEqual({ coverS: 1.5 });

    const e = (await db.query("select * from media_edits where id = $1", [id])).rows[0];
    expect(e).toMatchObject({ status: "done", result_media_id: r.mediaId, batch_item_id: null, error: null });
    const m = (await db.query("select * from media where id = $1", [r.mediaId])).rows[0];
    expect(m).toMatchObject({ derived_from: clipA, folder: STUDIO_FOLDER, status: "ready", pillar: "gym", source_path: `a-${run}-studio.mp4` });
    expect(m.r2_key).toMatch(/^library\/[0-9a-f]{64}\.mp4$/);
    expect(m.poster_key).toMatch(/^posters\/[0-9a-f]{64}\.jpg$/);
    // No calendar item and no "ready" alert for the export (it shows up in Ready to post instead).
    expect(Number((await db.query("select count(*)::int n from batch_items where media_id = any($1::uuid[])", [[r.mediaId, clipA, clipB]])).rows[0].n)).toBe(0);
    expect(Number((await db.query("select count(*)::int n from alerts a join batch_items bi on bi.id = a.batch_item_id where bi.media_id = $1", [r.mediaId])).rows[0].n)).toBe(0);
  });

  it("no sound: only the clips are downloaded", async () => {
    const id = await queue(edl({ sound: null, clips: [{ mediaId: clipB, inS: 0, outS: 4, speed: 1 }] }));
    downloads.length = 0;
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [id] });
    expect(r.kind).toBe("studio-done");
    expect(downloads).toEqual([`library/dbt-studio-b-${run}.mp4`]);
    expect(renders.at(-1)!.inputs.soundPath).toBeUndefined();
  });

  it("failure: runner error stored in plain words, no media row; bad EDL, archived clip and storage errors refused", async () => {
    const before = Number((await db.query("select count(*)::int n from media")).rows[0].n);
    const a = await queue(edl());
    failNext = new FixError("ffmpeg couldn't make this video.");
    expect(await runMediaReelOnce({ ...base, db, onlyEditIds: [a] })).toEqual({ kind: "failed", editId: a, reason: "ffmpeg couldn't make this video." });
    expect((await db.query("select status, error, result_media_id from media_edits where id = $1", [a])).rows[0]).toEqual({ status: "failed", error: "ffmpeg couldn't make this video.", result_media_id: null });

    const b = await queue({ v: 1, fit: "fit", clips: [] });
    expect(await runMediaReelOnce({ ...base, db, onlyEditIds: [b] })).toMatchObject({ kind: "failed", reason: expect.stringMatching(/couldn't be used: Add at least one clip/) });

    const gone = await clipRow("gone");
    await db.query("update media set status = 'archived' where id = $1", [gone]);
    const c = await queue(edl({ clips: [{ mediaId: gone, inS: 0, outS: 4, speed: 1 }] }));
    expect(await runMediaReelOnce({ ...base, db, onlyEditIds: [c] })).toMatchObject({ kind: "failed", reason: expect.stringMatching(/isn't in the library/) });

    const missing = await clipRow("nofile");
    const d = await queue(edl({ clips: [{ mediaId: missing, inS: 0, outS: 4, speed: 1 }], sound: null }));
    const r = await runMediaReelOnce({ ...base, db, onlyEditIds: [d] });
    expect(r).toMatchObject({ kind: "failed", reason: "The Studio export failed (storage or processing error). Nothing was posted." });
    if (r.kind === "failed") expect(r.reason).not.toContain("library/");
    expect(Number((await db.query("select count(*)::int n from media")).rows[0].n)).toBe(before + 2); // only the two fixture clips
  });

  it("studioSourcePath keeps only the file stem", () => {
    expect(studioSourcePath("/clips/day1/squat.mov")).toBe("squat-studio.mp4");
    expect(studioSourcePath("C:\\clips\\bench.MP4")).toBe("bench-studio.mp4");
    expect(studioSourcePath(null)).toBe("studio.mp4");
  });
});
