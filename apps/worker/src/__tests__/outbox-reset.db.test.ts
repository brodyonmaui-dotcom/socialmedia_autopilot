import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runOutboxTick, type OutboxPost, type PlatformAdapter, type PublishResult } from "@autopilot/core";
import { PgOutboxStore, type OutboxPool } from "../jobs/outbox.js";

/**
 * F11 T2: a row in exactly the state "reset to draft by the creator, then re-approved" (same key,
 * attempts 1, approved_at set, batch approved) goes through one real PgOutboxStore tick with a fake IG
 * adapter. attempts > 0 means findExisting runs before any publish: a hit marks it published with no
 * second publish; a miss publishes exactly once with the same idempotency key.
 *
 * Dev-DB safety: the tick's clock is in 2099, so listDue/listStale would see every approved/publishing
 * row in the dev DB. The pool wrapper below drops every outbox row except this test's fixtures before
 * the engine sees it, and the fake adapter fails the test if it is ever handed another row. Fixtures
 * live in a far-future week (2099-02-09), are reset at the start, rejected at the end; nothing is deleted.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-02-09";
const TICK_AT = new Date("2099-02-12T12:00:00.000Z");
const CADENCE = { dailyCaps: { instagram: 10, youtube: 10, tiktok: 10, snapchat: 1 } };

function scoped(pool: pg.Pool, allowed: Set<string>): OutboxPool {
  return {
    async query(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params);
      // Outbox SELECTs carry idempotency_key; keep only this test's rows.
      const rows = res.rows.filter((r) => !("idempotency_key" in r) || allowed.has(r.id));
      return { rows, rowCount: res.rowCount };
    },
  };
}

describe.skipIf(!url)("outbox tick after an F11 reset + re-approve (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let hitRow: string; // IG says it's there → no publish
  let missRow: string; // IG says it isn't → exactly one publish

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
    await pool.query("update batches set status = 'approved', approved_at = now(), updated_at = now() where id = $1", [batchId]);

    // The post-reset-and-re-approved state: approved, attempts 1, no error, no platform id, approved_at set.
    const fixture = async (caption: string, at: string): Promise<string> => {
      const hit = (await pool.query("select id from batch_items where batch_id = $1 and caption = $2 order by created_at, id limit 1", [batchId, caption])).rows[0];
      const id: string =
        hit?.id ??
        (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, 'instagram', $3, $4) returning id", [batchId, media.id, caption, at]))
          .rows[0].id;
      await pool.query(
        `update batch_items set status = 'approved', scheduled_for = $2, trial = null, attempts = 1, last_error = null, next_attempt_at = null,
                platform_post_id = null, platform_post_url = null, approved_at = now(), approved_session = null, updated_at = now() where id = $1`,
        [id, at],
      );
      return id;
    };
    hitRow = await fixture("f11 outbox fixture: already on IG", "2099-02-10T10:00:00Z");
    missRow = await fixture("f11 outbox fixture: not on IG", "2099-02-11T10:00:00Z");
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    await pool?.end();
  });

  const fakeIg = (allowed: Set<string>, found: PublishResult | null) => {
    const guard = (post: OutboxPost) => {
      if (!allowed.has(post.id)) throw new Error(`test adapter handed a non-fixture row ${post.id}`);
    };
    const findExisting = vi.fn(async (post: OutboxPost) => (guard(post), found));
    const publish = vi.fn(async (post: OutboxPost): Promise<PublishResult> => (guard(post), { platformPostId: "ig-fresh-1", platformPostUrl: "https://www.instagram.com/reel/fresh/" }));
    const adapter: PlatformAdapter = { platform: "instagram", findExisting, publish };
    return { adapter, findExisting, publish };
  };

  const tick = (allowed: Set<string>, adapter: PlatformAdapter) =>
    runOutboxTick(new PgOutboxStore(scoped(pool, allowed), "https://media.example.invalid", () => {}), {
      adapters: { instagram: adapter },
      dryRun: false,
      cadence: CADENCE,
      timeZone: "UTC",
      now: () => TICK_AT,
      log: () => {},
    });

  it("findExisting hit → published from the lookup, publish never called", async () => {
    const allowed = new Set([hitRow]);
    const key = (await item(hitRow)).idempotency_key;
    const fake = fakeIg(allowed, { platformPostId: "ig-existing-1", platformPostUrl: "https://www.instagram.com/reel/existing/" });
    const r = await tick(allowed, fake.adapter);
    expect(fake.findExisting).toHaveBeenCalledTimes(1);
    expect(fake.findExisting.mock.calls[0]![0].idempotencyKey).toBe(key);
    expect(fake.publish).toHaveBeenCalledTimes(0);
    expect(r).toMatchObject({ considered: 1, published: 1, recovered: 1 });
    expect(await item(hitRow)).toMatchObject({ status: "published", platform_post_id: "ig-existing-1", idempotency_key: key, attempts: 1 });
  });

  it("findExisting miss → publish exactly once, same idempotency key", async () => {
    const allowed = new Set([missRow]);
    const key = (await item(missRow)).idempotency_key;
    const fake = fakeIg(allowed, null);
    const r = await tick(allowed, fake.adapter);
    expect(fake.findExisting).toHaveBeenCalledTimes(1);
    expect(fake.publish).toHaveBeenCalledTimes(1);
    expect(fake.publish.mock.calls[0]![0].idempotencyKey).toBe(key);
    expect(fake.findExisting.mock.invocationCallOrder[0]!).toBeLessThan(fake.publish.mock.invocationCallOrder[0]!);
    expect(r).toMatchObject({ considered: 1, published: 1, recovered: 0 });
    expect(await item(missRow)).toMatchObject({ status: "published", platform_post_id: "ig-fresh-1", idempotency_key: key });

    // A second tick finds nothing due: still one publish.
    await tick(allowed, fake.adapter);
    expect(fake.publish).toHaveBeenCalledTimes(1);
  });
});
