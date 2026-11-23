import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, findCapBreaches, localDate, localToUtc, weekdayIndex, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { PgOutboxStore } from "../jobs/outbox.js";
import { batchReadyMessage, loadLibraryClips, runWeeklyDraftOnce, type ConnectPool, type LibraryClipRow, type Queryable } from "../jobs/weekly-draft.js";

/**
 * F14 weekly-draft against the dev DB (DATABASE_URL). Dev-DB safety:
 *  - Scenarios 1–4 run inside ONE transaction on one client that is rolled back at the end (the job's
 *    begin/commit become a savepoint), so their media fixtures, items, batches and alerts leave nothing.
 *  - The concurrency scenario needs two real connections, so it commits: it uses the dev seed's own
 *    clips (no new media rows), a random far-future week, and at the end its items are rejected, its
 *    batch archived and its alert acknowledged (nothing deleted).
 * Weeks are 10 weeks apart so one scenario's items are never "recently used" (28 days) in the next.
 * America/New_York is an arbitrary fixture zone.
 */
const url = process.env.DATABASE_URL;
const TZ = "America/New_York";
const TAG = `f14wd-${randomBytes(6).toString("hex")}`;
const PATHLIKE = "/Users/someone/Movies/gym/IMG_4821.MOV";
const mondayOf = (ymd: string) => addCalendarDays(ymd, -weekdayIndex(ymd));
const BASE = mondayOf(addCalendarDays("2110-01-06", 7 * Math.floor(Math.random() * 1500)));
const week = (n: number) => addCalendarDays(BASE, 70 * n);
/** Sunday 18:00 creator-local before the week: when the cron fires. */
const sundayBefore = (w: string) => localToUtc(addCalendarDays(w, -1), "18:00", TZ);
const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok"];

/** The job's transaction becomes a savepoint inside the test's outer transaction (rolled back at the end). */
function savepointPool(client: pg.PoolClient): ConnectPool {
  const map = (sql: string) => (sql === "begin" ? "savepoint weekly_draft" : sql === "commit" ? "release savepoint weekly_draft" : sql === "rollback" ? "rollback to savepoint weekly_draft" : sql);
  const q: Queryable = { query: (sql, params) => client.query(map(sql), params as unknown[]) };
  return { ...q, connect: async () => ({ ...q, release() {} }) };
}

describe.skipIf(!url)("weekly-draft (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let db: ConnectPool;
  const eligible: string[] = [];
  const ineligible: string[] = [];
  const library = (ids: () => Iterable<string>) => async (q: Queryable): Promise<LibraryClipRow[]> => {
    const keep = new Set(ids());
    return (await loadLibraryClips(q)).filter((r) => keep.has(r.id));
  };
  const fixtures = library(() => [...eligible, ...ineligible]);
  const quiet = () => {};

  const items = async (q: Queryable, w: string) =>
    (
      await q.query(
        `select id, batch_id, media_id, platform, caption, title, status, origin, approved_at, trial, scheduled_for, ingest_key from batch_items where ingest_key like $1 order by scheduled_for, platform`,
        [`weekly:${w}:%`],
      )
    ).rows;
  const alerts = async (q: Queryable, w: string) =>
    (await q.query(`select id, message, platform, batch_item_id, acknowledged_at from alerts where kind = 'batch-ready' and message like $1`, [`%(from ${w})%`])).rows;

  async function media(i: number, over: { status?: string; r2?: string | null; pillar?: string; captured?: string } = {}): Promise<string> {
    const hash = `${TAG}-${i}`;
    const r = await client.query(
      `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, captured_at)
       values ($1, $2, $3, 12, 1080, 1920, $4, $5, $6) returning id`,
      [hash, PATHLIKE, over.r2 === undefined ? `library/${hash}.mp4` : over.r2, over.pillar ?? ["gym", "meal", "trading"][i % 3], over.status ?? "ready", over.captured ?? `2109-0${1 + (i % 9)}-15T12:00:00Z`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 6 });
    client = await pool.connect();
    await client.query("begin");
    db = savepointPool(client);
    for (let i = 0; i < 12; i++) eligible.push(await media(i));
    // Ineligible, and the newest of all (so a missed filter would pick them first).
    const NEW = "2109-12-31T12:00:00Z";
    ineligible.push(await media(100, { status: "archived", captured: NEW }));
    ineligible.push(await media(101, { r2: null, captured: NEW }));
    const original = await media(102, { captured: NEW });
    const keptCopy = await media(103, { captured: "2109-01-01T00:00:00Z" }); // a kept fixed copy is a normal clip
    await client.query(`insert into media_fixes (media_id, ops, status, fixed_media_id) values ($1, '{trim}', 'kept', $2)`, [original, keptCopy]);
    ineligible.push(original);
    eligible.push(keptCopy);
    const other = await media(104, { captured: "2100-01-01T00:00:00Z" });
    const pendingCopy = await media(105, { captured: NEW });
    await client.query(`insert into media_fixes (media_id, ops, status, fixed_media_id) values ($1, '{trim}', 'done', $2)`, [other, pendingCopy]);
    ineligible.push(pendingCopy);
    eligible.push(other);
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool?.end();
  });

  it("empty week → 7 clips × IG/YT/TikTok, all draft, origin weekly, empty text, unapproved, one per local day, within caps; one batch-ready alert", async () => {
    const w = week(0);
    const r = await runWeeklyDraftOnce(db, { timeZone: TZ, now: sundayBefore(w), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ weekStart: w, clipsAdded: 7, postsInserted: 21, unplaced: 0, alertRaised: true, skipped: null });
    const rows = await items(client, w);
    expect(rows).toHaveLength(21);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "draft", origin: "weekly", caption: "", approved_at: null, trial: null, batch_id: r.batchId });
      expect(row.title).toBe(row.platform === "youtube" ? "" : null);
      expect(row.ingest_key).toBe(`weekly:${w}:${row.media_id}:${row.platform}`);
      expect(ineligible).not.toContain(row.media_id);
    }
    // One clip per local day, all three platforms on that clip's day.
    const dayOf = new Map<string, Set<string>>();
    for (const row of rows) {
      const d = localDate(new Date(row.scheduled_for), TZ);
      expect(d >= w && d <= addCalendarDays(w, 6)).toBe(true);
      dayOf.set(row.media_id, (dayOf.get(row.media_id) ?? new Set()).add(d));
    }
    expect(dayOf.size).toBe(7);
    for (const ds of dayOf.values()) expect(ds.size).toBe(1);
    expect(new Set([...dayOf.values()].map((s) => [...s][0])).size).toBe(7);
    for (const p of PLATFORMS) expect(rows.filter((x) => x.platform === p)).toHaveLength(7);
    const cadence = await loadCadence(client);
    expect(findCapBreaches(rows.map((x) => ({ platform: x.platform, scheduledFor: new Date(x.scheduled_for).toISOString() })), cadence, TZ)).toEqual([]);

    const events = (await client.query(`select kind, to_status, detail from batch_item_events where batch_item_id = any($1::uuid[])`, [rows.map((x) => x.id)])).rows;
    expect(events).toHaveLength(21);
    for (const e of events) expect(e).toEqual({ kind: "add", to_status: "draft", detail: { origin: "weekly" } });

    const al = await alerts(client, w);
    expect(al).toHaveLength(1);
    expect(al[0].message).toBe(batchReadyMessage(w, 7, 21));
    expect(al[0].message).not.toMatch(/IMG_|\.MOV|\/Users|library\//);
    expect(al[0].message).not.toContain(TAG);
    for (const row of rows) expect(al[0].message).not.toContain(row.media_id);
    expect(rows.map((x) => x.id)).toContain(al[0].batch_item_id);

    // Second run: everything covered → nothing inserted, no second alert.
    const again = await runWeeklyDraftOnce(db, { timeZone: TZ, now: sundayBefore(w), log: quiet, loadLibrary: fixtures });
    expect(again).toMatchObject({ postsInserted: 0, alertRaised: false, skipped: "covered" });
    expect(await items(client, w)).toHaveLength(21);
    expect(await alerts(client, w)).toHaveLength(1);

    // Even with the batch row approved, listDue returns none of them (no approved_at, status draft).
    await client.query(`update batches set status = 'approved' where id = $1`, [r.batchId]);
    const due = await new PgOutboxStore({ query: (sql: string, params?: unknown[]) => client.query(sql, params) }, "https://media.example.invalid", quiet).listDue(new Date("2200-01-01T00:00:00Z"));
    const ids = new Set(rows.map((x) => x.id));
    expect(due.filter((p) => ids.has(p.id))).toEqual([]);
  });

  it("editor items on Mon + Tue → only 5 clips, added to the same batch", async () => {
    const w = week(1);
    const batchId = (await client.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [w])).rows[0].id as string;
    for (const [i, d] of [w, addCalendarDays(w, 1)].entries()) {
      await client.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, origin, ingest_key) values ($1, $2, 'instagram', 'editor caption', $3, 'draft', 'editor', $4)`,
        [batchId, eligible[11 - i], localToUtc(d, "10:00", TZ).toISOString(), `${TAG}-editor-${i}:instagram`],
      );
    }
    const r = await runWeeklyDraftOnce(db, { timeZone: TZ, now: sundayBefore(w), log: quiet, loadLibrary: fixtures });
    expect(r).toMatchObject({ clipsAdded: 5, postsInserted: 15, batchId, alertRaised: true });
    expect(r.uncoveredDays).toEqual([2, 3, 4, 5, 6].map((n) => addCalendarDays(w, n)));
    const rows = await items(client, w);
    expect(rows).toHaveLength(15);
    for (const row of rows) expect(row.batch_id).toBe(batchId);
    const days = new Set(rows.map((x) => localDate(new Date(x.scheduled_for), TZ)));
    expect(days.has(w) || days.has(addCalendarDays(w, 1))).toBe(false);
    // The editor clips are recently used (scheduled this week), so they aren't picked again.
    expect(rows.map((x) => x.media_id)).not.toContain(eligible[11]);
    expect((await alerts(client, w)).map((a) => a.message)).toEqual([batchReadyMessage(w, 5, 15)]);
    expect((await client.query(`select count(*)::int as n from batches where week_start = $1::date`, [w])).rows[0].n).toBe(1);
  });

  it("duplicate-clip guard: a clip already published on Instagram in the last 14 days gets YouTube + TikTok only", async () => {
    const w = week(6);
    const clip = await media(200, { captured: "2109-12-30T12:00:00Z" });
    const now = sundayBefore(w);
    const other = (await client.query(`insert into batches (week_start, status) values ($1::date, 'approved') returning id`, [addCalendarDays(w, -14)])).rows[0].id as string;
    // Recorded as published without a time (so the 28-day "recently used" filter, which looks at times, misses it).
    await client.query(
      `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, platform_post_id, updated_at) values ($1, $2, 'instagram', 'posted', null, 'published', $3, $4)`,
      [other, clip, `${TAG}-pub`, new Date(now.getTime() - 3 * 86_400_000)],
    );
    const r = await runWeeklyDraftOnce(db, { timeZone: TZ, now, log: quiet, loadLibrary: library(() => [clip]) });
    expect(r).toMatchObject({ clipsAdded: 1, postsInserted: 2, duplicates: 1, skipped: null });
    expect((await items(client, w)).map((x) => x.platform).sort()).toEqual(["tiktok", "youtube"]);
  });

  it("empty library → nothing created (no batch either), nothing raised", async () => {
    const w = week(2);
    const r = await runWeeklyDraftOnce(db, { timeZone: TZ, now: sundayBefore(w), log: quiet, loadLibrary: async () => [] });
    expect(r).toMatchObject({ postsInserted: 0, alertRaised: false, skipped: "no-clips" });
    expect(await items(client, w)).toHaveLength(0);
    expect(await alerts(client, w)).toHaveLength(0);
    expect((await client.query(`select count(*)::int as n from batches where week_start = $1::date`, [w])).rows[0].n).toBe(0);
  });

  it("no TZ_CREATOR → nothing created, nothing raised", async () => {
    const before = (await client.query(`select (select count(*) from batch_items)::int as i, (select count(*) from alerts)::int as a, (select count(*) from batches)::int as b`)).rows[0];
    const lines: string[] = [];
    const r = await runWeeklyDraftOnce(db, { timeZone: undefined, now: sundayBefore(week(3)), log: (l) => lines.push(l), loadLibrary: fixtures });
    expect(r).toMatchObject({ skipped: "no-tz", postsInserted: 0, alertRaised: false });
    expect(lines).toHaveLength(1);
    const after = (await client.query(`select (select count(*) from batch_items)::int as i, (select count(*) from alerts)::int as a, (select count(*) from batches)::int as b`)).rows[0];
    expect(after).toEqual(before);
  });
});

describe.skipIf(!url)("weekly-draft concurrency (db, committed)", () => {
  let pool: pg.Pool;
  const w = addCalendarDays(week(4), 7 * 3);
  const seedIds: string[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 6 });
    const all = await loadLibraryClips(pool);
    const demo = (await pool.query(`select id from media where content_hash like 'demo-%'`)).rows.map((r) => String(r.id));
    const demoSet = new Set(demo);
    for (const r of all) if (demoSet.has(r.id) && r.status !== "archived" && r.r2Key && !r.supersededByKeptFix && !r.undecidedFixCopy) seedIds.push(r.id);
    if (seedIds.length === 0) throw new Error("seed the dev DB first (pnpm dev:seed): need demo clips with an r2_key");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update alerts set acknowledged_at = now() where acknowledged_at is null and kind = 'batch-ready' and message like $1`, [`%(from ${w})%`]);
    await pool.query(`update batch_items set status = 'rejected', updated_at = now() where ingest_key like $1`, [`weekly:${w}:%`]);
    await pool.query(`update batches set status = 'archived', updated_at = now() where week_start = $1::date and status <> 'archived'`, [w]);
    await pool.end();
  });

  it("two concurrent runs give the same result as one: one set of items, one batch, one alert", async () => {
    const opts = { timeZone: TZ, now: sundayBefore(w), log: () => {}, loadLibrary: async (q: Queryable) => (await loadLibraryClips(q)).filter((r) => seedIds.includes(r.id)) };
    const [a, b] = await Promise.all([runWeeklyDraftOnce(pool, opts), runWeeklyDraftOnce(pool, opts)]);
    const expected = Math.min(7, seedIds.length);
    const first = a.postsInserted > 0 ? a : b;
    const second = first === a ? b : a;
    expect(first.clipsAdded).toBe(expected);
    expect(second.postsInserted).toBe(0);
    expect(second.alertRaised).toBe(false);
    const rows = (await pool.query(`select media_id, platform, batch_id from batch_items where ingest_key like $1`, [`weekly:${w}:%`])).rows;
    expect(rows).toHaveLength(first.postsInserted);
    expect(new Set(rows.map((r) => `${r.media_id}|${r.platform}`)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
    expect((await pool.query(`select count(*)::int as n from batches where week_start = $1::date and status <> 'archived'`, [w])).rows[0].n).toBe(1);
    expect((await pool.query(`select count(*)::int as n from alerts where kind = 'batch-ready' and message like $1`, [`%(from ${w})%`])).rows[0].n).toBe(1);
  });
});
