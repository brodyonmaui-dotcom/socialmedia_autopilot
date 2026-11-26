import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutboxPost } from "@autopilot/core";
import { PgOutboxStore } from "../jobs/outbox.js";

/**
 * Audit fixes on PgOutboxStore against the dev DB:
 *  #2 missed-slot: a new miss (different message) reopens an acknowledged alert; the same miss stays closed.
 *  #1b knownPlatformPostIds: other rows' platform ids near the post, never the post's own.
 *  #4 claim persists the Settings default trial onto the row.
 * Fixtures live in a far-future week (2099-05-04) and are rejected afterwards; alerts are acknowledged, never deleted.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-05-04";

describe.skipIf(!url)("PgOutboxStore audit fixes (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let a: string;
  let b: string;
  const at = "2099-05-05T15:00:00Z";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, platform_post_id = null where batch_id = $1", [batchId]);
    const mk = async () =>
      (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, 'instagram', 'audit fixture', $3, 'approved') returning id", [batchId, media.id, at])).rows[0].id as string;
    a = await mk();
    b = await mk();
  });

  afterAll(async () => {
    if (batchId) await pool.query("update batch_items set status = 'rejected', approved_at = null, platform_post_id = null where batch_id = $1", [batchId]);
    if (pool) await pool.query("update alerts set acknowledged_at = coalesce(acknowledged_at, now()) where batch_item_id = any($1::uuid[])", [[a, b].filter(Boolean)]);
    await pool?.end();
  });

  const alertRow = async (id: string) => (await pool.query("select message, acknowledged_at, pushed_at from alerts where kind = 'missed-slot' and batch_item_id = $1", [id])).rows[0];
  const missed = (id: string, message: string, when: string) => ({ kind: "missed-slot" as const, platform: "instagram" as const, postId: id, idempotencyKey: "k", message, at: when });

  it("missed-slot: same miss deduped and stays closed once acknowledged; a new miss after a Move reopens it", async () => {
    const store = new PgOutboxStore(pool, "https://m", () => {});
    expect(await store.recordAlert(missed(a, "post missed its time (instagram, 9:00 AM 2099-05-05)", "2099-05-05T16:01:00Z"))).toBe(true);
    expect(await store.recordAlert(missed(a, "post missed its time (instagram, 9:00 AM 2099-05-05)", "2099-05-05T16:02:00Z"))).toBe(false);
    await pool.query("update alerts set acknowledged_at = now(), pushed_at = now() where kind = 'missed-slot' and batch_item_id = $1", [a]);
    // Same miss, acknowledged by the creator: stays closed.
    expect(await store.recordAlert(missed(a, "post missed its time (instagram, 9:00 AM 2099-05-05)", "2099-05-05T16:03:00Z"))).toBe(false);
    expect((await alertRow(a)).acknowledged_at).not.toBeNull();
    // Moved, then missed again (new time in the message): reopened.
    expect(await store.recordAlert(missed(a, "post missed its time (instagram, 1:00 PM 2099-05-06)", "2099-05-06T20:01:00Z"))).toBe(true);
    const row = await alertRow(a);
    expect(row).toMatchObject({ message: "post missed its time (instagram, 1:00 PM 2099-05-06)", acknowledged_at: null, pushed_at: null });
    // While open, another tick of the same new miss doesn't re-raise.
    expect(await store.recordAlert(missed(a, "post missed its time (instagram, 1:00 PM 2099-05-06)", "2099-05-06T20:02:00Z"))).toBe(false);
  });

  it("other kinds keep do-nothing dedupe even when acknowledged with a new message", async () => {
    const store = new PgOutboxStore(pool, "https://m", () => {});
    const u = (message: string) => ({ kind: "unknown-outcome" as const, platform: "instagram" as const, postId: b, idempotencyKey: "k", message, at: "2099-05-05T16:00:00Z" });
    expect(await store.recordAlert(u("first"))).toBe(true);
    await pool.query("update alerts set acknowledged_at = now() where kind = 'unknown-outcome' and batch_item_id = $1", [b]);
    expect(await store.recordAlert(u("second"))).toBe(false);
  });

  it("knownPlatformPostIds: the other row's id near the post, never its own", async () => {
    await pool.query("update batch_items set platform_post_id = 'audit-ig-A' where id = $1", [a]);
    const store = new PgOutboxStore(pool, "https://m", () => {});
    const post = { id: b, platform: "instagram", scheduledFor: at } as OutboxPost;
    expect([...(await store.knownPlatformPostIds(post))]).toContain("audit-ig-A");
    expect([...(await store.knownPlatformPostIds({ ...post, id: a }))]).not.toContain("audit-ig-A");
    expect([...(await store.knownPlatformPostIds({ ...post, scheduledFor: "2099-05-12T15:00:00Z" }))]).not.toContain("audit-ig-A");
  });

  it("claim writes the Settings default trial onto a row without its own", async () => {
    const store = new PgOutboxStore(pool, "https://m", () => {});
    await pool.query("update batch_items set status = 'approved', trial = null where id = $1", [b]);
    (store as unknown as { defaultTrial: Map<string, string> }).defaultTrial.set(b, "MANUAL");
    expect(await store.claim(b, new Date("2099-05-05T15:00:00Z"))).toBe(true);
    const row = (await pool.query("select status, trial from batch_items where id = $1", [b])).rows[0];
    expect(row).toMatchObject({ status: "publishing", trial: { graduationStrategy: "MANUAL" } });
  });
});
