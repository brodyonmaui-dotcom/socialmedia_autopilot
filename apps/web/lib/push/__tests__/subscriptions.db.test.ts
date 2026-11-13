import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countActiveSubscriptions, requestTestPush, revokeSubscription, saveSubscription } from "../subscriptions.js";

/**
 * Real dev DB (DATABASE_URL). Everything runs inside one transaction that is rolled back, so no
 * subscription or test request is left behind (a local worker with VAPID set would otherwise act on it).
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("push subscriptions (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let db: pg.Pool;
  let session: string;
  const endpoint = `https://push.example.invalid/${randomUUID()}`;
  const sub = (p: string) => ({ endpoint, keys: { p256dh: p + "A".repeat(86), auth: "abcdefghijklmnopqrstuv" } });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    db = client as unknown as pg.Pool;
    session = (
      await client.query(`insert into auth_sessions (token_hash, expires_at, hard_expires_at, revoked_at) values ($1, now(), now(), now()) returning id`, [
        randomBytes(16).toString("hex"),
      ])
    ).rows[0].id;
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    if (pool) await pool.end();
  });

  const row = async () => (await client.query("select * from push_subscriptions where endpoint = $1", [endpoint])).rows;

  it("save twice → one row; re-subscribing after a revoke clears revoked_at and takes the new keys", async () => {
    const before = await countActiveSubscriptions(db);
    await saveSubscription(db, sub("B"), session, "iPhone");
    await saveSubscription(db, sub("B"), session, null);
    expect(await row()).toHaveLength(1);
    expect((await row())[0].label).toBe("iPhone");
    expect(await countActiveSubscriptions(db)).toBe(before + 1);

    await revokeSubscription(db, endpoint);
    expect((await row())[0].revoked_at).not.toBeNull();
    expect(await countActiveSubscriptions(db)).toBe(before);

    await saveSubscription(db, sub("C"), session);
    const r = (await row())[0];
    expect(r.revoked_at).toBeNull();
    expect(r.p256dh.startsWith("C")).toBe(true);
    expect(r.session_id).toBe(session);
  });

  it("test requests are rate-limited to one a minute", async () => {
    const now = new Date();
    await client.query("update settings set value = '{}'::jsonb where key = 'alert_push_test'");
    expect(await requestTestPush(db, now)).toBe(true);
    expect(await requestTestPush(db, new Date(now.getTime() + 30_000))).toBe(false);
    expect(await requestTestPush(db, new Date(now.getTime() + 61_000))).toBe(true);
    const v = (await client.query("select value from settings where key = 'alert_push_test'")).rows[0].value;
    expect(Object.keys(v)).toEqual(["requested_at"]); // the worker's handled_at is reset by a new request
  });
});
