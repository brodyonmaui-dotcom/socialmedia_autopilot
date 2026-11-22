import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSession() redirects (throws) when there is no session; simulate that with a sentinel.
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000001", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const ID = "c0000000-0000-4000-8000-000000000001";
const auth = vi.hoisted(() => ({ requireSession: vi.fn(), getAuthStore: vi.fn(), clearSessionCookie: vi.fn() }));
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

/** A pool whose transactions see an empty engagement overlay and record every statement. */
function fakePool(opts: { listed?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/select value from settings/.test(sql)) return { rows: [{ value: {} }], rowCount: 1 };
    if (/update engagement_promo_accounts/.test(sql)) return { rows: [{ id: ID }], rowCount: 1 };
    if (/insert into engagement_promo_accounts/.test(sql) && opts.listed) return { rows: [], rowCount: 0 };
    if (/insert into engagement_promo_accounts/.test(sql)) return { rows: [{ id: ID }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) }, calls };
}

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

async function redirected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((url: string) => {
    throw new Redirect(url);
  });
});

describe("settings actions without a session", () => {
  it("exports the expected actions", () => {
    expect(exported.map(([n]) => n).sort()).toEqual(
      ["addPromoAccountAction", "logoutEverywhereAction", "removePromoAccountAction", "saveCapsAction", "setDmDraftsAction", "setEditorApprovalAction",
      "setIgTrialReelsAction", "setPauseAction", "setPingsAction", "setReplyModeAction", "setTouchupAutofixAction"].sort(),
    );
  });

  for (const [name, fn] of exported) {
    it(`${name} rejects and never touches the pool`, async () => {
      auth.requireSession.mockRejectedValue(NO_SESSION);
      db.getPool.mockImplementation(() => {
        throw new Error("getPool must not be called without a session");
      });
      const fd = form({ confirm: "auto", pings: "each", on: "on", "cap-instagram": "6", platform: "instagram", handle: "gym_fan_22" });
      const args: Record<string, unknown[]> = {
        setPauseAction: [false, form({ confirm: "resume" })],
        setReplyModeAction: ["instagram", "live", fd],
        removePromoAccountAction: [ID],
        logoutEverywhereAction: [],
      };
      await expect(fn(...(args[name] ?? [fd]))).rejects.toBe(NO_SESSION);
      expect(db.getPool).not.toHaveBeenCalled();
      expect(auth.getAuthStore).not.toHaveBeenCalled();
      expect(nav.revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("settings actions with a session (fake pool)", () => {
  beforeEach(() => auth.requireSession.mockResolvedValue(SESSION));

  it("Auto without the typed word is refused and nothing is written", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const url = await redirected(actions.setReplyModeAction("instagram", "live", form({ confirm: "yes" })));
    expect(decodeURIComponent(url)).toBe('/settings?error=type "auto" to turn on auto replies#replies');
    expect(fp.calls).toEqual([]);
  });

  it("Auto with the word sets live, raises the engagement-mode alert and the settings audit row", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const url = await redirected(actions.setReplyModeAction("instagram", "live", form({ confirm: "auto" })));
    expect(url.startsWith("/settings?note=")).toBe(true);
    const upd = fp.calls.find((c) => /update settings set value/.test(c.sql))!;
    expect(JSON.parse(upd.params[1] as string).mode.instagram).toBe("live");
    expect(fp.calls.some((c) => /insert into alerts/.test(c.sql) && c.params[0] === "engagement-mode")).toBe(true);
    expect(fp.calls.some((c) => /'settings-change'/.test(c.sql))).toBe(true);
  });

  it("Snapchat has no reply mode", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    expect(decodeURIComponent(await redirected(actions.setReplyModeAction("snapchat", "off", form({}))))).toContain("error=unknown platform");
    expect(fp.calls).toEqual([]);
  });

  it("resume needs 'resume' typed; pause takes one confirm and raises the kill alert", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    expect(decodeURIComponent(await redirected(actions.setPauseAction(false, form({ confirm: "ok" }))))).toContain('error=type "resume"');
    expect(fp.calls.filter((c) => /update settings/.test(c.sql))).toEqual([]);
    await redirected(actions.setPauseAction(true, form({ reason: "odd replies" })));
    expect(fp.calls.some((c) => /insert into alerts/.test(c.sql) && c.params[0] === "engagement-kill")).toBe(true);
  });

  it("caps over the platform limit are refused before any write", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const url = await redirected(actions.saveCapsAction(form({ "cap-youtube": "11" })));
    expect(decodeURIComponent(url)).toContain("error=youtube: at most 10 a day");
    expect(fp.calls).toEqual([]);
  });

  it("log out everywhere: audit row, revoke all (this session too), clear the cookie, then /login", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const revokeAll = vi.fn(async () => {});
    const revokeAllSessions = vi.fn(async () => {});
    auth.getAuthStore.mockReturnValue({ revokeAll, revokeAllSessions });
    expect(await redirected(actions.logoutEverywhereAction())).toBe("/login");
    expect(fp.calls.some((c) => /'settings-change'/.test(c.sql) && c.params[0] === "web")).toBe(true);
    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(revokeAll).not.toHaveBeenCalled(); // passkeys stay: no lock-out from the phone
    expect(auth.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("removing a promo account is a status change and is audited", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    await redirected(actions.removePromoAccountAction(ID));
    expect(fp.calls.some((c) => /^\s*delete/i.test(c.sql))).toBe(false);
    expect(fp.calls.some((c) => /'settings-change'/.test(c.sql))).toBe(true);
  });

  it("add by handle: a bad handle is refused before any write", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const url = await redirected(actions.addPromoAccountAction(form({ platform: "instagram", handle: "https://www.instagram.com/gym_fan_22" })));
    expect(decodeURIComponent(url)).toBe("/settings?error=Type the handle, not a link.#promo");
    expect(decodeURIComponent(await redirected(actions.addPromoAccountAction(form({ platform: "snapchat", handle: "gym_fan_22" }))))).toContain("error=Pick Instagram");
    expect(fp.calls).toEqual([]);
  });

  it("add by handle: lists the lower-cased handle as a manual row, audited; a second add is a no-op note", async () => {
    const fp = fakePool();
    db.getPool.mockReturnValue(fp.pool);
    const url = await redirected(actions.addPromoAccountAction(form({ platform: "instagram", handle: " @@Gym_Fan_22 " })));
    expect(decodeURIComponent(url)).toBe("/settings?note=@gym_fan_22 added: the inbox ignores it from now on#promo");
    const ins = fp.calls.find((c) => /insert into engagement_promo_accounts/.test(c.sql))!;
    expect(ins.sql).toMatch(/'manual'/);
    expect(ins.params.slice(0, 3)).toEqual(["instagram", "gym_fan_22", "gym_fan_22"]);
    expect(fp.calls.some((c) => /'settings-change'/.test(c.sql) && c.params[0] === "instagram")).toBe(true);
    expect(fp.calls.some((c) => /^\s*delete/i.test(c.sql))).toBe(false);

    const again = fakePool({ listed: true });
    db.getPool.mockReturnValue(again.pool);
    expect(decodeURIComponent(await redirected(actions.addPromoAccountAction(form({ platform: "instagram", handle: "gym_fan_22" }))))).toBe(
      "/settings?note=@gym_fan_22 is already on the list#promo",
    );
    expect(again.calls.filter((c) => /insert into engagement_promo_accounts/.test(c.sql))).toHaveLength(1);
    expect(again.calls.some((c) => /'settings-change'/.test(c.sql))).toBe(false);
  });
});
