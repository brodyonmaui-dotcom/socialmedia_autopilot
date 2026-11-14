import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OutboxPost, PlatformAdapter, PublishResult } from "@autopilot/core";
import { OUTBOX_LOCK_KEY, runOutboxWith, type OutboxConfig, type OutboxPool } from "../jobs/outbox.js";

/**
 * F13 T2: the outbox tick takes a session advisory lock (OUTBOX_LOCK_KEY) on one client, so two
 * overlapping ticks never both run; the second returns the zero result and says so. Released in
 * finally, also after a throw. Dry-run ticks take it too.
 *
 * Dev-DB safety (same pattern as outbox-config.db.test.ts): the tick clock is in 2099, the pool
 * wrapper drops every outbox row except this test's fixtures, and the fake adapter fails the test if
 * handed another row. Fixtures live in a far-future week (2099-06-07, no other test uses it) and are
 * rejected at the end (never deleted); cap-breach alerts this test raises are acknowledged.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2099-06-07";
const TICK_AT = new Date("2099-06-12T12:00:00.000Z");
const MARK = "outbox-lock fixture";

interface Scope {
  allowed: Set<string>;
  /** Overrides the 'cadence' setting for this pool only (the dev DB's settings row is never written). */
  cadence?: Record<string, unknown>;
  /** Throw on the next listDue query (simulates a store failure mid-tick). */
  failListDue?: boolean;
}

/** Real pg.Pool behind a filter; exposes connect() so runOutboxWith takes the real advisory lock. */
function scoped(pool: pg.Pool, scope: Scope): OutboxPool {
  return {
    async query(sql: string, params?: unknown[]) {
      if (scope.cadence && sql.startsWith("select value from settings") && params?.[0] === "cadence") return { rows: [{ value: scope.cadence }] };
      if (scope.failListDue && sql.includes("join batches b on b.id = bi.batch_id")) {
        scope.failListDue = false;
        throw new Error("store exploded (test)");
      }
      const res = await pool.query(sql, params);
      const rows = res.rows.filter((r) => !("idempotency_key" in r) || scope.allowed.has(r.id));
      return { rows, rowCount: res.rowCount };
    },
    connect: () => pool.connect(),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe.skipIf(!url)("outbox tick lock (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let mediaId: string;

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const lockHeld = async () =>
    (await pool.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = 0 and objid = $1 and objsubid = 1", [OUTBOX_LOCK_KEY])).rows[0].n as number;

  /** Rejects every item in the fixture batch, then (re)arms `n` approved IG rows due on `day`. */
  async function seed(tag: string, day: string, n: number): Promise<string[]> {
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const caption = `${MARK}: ${tag} #${i}`;
      const at = `${day}T10:0${i}:00Z`;
      const hit = (await pool.query("select id from batch_items where batch_id = $1 and caption = $2 order by created_at, id limit 1", [batchId, caption])).rows[0];
      const id: string =
        hit?.id ??
        (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, scheduled_for) values ($1, $2, 'instagram', $3, $4) returning id", [batchId, mediaId, caption, at])).rows[0].id;
      await pool.query(
        `update batch_items set status = 'approved', scheduled_for = $2, trial = null, attempts = 0, last_error = null, next_attempt_at = null,
                platform_post_id = null, platform_post_url = null, approved_at = now(), approved_session = null, updated_at = now() where id = $1`,
        [id, at],
      );
      ids.push(id);
    }
    return ids;
  }

  const fakeIg = (allowed: Set<string>, hold?: Promise<void>) => {
    const entered = deferred();
    const publish = vi.fn(async (post: OutboxPost): Promise<PublishResult> => {
      if (!allowed.has(post.id)) throw new Error(`test adapter handed a non-fixture row ${post.id}`);
      entered.resolve();
      if (hold) await hold;
      else await new Promise((r) => setTimeout(r, 30));
      return { platformPostId: `ig-lock-${post.id}`, platformPostUrl: "https://www.instagram.com/reel/lock/" };
    });
    const adapter: PlatformAdapter = { platform: "instagram", publish };
    return { adapter, publish, entered: entered.promise };
  };

  const cfg = (lines: string[], dryRun = false): OutboxConfig => ({
    publicMediaBase: "https://media.example.invalid",
    dryRun,
    timeZone: "UTC",
    now: () => TICK_AT,
    log: (l) => void lines.push(l),
    alerts: { send: async () => {} },
    blocklist: [],
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 6 });
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    mediaId = media.id;
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batches set status = 'approved', approved_at = now(), updated_at = now() where id = $1", [batchId]);
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query(
        `update alerts set acknowledged_at = now() where acknowledged_at is null
           and batch_item_id in (select id from batch_items where batch_id = $1)`,
        [batchId],
      );
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    await pool?.end();
  });

  it("two overlapping ticks: exactly one runs, the other returns the zero result and logs 'tick already running'", async () => {
    const ids = await seed("overlap", "2099-06-08", 1);
    const scope: Scope = { allowed: new Set(ids) };
    const gate = deferred();
    const fake = fakeIg(scope.allowed, gate.promise);
    const linesA: string[] = [];
    const linesB: string[] = [];

    const a = runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg(linesA));
    await fake.entered; // tick A holds the lock and is mid-publish
    expect(await lockHeld()).toBe(1);
    const b = await runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg(linesB));
    gate.resolve();
    const ra = await a;

    expect(b).toEqual({ considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, dryRun: false, alerts: [] });
    expect(linesB.filter((l) => l.includes("tick already running"))).toEqual(["[outbox] tick already running; skipped"]);
    expect(ra).toMatchObject({ considered: 1, published: 1 });
    expect([ra, b].filter((r) => r.considered > 0)).toHaveLength(1);
    expect(fake.publish).toHaveBeenCalledTimes(1);
    expect(await item(ids[0]!)).toMatchObject({ status: "published" });
    expect(await lockHeld()).toBe(0);
  });

  it("daily cap is never exceeded under overlapping ticks (cap 1, 3 due rows on one day)", async () => {
    const ids = await seed("cap", "2099-06-09", 3);
    const scope: Scope = { allowed: new Set(ids), cadence: { dailyCaps: { instagram: 1 } } };
    const fake = fakeIg(scope.allowed);
    const runs = await Promise.all([0, 1, 2].map(() => runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg([]))));

    expect(runs.reduce((n, r) => n + r.published, 0)).toBeLessThanOrEqual(1);
    expect(fake.publish.mock.calls.length).toBeLessThanOrEqual(1);
    const statuses = await Promise.all(ids.map(async (id) => (await item(id)).status as string));
    expect(statuses.filter((s) => s === "published" || s === "publishing" || s === "unknown").length).toBeLessThanOrEqual(1);
    expect(await lockHeld()).toBe(0);
  });

  it("after a tick throws, the lock is released and the next tick runs", async () => {
    const ids = await seed("throw", "2099-06-10", 1);
    const scope: Scope = { allowed: new Set(ids), failListDue: true };
    const fake = fakeIg(scope.allowed);

    await expect(runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg([]))).rejects.toThrow("store exploded");
    expect(await lockHeld()).toBe(0);

    const lines: string[] = [];
    const r = await runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg(lines));
    expect(lines.some((l) => l.includes("tick already running"))).toBe(false);
    expect(r).toMatchObject({ considered: 1, published: 1 });
  });

  it("a dry-run tick takes the lock too: skipped while another session holds it, runs once released", async () => {
    const ids = await seed("dry", "2099-06-11", 1);
    const scope: Scope = { allowed: new Set(ids) };
    const fake = fakeIg(scope.allowed);
    const holder = await pool.connect();
    try {
      expect((await holder.query("select pg_try_advisory_lock($1) as ok", [OUTBOX_LOCK_KEY])).rows[0].ok).toBe(true);
      const lines: string[] = [];
      const r = await runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg(lines, true));
      expect(r).toEqual({ considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, dryRun: true, alerts: [] });
      expect(lines).toContain("[outbox] tick already running; skipped");
    } finally {
      await holder.query("select pg_advisory_unlock($1)", [OUTBOX_LOCK_KEY]);
      holder.release();
    }
    const r2 = await runOutboxWith(scoped(pool, scope), { instagram: fake.adapter }, cfg([], true));
    expect(r2).toMatchObject({ considered: 1, published: 0, dryRun: true });
    expect(fake.publish).not.toHaveBeenCalled();
    expect((await item(ids[0]!)).status).toBe("approved");
  });
});
