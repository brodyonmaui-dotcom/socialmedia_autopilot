// Runs against a real Postgres with migrations applied (DATABASE_URL; local: bash scripts/dev/local-stack.sh).
// One transaction on one client, rolled back at the end: the account_* tables are emptied only inside it,
// so the dev DB keeps its seed rows.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFollowerTotals, loadOverview } from "../overview.js";
import { loadPlatform } from "../platform.js";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-16T12:00:00Z");
const TZ = "UTC";

describe.skipIf(!url)("analytics loaders (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let mediaId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    await client.query("delete from account_post_snapshots");
    await client.query("delete from account_posts");
    await client.query("delete from account_snapshots");
    mediaId = (await client.query("insert into media (content_hash, status, pillar, duration_s) values ($1, 'used', 'trading', 9) returning id", [`test-overview-${Date.now()}`])).rows[0].id;
    const batch = (await client.query("insert into batches (week_start, status) values ('2026-11-09', 'approved') returning id")).rows[0].id;
    const item = (
      await client.query(
        "insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, platform_post_id) values ($1, $2, 'instagram', 'x', '2026-11-12T17:00:00Z', 'published', '19000000000000001') returning id",
        [batch, mediaId],
      )
    ).rows[0].id;
    const ins = async (platform: string, pid: string, at: string, bi: string | null, snaps: Array<[string, number | null]>, title: string | null = null) => {
      const id = (
        await client.query(
          `insert into account_posts (platform, platform_post_id, permalink, caption, title, published_at, batch_item_id, matched_by)
           values ($1, $2, $3, 'Leg day #gym', $4, $5, $6, $7) returning id`,
          [platform, pid, `https://example.invalid/${pid}`, title, at, bi, bi ? "id" : null],
        )
      ).rows[0].id;
      for (const [c, v] of snaps) await client.query("insert into account_post_snapshots (account_post_id, captured_at, views, likes, comments) values ($1, $2, $3, 5, 1)", [id, c, v]);
    };
    await ins("instagram", "19000000000000001", "2026-11-12T17:01:00Z", item, [["2026-11-13T00:00:00Z", 200], ["2026-11-15T00:00:00Z", 260], ["2026-11-16T00:00:00Z", null]]);
    await ins("instagram", "19000000000000002", "2026-11-14T09:00:00Z", null, [["2026-11-15T00:00:00Z", 80]]);
    await ins("youtube", "testVidAAA1", "2026-11-15T20:00:00Z", null, [["2026-11-16T06:00:00Z", 40]], "Full push day");
    await ins("instagram", "19000000000000003", "2026-10-01T09:00:00Z", null, [["2026-10-02T00:00:00Z", 999]]);
    for (const [p, d, f] of [["instagram", "2026-11-02", 990], ["instagram", "2026-11-09", 1000], ["instagram", "2026-11-16", 1020], ["youtube", "2026-11-14", 300]] as const) {
      await client.query("insert into account_snapshots (platform, captured_on, followers) values ($1, $2, $3)", [p, d, f]);
    }
  });
  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool.end();
  });

  it("loadOverview: KPIs, per-day views, top posts with byHand and mediaId", async () => {
    const o = await loadOverview(client, { days: 7, timeZone: TZ, now: NOW });
    expect(o.hasData).toBe(true);
    expect(o.kpis.posts).toMatchObject({ value: 3, previous: 0 });
    expect(o.kpis.views.value).toBe(200 + 60 + 80 + 40);
    expect(o.kpis.followers).toMatchObject({ value: 1320, previous: 1000, delta: 320 });
    const d = Object.fromEntries(o.viewsPerDay.map((x) => [x.date, x]));
    expect(d["2026-11-12"]).toMatchObject({ instagram: 200, youtube: 0, tiktok: null });
    expect(d["2026-11-15"]).toMatchObject({ instagram: 60, youtube: 40 });
    expect(o.topPosts.map((t) => [t.views, t.byHand, t.mediaId])).toEqual([
      [260, false, mediaId], // the latest snapshot with a views number, not the later null one
      [80, true, null],
      [40, true, null],
    ]);
    expect(o.topPosts[2]!.title).toBe("Full push day");
  });

  it("loadPlatform: instagram series + posts; tiktok not collected", async () => {
    const v = await loadPlatform(client, "instagram", { days: 7, timeZone: TZ, now: NOW });
    if (!v.collected) throw new Error("expected collected");
    expect(v.posts.map((p) => p.pillar)).toEqual(["gym", "trading"]); // by hand → caption rule; matched → clip pillar
    expect(v.followers.find((f) => f.date === "2026-11-16")!.followers).toBe(1020);
    expect(v.card).toMatchObject({ followers: 1020, followersDelta: 20, posts: 2 });
    expect(await loadPlatform(client, "tiktok", { days: 7, timeZone: TZ, now: NOW })).toMatchObject({ collected: false, platform: "tiktok" });
  });

  it("on the dev seed (when present): non-zero KPIs, 30+ days of views, by-hand top posts, 3+ real findings", async (ctx) => {
    // Outside the test transaction: reads the committed seed rows (scripts/dev/lib/seed-account-posts.ts).
    const seeded = (await pool.query("select count(*)::int n from account_posts")).rows[0].n as number;
    if (seeded < 100) return ctx.skip();
    const o = await loadOverview(pool, { days: 30, timeZone: TZ, now: new Date() });
    expect(o.kpis.views.value).toBeGreaterThan(0);
    expect(o.kpis.posts.value).toBeGreaterThan(0);
    expect(o.kpis.followers.value).toBeGreaterThan(0);
    expect(o.viewsPerDay.filter((d) => (d.instagram ?? 0) + (d.youtube ?? 0) > 0).length).toBeGreaterThanOrEqual(25);
    expect(o.topPosts.length).toBeGreaterThanOrEqual(5);
    expect(o.topPosts.some((t) => t.byHand)).toBe(true);
    expect(o.findings.filter((f) => f.status === "ok").length).toBeGreaterThanOrEqual(3);
  });

  it("loadFollowerTotals sums the latest row per platform on or before each date", async () => {
    expect(await loadFollowerTotals(client, { from: "2026-11-09", to: "2026-11-16" })).toEqual({ current: 1320, previous: 1000 });
    expect(await loadFollowerTotals(client, { from: new Date("2026-01-01T00:00:00Z"), to: "2026-11-10" })).toEqual({ current: 1000, previous: null });
  });
});
