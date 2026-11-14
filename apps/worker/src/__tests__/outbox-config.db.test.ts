import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OutboxPost, PlatformAdapter, PublishResult } from "@autopilot/core";
import { MEDIA_BASE_INVALID_MESSAGE, runOutboxWith, type OutboxConfig, type OutboxPool } from "../jobs/outbox.js";

/**
 * Review pack handoff-media #7: with PUBLIC_MEDIA_BASE unset/invalid, runOutboxWith skips the tick
 * (no batch_items row touched, no adapter call) and raises ONE open 'config' alert, however many
 * ticks run. With a valid base the normal path publishes once.
 *
 * Dev-DB safety (same pattern as outbox-reset.db.test.ts): the tick's clock is in 2099, so the pool
 * wrapper drops every outbox row except this test's fixture, and the fake adapter fails the test if it
 * is handed another row. The fixture lives in a far-future week (2099-03-09) and is rejected at the end;
 * this test's config alerts are acknowledged (never deleted) before and after.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-03-09";
const TICK_AT = new Date("2099-03-12T12:00:00.000Z");

function scoped(pool: pg.Pool, allowed: Set<string>): OutboxPool {
  return {
    async query(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params);
      const rows = res.rows.filter((r) => !("idempotency_key" in r) || allowed.has(r.id));
      return { rows, rowCount: res.rowCount };
    },
  };
}

describe.skipIf(!url)("outbox tick with PUBLIC_MEDIA_BASE missing (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let row: string;

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const openConfigAlerts = async () =>
    (await pool.query("select id, platform, batch_item_id from alerts where kind = 'config' and acknowledged_at is null and message = $1", [MEDIA_BASE_INVALID_MESSAGE])).rows;
  const ackConfigAlerts = () => pool.query("update alerts set acknowledged_at = now() where kind = 'config' and acknowledged_at is null and message = $1", [MEDIA_BASE_INVALID_MESSAGE]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
    await pool.query("update batches set status = 'approved', approved_at = now(), updated_at = now() where id = $1", [batchId]);
    const caption = "outbox-config fixture: due approved item";
    const at = "2099-03-11T10:00:00Z";
    const hit = (await pool.query("select id from batch_items where batch_id = $1 and caption = $2 order by created_at, id limit 1", [batchId, caption])).rows[0];
    row =
      hit?.id ??
      (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, 'instagram', $3, $4) returning id", [batchId, media.id, caption, at])).rows[0].id;
    await pool.query(
      `update batch_items set status = 'approved', scheduled_for = $2, trial = null, attempts = 0, last_error = null, next_attempt_at = null,
              platform_post_id = null, platform_post_url = null, approved_at = now(), approved_session = null, updated_at = now() where id = $1`,
      [row, at],
    );
    await ackConfigAlerts();
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    if (pool) await ackConfigAlerts();
    await pool?.end();
  });

  const fakeIg = (allowed: Set<string>) => {
    const guard = (post: OutboxPost) => {
      if (!allowed.has(post.id)) throw new Error(`test adapter handed a non-fixture row ${post.id}`);
    };
    const publish = vi.fn(async (post: OutboxPost): Promise<PublishResult> => (guard(post), { platformPostId: "ig-config-1", platformPostUrl: "https://www.instagram.com/reel/config/" }));
    const adapter: PlatformAdapter = { platform: "instagram", publish };
    return { adapter, publish };
  };

  const cfg = (publicMediaBase: string, dryRun = false): OutboxConfig => ({ publicMediaBase, dryRun, timeZone: "UTC", now: () => TICK_AT, log: () => {}, alerts: { send: async () => {} }, blocklist: [] });

  it("empty base: item stays approved, no publish, exactly one open config alert across repeated ticks (live and dry run)", async () => {
    const allowed = new Set([row]);
    const fake = fakeIg(allowed);
    const before = await item(row);
    const r = await runOutboxWith(scoped(pool, allowed), { instagram: fake.adapter }, cfg(""));
    expect(r).toMatchObject({ considered: 0, published: 0, failed: 0, skipped: 0 });
    expect(fake.publish).not.toHaveBeenCalled();
    const after = await item(row);
    expect(after).toMatchObject({ status: "approved", attempts: 0, last_error: null });
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
    const open = await openConfigAlerts();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ platform: "all", batch_item_id: null });

    await runOutboxWith(scoped(pool, allowed), { instagram: fake.adapter }, cfg(""));
    await runOutboxWith(scoped(pool, allowed), { instagram: fake.adapter }, cfg("", true));
    expect(fake.publish).not.toHaveBeenCalled();
    expect(await openConfigAlerts()).toHaveLength(1);
    expect((await item(row)).status).toBe("approved");
  });

  it("valid base: the normal path publishes the item once", async () => {
    const allowed = new Set([row]);
    const fake = fakeIg(allowed);
    const r = await runOutboxWith(scoped(pool, allowed), { instagram: fake.adapter }, cfg("https://media.example.invalid"));
    expect(fake.publish).toHaveBeenCalledTimes(1);
    expect(fake.publish.mock.calls[0]![0].mediaUrl.startsWith("https://media.example.invalid/")).toBe(true);
    expect(r).toMatchObject({ considered: 1, published: 1 });
    expect(await item(row)).toMatchObject({ status: "published", platform_post_id: "ig-config-1" });
  });
});
