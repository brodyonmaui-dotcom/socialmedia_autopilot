import { describe, expect, it } from "vitest";
import { ENROLL_CODE_TTL_MS, normalizeEnrollCode, sha256Hex } from "@autopilot/db";
import { MemoryAuthStore } from "../memory-store.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

describe("MemoryAuthStore", () => {
  it("enrol code works once, and not after 15 min", async () => {
    const store = new MemoryAuthStore();
    const h1 = sha256Hex(normalizeEnrollCode("ABCD-EFGH"));
    const h2 = sha256Hex(normalizeEnrollCode("JKLM-NPQR"));
    store.addEnrollCode(h1, at(ENROLL_CODE_TTL_MS));
    store.addEnrollCode(h2, at(ENROLL_CODE_TTL_MS));
    expect(await store.consumeEnrollCode(h1, at(MIN))).toBe(true);
    expect(await store.consumeEnrollCode(h1, at(2 * MIN))).toBe(false);
    expect(await store.consumeEnrollCode(h2, at(ENROLL_CODE_TTL_MS))).toBe(false);
    expect(await store.consumeEnrollCode(h2, at(16 * MIN))).toBe(false);
    expect(await store.consumeEnrollCode(sha256Hex("unknown"), at(MIN))).toBe(false);
  });

  it("challenge is single use, kind-bound and expires", async () => {
    const store = new MemoryAuthStore();
    const id = await store.putChallenge("login", "chal-1", at(5 * MIN));
    expect(await store.takeChallenge(id, "register", at(MIN))).toBeNull();
    expect(await store.takeChallenge(id, "login", at(MIN))).toBe("chal-1");
    expect(await store.takeChallenge(id, "login", at(MIN))).toBeNull();
    const id2 = await store.putChallenge("register", "chal-2", at(5 * MIN));
    expect(await store.takeChallenge(id2, "register", at(5 * MIN))).toBeNull();
  });

  it("credentials round-trip and counter bumps", async () => {
    const store = new MemoryAuthStore();
    await store.saveCredential({ credentialId: "c1", publicKey: new Uint8Array([9, 8, 7]), counter: 1, transports: ["internal"], label: "phone" });
    await store.bumpCounter("c1", 5, at(MIN));
    const [c] = await store.listCredentials();
    expect(c?.counter).toBe(5);
    expect(Array.from(c!.publicKey)).toEqual([9, 8, 7]);
    expect(c?.transports).toEqual(["internal"]);
    expect(c?.label).toBe("phone");
  });
});
