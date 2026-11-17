import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchAll, SEARCH_SQL } from "../query.js";

/**
 * Runs against a real dev DB (DATABASE_URL). Every fixture row is written inside one transaction that is
 * rolled back at the end, so nothing is left behind. The run tag keeps matches to our own rows.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("search queries (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  const tag = `zq${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    const m = (await client.query("insert into media (content_hash, source_path, pillar, duration_s) values ($1, $2, 'gym', 42) returning id", [`search-test-${tag}`, `/in/${tag}-leg-day.mp4`])).rows[0].id;
    const b = (await client.query("insert into batches (week_start, status) values ('2099-01-05', 'draft') returning id")).rows[0].id;
    for (const [platform, at] of [
      ["instagram", "2099-01-06T17:00:00Z"],
      ["youtube", "2099-01-06T18:00:00Z"],
    ])
      await client.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, $3, $4, $5)", [b, m, platform, `Leg day ${tag}`, at]);
    await client.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'tiktok', $3, now(), 'rejected')", [b, m, `rejected ${tag}`]);
    await client.query("insert into ideas (title) values ($1)", [`Idea ${tag}`]);
    await client.query("insert into ideas (title, stage) values ($1, 'dropped')", [`Dropped ${tag}`]);
    await client.query("insert into hooks (text) values ($1)", [`Hook ${tag}`]);
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool?.end();
  });

  it("finds posts (one per clip per day), ideas + hooks and clips by the tag", async () => {
    const res = await searchAll(client, tag, "UTC");
    const g = Object.fromEntries(res.groups.map((x) => [x.id, x.results]));
    expect(g.posts).toHaveLength(1);
    expect(g.posts![0]).toMatchObject({ title: `Leg day ${tag}`, href: "/calendar?day=2099-01-06" });
    expect(g.posts![0]!.meta).toContain("Instagram, YouTube");
    expect(g.ideas!.map((r) => r.title).sort()).toEqual([`Hook ${tag}`, `Idea ${tag}`]);
    expect(g.clips![0]).toMatchObject({ title: `${tag}-leg-day`, href: `/library?q=${tag}-leg-day` });
  });

  it("matches wildcards literally (no injection through LIKE)", async () => {
    const res = await searchAll(client, `${tag}%`, "UTC");
    expect(res.groups.filter((x) => x.id !== "pages")).toEqual([]);
  });

  it("uses only placeholders", () => {
    for (const sql of Object.values(SEARCH_SQL)) {
      expect(sql).toContain("$1");
      expect(sql).not.toMatch(/\$\{/);
    }
  });
});
