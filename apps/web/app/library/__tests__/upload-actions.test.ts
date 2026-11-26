import { beforeEach, describe, expect, it, vi } from "vitest";

/** The upload server actions check the session before anything else, and a refused start never touches storage. */
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const dbm = vi.hoisted(() => ({ getPool: vi.fn() }));
const env = vi.hoisted(() => ({ uploadStorage: vi.fn() }));

vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => dbm);
vi.mock("../../../lib/uploads/env.js", () => env);

const actions = await import("../upload-actions.js");

beforeEach(() => vi.clearAllMocks());

describe("upload actions", () => {
  it("refuse without a session, before the DB or storage", async () => {
    auth.requireSession.mockRejectedValue(NO_SESSION);
    await expect(actions.checkUploadsAction([{ name: "a.mp4", size: 1 }])).rejects.toBe(NO_SESSION);
    await expect(actions.startUploadAction({ name: "a.mp4", size: 1, type: "video/mp4" })).rejects.toBe(NO_SESSION);
    expect(dbm.getPool).not.toHaveBeenCalled();
    expect(env.uploadStorage).not.toHaveBeenCalled();
  });

  it("start refuses a non-video in plain words without opening a storage upload", async () => {
    auth.requireSession.mockResolvedValue({ id: "s" });
    const storage = { createMultipart: vi.fn() };
    env.uploadStorage.mockReturnValue(storage);
    dbm.getPool.mockReturnValue({ query: vi.fn() });
    expect(await actions.startUploadAction({ name: "notes.txt", size: 10, type: "text/plain" })).toEqual({ ok: false, error: expect.stringMatching(/mp4/) });
    expect(storage.createMultipart).not.toHaveBeenCalled();
  });
});
