import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFolders, loadLibrary, moveToFolder } from "../data.js";
import { groupClips } from "../screen.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0016) inside ONE rolled-back transaction: the folder column feeds
 * the week / folder grouping, loadFolders lists labels in use, and the move action validates and requires a session.
 */
const url = process.env.DATABASE_URL;
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const dbm = vi.hoisted(() => ({ getPool: vi.fn() }));
vi.mock("../../auth/require.js", () => auth);
vi.mock("../../db.js", () => dbm);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => dbm);

describe("move to folder: no session", () => {
  it("refuses before touching the DB", async () => {
    const NO_SESSION = new Error("NO_SESSION");
    auth.requireSession.mockRejectedValue(NO_SESSION);
    const { moveToFolderAction } = await import("../../../app/library/actions.js");
    await expect(moveToFolderAction(new FormData())).rejects.toBe(NO_SESSION);
    expect(dbm.getPool).not.toHaveBeenCalled();
  });
});

describe.skipIf(!url)("library folders (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const id: Record<string, string> = {};

  const media = async (key: string, o: { folder?: string; captured?: string; created: string }) => {
    const r = await db.query(
      `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, qa, folder, captured_at, created_at)
       values ($1, $2, $3, 12, 'gym', 'ready', null, $4, $5, $6) returning id`,
      [`dbt-fold-${run}-${key}`, `/clips/${run}-${key}.mp4`, `library/dbt-fold-${run}-${key}.mp4`, o.folder ?? null, o.captured ?? null, o.created],
    );
    id[key] = r.rows[0].id;
  };
  const mine = <T extends { mediaId: string }>(xs: T[]) => xs.filter((x) => Object.values(id).includes(x.mediaId));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    await media("a", { created: "2026-11-26T10:00:00Z" });
    await media("b", { created: "2026-11-26T09:00:00Z", captured: "2026-11-17T09:00:00Z" });
    await media("c", { created: "2026-11-25T09:00:00Z", folder: `Upper ${run}` });
    await media("d", { created: "2026-11-24T09:00:00Z", folder: `Upper ${run}` });
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });
  beforeEach(() => vi.clearAllMocks());

  it("loadLibrary returns folder and the captured-else-created instant; grouping buckets by week or label", async () => {
    const clips = mine((await loadLibrary(db, { q: `${run}-` })).clips);
    expect(clips).toHaveLength(4);
    const b = clips.find((c) => c.mediaId === id.b)!;
    expect(b.at).toBe("2026-11-17T09:00:00.000Z");
    expect(b.folder).toBeNull();
    const week = groupClips(clips, "week", "UTC").map((s) => [s.title, s.count]);
    expect(week).toEqual([["Week of Nov 23", 1], [`Upper ${run}`, 2], ["Week of Nov 16", 1]]);
    const folder = groupClips(clips, "folder", "UTC").map((s) => [s.title, s.count]);
    expect(folder).toEqual([[`Upper ${run}`, 2], ["No folder", 2]]);
  });

  it("loadFolders lists labels in use with counts", async () => {
    const f = (await loadFolders(db)).find((x) => x.folder === `Upper ${run}`);
    expect(f).toEqual({ folder: `Upper ${run}`, clips: 2 });
  });

  it("moveToFolder sets, trims, clears, and refuses bad labels without changing the row", async () => {
    expect(await moveToFolder(db, id.a!, "  Week of Nov 23 ")).toEqual({ ok: true, folder: "Week of Nov 23" });
    expect((await db.query("select folder from media where id = $1", [id.a])).rows[0].folder).toBe("Week of Nov 23");
    for (const bad of ["a/b", "x".repeat(61), "a\\b"]) {
      expect((await moveToFolder(db, id.a!, bad)).ok).toBe(false);
    }
    expect((await db.query("select folder from media where id = $1", [id.a])).rows[0].folder).toBe("Week of Nov 23");
    expect(await moveToFolder(db, id.a!, "")).toEqual({ ok: true, folder: null });
    expect((await db.query("select folder from media where id = $1", [id.a])).rows[0].folder).toBeNull();
    expect(await moveToFolder(db, "not-a-uuid", "x")).toEqual({ ok: false, reason: "unknown clip" });
    expect(await moveToFolder(db, randomUUID(), "x")).toEqual({ ok: false, reason: "unknown clip" });
  });
});
