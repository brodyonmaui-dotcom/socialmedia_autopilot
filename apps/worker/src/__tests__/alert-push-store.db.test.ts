import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgAlertPushStore } from "../jobs/alert-push-store.js";
import { ALERT_PUSH_TEST_SETTING, runAlertPushOnce } from "../jobs/alert-push-core.js";
import type { OutboxPool } from "../jobs/outbox.js";

/**
 * Runs against a real dev DB (DATABASE_URL). Fixture alerts are created an hour in the future (so the
 * `since` window holds only them) with pushed_at null. Claims run in transactions that are rolled back,
 * so nothing else in the dev DB is touched; at the end the fixtures are left pushed + acknowledged and
 * the fixture subscription revoked. Nothing is ever removed.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("PgAlertPushStore (db)", () => {
  let pool: pg.Pool;
  const run = randomUUID().slice(0, 8);
  const T = new Date(Date.now() + 3_600_000);
  const since = new Date(T.getTime() - 1);
  const ids: string[] = [];
  let subId = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    for (let i = 0; i < 6; i++) {
      const { rows } = await pool.query(
        "insert into alerts (kind, platform, message, created_at) values ($1, 'web', $2, $3) returning id",
        [i % 2 ? "auth" : "engagement-kill", `push-test ${run}: ${i}`, new Date(T.getTime() + i)],
      );
      ids.push(rows[0].id);
    }
    await pool.query("insert into alerts (kind, platform, message, created_at) values ('metrics-health', 'instagram', $1, $2)", [`push-test ${run}: page-only`, T]);
    subId = (
      await pool.query("insert into push_subscriptions (endpoint, p256dh, auth) values ($1, 'k', 'a') returning id", [`https://push.example.invalid/${run}`])
    ).rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update alerts set pushed_at = coalesce(pushed_at, now()), acknowledged_at = coalesce(acknowledged_at, now()) where message like $1", [`push-test ${run}:%`]);
    await pool.query("update push_subscriptions set revoked_at = coalesce(revoked_at, now()) where id = $1", [subId]);
    await pool.end();
  });

  async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  it("two concurrent claims return each alert exactly once, and only push kinds", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const sa = new PgAlertPushStore(a as unknown as OutboxPool);
      const sb = new PgAlertPushStore(b as unknown as OutboxPool);
      const kinds = ["auth", "engagement-kill"] as const;
      const [ra, rb] = await Promise.all([sa.claimUnpushed(kinds, since, T, 3), sb.claimUnpushed(kinds, since, T, 3)]);
      const got = [...ra, ...rb].map((r) => r.id);
      expect(new Set(got).size).toBe(got.length); // no alert claimed twice
      expect(got.every((id) => ids.includes(id))).toBe(true);
      // more claims in the same transactions finish the set; still no overlap, never the page-only kind
      const more = [...(await sa.claimUnpushed(kinds, since, T, 10)), ...(await sb.claimUnpushed(kinds, since, T, 10))].map((r) => r.id);
      const all = [...got, ...more];
      expect(new Set(all).size).toBe(all.length);
      expect(new Set(all)).toEqual(new Set(ids));
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      a.release();
      b.release();
    }
  });

  it("two concurrent full ticks (claim + send) never push the same alert twice", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const cfg = { kinds: ["auth", "engagement-kill"] as const, enabled: true, maxAgeH: 24 };
      const counts: number[][] = [[], []];
      const sender = (i: number) => ({
        send: async (_s: unknown, body: string) => {
          counts[i]!.push(JSON.parse(body).count as number);
          return { status: 201 };
        },
      });
      const quiet = () => {};
      const [ra, rb] = await Promise.all([
        runAlertPushOnce(new PgAlertPushStore(a as unknown as OutboxPool), sender(0), cfg, T, quiet),
        runAlertPushOnce(new PgAlertPushStore(b as unknown as OutboxPool), sender(1), cfg, T, quiet),
      ]);
      const mine = async (c: pg.PoolClient) => (await c.query("select id from alerts where pushed_at = $1", [T])).rows.map((r) => r.id as string);
      const [ia, ib] = [await mine(a), await mine(b)];
      expect(ia.filter((id) => ib.includes(id))).toEqual([]); // disjoint claims
      expect(ia.length).toBe(ra.claimed);
      expect(ib.length).toBe(rb.claimed);
      expect(ids.every((id) => ia.includes(id) || ib.includes(id))).toBe(true);
      const kindsSeen = (await a.query("select distinct kind from alerts where id = any($1::uuid[])", [ia.concat(ib)])).rows.map((r) => r.kind);
      expect(kindsSeen).not.toContain("metrics-health");
      // every send of a tick carries exactly that tick's claim count
      for (const [i, r] of [ra, rb].entries()) for (const n of counts[i]!) expect(n).toBe(r.claimed);
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      a.release();
      b.release();
    }
  });

  it("a claimed (committed-or-not) row is never claimed again in the same transaction", async () => {
    await inTx(async (c) => {
      const s = new PgAlertPushStore(c as unknown as OutboxPool);
      expect((await s.claimUnpushed(["auth"], since, T, 50)).length).toBe(3);
      expect(await s.claimUnpushed(["auth"], since, T, 50)).toEqual([]);
    });
  });

  it("respects the since cutoff and acknowledged rows", async () => {
    await inTx(async (c) => {
      const s = new PgAlertPushStore(c as unknown as OutboxPool);
      await c.query("update alerts set acknowledged_at = now() where id = $1", [ids[1]]);
      const r = await s.claimUnpushed(["auth", "engagement-kill"], new Date(T.getTime() + 2), T, 50);
      expect(r.map((x) => x.id).sort()).toEqual([ids[2], ids[3], ids[4], ids[5]].sort());
    });
  });

  it("subscriptions: active list, success stamp, revoke by timestamp", async () => {
    await inTx(async (c) => {
      const s = new PgAlertPushStore(c as unknown as OutboxPool);
      expect((await s.activeSubscriptions()).some((x) => x.id === subId)).toBe(true);
      await s.markSuccess(subId, T);
      await s.revoke(subId, T);
      expect((await s.activeSubscriptions()).some((x) => x.id === subId)).toBe(false);
      const row = (await c.query("select revoked_at, last_success_at from push_subscriptions where id = $1", [subId])).rows[0];
      expect(new Date(row.revoked_at).getTime()).toBe(T.getTime());
      expect(new Date(row.last_success_at).getTime()).toBe(T.getTime());
    });
  });

  it("a test request is claimed once, and a stale one never", async () => {
    await inTx(async (c) => {
      const s = new PgAlertPushStore(c as unknown as OutboxPool);
      const now = new Date();
      const put = (at: Date) =>
        c.query(
          `insert into settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [ALERT_PUSH_TEST_SETTING, JSON.stringify({ requested_at: at.toISOString() })],
        );
      await put(new Date(now.getTime() - 1000));
      expect(await s.claimTestRequest(now)).toBe(true);
      expect(await s.claimTestRequest(now)).toBe(false);
      await put(new Date(now.getTime() - 11 * 60_000));
      expect(await s.claimTestRequest(now)).toBe(false);
    });
  });
});
