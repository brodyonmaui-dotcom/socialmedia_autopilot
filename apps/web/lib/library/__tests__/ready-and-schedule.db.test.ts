import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addToCalendar } from "../add-to-calendar.js";
import { approveAndSchedule } from "../approve-and-schedule.js";
import { loadReadyToPost } from "../ready-to-post.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0016) inside ONE rolled-back transaction (BEGIN/COMMIT of the write path become
 * savepoints). The `uploads` table (migration 0017) is created inside the transaction when the DB doesn't have it yet.
 * Slots are planned in 2099, far from any real post.
 */
const url = process.env.DATABASE_URL;
const NOW = new Date("2099-03-02T08:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe.skipIf(!url)("Ready to post, add-to-calendar overrides, approve & schedule (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  let sp = 0;
  const run = randomUUID().slice(0, 8);
  const id: Record<string, string> = {};
  let SESSION = "";

  const txPool = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    connect: async () => {
      const name = `sp${++sp}`;
      return {
        query: async (sql: string, params?: unknown[]) => {
          if (sql === "begin") return db.query(`savepoint ${name}`);
          if (sql === "commit") return db.query(`release savepoint ${name}`);
          if (sql === "rollback") return db.query(`rollback to savepoint ${name}`);
          return db.query(sql, params);
        },
        release: () => {},
      };
    },
  };
  const pgPool = txPool as unknown as pg.Pool;

  const media = async (key: string, o: { status?: string } = {}) => {
    id[key] = (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, poster_key, created_at) values ($1, $2, $3, 12, 'gym', $4, 'posters/x.jpg', $5) returning id`,
        [`dbt-ready-${run}-${key}`, `/clips/zz${run}-${key}.mp4`, `library/dbt-ready-${run}-${key}.mp4`, o.status ?? "ready", NOW.toISOString()],
      )
    ).rows[0].id;
  };
  const upload = (key: string, status: string, finishedAt: string) =>
    db.query(`insert into uploads (original_name, size_bytes, r2_key, status, media_id, finished_at) values ($1, 10, $2, $3, $4, $5::timestamptz)`, [`zz${run}-${key}.mp4`, `incoming/${run}-${key}`, status, id[key], finishedAt]);
  const mine = <T extends { mediaId: string }>(xs: T[]) => xs.filter((x) => Object.values(id).includes(x.mediaId));
  const keyOf = (mediaId: string) => Object.keys(id).find((k) => id[k] === mediaId);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    db = await pool.connect();
    await db.query("begin");
    SESSION = (await db.query(`insert into auth_sessions (token_hash, expires_at, hard_expires_at) values ($1, now() + interval '1 day', now() + interval '1 day') returning id`, [`dbt-${run}`])).rows[0].id;
    await db.query(`create table if not exists uploads (
      id uuid primary key default gen_random_uuid(), original_name text not null, size_bytes bigint not null, content_type text, folder text,
      r2_key text not null, s3_upload_id text, parts jsonb not null default '[]',
      status text not null default 'uploading' check (status in ('uploading','uploaded','processing','done','duplicate','failed','aborted')),
      media_id uuid references media(id), error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz)`);
    for (const k of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "s1", "s2", "s3", "s4", "s5", "s6"]) await media(k, k === "f" ? { status: "archived" } : {});
    await upload("a", "done", days(1)); // ready
    await upload("b", "done", days(8)); // too old
    await upload("c", "done", days(1)); // has a draft item
    await upload("d", "done", days(2)); // only a rejected item: ready
    await upload("e", "processing", days(1)); // not done
    await upload("f", "done", days(1)); // archived
    await upload("g", "done", days(3)); // ready (older than a)
    const studio = (key: string, status: string, kind: string, finishedAt: string) =>
      db.query(`insert into media_edits (kind, source_media_id, params, status, result_media_id, requested_at, finished_at) values ($1, $2, '{}'::jsonb, $3, $4, $5::timestamptz, $5::timestamptz)`, [kind, id.a, status, id[key], finishedAt]);
    await studio("s1", "done", "studio", days(0.5)); // ready (newest)
    await studio("s2", "done", "studio", days(10)); // ready: inside 14 days
    await studio("s3", "done", "studio", days(15)); // too old
    await studio("s4", "running", "studio", days(1)); // not done
    await studio("s5", "done", "reel", days(1)); // a reel, not studio
    await studio("s6", "done", "studio", days(1)); // has a draft item
    const batch = (await db.query("insert into batches (week_start, status) values ('2098-01-05', 'draft') returning id")).rows[0].id;
    await db.query(`insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'instagram', 'x', '2099-03-03T10:00:00Z', 'draft')`, [batch, id.c]);
    await db.query(`insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'tiktok', 'x', '2099-03-03T11:00:00Z', 'rejected')`, [batch, id.d]);
    await db.query(`insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'instagram', 'x', '2099-03-03T12:00:00Z', 'draft')`, [batch, id.s6]);
    id.batch = batch;
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("Ready to post: done in the last 7 days, not archived, nothing non-rejected on the calendar; newest first", async () => {
    const clips = mine(await loadReadyToPost(db, NOW));
    expect(clips.map((c) => keyOf(c.mediaId))).toEqual(["s1", "a", "d", "g", "s2"]);
    expect(clips[0]!.suggestion).not.toBe("");
    expect(new Set(clips.map((c) => c.suggestion)).size).toBe(clips.length);
    expect(clips[0]!.hasPoster).toBe(true);
  });

  it("Ready to post also lists done studio renders (14 days) with nothing on the calendar", async () => {
    const clips = mine(await loadReadyToPost(db, NOW));
    expect(clips.map((c) => keyOf(c.mediaId))).toEqual(["s1", "a", "d", "g", "s2"]);
  });

  it("without the media.folder column (database behind the code) it still lists clips, folder null", async () => {
    const sqls: string[] = [];
    const behind = {
      query: (sql: string, params?: unknown[]) => {
        sqls.push(sql);
        return sql.includes("information_schema.columns") ? Promise.resolve({ rows: [], rowCount: 0 }) : db.query(sql, params);
      },
    } as never;
    const clips = mine(await loadReadyToPost(behind, NOW));
    expect(clips.map((c) => keyOf(c.mediaId))).toEqual(["s1", "a", "d", "g", "s2"]);
    expect(clips.every((c) => c.folder === null)).toBe(true);
    expect(sqls.some((s) => /\bm\.folder\b/.test(s))).toBe(false);
  });

  it("addToCalendar overrides: typed caption on every platform, typed YouTube title; clips without one keep the template", async () => {
    const r = await addToCalendar(pgPool, { mediaIds: [id.a!, id.g!], platforms: ["instagram", "youtube", "tiktok"], now: NOW, timeZone: "UTC", sessionId: null, overrides: { [id.a!]: { caption: "  My own words  ", title: " My title " } } });
    expect(r.added).toBe(6);
    expect(r.created).toHaveLength(6);
    const rows = (await db.query(`select media_id, platform, caption, title from batch_items where id = any($1::uuid[])`, [r.created.map((c) => c.itemId)])).rows as Array<{ media_id: string; platform: string; caption: string; title: string | null }>;
    const a = rows.filter((x) => x.media_id === id.a);
    expect(a.map((x) => x.caption)).toEqual(["My own words", "My own words", "My own words"]);
    expect(a.find((x) => x.platform === "youtube")!.title).toBe("My title");
    expect(a.find((x) => x.platform === "instagram")!.title).toBeNull();
    const g = rows.filter((x) => x.media_id === id.g);
    expect(g.find((x) => x.platform === "instagram")!.caption).not.toBe("");
    expect(g.find((x) => x.platform === "tiktok")!.caption).toBe("");
    expect(g.find((x) => x.platform === "youtube")!.title).toBe("");
  });

  it("approve & schedule: block warnings stay drafts, the rest is approved, nothing else is touched", async () => {
    const before = (await db.query(`select status from batch_items where id in (select id from batch_items where media_id = $1)`, [id.c])).rows.map((r) => r.status);
    const res = await approveAndSchedule(pgPool, {
      mediaIds: [id.h!, id.i!],
      platforms: ["instagram", "youtube", "tiktok"],
      overrides: { [id.h!]: { caption: "Ready to go #gym", title: "Leg day" }, [id.i!]: { caption: "", title: "" } },
      now: NOW,
      timeZone: "UTC",
      sessionId: SESSION,
      approve: true,
    });
    expect(res.scheduled).toBe(3);
    expect(res.stayed).toHaveLength(3);
    const st = async (k: string) => (await db.query(`select platform, status from batch_items where media_id = $1 order by platform`, [id[k]])).rows as Array<{ platform: string; status: string }>;
    expect((await st("h")).map((x) => x.status)).toEqual(["approved", "approved", "approved"]);
    expect((await st("i")).map((x) => x.status)).toEqual(["draft", "draft", "draft"]);
    expect((await db.query(`select status from batch_items where media_id = $1`, [id.c])).rows.map((r) => r.status)).toEqual(before);
    expect((await db.query(`select status from batch_items where media_id = $1`, [id.d])).rows.map((r) => r.status)).toEqual(["rejected"]);
  });

  it("save as drafts (approve: false) approves nothing", async () => {
    const res = await approveAndSchedule(pgPool, { mediaIds: [id.e!], platforms: ["instagram"], overrides: { [id.e!]: { caption: "Fine #gym" } }, now: NOW, timeZone: "UTC", sessionId: SESSION, approve: false });
    expect(res.scheduled).toBe(0);
    expect((await db.query(`select status from batch_items where media_id = $1`, [id.e])).rows.map((r) => r.status)).toEqual(["draft"]);
  });
});
