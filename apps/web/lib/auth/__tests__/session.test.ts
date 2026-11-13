import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../memory-store.js";
import {
  createSession,
  HARD_CAP_MS,
  hashToken,
  isWellFormedToken,
  newSessionToken,
  revokeSession,
  sessionCookieOptions,
  SLIDING_MS,
  validateSession,
} from "../session.js";
import type { AuthStore } from "../store.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("session tokens", () => {
  it("is 43 base64url chars from 32 bytes", () => {
    const { token, hash } = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes only the hash to insertSession", async () => {
    const store = new MemoryAuthStore();
    const seen: unknown[][] = [];
    const spy: AuthStore = Object.create(store);
    spy.insertSession = (...args) => {
      seen.push(args);
      return store.insertSession(...args);
    };
    const { token } = await createSession(spy, T0);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(hashToken(token));
    expect(JSON.stringify(seen)).not.toContain(token);
  });

  it("isWellFormedToken rejects malformed input", () => {
    const good = newSessionToken().token;
    expect(isWellFormedToken(good)).toBe(true);
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken("")).toBe(false);
    expect(isWellFormedToken(good.slice(1))).toBe(false);
    expect(isWellFormedToken(good + "A")).toBe(false);
    for (const bad of ["+", "/", "="]) expect(isWellFormedToken(bad + good.slice(1))).toBe(false);
    expect(isWellFormedToken(good.slice(1) + "\n")).toBe(false);
  });

  it("cookie options", () => {
    expect(sessionCookieOptions(true)).toEqual({
      name: "ap_session",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/app",
      maxAge: HARD_CAP_MS / 1000,
    });
  });
});

describe("validateSession", () => {
  it("unknown or malformed → null", async () => {
    const store = new MemoryAuthStore();
    expect(await validateSession(store, newSessionToken().token, T0)).toBeNull();
    expect(await validateSession(store, "nope", T0)).toBeNull();
    expect(await validateSession(store, undefined, T0)).toBeNull();
  });

  it("revoked → null", async () => {
    const store = new MemoryAuthStore();
    const { token, session } = await createSession(store, T0);
    expect(await validateSession(store, token, at(HOUR))).not.toBeNull();
    await revokeSession(store, session.id, at(2 * HOUR));
    expect(await validateSession(store, token, at(3 * HOUR))).toBeNull();
  });

  it("slides on use, never past the hard cap, and expires after it", async () => {
    const store = new MemoryAuthStore();
    const { token, session } = await createSession(store, T0);
    expect(session.expiresAt).toEqual(at(SLIDING_MS));
    expect(session.hardExpiresAt).toEqual(at(HARD_CAP_MS));

    const s1 = await validateSession(store, token, at(20 * DAY));
    expect(s1?.expiresAt).toEqual(at(50 * DAY));
    expect(store.touches).toBe(1);

    // without use, it lapses after the sliding window
    expect(await validateSession(store, token, at(50 * DAY + 1))).toBeNull();
  });

  it("keeps sliding with use but stops at hardExpiresAt", async () => {
    const store = new MemoryAuthStore();
    const { token } = await createSession(store, T0);
    for (const d of [25, 50, 75]) expect(await validateSession(store, token, at(d * DAY))).not.toBeNull();
    const s = await validateSession(store, token, at(85 * DAY));
    expect(s?.expiresAt).toEqual(at(HARD_CAP_MS));
    expect(store.sessions[0]!.expiresAt).toEqual(at(HARD_CAP_MS));
    expect(await validateSession(store, token, at(HARD_CAP_MS))).toBeNull();
    expect(await validateSession(store, token, at(HARD_CAP_MS + DAY))).toBeNull();
  });

  it("does not touch the store when the expiry would move by < 1 h", async () => {
    const store = new MemoryAuthStore();
    const { token, session } = await createSession(store, T0);
    const s = await validateSession(store, token, at(30 * 60_000));
    expect(s?.expiresAt).toEqual(session.expiresAt);
    expect(store.touches).toBe(0);
    await validateSession(store, token, at(HOUR + 1));
    expect(store.touches).toBe(1);
  });

  it("revokeAll invalidates an existing session", async () => {
    const store = new MemoryAuthStore();
    const { token } = await createSession(store, T0);
    await store.saveCredential({ credentialId: "c1", publicKey: new Uint8Array([1, 2]), counter: 0 });
    await store.revokeAll(at(HOUR));
    expect(await validateSession(store, token, at(2 * HOUR))).toBeNull();
    expect(await store.listCredentials()).toEqual([]);
  });
});
