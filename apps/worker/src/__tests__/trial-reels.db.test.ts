// F20-F. Real Postgres (DATABASE_URL), one transaction rolled back at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { IG_TRIAL_REELS_KEY, TRIAL_REELS_ALERTED_KEY, TRIAL_REELS_MIN_FOLLOWERS_KEY } from "@autopilot/core";
import { setSetting } from "@autopilot/db";
import { PgOutboxStore } from "../jobs/outbox.js";
import { checkTrialReelsReady, igTrialDefault } from "../jobs/trial-reels.js";

const url = process.env.DATABASE_URL;
const NOW = new Date("2099-05-01T12:00:00Z");

describe.skipIf(!url)("trial reels (db)", () => {
  let pool: pg.Pool;
  let c: pg.PoolClient;
  const followers = (n: number, day = "2099-05-01") =>
    c.query("insert into account_snapshots (platform, captured_on, followers) values ('instagram', $1::date, $2) on conflict (platform, captured_on) do update set followers = excluded.followers", [day, n]);
  const alerts = async () => (await c.query("select message, platform from alerts where kind = 'trial-reels-ready'")).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    c = await pool.connect();
    await c.query("begin");
    await c.query("delete from alerts where kind = 'trial-reels-ready'");
    await c.query("delete from account_snapshots");
    await c.query("delete from settings where key in ($1, $2, $3)", [IG_TRIAL_REELS_KEY, TRIAL_REELS_ALERTED_KEY, TRIAL_REELS_MIN_FOLLOWERS_KEY]);
  });
  afterAll(async () => {
    await c?.query("rollback");
    c?.release();
    await pool?.end();
  });

  it("no alert below the minimum or without a count; one alert at it; never twice", async () => {
    expect(await checkTrialReelsReady(c, NOW, () => {})).toBe(false);
    await followers(199, "2099-04-30");
    expect(await checkTrialReelsReady(c, NOW, () => {})).toBe(false);
    expect(await alerts()).toEqual([]);
    await followers(200);
    expect(await checkTrialReelsReady(c, NOW, () => {})).toBe(true);
    expect(await alerts()).toEqual([{ message: "Instagram reached 200 followers: trial reels can be turned on in Settings.", platform: "instagram" }]);
    await followers(250, "2099-05-02");
    expect(await checkTrialReelsReady(c, NOW, () => {})).toBe(false);
    expect(await alerts()).toHaveLength(1);
  });

  it("toggle off → no trial params; on but below the minimum → none; on and >= minimum → MANUAL", async () => {
    expect(await igTrialDefault(c)).toBeNull();
    await setSetting(c, IG_TRIAL_REELS_KEY, true);
    await setSetting(c, TRIAL_REELS_MIN_FOLLOWERS_KEY, 1000);
    expect(await igTrialDefault(c)).toBeNull();
    await setSetting(c, TRIAL_REELS_MIN_FOLLOWERS_KEY, 200);
    expect(await igTrialDefault(c)).toBe("MANUAL");
    await setSetting(c, IG_TRIAL_REELS_KEY, false);
    expect(await igTrialDefault(c)).toBeNull(); // read per call, not cached
  });

  it("listDue gives plain IG posts the default only when on, never to an item with its own trial; markPublished records it, a fallback does not count", async () => {
    const mk = (id: string, platform: string, trial: unknown) => ({ id, idempotency_key: id, media_id: "m", platform, caption: "x", title: null, trial, scheduled_for: NOW, status: "approved", attempts: 0, next_attempt_at: null, last_error: null, platform_post_id: null, platform_post_url: null, updated_at: NOW, r2_key: "k" });
    const rows = [mk("a", "instagram", null), mk("b", "instagram", { graduationStrategy: "SS_PERFORMANCE" }), mk("c", "youtube", null)];
    const writes: unknown[][] = [];
    const fake = {
      async query(sql: string, params?: unknown[]) {
        if (/from batch_items bi/.test(sql)) return { rows, rowCount: rows.length };
        if (/^update batch_items set status = 'published'/.test(sql.trim())) {
          writes.push(params!);
          return { rows: [], rowCount: 1 };
        }
        return c.query(sql, params);
      },
    };
    const store = new PgOutboxStore(fake as never, "https://m.example", () => {});
    await setSetting(c, IG_TRIAL_REELS_KEY, false);
    expect((await store.listDue(NOW)).map((p) => p.trial?.graduationStrategy)).toEqual([undefined, "SS_PERFORMANCE", undefined]);
    await setSetting(c, IG_TRIAL_REELS_KEY, true);
    expect((await store.listDue(NOW)).map((p) => p.trial?.graduationStrategy)).toEqual(["MANUAL", "SS_PERFORMANCE", undefined]);
    await store.markPublished("a", { platformPostId: "1" }, 1, NOW);
    expect(JSON.parse(writes[0]![5] as string)).toEqual({ graduationStrategy: "MANUAL" });
    await store.listDue(NOW);
    await store.markPublished("a", { platformPostId: "1", trialFellBack: true, flags: ["trial refused: posted as a regular reel"] }, 1, NOW);
    expect(JSON.parse(writes[1]![5] as string)).toMatchObject({ fellBack: true });
  });
});
