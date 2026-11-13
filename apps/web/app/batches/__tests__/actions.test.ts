import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSession() redirects (throws) when there is no session; simulate that with a sentinel.
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000001", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const db = vi.hoisted(() => ({ getPool: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => db);
vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: nav.revalidatePath }));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

const actions = await import("../[id]/actions.js");
const exported = Object.entries(actions).filter(([, v]) => typeof v === "function") as Array<[string, (...a: unknown[]) => Promise<void>]>;

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((url: string) => {
    throw new Redirect(url);
  });
});

describe("batch actions without a session", () => {
  it("exports the expected actions", () => {
    expect(exported.map(([n]) => n).sort()).toEqual(
      ["addItemAction", "approveAction", "approveAllAction", "editAction", "fillTimesAction", "rejectAction", "unapproveAction"].sort(),
    );
  });

  for (const [name, fn] of exported) {
    it(`${name} rejects with the redirect and never touches the pool`, async () => {
      auth.requireSession.mockRejectedValue(NO_SESSION);
      db.getPool.mockImplementation(() => {
        throw new Error("getPool must not be called without a session");
      });
      const fd = new FormData();
      fd.set("batchId", "b0000000-0000-4000-8000-000000000001");
      fd.set("itemId", "10000000-0000-4000-8000-000000000001");
      await expect(fn("b0000000-0000-4000-8000-000000000001", ["10000000-0000-4000-8000-000000000001"], fd)).rejects.toBe(NO_SESSION);
      await expect(fn(fd)).rejects.toBe(NO_SESSION);
      expect(db.getPool).not.toHaveBeenCalled();
      expect(nav.revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("batch actions with a session (fake pool)", () => {
  const BATCH = "b0000000-0000-4000-8000-000000000001";
  const ITEM = "10000000-0000-4000-8000-000000000001";

  function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const answer = (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/from batches where id = \$1/.test(sql)) return { rows: [{ id: BATCH, week_start: "2099-01-05", status: "approved", approved_at: new Date() }], rowCount: 1 };
      if (/from batch_items bi join media/.test(sql))
        return {
          rows: [
            {
              id: ITEM, batch_id: BATCH, media_id: "m0000000-0000-4000-8000-000000000001", platform: "instagram", caption: "calm caption", title: null,
              scheduled_for: new Date("2099-01-06T10:00:00Z"), status: "approved", trial: null, platform_post_id: null, approved_at: new Date(),
              source_path: "clip.mp4", r2_key: "k", duration_s: "20", pillar: null, qa: null,
            },
          ],
          rowCount: 1,
        };
      if (/^update batch_items/.test(sql.trim()) || /^update batches/.test(sql.trim())) return { rows: [{ id: params[0] }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), release: vi.fn() };
    const pool = { query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), connect: vi.fn(async () => client) };
    return { pool, client, calls };
  }

  it("rejectAction: one conditional update in a transaction, audited with the session, then back to the batch", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, client, calls } = fakePool();
    db.getPool.mockReturnValue(pool);

    await expect(actions.rejectAction(BATCH, [ITEM])).rejects.toMatchObject({ url: `/batches/${BATCH}` });

    expect(auth.requireSession).toHaveBeenCalledTimes(1);
    const sqls = calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(" "));
    expect(sqls).toContain("begin");
    expect(sqls).toContain("commit");
    const upd = calls.find((c) => /^update batch_items/.test(c.sql.trim()))!;
    expect(upd.sql).toMatch(/and status = \$5/);
    expect(upd.params.slice(0, 5)).toEqual(["rejected", expect.any(Date), SESSION.id, ITEM, "approved"]);
    const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params).toEqual([ITEM, "reject", "approved", "rejected", null, SESSION.id, expect.any(Date)]);
    const b = calls.find((c) => /^update batches/.test(c.sql.trim()))!;
    expect(b.params[1]).toBe("draft");
    expect(client.release).toHaveBeenCalled();
  });
});
