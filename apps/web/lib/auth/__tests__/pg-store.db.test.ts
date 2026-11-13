import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnrollCode, normalizeEnrollCode, sha256Hex } from "@autopilot/db";
import { PgAuthStore } from "../pg-store.js";
import { createSession, validateSession } from "../session.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const DAY = 86_400_000;

describe.skipIf(!process.env.DATABASE_URL)("PgAuthStore (dev DB, rolled back)", () => {
  let client: pg.Client;
  let store: PgAuthStore;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("begin");
    store = new PgAuthStore(client);
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  it("insert / find / touch / revoke session", async () => {
    const { token, session } = await createSession(store, T0);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    const found = await validateSession(store, token, at(20 * DAY));
    expect(found?.expiresAt).toEqual(at(50 * DAY));
    const { rows } = await client.query("select expires_at, last_seen_at from auth_sessions where id = $1", [session.id]);
    expect(rows[0].expires_at).toEqual(at(50 * DAY));
    expect(rows[0].last_seen_at).toEqual(at(20 * DAY));
    await store.revokeSession(session.id, at(21 * DAY));
    expect(await validateSession(store, token, at(22 * DAY))).toBeNull();
  });

  it("revokeAll invalidates sessions and credentials", async () => {
    const { token } = await createSession(store, T0);
    await store.revokeAll(at(MIN));
    expect(await validateSession(store, token, at(2 * MIN))).toBeNull();
    expect(await store.listCredentials()).toEqual([]);
  });

  it("credential bytea round-trip, counter bump", async () => {
    const key = new Uint8Array([0, 1, 2, 250, 255]);
    await store.saveCredential({ credentialId: "test-cred", publicKey: key, counter: 3, transports: ["internal", "hybrid"], label: "phone" });
    await store.bumpCounter("test-cred", 7, at(MIN));
    const creds = await store.listCredentials();
    const c = creds.find((x) => x.credentialId === "test-cred");
    expect(c).toBeDefined();
    expect(c!.publicKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(c!.publicKey)).toEqual(Array.from(key));
    expect(c!.counter).toBe(7);
    expect(c!.transports).toEqual(["internal", "hybrid"]);
    expect(c!.label).toBe("phone");
  });

  it("takeChallenge is single use and expires", async () => {
    const id = await store.putChallenge("login", "abc", at(5 * MIN));
    expect(await store.takeChallenge(id, "register", at(MIN))).toBeNull();
    expect(await store.takeChallenge(id, "login", at(MIN))).toBe("abc");
    expect(await store.takeChallenge(id, "login", at(MIN))).toBeNull();
    const id2 = await store.putChallenge("register", "def", at(5 * MIN));
    expect(await store.takeChallenge(id2, "register", at(6 * MIN))).toBeNull();
  });

  it("consumeEnrollCode is single use and expires", async () => {
    const now = new Date();
    const { code } = await createEnrollCode(client, now);
    const hash = sha256Hex(normalizeEnrollCode(code.toLowerCase()));
    expect(await store.consumeEnrollCode(hash, new Date(now.getTime() + MIN))).toBe(true);
    expect(await store.consumeEnrollCode(hash, new Date(now.getTime() + MIN))).toBe(false);
    const second = await createEnrollCode(client, now);
    expect(await store.consumeEnrollCode(sha256Hex(normalizeEnrollCode(second.code)), new Date(now.getTime() + 16 * MIN))).toBe(false);
  });

  it("countFailures counts only inside the window", async () => {
    // Far-past timestamps, so any real rows in the dev DB count equally before and after.
    const old = new Date("2000-01-01T00:00:00Z");
    const t = (ms: number) => new Date(old.getTime() + ms);
    const now = t(16 * MIN);
    const since = t(16 * MIN - 15 * MIN);
    const before = await store.countFailures(since);
    await store.recordFailure("login", t(0)); // 16 min old: outside
    await store.recordFailure("login", t(10 * MIN));
    await store.recordFailure("register", now);
    expect((await store.countFailures(since)) - before).toBe(2);
  });
});
