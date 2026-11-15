import { describe, expect, it, vi } from "vitest";
import { OUTBOX_LOCK_KEY, OUTBOX_NO_CONNECT_LOG, OUTBOX_TICK_BUSY_LOG, runOutboxWith, type OutboxPool } from "../jobs/outbox.js";

/** F13 T2 lock plumbing with a fake client: which SQL runs on the client, and how it is released. */
function fakePool(opts: { lockOk?: boolean; unlockThrows?: boolean; noConnect?: boolean } = {}) {
  const clientSql: Array<{ sql: string; params?: unknown[] }> = [];
  const poolSql: string[] = [];
  const release = vi.fn();
  const pool: OutboxPool = {
    async query(sql: string) {
      poolSql.push(sql.replace(/\s+/g, " ").trim());
      return { rows: [] }; // no settings, no due rows
    },
  };
  if (!opts.noConnect) {
    pool.connect = async () => ({
      async query(sql: string, params?: unknown[]) {
        clientSql.push({ sql, params });
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: opts.lockOk ?? true }] };
        if (sql.includes("pg_advisory_unlock") && opts.unlockThrows) throw new Error("connection lost");
        return { rows: [{}] };
      },
      release,
    });
  }
  return { pool, clientSql, poolSql, release };
}

const cfg = (lines: string[], dryRun = false) => ({ publicMediaBase: "https://media.example", dryRun, timeZone: "UTC", log: (l: string) => void lines.push(l) });

describe("runOutboxWith tick lock (fake client)", () => {
  it("locks, runs the tick on the pool (not the client), unlocks the same key, releases cleanly", async () => {
    const f = fakePool();
    await runOutboxWith(f.pool, {}, cfg([]));
    expect(f.clientSql.map((q) => q.sql)).toEqual(["select pg_try_advisory_lock($1) as ok", "select pg_advisory_unlock($1)"]);
    expect(f.clientSql.every((q) => q.params?.[0] === OUTBOX_LOCK_KEY)).toBe(true);
    expect(f.poolSql.some((s) => s.startsWith("select bi.id"))).toBe(true);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls[0]![0]).toBeUndefined();
  });

  it("busy lock: zero result, one log line, no tick SQL, no unlock", async () => {
    const f = fakePool({ lockOk: false });
    const lines: string[] = [];
    const r = await runOutboxWith(f.pool, {}, cfg(lines, true));
    expect(r).toEqual({ considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, dryRun: true, alerts: [] });
    expect(lines).toEqual([OUTBOX_TICK_BUSY_LOG]);
    expect(f.poolSql).toEqual([]);
    expect(f.clientSql).toHaveLength(1);
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("the lock is taken before the PUBLIC_MEDIA_BASE check (a config-skip tick is serialised too)", async () => {
    const f = fakePool({ lockOk: false });
    await runOutboxWith(f.pool, {}, { ...cfg([]), publicMediaBase: "" });
    expect(f.poolSql).toEqual([]); // no config alert written by a tick that didn't get the lock
  });

  it("unlock failure: the client is released with the error so pg destroys it (dropping the session lock)", async () => {
    const f = fakePool({ unlockThrows: true });
    await runOutboxWith(f.pool, {}, cfg([]));
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("a tick that throws still unlocks and releases", async () => {
    const f = fakePool();
    f.pool.query = async () => {
      throw new Error("db down");
    };
    await expect(runOutboxWith(f.pool, {}, cfg([]))).rejects.toThrow("db down");
    expect(f.clientSql.map((q) => q.sql)).toContain("select pg_advisory_unlock($1)");
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("a pool without connect() runs unlocked and logs that once per process", async () => {
    const lines: string[] = [];
    await runOutboxWith(fakePool({ noConnect: true }).pool, {}, cfg(lines));
    await runOutboxWith(fakePool({ noConnect: true }).pool, {}, cfg(lines));
    expect(lines.filter((l) => l === OUTBOX_NO_CONNECT_LOG)).toHaveLength(1);
  });
});
