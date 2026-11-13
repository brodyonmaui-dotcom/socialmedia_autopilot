import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acknowledge, acknowledgeAll, countByKind, listAlerts } from "../queries.js";

/**
 * Runs against a real dev DB (DATABASE_URL). Fixture alerts carry a per-run tag in the message, are
 * created with pushed_at set (a push job on the same DB never pages for them) and are left acknowledged
 * at the end: nothing is ever removed. The session row is a throwaway, already revoked. acknowledgeAll
 * runs inside a rolled-back transaction so it can't touch other rows in the dev DB.
 */
const url = process.env.DATABASE_URL;
const NOW = new Date();

describe.skipIf(!url)("alerts queries (db)", () => {
  let pool: pg.Pool;
  let session: string;
  let itemBatch: string | null = null;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const ours = <T extends { id: string }>(xs: T[]) => xs.filter((x) => Object.values(ids).includes(x.id));

  const alert = async (key: string, kind: string, platform: string, batchItemId: string | null = null) => {
    const { rows } = await pool.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at, pushed_at) values ($1, $2, $3, $4, $5, $5) returning id`,
      [kind, batchItemId, platform, `alerts-test ${run}: ${key}`, NOW],
    );
    ids[key] = rows[0].id as string;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    session = (
      await pool.query(`insert into auth_sessions (token_hash, expires_at, hard_expires_at, revoked_at) values ($1, now(), now(), now()) returning id`, [
        randomBytes(16).toString("hex"),
      ])
    ).rows[0].id;
    await alert("auth", "auth", "web");
    await alert("meta", "token-health", "meta");
    await alert("kill", "engagement-kill", "all");
    // An item-linked alert, when the dev DB has an item without a 'duplicate' alert yet (unique per kind + item).
    const item = (
      await pool.query(
        "select bi.id, bi.batch_id from batch_items bi where not exists (select 1 from alerts a where a.kind = 'duplicate' and a.batch_item_id = bi.id) order by bi.created_at, bi.id limit 1",
      )
    ).rows[0] as { id: string; batch_id: string } | undefined;
    if (item) {
      await alert("item", "duplicate", "instagram", item.id);
      itemBatch = item.batch_id;
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update alerts set acknowledged_at = coalesce(acknowledged_at, now()) where message like $1", [`alerts-test ${run}:%`]);
    await pool.end();
  });

  it("lists open alerts with their source and batch link", async () => {
    const open = ours(await listAlerts(pool, { state: "open", now: NOW }));
    expect(open.map((a) => a.id).sort()).toEqual(Object.values(ids).sort());
    expect(open.find((a) => a.id === ids.auth)).toMatchObject({ kind: "auth", source: "web", acknowledgedAt: null, batchId: null, batchItemId: null });
    expect(open.find((a) => a.id === ids.kill)!.source).toBe("all");
    if (ids.item) expect(open.find((a) => a.id === ids.item)!.batchId).toBe(itemBatch);
    expect((await countByKind(pool, "open", NOW)).auth).toBeGreaterThanOrEqual(1);
  });

  it("filters by kind", async () => {
    const meta = ours(await listAlerts(pool, { state: "open", kind: "token-health", now: NOW }));
    expect(meta.map((a) => a.id)).toEqual([ids.meta]);
    expect(meta[0]!.source).toBe("meta");
  });

  it("acknowledge stamps time + session, counts only open rows, and is idempotent", async () => {
    expect(await acknowledge(pool, [ids.auth!, ids.meta!], session, NOW)).toBe(2);
    expect(await acknowledge(pool, [ids.auth!, ids.meta!], session, NOW)).toBe(0);
    const row = (await pool.query("select acknowledged_at, acknowledged_session from alerts where id = $1", [ids.auth])).rows[0];
    expect(row.acknowledged_session).toBe(session);
    expect(new Date(row.acknowledged_at).getTime()).toBe(NOW.getTime());

    const open = ours(await listAlerts(pool, { state: "open", now: NOW })).map((a) => a.id);
    const acked = ours(await listAlerts(pool, { state: "acknowledged", now: NOW })).map((a) => a.id);
    expect(open).not.toContain(ids.auth);
    expect(open).not.toContain(ids.meta);
    expect(acked.sort()).toEqual([ids.auth, ids.meta].sort());
    expect((await countByKind(pool, "acknowledged", NOW)).auth).toBeGreaterThanOrEqual(1);
  });

  it("the acknowledged tab only looks back 30 days", async () => {
    const later = new Date(NOW.getTime() + 31 * 86_400_000);
    expect(ours(await listAlerts(pool, { state: "acknowledged", now: later }))).toEqual([]);
  });

  it("acknowledgeAll(kind) touches only that kind's open rows (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const db = client as unknown as pg.Pool;
      const before = (await client.query("select count(*)::int as n from alerts where kind = 'engagement-kill' and acknowledged_at is null")).rows[0].n as number;
      expect(before).toBeGreaterThanOrEqual(1);
      expect(await acknowledgeAll(db, session, "engagement-kill", NOW)).toBe(before);
      expect(await acknowledgeAll(db, session, "engagement-kill", NOW)).toBe(0);
      const open = ours(await listAlerts(db, { state: "open", now: NOW })).map((a) => a.id);
      expect(open).toEqual(ids.item ? [ids.item] : []);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
