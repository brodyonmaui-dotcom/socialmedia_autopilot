import { describe, expect, it, vi } from "vitest";

describe("probe safety helpers", () => {
  it("redacts env secrets and access_token query params", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "EAAB-super-secret-value");
    vi.resetModules();
    const { redact } = await import("../lib.js");
    expect(redact("Bearer EAAB-super-secret-value")).toBe("Bearer [REDACTED]");
    expect(redact("https://x/y?access_token=abc123&f=1")).toBe("https://x/y?access_token=[REDACTED]&f=1");
  });

  it("is not LIVE unless both --live and DRY_RUN=false", async () => {
    vi.stubEnv("DRY_RUN", "true");
    process.argv.push("--live");
    vi.resetModules();
    expect((await import("../lib.js")).LIVE).toBe(false);
    vi.stubEnv("DRY_RUN", "false");
    vi.resetModules();
    expect((await import("../lib.js")).LIVE).toBe(true);
    process.argv.pop();
  });
});
