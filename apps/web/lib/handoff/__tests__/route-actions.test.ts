import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSession() redirects (throws) when there is no session; simulate that with a sentinel.
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000001", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const ITEM = "10000000-0000-4000-8000-000000000001";
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const db = vi.hoisted(() => ({ getPool: vi.fn() }));
const nav = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("../../auth/require.js", () => auth);
vi.mock("../../db.js", () => db);
vi.mock("next/cache", () => ({ revalidatePath: nav.revalidatePath }));

const actions = await import("../../../app/handoff/actions.js");
const route = await import("../../../app/handoff/media/[itemId]/route.js");
const params = { params: Promise.resolve({ itemId: ITEM }) };

const envKeys = ["TZ_CREATOR", "PUBLIC_MEDIA_BASE"] as const;
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
beforeEach(() => {
  vi.clearAllMocks();
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fakePool(rows: unknown[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    calls.push({ sql, params: p });
    return { rows: /^\s*update/.test(sql) ? [{ id: ITEM, batch_id: "b" }] : rows, rowCount: /^\s*update/.test(sql) ? 1 : rows.length };
  });
  const client = { query, release: vi.fn() };
  return { pool: { query, connect: vi.fn(async () => client) }, calls };
}

describe("handoff actions", () => {
  it("exports exactly the three actions", () => {
    const names = Object.entries(actions)
      .filter(([, v]) => typeof v === "function")
      .map(([n]) => n)
      .sort();
    expect(names).toEqual(["dropAction", "markPostedAction", "skipAction"]);
  });

  for (const [name, call] of [
    ["markPostedAction", () => actions.markPostedAction(ITEM, null)],
    ["skipAction", () => actions.skipAction(ITEM)],
    ["dropAction", () => actions.dropAction(ITEM)],
  ] as const) {
    it(`${name} without a session rejects and never touches the pool`, async () => {
      auth.requireSession.mockRejectedValue(NO_SESSION);
      await expect(call()).rejects.toBe(NO_SESSION);
      expect(db.getPool).not.toHaveBeenCalled();
      expect(nav.revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("markPostedAction writes with the session id and revalidates /handoff", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    expect(await actions.markPostedAction(ITEM, "https://evil.example/x")).toEqual({ ok: true });
    const upd = fp.calls.find((c) => /update batch_items/.test(c.sql))!;
    expect(upd.params[2]).toBeNull(); // off-host link dropped
    const ev = fp.calls.find((c) => /insert into batch_item_events/.test(c.sql))!;
    expect(ev.params).toContain("snap-posted");
    expect(ev.params).toContain(SESSION.id);
    expect(nav.revalidatePath).toHaveBeenCalledWith("/handoff");
  });

  it("skipAction refuses without TZ_CREATOR (no UTC guess) and never touches the pool", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    delete process.env.TZ_CREATOR;
    expect(await actions.skipAction(ITEM)).toEqual({ ok: false, reason: "TZ_CREATOR not set" });
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it("a DB error becomes a fixed message", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    db.getPool.mockReturnValue({ connect: vi.fn(async () => Promise.reject(new Error("password=hunter2 host=10.0.0.1"))) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await actions.dropAction(ITEM)).toEqual({ ok: false, reason: "something went wrong" });
      expect(spy.mock.calls.flat().join(" ")).not.toContain("hunter2");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("GET /handoff/media/[itemId]", () => {
  it("without a session rejects before anything else", async () => {
    auth.requireSession.mockRejectedValue(NO_SESSION);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(route.GET(new Request("http://x/app/handoff/media/" + ITEM), params)).rejects.toBe(NO_SESSION);
      expect(db.getPool).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("503 with a fixed body when PUBLIC_MEDIA_BASE is unset", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    db.getPool.mockReturnValue(fakePool().pool);
    delete process.env.PUBLIC_MEDIA_BASE;
    process.env.TZ_CREATOR = "Europe/London";
    const res = await route.GET(new Request("http://x"), params);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("media not configured");
  });

  it("streams through global fetch for a due item", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    db.getPool.mockReturnValue(fakePool([{ scheduled_for: new Date(Date.now() - 60_000), r2_key: "k/clip.mp4" }]).pool);
    process.env.PUBLIC_MEDIA_BASE = "https://media.example.test";
    process.env.TZ_CREATOR = "Europe/London";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("BYTES", { status: 200 }));
    try {
      const res = await route.GET(new Request("http://x"), params);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toBe("BYTES");
      expect(fetchSpy).toHaveBeenCalledWith("https://media.example.test/k/clip.mp4", expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
