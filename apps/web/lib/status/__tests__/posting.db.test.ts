import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPostingStatus } from "../posting.js";

/**
 * F18 posting status against the scratch DB (DATABASE_URL). Fixtures sit in 1999 and `now` is set there,
 * so nothing else in the dev DB is late enough to count. Items are upserted by ingest_key and rejected at
 * the end (never deleted); the heartbeat goes to an isolated settings key (removed at the end), so a
 * running worker's real `worker_status` row is never touched.
 */
const url = process.env.DATABASE_URL;
const KEY = "test-f18-worker_status";
const NOW = new Date("1999-03-10T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe.skipIf(!url)("loadPostingStatus (db)", () => {
  let pool: pg.Pool;
  const heartbeat = (value: unknown) =>
    pool.query("insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()", [KEY, JSON.stringify(value)]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    const media = (await pool.query("select id from media order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need a media row");
    const batch = async (week: string, status: string) => {
      const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [week])).rows[0];
      const id = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, $2) returning id", [week, status])).rows[0].id;
      await pool.query("update batches set status = $2 where id = $1", [id, status]);
      return id as string;
    };
    const approvedBatch = await batch("1999-03-01", "approved");
    const draftBatch = await batch("1999-03-08", "draft");
    const fixture = (key: string, batchId: string, platform: string, status: string, at: Date) =>
      pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, ingest_key, approved_at)
         values ($1, $2, $3, 'F18 fixture.', $4, $5, $6, case when $5 = 'approved' then now() end)
         on conflict (ingest_key) where ingest_key is not null do update
           set batch_id = excluded.batch_id, platform = excluded.platform, scheduled_for = excluded.scheduled_for,
               status = excluded.status, approved_at = excluded.approved_at`,
        [batchId, media.id, platform, at, status, `test-f18-i2:${key}`],
      );
    // Counted: two approved posts more than an hour late (the oldest is 3 h late).
    await fixture("yt", approvedBatch, "youtube", "approved", ago(180));
    await fixture("tt", approvedBatch, "tiktok", "approved", ago(61));
    // Not counted: within the hour, Snapchat, published, rejected, draft, an unapproved batch, the future.
    await fixture("grace", approvedBatch, "instagram", "approved", ago(59));
    await fixture("snap", approvedBatch, "snapchat", "approved", ago(300));
    await fixture("published", approvedBatch, "instagram", "published", ago(300));
    await fixture("rejected", approvedBatch, "instagram", "rejected", ago(300));
    await fixture("draft", approvedBatch, "tiktok", "draft", ago(300));
    await fixture("unapproved-batch", draftBatch, "youtube", "approved", ago(300));
    await fixture("future", approvedBatch, "youtube", "approved", ago(-120));
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like 'test-f18-i2:%'");
    await pool.query("delete from settings where key = $1", [KEY]);
    await pool.end();
  });

  it("unknown without a heartbeat row; missed is counted in SQL anyway", async () => {
    await pool.query("delete from settings where key = $1", [KEY]);
    expect(await loadPostingStatus(pool, NOW, { key: KEY })).toEqual({ state: "unknown", lastTickAt: null, missed: 2, oldestMissedAt: ago(180).toISOString() });
  });

  it("dry-run and live from a fresh heartbeat (the heartbeat's own missed number is ignored)", async () => {
    await heartbeat({ mode: "dry-run", reason: "dry run", startedAt: ago(30).toISOString(), lastTickAt: ago(1).toISOString(), missed: 99, dueNow: 0 });
    expect(await loadPostingStatus(pool, NOW, { key: KEY })).toMatchObject({ state: "dry-run", lastTickAt: ago(1).toISOString(), missed: 2 });
    await heartbeat({ mode: "live", reason: null, startedAt: ago(30).toISOString(), lastTickAt: ago(4).toISOString(), missed: 0, dueNow: 1 });
    expect(await loadPostingStatus(pool, NOW, { key: KEY })).toMatchObject({ state: "live", missed: 2 });
  });

  it("stale when the last tick is older than 5 minutes", async () => {
    await heartbeat({ mode: "live", reason: null, startedAt: ago(60).toISOString(), lastTickAt: ago(6).toISOString(), missed: 0, dueNow: 0 });
    expect(await loadPostingStatus(pool, NOW, { key: KEY })).toMatchObject({ state: "stale", lastTickAt: ago(6).toISOString() });
  });

  it("a malformed row reads as unknown, never throws", async () => {
    await heartbeat(["not", "an", "object"]);
    expect((await loadPostingStatus(pool, NOW, { key: KEY })).state).toBe("unknown");
  });
});
