import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../memory-store.js";
import { assertNotRateLimited, MAX_FAILURES, RateLimitedError, recordAuthFailure } from "../rate-limit.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

describe("rate limit", () => {
  it("refuses the 11th attempt in 15 min and alerts exactly once at the 10th failure", async () => {
    const store = new MemoryAuthStore();
    const alerts: string[] = [];
    const onAlert = async (m: string) => void alerts.push(m);
    for (let i = 0; i < MAX_FAILURES; i++) {
      await assertNotRateLimited(store, at(i * 1000));
      await recordAuthFailure(store, "login", at(i * 1000), onAlert);
      expect(alerts).toHaveLength(i === MAX_FAILURES - 1 ? 1 : 0);
    }
    await expect(assertNotRateLimited(store, at(MAX_FAILURES * 1000))).rejects.toBeInstanceOf(RateLimitedError);
    await recordAuthFailure(store, "enroll-code", at(11_000), onAlert);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/10 failed login\/enrol attempts in 15 min/);
  });

  it("a failure 16 min old does not count", async () => {
    const store = new MemoryAuthStore();
    const onAlert = async () => {};
    await recordAuthFailure(store, "login", T0, onAlert);
    for (let i = 0; i < MAX_FAILURES - 1; i++) await recordAuthFailure(store, "login", at(16 * MIN), onAlert);
    await expect(assertNotRateLimited(store, at(16 * MIN))).resolves.toBeUndefined();
    await recordAuthFailure(store, "login", at(16 * MIN), onAlert);
    await expect(assertNotRateLimited(store, at(16 * MIN))).rejects.toBeInstanceOf(RateLimitedError);
  });
});
