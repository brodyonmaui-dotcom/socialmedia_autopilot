import { describe, expect, it } from "vitest";
import { backoffMs, classifyFailure, decideAfterAttempt, DEFAULT_RETRY_POLICY, PublishTimeoutError } from "../outbox/policy.js";

const now = new Date("2026-11-12T10:00:00Z");

describe("backoffMs", () => {
  it("grows 5 → 15 → 45 min and caps at 60", () => {
    expect(backoffMs(1)).toBe(5 * 60_000);
    expect(backoffMs(2)).toBe(15 * 60_000);
    expect(backoffMs(3)).toBe(45 * 60_000);
    expect(backoffMs(4)).toBe(60 * 60_000);
    expect(backoffMs(9)).toBe(60 * 60_000);
  });
});

describe("classifyFailure", () => {
  it("treats network errors, aborts and timeouts as unknown outcomes", () => {
    expect(classifyFailure(new TypeError("fetch failed"))).toBe("timeout");
    expect(classifyFailure(new PublishTimeoutError(10))).toBe("timeout");
    expect(classifyFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("timeout");
    expect(classifyFailure(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("timeout");
  });
  it("treats everything else as a deliberate rejection", () => {
    expect(classifyFailure(new Error("HTTP 400 bad caption"))).toBe("rejected");
    expect(classifyFailure("string error")).toBe("rejected");
  });
});

describe("decideAfterAttempt", () => {
  it("success → published", () => {
    expect(decideAfterAttempt({ kind: "success" }, 0, now)).toEqual({ status: "published", attempts: 1, alert: false });
  });
  it("rejection → queued with backoff until maxAttempts, then failed + alert", () => {
    expect(decideAfterAttempt({ kind: "failure", cls: "rejected" }, 0, now)).toEqual({ status: "queued", attempts: 1, nextAttemptAt: "2026-11-12T10:05:00.000Z", alert: false });
    expect(decideAfterAttempt({ kind: "failure", cls: "rejected" }, 2, now)).toEqual({ status: "queued", attempts: 3, nextAttemptAt: "2026-11-12T10:45:00.000Z", alert: false });
    expect(decideAfterAttempt({ kind: "failure", cls: "rejected" }, 3, now)).toEqual({ status: "failed", attempts: 4, alert: true });
  });
  it("timeout → unknown + alert, never queued, whatever the attempt count", () => {
    expect(decideAfterAttempt({ kind: "failure", cls: "timeout" }, 0, now)).toEqual({ status: "unknown", attempts: 1, alert: true });
    expect(decideAfterAttempt({ kind: "failure", cls: "timeout" }, 3, now)).toEqual({ status: "unknown", attempts: 4, alert: true });
  });
  it("respects a custom policy", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 2, baseBackoffMs: 1000 };
    expect(decideAfterAttempt({ kind: "failure", cls: "rejected" }, 0, now, policy)).toMatchObject({ status: "queued", nextAttemptAt: "2026-11-12T10:00:01.000Z" });
    expect(decideAfterAttempt({ kind: "failure", cls: "rejected" }, 1, now, policy)).toMatchObject({ status: "failed" });
  });
});
