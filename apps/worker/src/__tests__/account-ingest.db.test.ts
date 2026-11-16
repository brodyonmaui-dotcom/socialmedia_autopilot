// Runs against a real Postgres with migrations applied (DATABASE_URL; local: bash scripts/dev/local-stack.sh).
// Everything happens inside one transaction on a single client that is rolled back at the end.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fetchInstagramAccount, fetchYouTubeAccount, loadAccountPosts, type FetchLike } from "@autopilot/analytics";
import { runAccountIngestOnce, type AccountPlatform } from "../jobs/account-ingest.js";
import type { AccountFetcher } from "@autopilot/analytics";

const url = process.env.DATABASE_URL;
const FX = new URL("../../../../packages/analytics/src/__tests__/fixtures/account/", import.meta.url);
const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FX), "utf8"));
const NOW = new Date("2026-11-16T12:00:00Z");

function igFetch(rateLimitOn?: string): FetchLike {
  return async (u) => {
    const r = (() => {
      if (rateLimitOn && u.includes(rateLimitOn)) return { status: 400, body: fx("ig-error-rate-limit.json") };
      if (/\?fields=followers_count,media_count$/.test(u)) return { status: 200, body: fx("ig-user.json") };
      if (u.includes("/media?") && u.includes("after=QVFIUAFTER1")) return { status: 200, body: fx("ig-media-page2.json") };
      if (u.includes("/media?")) return { status: 200, body: fx("ig-media-page1.json") };
      if (u.includes("18000000000000003/insights?metric=views,")) return { status: 400, body: fx("ig-error-unsupported.json") };
      if (u.includes("18000000000000003/insights?metric=views")) return { status: 200, body: fx("ig-insights-views-only.json") };
      return { status: 200, body: fx("ig-insights-reel.json") };
    })();
    return { status: r.status, json: async () => r.body };
  };
}
const ytFetch: FetchLike = async (u) => {
  const body = u.includes("/channels?") ? fx("yt-channels-mine.json") : u.includes("/playlistItems?") ? fx("yt-playlist-items.json") : fx("yt-videos-account.json");
  return { status: 200, json: async () => body };
};

const fetchers = (rateLimitOn?: string): Partial<Record<AccountPlatform, AccountFetcher>> => ({
  instagram: (o) => fetchInstagramAccount({ accessToken: "t", igUserId: "17841400000000001", fetch: igFetch(rateLimitOn) }, o),
  youtube: (o) => fetchYouTubeAccount({ accessToken: "t", fetch: ytFetch }, o),
});

describe.skipIf(!url)("account ingest (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let igItem: string;
  let ytItem: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    // Isolate from the seed's demo rows in the account_* tables (only written by this feature): this
    // transaction is rolled back, so nothing is removed from the dev DB.
    await client.query("delete from account_post_snapshots");
    await client.query("delete from account_posts");
    await client.query("delete from account_snapshots");
    const media = (await client.query("insert into media (content_hash, status, pillar, duration_s) values ($1, 'used', 'gym', 12) returning id", [`test-account-${Date.now()}`])).rows[0].id;
    const batch = (await client.query("insert into batches (week_start, status) values ('2026-11-09', 'approved') returning id")).rows[0].id;
    // IG item matched by id; YT item matched by caption (its first line = the video title, ±36 h).
    igItem = (
      await client.query(
        "insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, platform_post_id) values ($1, $2, 'instagram', 'x', '2026-11-15T17:00:00Z', 'published', '18000000000000001') returning id",
        [batch, media],
      )
    ).rows[0].id;
    ytItem = (
      await client.query(
        "insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'youtube', $3, '2026-11-14T18:00:00Z', 'published') returning id",
        [batch, media, "Full push day, every set\n\n#gym"],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool.end();
  });

  it("upserts posts, one snapshot per post per run, today's account row; matches by id and caption", async () => {
    const lines: string[] = [];
    const s = await runAccountIngestOnce(client, {}, { now: NOW, timeZone: "UTC", fetchers: fetchers(), log: (l) => lines.push(l) });
    expect(s.map((x) => [x.platform, x.posts, x.snapshots, x.matchedById, x.matchedByCaption, x.byHand, x.account])).toEqual([
      ["instagram", 4, 4, 1, 0, 3, true],
      ["youtube", 2, 2, 0, 1, 1, true],
    ]);
    expect(lines[0]).toMatch(/^\[account\] ig posts 4 \(id 1, caption 0, by hand 3\)/);
    const posts = await loadAccountPosts(client, { since: new Date("2026-09-01T00:00:00Z") });
    const ig = posts.find((p) => p.platformPostId === "18000000000000001")!;
    expect(ig).toMatchObject({ batchItemId: igItem, matchedBy: "id", pillar: "gym", durationS: 12, metrics: { views: 1532, avgWatchS: 4.21 } });
    expect(posts.find((p) => p.platformPostId === "vidAAAAAAA2")).toMatchObject({ batchItemId: ytItem, matchedBy: "caption", durationS: 42 });
    const acc = (await client.query("select platform, captured_on::text d, followers, total_views, posts_count from account_snapshots order by platform")).rows;
    expect(acc).toEqual([
      { platform: "instagram", d: "2026-11-16", followers: "142", total_views: null, posts_count: 61 },
      { platform: "youtube", d: "2026-11-16", followers: "312", total_views: "48210", posts_count: 57 },
    ]);
  });

  it("running twice inserts no duplicates and skips the account call once today's row exists", async () => {
    const calls: string[] = [];
    const f = fetchers();
    const wrapped: Partial<Record<AccountPlatform, AccountFetcher>> = {
      instagram: (o) => {
        calls.push(`ig include=${o.includeAccount}`);
        return f.instagram!(o);
      },
      youtube: f.youtube,
    };
    const s = await runAccountIngestOnce(client, {}, { now: NOW, timeZone: "UTC", fetchers: wrapped, log: () => {} });
    expect(calls).toEqual(["ig include=false"]);
    expect(s.map((x) => x.snapshots)).toEqual([0, 0]);
    const counts = (await client.query("select (select count(*)::int from account_posts) p, (select count(*)::int from account_post_snapshots) s, (select count(*)::int from account_snapshots) a")).rows[0];
    expect(counts).toEqual({ p: 6, s: 6, a: 2 });
  });

  it("a later run adds one snapshot per post; an 'id' match is never replaced", async () => {
    await client.query("update account_posts set batch_item_id = $1, matched_by = 'id' where platform_post_id = 'vidAAAAAAA2'", [igItem]); // pretend an id match
    await runAccountIngestOnce(client, {}, { now: new Date(NOW.getTime() + 6 * 3_600_000), timeZone: "UTC", fetchers: fetchers(), log: () => {} });
    const r = (await client.query("select batch_item_id, matched_by from account_posts where platform_post_id = 'vidAAAAAAA2'")).rows[0];
    expect(r).toEqual({ batch_item_id: igItem, matched_by: "id" });
    expect((await client.query("select count(*)::int n from account_post_snapshots")).rows[0].n).toBe(12);
  });

  it("a rate limit ends the platform run cleanly: partial data kept, one alert", async () => {
    const later = new Date(NOW.getTime() + 12 * 3_600_000);
    const open = async () => (await client.query("select count(*)::int n from alerts where kind = 'metrics-health' and platform = 'instagram' and acknowledged_at is null")).rows[0].n as number;
    const before = await open();
    const lines: string[] = [];
    const s = await runAccountIngestOnce(client, {}, { now: later, timeZone: "UTC", fetchers: fetchers("18000000000000002/insights"), log: (l) => lines.push(l) });
    expect(s[0]).toMatchObject({ platform: "instagram", stoppedBy: "rate-limit", posts: 4, snapshots: 1 });
    expect(s[1]).toMatchObject({ platform: "youtube", stoppedBy: null, snapshots: 2 });
    await runAccountIngestOnce(client, {}, { now: new Date(later.getTime() + 1000), timeZone: "UTC", fetchers: fetchers("18000000000000002/insights"), log: (l) => lines.push(l) });
    expect(await open()).toBe(Math.max(before, 1)); // one open alert, however many runs hit the limit
    expect(lines.filter((l) => l.includes("alert raised"))).toHaveLength(before ? 0 : 1);
    expect(lines.filter((l) => l.includes("alert already open"))).toHaveLength(before ? 2 : 1);
    expect(lines.some((l) => l.includes("metrics-health youtube"))).toBe(false);
    expect(lines.join("\n")).not.toMatch(/Bearer|access_token/);
  });

  it("without credentials logs one line and does nothing", async () => {
    const lines: string[] = [];
    expect(await runAccountIngestOnce(client, {}, { now: NOW, log: (l) => lines.push(l) })).toEqual([]);
    expect(lines).toEqual(["[account] account analytics: no sources"]);
  });
});
