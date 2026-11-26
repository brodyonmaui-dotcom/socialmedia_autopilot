import pg from "pg";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OutboxPost, PlatformAdapter, PublishResult } from "@autopilot/core";
import { runOutboxWith, type OutboxConfig, type OutboxPool } from "../jobs/outbox.js";
import { registerOutboxJob } from "../jobs/register-outbox.js";
import { WORKER_STATUS_KEY, startupStatus, writeWorkerStatus, type HeartbeatInfo } from "../jobs/heartbeat.js";

/**
 * F18 I1: settings.worker_status is upserted at startup and after every outbox tick, and the
 * missed-slot guard holds a late approved post (one alert, row untouched) through the real pg store.
 *
 * Dev-DB safety (same pattern as outbox-config.db.test.ts): the tick clock is in 2099, the pool wrapper
 * drops every outbox row except this test's fixtures, the fake adapter fails the test if handed another
 * row. Fixtures live in a far-future week (2099-07-06, no other test uses it) and are rejected at the end;
 * their alerts are acknowledged (never deleted). A pre-existing worker_status value is put back afterwards.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-07-06";
const TICK_AT = new Date("2099-07-08T12:00:00.000Z");
const MARK = "heartbeat fixture";

function scoped(pool: pg.Pool, allowed: Set<string>): OutboxPool {
  return {
    async query(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params);
      const rows = res.rows.filter((r) => !("idempotency_key" in r) || allowed.has(r.id));
      return { rows, rowCount: res.rowCount };
    },
  };
}

describe.skipIf(!url)("worker heartbeat + missed-slot guard (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let mediaId: string;
  let previous: { value: unknown } | undefined;

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const status = async () => (await pool.query("select value, updated_at from settings where key = $1", [WORKER_STATUS_KEY])).rows[0];

  async function fixture(tag: string, at: string): Promise<string> {
    const caption = `${MARK}: ${tag}`;
    const hit = (await pool.query("select id from batch_items where batch_id = $1 and caption = $2 order by created_at, id limit 1", [batchId, caption])).rows[0];
    const id: string =
      hit?.id ??
      (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, 'instagram', $3, $4) returning id", [batchId, mediaId, caption, at])).rows[0].id;
    await pool.query(
      `update batch_items set status = 'approved', scheduled_for = $2, trial = null, attempts = 0, last_error = null, next_attempt_at = null,
              platform_post_id = null, platform_post_url = null, approved_at = now(), approved_session = null, updated_at = now() where id = $1`,
      [id, at],
    );
    await pool.query("update alerts set acknowledged_at = now() where acknowledged_at is null and batch_item_id = $1", [id]);
    return id;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const prev = (await pool.query("select value from settings where key = $1", [WORKER_STATUS_KEY])).rows[0];
    previous = prev && !String(prev.value?.lastTickAt ?? "").startsWith("2099-") ? prev : undefined; // never "restore" a leftover fixture
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    mediaId = media.id;
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
    await pool.query("update batches set status = 'approved', approved_at = now(), updated_at = now() where id = $1", [batchId]);
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query("update alerts set acknowledged_at = now() where acknowledged_at is null and batch_item_id in (select id from batch_items where batch_id = $1)", [batchId]);
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    // Put a real value back; a row only this test created (2099 clock) is removed so the dev banner isn't fooled.
    if (pool && previous) await pool.query("update settings set value = $2, updated_at = now() where key = $1", [WORKER_STATUS_KEY, JSON.stringify(previous.value)]);
    else if (pool) await pool.query("delete from settings where key = $1 and value->>'lastTickAt' like '2099-%'", [WORKER_STATUS_KEY]);
    await pool?.end();
  });

  const fakeIg = (allowed: Set<string>) => {
    const publish = vi.fn(async (post: OutboxPost): Promise<PublishResult> => {
      if (!allowed.has(post.id)) throw new Error(`test adapter handed a non-fixture row ${post.id}`);
      return { platformPostId: `ig-hb-${post.id}`, platformPostUrl: "https://www.instagram.com/reel/hb/" };
    });
    const adapter: PlatformAdapter = { platform: "instagram", publish };
    return { adapter, publish };
  };

  /** Registers the real job on a fake boss and returns its tick handler (runTick goes through the scoped pool). */
  async function registeredTick(allowed: Set<string>, adapter: PlatformAdapter, info: HeartbeatInfo, dryRun: boolean): Promise<() => Promise<unknown>> {
    let handler: (() => Promise<unknown>) | undefined;
    const boss = { createQueue: async () => {}, work: async (_q: string, fn: () => Promise<unknown>) => void (handler = fn), schedule: async () => {} };
    const cfg: OutboxConfig = { publicMediaBase: "https://media.example.invalid", dryRun, timeZone: "UTC", now: () => TICK_AT, log: () => {}, alerts: { send: async () => {} }, blocklist: [] };
    await registerOutboxJob(boss as unknown as PgBoss, pool, cfg, info, (_p, c) => runOutboxWith(scoped(pool, allowed), { instagram: adapter }, c));
    return handler!;
  }

  it("startup: worker_status is upserted with the documented shape", async () => {
    const info: HeartbeatInfo = { dryRun: true, reason: "live refused: DRY_RUN is false but no live key (pass the argv flag or WORKER_LIVE=1); running dry-run", startedAt: "2099-07-08T11:59:00.000Z" };
    expect(await writeWorkerStatus(pool, startupStatus(info))).toBe(true);
    const row = await status();
    expect(row.value).toEqual({ mode: "dry-run", reason: info.reason, startedAt: info.startedAt, lastTickAt: info.startedAt, missed: 0, dueNow: 0 });
    expect(Object.keys(row.value).sort()).toEqual(["dueNow", "lastTickAt", "missed", "mode", "reason", "startedAt"]);
  });

  it("per tick: a 61-min-late approved post is held (one missed-slot alert across ticks, row untouched); the heartbeat records it", async () => {
    const late = await fixture("late", new Date(TICK_AT.getTime() - 61 * 60_000).toISOString());
    const before = await item(late);
    const allowed = new Set([late]);
    const fake = fakeIg(allowed);
    const info: HeartbeatInfo = { dryRun: false, reason: null, startedAt: "2099-07-08T11:00:00.000Z" };
    const tick = await registeredTick(allowed, fake.adapter, info, false);
    await tick();
    await tick();

    expect(fake.publish).not.toHaveBeenCalled();
    const after = await item(late);
    expect(after).toMatchObject({ status: "approved", attempts: 0, last_error: null });
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
    // unique (kind, batch_item_id): one missed-slot row per item, ever (a re-run of this test finds the first one, acknowledged).
    const alerts = (await pool.query("select kind, platform, message from alerts where batch_item_id = $1 and kind = 'missed-slot'", [late])).rows;
    expect(alerts).toEqual([{ kind: "missed-slot", platform: "instagram", message: "post missed its time (instagram, 10:59 AM 2099-07-08); move it in the calendar" }]);

    const row = await status();
    expect(row.value).toEqual({ mode: "live", reason: null, startedAt: info.startedAt, lastTickAt: TICK_AT.toISOString(), missed: 1, dueNow: 0 });
  });

  it("per tick in dry-run: a post inside the grace counts as due, nothing is published", async () => {
    const ok = await fixture("in-grace", new Date(TICK_AT.getTime() - 30 * 60_000).toISOString());
    const allowed = new Set([ok]);
    const fake = fakeIg(allowed);
    const info: HeartbeatInfo = { dryRun: true, reason: null, startedAt: "2099-07-08T11:00:00.000Z" };
    await (await registeredTick(allowed, fake.adapter, info, true))();
    expect(fake.publish).not.toHaveBeenCalled();
    expect((await item(ok)).status).toBe("approved");
    expect((await status()).value).toMatchObject({ mode: "dry-run", lastTickAt: TICK_AT.toISOString(), missed: 0, dueNow: 1 });
  });
});
