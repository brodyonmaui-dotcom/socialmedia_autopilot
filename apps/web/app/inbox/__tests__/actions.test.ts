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
const COMMENT = "c0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((url: string) => {
    throw new Redirect(url);
  });
});

describe("inbox actions without a session", () => {
  it("exports the expected actions", () => {
    expect(exported.map(([n]) => n).sort()).toEqual(
      ["blockAuthorAction", "copyDraftAction", "markHandledAction", "promoteShadowAction", "sendManualAction", "setDmDraftsAction", "setKillAction", "setModeAction"].sort(),
    );
  });

  for (const [name, fn] of exported) {
    it(`${name} rejects with the redirect and never touches the pool`, async () => {
      auth.requireSession.mockRejectedValue(NO_SESSION);
      db.getPool.mockImplementation(() => {
        throw new Error("getPool must not be called without a session");
      });
      const fd = new FormData();
      fd.set("confirm", "resume");
      // Arguments that would otherwise pass validation, so only the session check can stop them.
      const args: Record<string, unknown[]> = {
        markHandledAction: [COMMENT, fd],
        blockAuthorAction: ["instagram", "author-1", fd],
        sendManualAction: [COMMENT, "reply", fd],
        promoteShadowAction: [COMMENT, fd],
        setKillAction: [false, fd],
        setModeAction: ["instagram", "live", fd],
        copyDraftAction: [COMMENT],
      };
      await expect(fn(...(args[name] ?? [COMMENT, fd]))).rejects.toBe(NO_SESSION);
      expect(db.getPool).not.toHaveBeenCalled();
      expect(nav.revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("inbox actions with a session (fake pool)", () => {
  it("markHandledAction runs the conditional update with the id and returns to the tab", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    db.getPool.mockReturnValue(pool);
    const fd = new FormData();
    fd.set("tab", "shadow");

    await expect(actions.markHandledAction(COMMENT, fd)).rejects.toMatchObject({ url: "/inbox?tab=shadow&note=marked%20done" });

    expect(auth.requireSession).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/update comment_triage set handled_at = \$2 where comment_id = \$1 and handled_at is null/);
    expect(params).toEqual([COMMENT, expect.any(Date)]);
  });

  it("an invalid id is refused before any query", async () => {
    auth.requireSession.mockResolvedValue(SESSION);
    const pool = { query: vi.fn() };
    db.getPool.mockReturnValue(pool);
    await expect(actions.markHandledAction("not-a-uuid")).rejects.toMatchObject({ url: "/inbox?error=unknown%20comment" });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
