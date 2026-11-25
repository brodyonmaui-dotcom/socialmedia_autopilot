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

const actions = await import("../actions.js");
const exported = Object.entries(actions).filter(([, v]) => typeof v === "function") as Array<[string, (...a: unknown[]) => Promise<void>]>;

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((url: string) => {
    throw new Redirect(url);
  });
});

describe("calendar actions without a session", () => {
  it("exports the expected actions", () => {
    expect(exported.map(([n]) => n).sort()).toEqual(
      [
        "alreadyPostedAction", "approveAllAction", "approveItemsAction", "editTextAction", "fillTimesAction", "igCheckAction", "moveAction", "moveTomorrowAction",
        "recordPublishedAction", "rejectItemsAction", "rescheduleMissedAction", "resetCheckedAction",
      ].sort(),
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

describe("calendar actions with a session (fake pool)", () => {
  const BATCH = "b0000000-0000-4000-8000-000000000001";
  const ITEM = "10000000-0000-4000-8000-000000000001";

  const BACK = "/calendar?d=2099-01-06&day=2099-01-06";
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
    return fd;
  };
  const writes = (calls: Array<{ sql: string }>) => calls.filter((c) => /^(update|insert)/.test(c.sql.trim()));

  function fakePool(status = "approved", caption = "calm caption") {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const answer = (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/^select batch_id from batch_items where id = \$1/.test(sql)) return { rows: [{ batch_id: BATCH }], rowCount: 1 };
      if (/from batches where id = \$1/.test(sql)) return { rows: [{ id: BATCH, week_start: "2099-01-05", status: "approved", approved_at: new Date() }], rowCount: 1 };
      if (/from batch_items bi join media/.test(sql))
        return {
          rows: [
            {
              id: ITEM, batch_id: BATCH, media_id: "m0000000-0000-4000-8000-000000000001", platform: "instagram", caption, title: null,
              scheduled_for: new Date("2099-01-06T10:00:00Z"), status, trial: null, platform_post_id: null, approved_at: new Date(),
              attempts: 4, last_error: "gave up", key_tail: "abc123", platform_post_url: null,
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

  it("rejectItemsAction: one conditional update in a transaction, audited with the session, then back to the calendar", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, client, calls } = fakePool();
    db.getPool.mockReturnValue(pool);

    await expect(actions.rejectItemsAction(form({ back: BACK, item: `${BATCH}:${ITEM}` }))).rejects.toMatchObject({
      url: expect.stringMatching(/^\/calendar\?d=2099-01-06&note=Rejected\+1/),
    });

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

  it("alreadyPostedAction: the reject transition with detail {reason: already-posted}, audited, back with a note", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    for (const status of ["draft", "approved"]) {
      const { pool, calls } = fakePool(status);
      db.getPool.mockReturnValue(pool);
      await expect(actions.alreadyPostedAction(form({ back: BACK, itemId: ITEM }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/calendar\?d=2099-01-06&day=2099-01-06&note=Dropped/) });
      const upd = calls.find((c) => /^update batch_items/.test(c.sql.trim()))!;
      expect(upd.sql).toMatch(/and status = \$5/);
      expect(upd.sql).not.toMatch(/idempotency_key/);
      expect(upd.params.slice(0, 5)).toEqual(["rejected", expect.any(Date), SESSION.id, ITEM, status]);
      const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
      expect(ev.params.slice(0, 4)).toEqual([ITEM, "reject", status, "rejected"]);
      expect(JSON.parse(ev.params[4] as string)).toEqual({ reason: "already-posted" });
    }
  });

  it("alreadyPostedAction refuses published / queued / publishing / failed / unknown and bad ids, writing nothing", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    for (const status of ["published", "queued", "publishing", "failed", "unknown"]) {
      const { pool, calls } = fakePool(status);
      db.getPool.mockReturnValue(pool);
      await expect(actions.alreadyPostedAction(form({ back: BACK, itemId: ITEM }))).rejects.toMatchObject({ url: expect.stringContaining("error=Can%27t+reject") });
      expect(writes(calls)).toEqual([]);
    }
    const { pool, calls } = fakePool("draft");
    db.getPool.mockReturnValue(pool);
    await expect(actions.alreadyPostedAction(form({ back: "https://evil.example.com", itemId: "nope" }))).rejects.toMatchObject({ url: "/calendar?error=Unknown+post." });
    expect(calls).toEqual([]);
  });

  it("resetCheckedAction: IG check runs server-side (no creds → 'error'), explicit reset SQL, alert ack, never approves", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    vi.stubEnv("IG_USER_ID", "");
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, calls } = fakePool("failed");
    db.getPool.mockReturnValue(pool);
    const { RESET_CHECKLIST } = await import("../../../lib/batches/reset.js");
    const fd = new FormData();
    fd.set("back", BACK);
    fd.set("batchId", BATCH);
    fd.set("itemId", ITEM);
    fd.set("autoCheck", "not-found"); // ignored: the server runs its own check
    for (const c of RESET_CHECKLIST.instagram) fd.append("checked", c);

    await expect(actions.resetCheckedAction(fd)).rejects.toMatchObject({ url: expect.stringMatching(/^\/calendar\?d=2099-01-06&day=2099-01-06&note=/) });
    const upd = calls.find((c) => /^update batch_items/.test(c.sql.trim()))!;
    expect(upd.sql).toMatch(/set status = 'draft'/);
    expect(upd.sql).toMatch(/platform_post_id is null/);
    expect(upd.sql).not.toMatch(/idempotency_key/);
    expect(upd.params).toEqual([ITEM, expect.any(Date), 1, BATCH, "failed"]);
    const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params[1]).toBe("reset-checked");
    expect(JSON.parse(ev.params[4] as string)).toMatchObject({ autoCheck: "error", attemptsBefore: 4, lastError: "gave up" });
    expect(calls.some((c) => /^update alerts set acknowledged_at/.test(c.sql.trim()))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("resetCheckedAction: a missing checklist box refuses before any write", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, calls } = fakePool("failed");
    db.getPool.mockReturnValue(pool);
    const fd = new FormData();
    fd.set("batchId", BATCH);
    fd.set("itemId", ITEM);
    await expect(actions.resetCheckedAction(fd)).rejects.toMatchObject({ url: expect.stringContaining("?error=") });
    expect(calls.some((c) => c.sql.trim() === "begin")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("approveItemsAction: a draft without block warnings is approved through the approve transition", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, calls } = fakePool("draft");
    db.getPool.mockReturnValue(pool);
    await expect(actions.approveItemsAction(form({ back: BACK, item: `${BATCH}:${ITEM}` }))).rejects.toMatchObject({ url: expect.stringContaining("note=Approved+1") });
    const upd = calls.find((c) => /^update batch_items/.test(c.sql.trim()))!;
    expect(upd.params.slice(0, 1)).toEqual(["approved"]);
    const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params[1]).toBe("approve");
  });

  it("approveItemsAction / approveAllAction never approve a block-warning item (empty caption)", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    for (const fn of [actions.approveItemsAction, actions.approveAllAction]) {
      const { pool, calls } = fakePool("draft", "");
      db.getPool.mockReturnValue(pool);
      await expect(fn(form({ back: BACK, item: `${BATCH}:${ITEM}` }))).rejects.toMatchObject({ url: expect.stringContaining("error=Nothing+approved") });
      expect(writes(calls)).toEqual([]);
    }
  });

  it("editTextAction: the edit transition (approved → back to draft), audited", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool, calls } = fakePool("approved");
    db.getPool.mockReturnValue(pool);
    await expect(actions.editTextAction(form({ back: BACK, item: `${BATCH}:${ITEM}`, [`caption:${ITEM}`]: "a new calm caption" }))).rejects.toMatchObject({ url: expect.stringContaining("note=Saved+1") });
    const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params.slice(1, 4)).toEqual(["edit", "approved", "draft"]);
  });

  it("moveAction: an edit of the time; a move into the past is refused and writes nothing", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const ok = fakePool("approved");
    db.getPool.mockReturnValue(ok.pool);
    await expect(actions.moveAction(form({ back: BACK, item: `${BATCH}:${ITEM}`, date: "2099-01-08" }))).rejects.toMatchObject({ url: expect.stringContaining("note=Moved+1") });
    const ev = ok.calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params[1]).toBe("edit");

    const past = fakePool("approved");
    db.getPool.mockReturnValue(past.pool);
    await expect(actions.moveAction(form({ back: BACK, item: `${BATCH}:${ITEM}`, date: "2001-01-01" }))).rejects.toMatchObject({ url: expect.stringContaining("error=Can%27t+move+there") });
    expect(writes(past.calls)).toEqual([]);
  });

  it("rescheduleMissedAction: one locked transaction, optimistic update that keeps it approved, event + alert ack, notice", async () => {
    vi.stubEnv("TZ_CREATOR", "UTC");
    auth.requireSession.mockResolvedValue(SESSION);
    const late = new Date(Date.now() - 3 * 3_600_000);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const answer = (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/from batch_items bi join batches b/.test(sql))
        return {
          rows: [{ id: ITEM, platform: "instagram", status: "approved", batch_status: "approved", scheduled_for: late, from_raw: late.toISOString(), title: null, caption: "Day 3 of it" }],
          rowCount: 1,
        };
      if (/^update batch_items/.test(sql.trim())) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), release: vi.fn() };
    db.getPool.mockReturnValue({ query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), connect: vi.fn(async () => client) });

    await expect(actions.rescheduleMissedAction(form({ returnTo: "/calendar?d=2099-01-06&notice=old", itemId: [ITEM, ITEM, "not-a-uuid"] }))).rejects.toMatchObject({
      url: "/calendar?d=2099-01-06&notice=rescheduled&n=1",
    });
    const sqls = calls.map((c) => c.sql.trim());
    expect(sqls[0]).toBe("begin");
    expect(sqls[1]).toMatch(/pg_advisory_xact_lock\(hashtext\('reschedule-missed'\)\)/);
    expect(sqls.find((q) => /from batch_items bi join batches b/.test(q))).toMatch(/for update of bi/);
    const upd = calls.find((c) => /^update batch_items/.test(c.sql.trim()))!;
    expect(upd.sql).toMatch(/where id = \$1 and status = 'approved' and scheduled_for = \$4::timestamptz/);
    expect(upd.sql).not.toMatch(/status =\s*'(draft|queued)'|idempotency_key/);
    expect(upd.params[0]).toBe(ITEM);
    const ev = calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.sql).toMatch(/'move', 'approved', 'approved'/);
    expect(ev.params[2]).toBe(SESSION.id);
    expect(calls.some((c) => /^delete from alerts/.test(c.sql.trim()) && /kind = 'missed-slot'/.test(c.sql))).toBe(true);
    expect(sqls.at(-1)).toBe("commit");
    expect(client.release).toHaveBeenCalled();

    // Open redirects fall back to the calendar; no ids → an error and no transaction.
    await expect(actions.rescheduleMissedAction(form({ returnTo: "//evil.example.com", itemId: ITEM }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/calendar\?notice=rescheduled/) });
    const before = calls.length;
    await expect(actions.rescheduleMissedAction(form({ returnTo: "/", itemId: "nope" }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/\?error=/) });
    expect(calls.length).toBe(before);
    vi.unstubAllEnvs();
  });

  it("only returns to /calendar or Home (never an open redirect)", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const { pool } = fakePool();
    db.getPool.mockReturnValue(pool);
    await expect(actions.rejectItemsAction(form({ back: "https://evil.example.com", item: `${BATCH}:${ITEM}` }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/calendar\?note=/) });
  });
});
