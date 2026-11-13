// Runs against a real Postgres with migrations applied (DATABASE_URL; local: bash scripts/dev/local-stack.sh).
// One media/batch/item fixture tagged `test-f9-analytics`, scheduled in 2020 so it never shows in a
// 30-day window; found-or-created and left in place, like the other db tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { EMPTY_METRICS, loadPublishedForIngest, writeSnapshot } from "@autopilot/analytics";

const url = process.env.DATABASE_URL;
const TAG = "test-f9-analytics";
const AT = "2020-01-06T12:00:00Z";

describe.skipIf(!url)("analytics snapshots (db)", () => {
  let pool: pg.Pool;
  let itemId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const media =
      (await pool.query("select id from media where content_hash = $1", [TAG])).rows[0]?.id ??
      (await pool.query("insert into media (content_hash, status) values ($1, 'used') returning id", [TAG])).rows[0].id;
    const hit = (await pool.query("select id from batch_items where title = $1 and media_id = $2", [TAG, media])).rows[0]?.id;
    if (hit) itemId = hit;
    else {
      const batch = (await pool.query("insert into batches (week_start, status) values ('2020-01-06', 'approved') returning id")).rows[0].id;
      itemId = (
        await pool.query(
          "insert into batch_items (batch_id, media_id, platform, title, scheduled_for, status, platform_post_id) values ($1, $2, 'youtube', $3, $4, 'published', 'testVideo01') returning id",
          [batch, media, TAG, AT],
        )
      ).rows[0].id;
    }
  });
  afterAll(async () => {
    await pool.end();
  });

  it("unique (batch_item_id, age_hours): a second write of the same checkpoint is a no-op", async () => {
    const w = { batchItemId: itemId, ageHours: 24, metrics: { ...EMPTY_METRICS, views: 1 } };
    await writeSnapshot(pool, w);
    await writeSnapshot(pool, { ...w, metrics: { ...EMPTY_METRICS, views: 999 } });
    await writeSnapshot(pool, { ...w, ageHours: 72 });
    const { rows } = await pool.query("select age_hours, metrics from post_metrics where batch_item_id = $1 order by age_hours", [itemId]);
    expect(rows.map((r) => r.age_hours)).toEqual([24, 72]);
    expect(rows[0].metrics.views).toBe(1);

    const posts = await loadPublishedForIngest(pool, new Date("2020-01-01T00:00:00Z"));
    const mine = posts.find((p) => p.batchItemId === itemId);
    expect(mine).toMatchObject({ platform: "youtube", platformPostId: "testVideo01", postedAt: new Date(AT).toISOString() });
    expect(mine!.capturedAges.sort((a, b) => a - b)).toEqual([24, 72]);
  });
});
