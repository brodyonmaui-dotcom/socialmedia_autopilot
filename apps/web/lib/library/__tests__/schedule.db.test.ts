import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCadence } from "@autopilot/db";
import { localDate } from "@autopilot/core";
import { hasFolderColumn, loadFolders, loadLibrary, loadLibraryCounts, loadPlatformMarks, moveManyToFolder, resetFolderColumnCache } from "../data.js";
import { addToCalendar, planAddToCalendar } from "../add-to-calendar.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0016) inside ONE rolled-back transaction. The write path (which opens its
 * own BEGIN/COMMIT) runs through a wrapper that turns those into savepoints, so nothing survives. Slots are planned in
 * 2099, far from any real post. Fixture clips carry a per-run tag in their file name.
 */
const url = process.env.DATABASE_URL;
const auth = vi.hoisted(() => ({ requireSession: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001" })) }));
const dbm = vi.hoisted(() => ({ getPool: vi.fn() }));
vi.mock("../../auth/require.js", () => auth);
vi.mock("../../db.js", () => dbm);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

const TZ = "UTC";
const NOW = new Date("2099-03-02T08:00:00.000Z"); // a Monday

describe.skipIf(!url)("library filters, marks and add-to-calendar (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  let sp = 0;
  const run = randomUUID().slice(0, 8);
  const id: Record<string, string> = {};
  const queries: string[] = [];

  /** A pool-shaped view of the one transaction client: BEGIN/COMMIT/ROLLBACK become savepoints. */
  const txPool = {
    query: (sql: string, params?: unknown[]) => {
      queries.push(sql);
      return db.query(sql, params);
    },
    connect: async () => {
      const name = `sp${++sp}`;
      return {
        query: async (sql: string, params?: unknown[]) => {
          if (sql === "begin") return db.query(`savepoint ${name}`);
          if (sql === "commit") return db.query(`release savepoint ${name}`);
          if (sql === "rollback") return db.query(`rollback to savepoint ${name}`);
          return db.query(sql, params);
        },
        release: () => {},
      };
    },
  };
  const pgPool = txPool as unknown as pg.Pool;

  const media = async (key: string, o: { dur?: number; status?: string; r2?: boolean; path?: string; created?: string } = {}) => {
    const r = await db.query(
      `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, created_at)
       values ($1, $2, $3, $4, 'gym', $5, $6) returning id`,
      [`dbt-sched-${run}-${key}`, o.path ?? `/clips/zz${run}-${key}.mp4`, o.r2 === false ? null : `library/dbt-sched-${run}-${key}.mp4`, o.dur ?? 12, o.status ?? "ready", o.created ?? "2099-01-01T00:00:00Z"],
    );
    id[key] = r.rows[0].id;
  };
  let batch: string;
  const item = async (key: string, platform: string, status: string, at: string | null = null) =>
    (
      await db.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status) values ($1, $2, $3, 'x', $4, $5, $6) returning id`,
        [batch, id[key], platform, platform === "youtube" ? "t" : null, at, status],
      )
    ).rows[0].id as string;
  const mine = <T extends { mediaId: string }>(xs: T[]) => xs.filter((x) => Object.values(id).includes(x.mediaId));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    db = await pool.connect();
    await db.query("begin");
    batch = (await db.query("insert into batches (week_start, status) values ('2098-01-05', 'draft') returning id")).rows[0].id;
    await media("a", { dur: 10, created: "2099-01-01T00:00:00Z" }); // ready
    await media("b", { dur: 20, status: "archived", created: "2099-01-02T00:00:00Z" }); // archived
    await media("c", { dur: 30, r2: false, created: "2099-01-03T00:00:00Z" }); // no clean file
    await media("d", { dur: 40, created: "2099-01-04T00:00:00Z" }); // scheduled (draft IG)
    await media("e", { dur: 50, created: "2099-01-05T00:00:00Z" }); // only a rejected item: ready
    await media("f", { dur: 60, created: "2099-01-06T00:00:00Z" }); // posted (YT)
    await media("g", { dur: 70, created: "2099-01-07T00:00:00Z" }); // hidden by a kept fix
    await media("h", { dur: 80, created: "2099-01-08T00:00:00Z" }); // posted on TikTok + a draft IG
    await media("z", { dur: 5, created: "2099-01-09T00:00:00Z", path: `/dir-${run}-folder/zebra${run}.mp4` });
    await item("d", "instagram", "draft", "2099-03-03T10:00:00Z");
    await item("e", "tiktok", "rejected", "2099-03-03T11:00:00Z");
    await item("f", "youtube", "published", "2098-12-01T10:00:00Z");
    await item("h", "tiktok", "published", "2098-12-02T10:00:00Z");
    await item("h", "instagram", "draft", "2099-03-04T09:30:00Z");
    const fixed = (await db.query(`insert into media (content_hash, source_path, r2_key, status, duration_s, created_at) values ($1, $2, 'library/x.mp4', 'ready', 100, '2099-01-10T00:00:00Z') returning id`, [`dbt-sched-${run}-gfix`, `/clips/zz${run}-gfix.mp4`])).rows[0].id;
    await db.query(`insert into media_fixes (media_id, ops, status, fixed_media_id) values ($1, '{loudness}', 'kept', $2)`, [id.g, fixed]);
    id.gfix = fixed;
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("status chips: counts and queries agree (ready / scheduled / posted / all)", async () => {
    // The tag is in the file name only for the clips with the standard path; "z" has it in a folder AND its name.
    const counts = await loadLibraryCounts(db, { q: run });
    // a, e, z, gfix ready; d, h scheduled; f, h posted; all = a-f, h, z, gfix (g hidden)
    expect(counts).toEqual({ ready: 4, scheduled: 2, posted: 2, all: 9 });
    const names = async (status: "ready" | "scheduled" | "posted" | "all") =>
      mine((await loadLibrary(db, { q: run, status, limit: 50 })).clips).map((c) => Object.keys(id).find((k) => id[k] === c.mediaId)).sort();
    expect(await names("ready")).toEqual(["a", "e", "gfix", "z"]);
    expect(await names("scheduled")).toEqual(["d", "h"]);
    expect(await names("posted")).toEqual(["f", "h"]);
    expect(await names("all")).toEqual(["a", "b", "c", "d", "e", "f", "gfix", "h", "z"]);
  });

  it("search is on the file name, not its folders; sorts order by length and date; offset paging", async () => {
    const dirOnly = await loadLibrary(db, { q: `dir-${run}-folder`, status: "all" });
    expect(mine(dirOnly.clips)).toEqual([]);
    expect(mine((await loadLibrary(db, { q: `zebra${run}`, status: "all" })).clips).map((c) => c.mediaId)).toEqual([id.z]);
    const order = async (sort: "newest" | "oldest" | "longest" | "shortest") =>
      mine((await loadLibrary(db, { q: run, status: "ready", sort, limit: 50 })).clips).map((c) => c.durationS);
    expect(await order("longest")).toEqual([100, 50, 10, 5]);
    expect(await order("shortest")).toEqual([5, 10, 50, 100]);
    expect(await order("oldest")).toEqual([10, 50, 5, 100]);
    expect(await order("newest")).toEqual([100, 5, 50, 10]);
    // Offset paging for a non-default sort: two pages, no overlap.
    const p1 = await loadLibrary(db, { q: run, status: "all", sort: "oldest", limit: 4 });
    const p2 = await loadLibrary(db, { q: run, status: "all", sort: "oldest", limit: 4, cursor: p1.nextCursor });
    expect(p1.nextCursor).toMatch(/^o4$/);
    expect(p1.clips.map((c) => c.mediaId).filter((m) => p2.clips.some((c) => c.mediaId === m))).toEqual([]);
    expect(p1.clips.length + p2.clips.length).toBeGreaterThanOrEqual(8);
  });

  it("marks: posted wins, scheduled shows its time, rejected shows nothing; one batched query for the page", async () => {
    await item("f", "instagram", "draft", "2099-03-05T12:00:00Z");
    await item("f", "tiktok", "rejected", "2099-03-05T13:00:00Z");
    queries.length = 0;
    const page = await loadLibrary(txPool as never, { q: run, status: "all", limit: 50, now: NOW });
    const byId = new Map(page.clips.map((c) => [c.mediaId, c.marks]));
    expect(byId.get(id.f!)).toEqual({ youtube: { kind: "posted" }, instagram: { kind: "scheduled", at: "2099-03-05T12:00:00.000Z" } });
    expect(byId.get(id.h!)).toEqual({ tiktok: { kind: "posted" }, instagram: { kind: "scheduled", at: "2099-03-04T09:30:00.000Z" } });
    expect(byId.get(id.e!)).toEqual({});
    expect(queries.filter((q) => q.includes("from batch_items bi") && q.includes("any($1::uuid[])")).length).toBe(1);
    expect((await loadPlatformMarks(db, [], NOW)).size).toBe(0);
  });

  it("without migration 0016 the loaders still work (folder null, no folders), and move says why", async () => {
    await db.query("savepoint nofolder");
    try {
      await db.query("alter table media drop column folder");
      resetFolderColumnCache(db);
      expect(await hasFolderColumn(db)).toBe(false);
      const page = await loadLibrary(db, { q: run, status: "all", limit: 50 });
      expect(mine(page.clips).length).toBeGreaterThan(0);
      expect(mine(page.clips).every((c) => c.folder === null)).toBe(true);
      expect(await loadFolders(db)).toEqual([]);
      expect(await loadLibraryCounts(db, { q: run })).toMatchObject({ all: 9 });
      expect(await moveManyToFolder(db, [id.a!], "Upper")).toEqual({ ok: false, reason: "folders need a database update" });
    } finally {
      await db.query("rollback to savepoint nofolder");
      resetFolderColumnCache(db);
    }
    expect(await hasFolderColumn(db)).toBe(true);
    expect(await moveManyToFolder(db, [id.a!, id.z!], "Upper")).toEqual({ ok: true, folder: "Upper" });
    expect((await loadFolders(db)).some((f) => f.folder === "Upper")).toBe(true);
  });

  describe("add to calendar", () => {
    const clips = ["a", "e"];
    const ids = () => clips.map((k) => id[k]!);

    it("plans the next open slot per platform, skips duplicates, and never doubles a slot", async () => {
      // "e" already has an IG post in the window (a draft within ±7 days) → duplicate on Instagram only.
      await item("e", "instagram", "draft", "2099-03-04T15:00:00Z");
      const plan = await planAddToCalendar(txPool as never, { mediaIds: ids(), platforms: ["instagram", "youtube", "tiktok"], now: NOW, timeZone: TZ });
      expect(plan.skipped).toEqual([{ mediaId: id.e, label: `zz${run}-e`, platform: "instagram", reason: "duplicate" }]);
      expect(plan.lines.map((l) => `${l.label.slice(-1)}:${l.platform}`).sort()).toEqual(["a:instagram", "a:tiktok", "a:youtube", "e:tiktok", "e:youtube"]);
      const slots = plan.lines.map((l) => `${l.platform}|${l.scheduledFor}`);
      expect(new Set(slots).size).toBe(slots.length);
      expect(plan.lines[0]!.when).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (AM|PM)$/);
      // Unavailable clips (archived, no file, hidden) are skipped, not planned.
      const bad = await planAddToCalendar(txPool as never, { mediaIds: [id.b!, id.c!, id.g!], platforms: ["instagram"], now: NOW, timeZone: TZ });
      expect(bad.lines).toEqual([]);
      expect(bad.skipped.map((s) => s.reason)).toEqual(["unavailable", "unavailable", "unavailable"]);
    });

    it("writes drafts only (origin library, IG template caption, others empty), in the week's batch, with 'add' events; a second submit adds nothing", async () => {
      const { addToCalendarAction } = await import("../../../app/library/actions.js");
      dbm.getPool.mockReturnValue(txPool);
      vi.stubEnv("TZ_CREATOR", TZ);
      // Fresh clips so the earlier duplicate fixture doesn't matter.
      await media("n1", { dur: 11 });
      await media("n2", { dur: 12 });
      const fd = new FormData();
      fd.append("mediaId", id.n1!);
      fd.append("mediaId", id.n2!);
      for (const p of ["instagram", "youtube", "tiktok"]) fd.append("platform", p);
      const r = await addToCalendarAction(fd);
      if (!r.ok) throw new Error(r.reason);
      expect(r.added).toBe(6);
      expect(r.firstWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const rows = (await db.query(`select bi.*, (select count(*)::int from batch_item_events e where e.batch_item_id = bi.id and e.kind = 'add') as adds from batch_items bi where bi.media_id = any($1::uuid[]) order by bi.platform, bi.media_id`, [[id.n1, id.n2]])).rows;
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.status).toBe("draft");
        expect(row.approved_at).toBeNull();
        expect(row.origin).toBe("library");
        expect(row.adds).toBe(1);
        expect(row.ingest_key).toBe(`library:${row.media_id}:${row.platform}:${localDate(new Date(row.scheduled_for), TZ)}`);
        expect(row.caption === "").toBe(row.platform !== "instagram");
      }
      // The week lock was taken (advisory, transaction-scoped: still held by the outer test transaction).
      expect((await db.query(`select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`)).rows[0].n).toBeGreaterThan(0);
      const wk = (await db.query(`select b.week_start::text as w, b.status from batches b where b.id = $1`, [rows[0].batch_id])).rows[0];
      expect(wk.status).toBe("draft");
      const again = await addToCalendarAction(fd);
      if (!again.ok) throw new Error(again.reason);
      expect(again.added).toBe(0);
      expect(again.skipped.every((s) => s.reason === "duplicate")).toBe(true);
      expect((await db.query(`select count(*)::int n from batch_items where media_id = any($1::uuid[])`, [[id.n1, id.n2]])).rows[0].n).toBe(6);
    });

    it("respects the daily caps across a big selection", async () => {
      const cad = await loadCadence(db as never);
      const cap = cad.dailyCaps.instagram;
      const keys: string[] = [];
      for (let i = 0; i < cap + 2; i++) {
        await media(`cap${i}`);
        keys.push(`cap${i}`);
      }
      const res = await addToCalendar(pgPool, { mediaIds: keys.map((k) => id[k]!), platforms: ["instagram"], now: NOW, timeZone: TZ, sessionId: null });
      expect(res.added + res.skipped.length).toBe(cap + 2);
      const days = (await db.query(`select scheduled_for from batch_items where media_id = any($1::uuid[])`, [keys.map((k) => id[k])])).rows.map((r) => localDate(new Date(r.scheduled_for), TZ));
      const perDay = new Map<string, number>();
      for (const d of days) perDay.set(d, (perDay.get(d) ?? 0) + 1);
      // The caps count every non-rejected IG post that day (the earlier fixtures too).
      for (const d of perDay.keys()) {
        const total = (await db.query(`select count(*)::int n from batch_items where platform = 'instagram' and status <> 'rejected' and scheduled_for >= $1::timestamptz and scheduled_for < $1::timestamptz + interval '1 day'`, [`${d}T00:00:00Z`])).rows[0].n;
        expect(total).toBeLessThanOrEqual(cap);
      }
    });
  });
});
