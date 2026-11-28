import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, localToUtc } from "@autopilot/core";
import { lintText } from "@autopilot/research";
import { PgOutboxStore } from "../jobs/outbox.js";
import { dailyReadyMessage, runDailyInstagramOnce } from "../jobs/daily-instagram.js";
import { loadLibraryClips, type ConnectPool, type LibraryClipRow, type Queryable } from "../jobs/weekly-draft.js";

/**
 * F20 D daily-instagram against the dev DB. Everything runs inside ONE transaction that is rolled back at the end
 * (the job's begin/commit become a savepoint), so fixtures, items, batches, alerts and settings leave nothing.
 * Each scenario uses its own far-future day, 10 days apart (never "recently used" by the next one).
 */
const url = process.env.DATABASE_URL;
const TZ = "America/New_York";
const TAG = `f20d-${randomBytes(6).toString("hex")}`;
const BASE = addCalendarDays("2111-01-03", Math.floor(Math.random() * 3000));
const day = (n: number) => addCalendarDays(BASE, 10 * n);
/** 17:00 the day before `d`, creator-local: when the cron fires. */
const at17 = (d: string) => localToUtc(addCalendarDays(d, -1), "17:00", TZ);
const quiet = () => {};

function savepointPool(client: pg.PoolClient): ConnectPool {
  const map = (sql: string) => (sql === "begin" ? "savepoint daily_ig" : sql === "commit" ? "release savepoint daily_ig" : sql === "rollback" ? "rollback to savepoint daily_ig" : sql);
  const q: Queryable = { query: (sql, params) => client.query(map(sql), params as unknown[]) };
  return { ...q, connect: async () => ({ ...q, release() {} }) };
}

describe.skipIf(!url)("daily-instagram (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let db: ConnectPool;
  const ids: string[] = [];
  const fixtures = async (q: Queryable): Promise<LibraryClipRow[]> => (await loadLibraryClips(q)).filter((r) => ids.includes(r.id));
  const rowsFor = async (d: string) => (await client.query(`select * from batch_items where ingest_key like $1 order by scheduled_for`, [`daily:${d}:%`])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    client = await pool.connect();
    await client.query("begin");
    db = savepointPool(client);
    const pillars = ["workout-log", "physique", "single-set", "yap", "workout-log", "physique", "other", "single-set", "workout-log", "yap"];
    for (const [i, pillar] of pillars.entries()) {
      const hash = `${TAG}-${i}`;
      const r = await client.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, captured_at) values ($1, '/x/' || $1 || '.MOV', $2, 12, 1080, 1920, $3, 'ready', $4) returning id`,
        [hash, `library/${hash}.mp4`, pillar, `2109-0${1 + (i % 9)}-15T12:00:00Z`],
      );
      ids.push(r.rows[0].id);
    }
  });
  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool?.end();
  });

  it("empty day → adds exactly the minimum (2): Instagram-only drafts with captions, unapproved, one alert; second run adds nothing; listDue none", async () => {
    const d = day(0);
    const r = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(d), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ date: d, min: 2, postsInserted: 2, alertRaised: true, skipped: null });
    const rows = await rowsFor(d);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ platform: "instagram", status: "draft", origin: "daily", approved_at: null, trial: null, batch_id: r.batchId });
      expect(row.caption.length).toBeGreaterThan(0);
      expect(lintText({ text: row.caption, kind: "caption", platform: "instagram" }).ok).toBe(true);
      expect(row.ingest_key).toBe(`daily:${d}:${row.media_id}:instagram`);
    }
    expect(new Set(rows.map((x) => x.caption)).size).toBe(2);
    const al = (await client.query(`select message from alerts where kind = 'batch-ready' and message = $1`, [dailyReadyMessage(d, 2)])).rows;
    expect(al).toHaveLength(1);

    const again = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(d), log: quiet, loadLibrary: fixtures });
    expect(again).toMatchObject({ postsInserted: 0, alertRaised: false, skipped: "enough" });
    expect(await rowsFor(d)).toHaveLength(2);

    await client.query(`update batches set status = 'approved' where id = $1`, [r.batchId]);
    const due = await new PgOutboxStore({ query: (sql: string, params?: unknown[]) => client.query(sql, params) }, "https://media.example.invalid", quiet).listDue(new Date("2300-01-01T00:00:00Z"));
    const set = new Set(rows.map((x) => x.id));
    expect(due.filter((p) => set.has(p.id))).toEqual([]);
  });

  it("editor/other items count toward the minimum; fills only the gap; never beyond", async () => {
    const d = day(1);
    const batchId = (await client.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [addCalendarDays(d, -2)])).rows[0].id as string;
    await client.query(
      `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, origin, ingest_key) values ($1, $2, 'instagram', 'editor caption', $3, 'draft', 'editor', $4)`,
      [batchId, ids[9], localToUtc(d, "10:00", TZ).toISOString(), `${TAG}-editor:instagram`],
    );
    const r = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(d), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ existing: 1, postsInserted: 1 });
    expect(await rowsFor(d)).toHaveLength(1);
    expect((await rowsFor(d))[0]!.media_id).not.toBe(ids[9]);
    const again = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(d), log: quiet, loadLibrary: fixtures });
    expect(again.postsInserted).toBe(0);
  });

  it("a rejected item does not count; the minimum setting is honoured (3)", async () => {
    const d = day(2);
    await client.query(`insert into settings (key, value, updated_at) values ('instagram_daily_min', '3'::jsonb, now()) on conflict (key) do update set value = '3'::jsonb`);
    const r = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(d), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ min: 3, postsInserted: 3 });
    await client.query(`update settings set value = '0'::jsonb where key = 'instagram_daily_min'`);
    const none = await runDailyInstagramOnce(db, { timeZone: TZ, now: at17(day(3)), log: quiet, loadLibrary: fixtures });
    expect(none).toMatchObject({ postsInserted: 0, skipped: "enough" });
    await client.query(`delete from settings where key = 'instagram_daily_min'`);
  });

  it("duplicate-clip guard: a clip published on Instagram in the last 14 days is skipped", async () => {
    const d = day(5);
    const now = at17(d);
    const mk = async (n: number) =>
      (
        await client.query(
          `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, captured_at) values ($1, '/x/' || $1 || '.MOV', $2, 12, 1080, 1920, 'workout-log', 'ready', '2109-12-30T12:00:00Z') returning id`,
          [`${TAG}-dup-${n}`, `library/${TAG}-dup-${n}.mp4`],
        )
      ).rows[0].id as string;
    const posted = await mk(1);
    const fresh = await mk(2);
    const other = (await client.query(`insert into batches (week_start, status) values ($1::date, 'approved') returning id`, [addCalendarDays(d, -20)])).rows[0].id as string;
    await client.query(
      `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, platform_post_id, updated_at) values ($1, $2, 'instagram', 'posted', null, 'published', $3, $4)`,
      [other, posted, `${TAG}-pub`, new Date(now.getTime() - 2 * 86_400_000)],
    );
    const lib = async (q: Queryable) => (await loadLibraryClips(q)).filter((r) => r.id === posted || r.id === fresh);
    const r = await runDailyInstagramOnce(db, { timeZone: TZ, now, log: quiet, loadLibrary: lib });
    // F26 A: the picker already skips the posted clip (blockedVideoIds), so the guard below it has nothing to drop.
    expect(r).toMatchObject({ postsInserted: 1, duplicates: 0 });
    expect((await rowsFor(d)).map((x) => x.media_id)).toEqual([fresh]);
  });

  it("no TZ_CREATOR → nothing created", async () => {
    const before = (await client.query(`select (select count(*) from batch_items)::int as i, (select count(*) from alerts)::int as a`)).rows[0];
    const r = await runDailyInstagramOnce(db, { timeZone: undefined, now: at17(day(4)), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ skipped: "no-tz", postsInserted: 0 });
    expect((await client.query(`select (select count(*) from batch_items)::int as i, (select count(*) from alerts)::int as a`)).rows[0]).toEqual(before);
  });
});
