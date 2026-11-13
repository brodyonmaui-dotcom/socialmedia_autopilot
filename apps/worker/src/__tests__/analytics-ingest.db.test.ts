// Runs against a real Postgres with migrations applied (DATABASE_URL; local: bash scripts/dev/local-stack.sh).
// Everything happens inside one transaction on a single client that is rolled back at the end, so the
// test leaves no rows behind (a leftover media row would make dev:seed refuse the dev DB).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { EMPTY_METRICS, loadPublishedForIngest, writeSnapshot } from "@autopilot/analytics";

const url = process.env.DATABASE_URL;
const TAG = "test-f9-analytics";
const AT = "2020-01-06T12:00:00Z";

describe.skipIf(!url)("analytics snapshots (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let itemId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    const media = (await client.query("insert into media (content_hash, status) values ($1, 'used') returning id", [`${TAG}-${Date.now()}`])).rows[0].id;
    const batch = (await client.query("insert into batches (week_start, status) values ('2020-01-06', 'approved') returning id")).rows[0].id;
    itemId = (
      await client.query(
        "insert into batch_items (batch_id, media_id, platform, title, scheduled_for, status, platform_post_id) values ($1, $2, 'youtube', $3, $4, 'published', 'testVideo01') returning id",
        [batch, media, TAG, AT],
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

  it("unique (batch_item_id, age_hours): a second write of the same checkpoint is a no-op", async () => {
    const w = { batchItemId: itemId, ageHours: 24, metrics: { ...EMPTY_METRICS, views: 1 } };
    await writeSnapshot(client, w);
    await writeSnapshot(client, { ...w, metrics: { ...EMPTY_METRICS, views: 999 } });
    await writeSnapshot(client, { ...w, ageHours: 72 });
    const { rows } = await client.query("select age_hours, metrics from post_metrics where batch_item_id = $1 order by age_hours", [itemId]);
    expect(rows.map((r) => r.age_hours)).toEqual([24, 72]);
    expect(rows[0].metrics.views).toBe(1);

    const posts = await loadPublishedForIngest(client, new Date("2020-01-01T00:00:00Z"));
    const mine = posts.find((p) => p.batchItemId === itemId);
    expect(mine).toMatchObject({ platform: "youtube", platformPostId: "testVideo01", postedAt: new Date(AT).toISOString() });
    expect(mine!.capturedAges.sort((a, b) => a - b)).toEqual([24, 72]);
  });
});
