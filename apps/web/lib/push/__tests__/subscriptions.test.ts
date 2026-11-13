import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InvalidSubscription, cleanLabel, saveSubscription, revokeSubscription, validateSubscription } from "../subscriptions.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const P256 = "B" + "A".repeat(86); // 87 base64url chars, like a real p256dh
const AUTH = "abcdefghijklmnopqrstuv"; // 22 chars
const good = { endpoint: "https://web.push.apple.com/QGx-abc_123", keys: { p256dh: P256, auth: AUTH } };

function fakePool() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return { calls, pool: { query: async (sql: string, params: unknown[] = []) => (calls.push({ sql, params }), { rows: [], rowCount: 1 }) } as never };
}

describe("validateSubscription", () => {
  it("accepts a browser PushSubscription.toJSON()", () => {
    expect(validateSubscription({ ...good, expirationTime: null })).toEqual(good);
  });

  it.each([
    ["non-https endpoint", { ...good, endpoint: "http://web.push.apple.com/x" }],
    ["javascript endpoint", { ...good, endpoint: "javascript:alert(1)" }],
    ["credentials in endpoint", { ...good, endpoint: "https://u:p@push.example.com/x" }],
    ["dotless host", { ...good, endpoint: "https://localhost/x" }],
    ["oversized endpoint", { ...good, endpoint: "https://push.example.com/" + "a".repeat(1100) }],
    ["missing keys", { endpoint: good.endpoint }],
    ["missing auth", { ...good, keys: { p256dh: P256 } }],
    ["missing p256dh", { ...good, keys: { auth: AUTH } }],
    ["oversized p256dh", { ...good, keys: { p256dh: "A".repeat(200), auth: AUTH } }],
    ["oversized auth", { ...good, keys: { p256dh: P256, auth: "A".repeat(100) } }],
    ["non-base64url key", { ...good, keys: { p256dh: P256.slice(0, -1) + "/", auth: AUTH } }],
    ["not an object", "https://push.example.com/x"],
    ["null", null],
  ])("rejects %s", (_name, input) => {
    expect(() => validateSubscription(input)).toThrow(InvalidSubscription);
  });

  it("error messages never echo the input", () => {
    try {
      validateSubscription({ ...good, endpoint: "http://secret-endpoint.example.com/x" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-endpoint");
    }
  });
});

describe("storage SQL", () => {
  it("save is an upsert on endpoint that clears revoked_at", async () => {
    const f = fakePool();
    await saveSubscription(f.pool, good, "session-1", "iPhone");
    expect(f.calls[0]!.sql).toMatch(/on conflict \(endpoint\) do update set[\s\S]*revoked_at = null/);
    expect(f.calls[0]!.params).toEqual([good.endpoint, P256, AUTH, "session-1", "iPhone"]);
  });

  it("revoke is a timestamp, never a delete", async () => {
    const f = fakePool();
    await revokeSubscription(f.pool, good.endpoint);
    expect(f.calls[0]!.sql).toMatch(/^update push_subscriptions set revoked_at/);
  });

  it("no delete anywhere in the push code", () => {
    for (const rel of ["../subscriptions.ts", "../../../app/alerts/push-actions.ts", "../../../app/alerts/ui/EnablePush.tsx"]) {
      expect(read(rel), rel).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it("push-actions never log or return the endpoint/keys", () => {
    const src = read("../../../app/alerts/push-actions.ts");
    expect(src).not.toMatch(/console\.\w+\([^)]*(endpoint|keys|json)/);
    expect(src).not.toMatch(/reason: [^"]*\$\{/); // fixed messages only
  });

  it("labels are coarse and capped", () => {
    expect(cleanLabel("iPhone")).toBe("iPhone");
    expect(cleanLabel("<script>x</script>")).toBe("scriptxscript");
    expect(cleanLabel("a".repeat(100))).toHaveLength(60);
    expect(cleanLabel(5)).toBeNull();
    expect(cleanLabel("   ")).toBeNull();
  });
});
