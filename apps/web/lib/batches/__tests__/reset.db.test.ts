import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { planResetChecked } from "../ig-check.js";
import { PgBatchStore } from "../pg-store.js";
import { RESET_CHECKLIST } from "../reset.js";
import { ConflictError } from "../store.js";
import { planTransition, type ItemChange } from "../transitions.js";

/**
 * F11 T2 against a real dev DB (DATABASE_URL). Same rules as pg-store.db.test.ts: a throwaway batch in a
 * far-future week (2099-02-02), fixtures found-or-created and put back into their starting state at the
 * start of each run, leftovers rejected at the end. Fixture alerts are marked pushed so the push job
 * never pages anyone. Nothing is ever deleted.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-02-02";
const TEST_SESSION_HASH = "test-reset-db";

describe.skipIf(!url)("F11 reset / record-published (db)", () => {
  let pool: pg.Pool;
  let pool2: pg.Pool;
  let store: PgBatchStore;
  let store2: PgBatchStore;
  let batchId: string;
  let sessionId: string;
  let a: string; // instagram, failed, attempts 4, final-failure alert → reset, then re-approved
  let b: string; // instagram, failed, but platform_post_id set → reset refused
  let c: string; // youtube, unknown, unknown-outcome alert → record-published
  const now = new Date();

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const eventsAt = async (id: string, kind: string) =>
    (await pool.query("select * from batch_item_events where batch_item_id = $1 and kind = $2 and at = $3 order by id", [id, kind, now])).rows;
  const alertOf = async (id: string, kind: string) => (await pool.query("select * from alerts where batch_item_id = $1 and kind = $2", [id, kind])).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    pool2 = new pg.Pool({ connectionString: url, max: 2 });
    store = new PgBatchStore(pool);
    store2 = new PgBatchStore(pool2);
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");

    sessionId = (
      await pool.query(
        `insert into auth_sessions (token_hash, expires_at, hard_expires_at, revoked_at)
         values ($1, now() + interval '1 day', now() + interval '1 day', now())
         on conflict (token_hash) do update set revoked_at = coalesce(auth_sessions.revoked_at, now()) returning id`,
        [TEST_SESSION_HASH],
      )
    ).rows[0].id;

    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batches set status = 'approved', approved_at = $2, updated_at = now() where id = $1", [batchId, now]);
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);

    const fixture = async (platform: string, caption: string, status: string, at: string, postId: string | null, alertKind: string): Promise<string> => {
      const hit = (await pool.query("select id from batch_items where batch_id = $1 and platform = $2 and caption = $3 order by created_at, id limit 1", [batchId, platform, caption])).rows[0];
      const id: string =
        hit?.id ??
        (
          await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, $3, $4, $5) returning id", [
            batchId,
            media.id,
            platform,
            caption,
            at,
          ])
        ).rows[0].id;
      await pool.query(
        `update batch_items set status = $2, scheduled_for = $3, title = $4, trial = null, attempts = 4, last_error = 'gave up: test error',
                next_attempt_at = null, platform_post_id = $5, platform_post_url = null,
                approved_at = $6, approved_session = $7, updated_at = $6 where id = $1`,
        [id, status, at, platform === "youtube" ? "Test title" : null, postId, now, sessionId],
      );
      await pool.query(
        `insert into alerts (kind, batch_item_id, platform, message, pushed_at) values ($1, $2, $3, 'test alert', now())
         on conflict (kind, batch_item_id) do update set acknowledged_at = null, acknowledged_session = null, pushed_at = coalesce(alerts.pushed_at, now())`,
        [alertKind, id, platform],
      );
      return id;
    };
    a = await fixture("instagram", "f11 reset fixture A", "failed", "2099-02-03T10:00:00Z", null, "final-failure");
    b = await fixture("instagram", "f11 reset fixture B", "failed", "2099-02-03T12:00:00Z", "ig-already-there", "final-failure");
    c = await fixture("youtube", "f11 reset fixture C", "unknown", "2099-02-04T10:00:00Z", null, "unknown-outcome");
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    await pool?.end();
    await pool2?.end();
  });

  it("loadBatch exposes attempts, last_error, key tail and canReset", async () => {
    const v = (await store.loadBatch(batchId))!;
    const ia = v.items.find((i) => i.id === a)!;
    const key = (await item(a)).idempotency_key as string;
    expect(ia).toMatchObject({ status: "failed", attempts: 4, lastError: "gave up: test error", keyTail: key.slice(-6), platformPostUrl: null, canReset: true, handedOff: true });
    expect(v.items.find((i) => i.id === b)!.canReset).toBe(false);
  });

  it("an IG findExisting hit refuses the reset (and offers the URL)", async () => {
    const batch = (await store.loadBatch(batchId))!;
    const findExisting = vi.fn().mockResolvedValue({ platformPostId: "1789", platformPostUrl: "https://www.instagram.com/reel/abc/" });
    const plan = await planResetChecked(batch, { itemId: a, checked: [...RESET_CHECKLIST.instagram] }, now, { adapter: { findExisting } });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toContain("https://www.instagram.com/reel/abc/");
    expect((await item(a)).status).toBe("failed");
  });

  it("two concurrent resets: exactly one wins; the row is draft with the SAME key, attempts 1, alert acknowledged", async () => {
    const before = await item(a);
    const batch = (await store.loadBatch(batchId))!;
    const plan = await planResetChecked(batch, { itemId: a, checked: [...RESET_CHECKLIST.instagram] }, now, { adapter: { findExisting: vi.fn().mockResolvedValue(null) } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const results = await Promise.allSettled([
      store.apply(batchId, plan.changes, plan.batchStatus, sessionId, now),
      store2.apply(batchId, plan.changes, plan.batchStatus, sessionId, now),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);

    const after = await item(a);
    expect(after).toMatchObject({ status: "draft", attempts: 1, approved_at: null, approved_session: null, last_error: null, next_attempt_at: null, platform_post_id: null });
    expect(after.idempotency_key).toBe(before.idempotency_key);
    const ev = await eventsAt(a, "reset-checked");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from_status: "failed", to_status: "draft", session_id: sessionId });
    expect(ev[0].detail).toEqual({ attemptsBefore: 4, lastError: "gave up: test error", checked: [...RESET_CHECKLIST.instagram], autoCheck: "not-found" });
    const al = await alertOf(a, "final-failure");
    expect(al.acknowledged_at.toISOString()).toBe(now.toISOString());
    expect(al.acknowledged_session).toBe(sessionId);
  });

  it("the SQL refuses a reset when platform_post_id is set, and attempts < 1", async () => {
    const before = await item(b);
    const change: ItemChange = { itemId: b, from: "failed", to: "draft", eventKind: "reset-checked", patch: { attempts: 1, last_error: null, next_attempt_at: null }, detail: {} };
    await expect(store.apply(batchId, [change], "approved", sessionId, now)).rejects.toBeInstanceOf(ConflictError);
    const zero: ItemChange = { ...change, itemId: c, from: "unknown", patch: { attempts: 0, last_error: null, next_attempt_at: null } };
    await expect(store.apply(batchId, [zero], "approved", sessionId, now)).rejects.toThrow(/attempts >= 1/);
    const after = await item(b);
    expect(after).toMatchObject({ status: "failed", attempts: 4, platform_post_id: "ig-already-there", idempotency_key: before.idempotency_key });
    expect((await alertOf(b, "final-failure")).acknowledged_at).toBeNull();
    expect((await item(c)).status).toBe("unknown");
  });

  it("record-published is refused from draft (SQL guard), even with a hand-built change", async () => {
    const change: ItemChange = { itemId: a, from: "draft", to: "published", eventKind: "record-published", patch: { platform_post_url: "https://www.instagram.com/reel/x/", next_attempt_at: null } };
    await expect(store.apply(batchId, [change], "approved", sessionId, now)).rejects.toBeInstanceOf(ConflictError);
    expect((await item(a)).status).toBe("draft");
  });

  it("record-published sets url + id, writes the event, acknowledges the alert", async () => {
    const batch = (await store.loadBatch(batchId))!;
    const before = await item(c);
    const plan = planTransition(batch, { kind: "record-published", itemId: c, url: "https://youtu.be/abcDEF12345", platformPostId: "abcDEF12345" }, now);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    await store.apply(batchId, plan.changes, plan.batchStatus, sessionId, now);
    const after = await item(c);
    expect(after).toMatchObject({ status: "published", platform_post_url: "https://youtu.be/abcDEF12345", platform_post_id: "abcDEF12345", next_attempt_at: null });
    expect(after.idempotency_key).toBe(before.idempotency_key);
    const ev = await eventsAt(c, "record-published");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toMatchObject({ url: "https://youtu.be/abcDEF12345", platformPostId: "abcDEF12345", attemptsBefore: 4 });
    expect((await alertOf(c, "unknown-outcome")).acknowledged_at.toISOString()).toBe(now.toISOString());
  });

  it("re-approve after the reset: approved, attempts still 1, same key", async () => {
    const key = (await item(a)).idempotency_key;
    const batch = (await store.loadBatch(batchId))!;
    const plan = planTransition(batch, { kind: "approve", itemIds: [a] }, now);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    await store.apply(batchId, plan.changes, plan.batchStatus, sessionId, now);
    const after = await item(a);
    expect(after).toMatchObject({ status: "approved", attempts: 1, approved_session: sessionId, idempotency_key: key });
    expect(after.approved_at.toISOString()).toBe(now.toISOString());
  });
});
