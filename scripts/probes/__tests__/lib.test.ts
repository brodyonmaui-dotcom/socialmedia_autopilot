import { describe, expect, it, vi } from "vitest";

describe("probe safety helpers", () => {
  it("redacts env secrets and access_token query params", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "EAAB-super-secret-value");
    vi.resetModules();
    const { redact } = await import("../lib.js");
    expect(redact("Bearer EAAB-super-secret-value")).toBe("Bearer [REDACTED]");
    expect(redact("https://x/y?access_token=abc123&f=1")).toBe("https://x/y?access_token=[REDACTED]&f=1");
  });

  it("F7 B4: redacts YouTube refresh tokens, Google access tokens and Zernio keys even when not in env", async () => {
    vi.resetModules();
    const { redact } = await import("../lib.js");
    const ytRefresh = "1//" + "0gAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const ytAccess = "ya29." + "a0AfB_byC7dEfGh1JkLmN2oPqRsT3uVwXyZ";
    const zernio = "sk_" + "live_9fA3kLm2Qx7Rt8Vw1Yz4Bc6De0Gh";
    const line = `refresh_token=${ytRefresh} {"access_token":"${ytAccess}"} Authorization: Bearer ${zernio} raw ${ytRefresh} ${zernio}`;
    const out = redact(line);
    for (const s of [ytRefresh, ytAccess, zernio]) expect(out).not.toContain(s.slice(4));
    expect(redact(out)).toBe(out);
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
