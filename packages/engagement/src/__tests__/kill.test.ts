import { describe, expect, it } from "vitest";
import { killEnvFromEnv, shouldTripKill } from "../kill.js";

describe("shouldTripKill", () => {
  it("trips on 3 consecutive failures at the head", () => {
    expect(shouldTripKill([{ ok: false, error: "bad request" }, { ok: false, error: "x" }, { ok: false }])).toBe("3 consecutive send failures");
  });
  it("doesn't trip on 2 failures + 1 ok, or on fewer than 3 outcomes", () => {
    expect(shouldTripKill([{ ok: false }, { ok: false }, { ok: true }])).toBeNull();
    expect(shouldTripKill([{ ok: true }, { ok: false }, { ok: false }])).toBeNull();
    expect(shouldTripKill([{ ok: false }, { ok: false }])).toBeNull();
    expect(shouldTripKill([])).toBeNull();
  });
  it("trips at once on a block/limit signal", () => {
    expect(shouldTripKill([{ ok: false, error: "Action Blocked: spam" }])).toBe("platform block/limit signal: Action Block");
    expect(shouldTripKill([{ ok: false, error: "429 Too Many Requests" }])).toMatch(/^platform block\/limit signal: Too Many/);
    expect(shouldTripKill([{ ok: false, error: "insufficient_quota" }])).toMatch(/insufficient_quota/);
  });
  it("an old block signal behind a newer ok doesn't re-trip after a reset", () => {
    expect(shouldTripKill([{ ok: true }, { ok: false, error: "Action Blocked" }])).toBeNull();
  });
});

describe("killEnvFromEnv", () => {
  it("parses ENGAGEMENT_KILL", () => {
    expect(killEnvFromEnv({ ENGAGEMENT_KILL: "1" })).toBe(true);
    expect(killEnvFromEnv({ ENGAGEMENT_KILL: "true" })).toBe(true);
    expect(killEnvFromEnv({ ENGAGEMENT_KILL: "TRUE" })).toBe(true);
    expect(killEnvFromEnv({ ENGAGEMENT_KILL: "0" })).toBe(false);
    expect(killEnvFromEnv({ ENGAGEMENT_KILL: "" })).toBe(false);
    expect(killEnvFromEnv({})).toBe(false);
  });
});
