import { describe, expect, it } from "vitest";
import { checkTokenHealth, formatTokenHealth } from "../token-health.js";
import { fixture, json, router } from "./helpers.js";

const isDebug = (u: string) => u.includes("/debug_token?");
const isGoogle = (u: string) => u.includes("oauth2.googleapis.com/token");
const isAccounts = (u: string) => u.endsWith("/accounts");
const meta = { appId: "app", appSecret: "secret", accessToken: "page-token" };
const youtube = { clientId: "c", clientSecret: "s", refreshToken: "r" };
const zernio = { apiKey: "k", tiktokAccountId: "acct1" };

describe("checkTokenHealth", () => {
  it("everything configured and healthy → ok; the data-access date is reported", async () => {
    const r = router([
      [isDebug, () => json(fixture("ig-debug-token"))],
      [isGoogle, () => json(fixture("yt-token"))],
      [isAccounts, () => json(fixture("zernio-accounts"))],
    ]);
    const now = () => new Date("2026-11-12T00:00:00Z"); // 88 days before 2027-02-08
    const report = await checkTokenHealth({ fetch: r.fetch, now, meta, youtube, zernio });
    expect(report.map((x) => x.level)).toEqual(["ok", "ok", "ok"]);
    expect(report[0]).toMatchObject({ service: "meta", dataAccessExpiresAt: "2027-02-08T00:00:00.000Z", daysLeft: 88, missingScopes: [] });
    expect(formatTokenHealth(report)).toBe("meta=ok · youtube=ok · zernio=ok");
    // The token never appears in the report.
    expect(JSON.stringify(report)).not.toContain("page-token");
  });

  it("meta: warns inside the 7-day window, fails once lapsed or when scopes are missing", async () => {
    const r = router([[isDebug, () => json(fixture("ig-debug-token"))]]);
    const warn = await checkTokenHealth({ fetch: r.fetch, now: () => new Date("2027-02-03T00:00:00Z"), meta });
    expect(warn[0]).toMatchObject({ level: "warn", daysLeft: 5 });
    expect(warn[0]!.summary).toMatch(/probe:connect-meta/);
    const lapsed = await checkTokenHealth({ fetch: r.fetch, now: () => new Date("2027-02-10T00:00:00Z"), meta });
    expect(lapsed[0]!.level).toBe("fail");
    const scopes = await checkTokenHealth({ fetch: r.fetch, now: () => new Date("2026-11-12T00:00:00Z"), meta: { ...meta, wantedScopes: ["instagram_content_publish", "made_up_scope"] } });
    expect(scopes[0]).toMatchObject({ level: "fail", missingScopes: ["made_up_scope"] });
  });

  it("meta: an invalid token fails", async () => {
    const r = router([[isDebug, () => json({ data: { is_valid: false, error: { message: "Session has expired" } } })]]);
    const [m] = await checkTokenHealth({ fetch: r.fetch, meta });
    expect(m).toMatchObject({ level: "fail" });
    expect(m!.summary).toMatch(/Session has expired/);
  });

  it("youtube: invalid_grant fails with a re-probe hint", async () => {
    const r = router([[isGoogle, () => json(fixture("yt-invalid-grant"), 400)]]);
    const report = await checkTokenHealth({ fetch: r.fetch, youtube });
    expect(report[1]).toMatchObject({ service: "youtube", level: "fail" });
    expect(report[1]!.summary).toMatch(/revoked|expired/);
  });

  it("zernio: a missing TikTok account fails; unconfigured services are skipped", async () => {
    const r = router([[isAccounts, () => json({ accounts: [] })]]);
    const report = await checkTokenHealth({ fetch: r.fetch, zernio });
    expect(report.map((x) => x.level)).toEqual(["skipped", "skipped", "fail"]);
  });

  it("a check that throws is reported as fail, not thrown", async () => {
    const report = await checkTokenHealth({ fetch: async () => { throw new TypeError("fetch failed"); }, meta });
    expect(report[0]).toMatchObject({ service: "meta", level: "fail" });
    expect(report[0]!.summary).toMatch(/fetch failed/);
  });
  it("F7 B1: a failing debug_token fetch whose error echoes the URL leaks neither token into the summary", async () => {
    const realish = { appId: "1234567890123", appSecret: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", accessToken: "EAAB" + "x7Yq2Lm9Pz3Kd8Rw4Tn6Vb1Hc5Jf0Gs" };
    for (const m of [meta, realish]) {
      const report = await checkTokenHealth({
        fetch: async (url) => {
          throw new TypeError(`fetch failed: ${url}`);
        },
        meta: m,
      });
      const s = report[0]!.summary;
      expect(report[0]!.level).toBe("fail");
      expect(s).toMatch(/debug_token/); // still says what failed
      for (const secret of [m.accessToken, m.appSecret, encodeURIComponent(`${m.appId}|${m.appSecret}`)]) expect(s).not.toContain(secret);
    }
  });

  it("F7 B1: a platform error message that echoes a token is scrubbed (youtube, zernio)", async () => {
    const yt = { clientId: "c", clientSecret: "client-secret-value", refreshToken: "1//" + "0gAbCdEfGhIjKlMnOpQrStUvWxYz0123456789" };
    const r = router([
      [isGoogle, () => json({ error: "invalid_request", error_description: `bad refresh_token=${yt.refreshToken} client_secret=${yt.clientSecret}` }, 400)],
      [isAccounts, () => json({ message: `invalid key ${zernio.apiKey}-long-zernio-key-value` }, 401)],
    ]);
    const z = { apiKey: "zernio-key-123456", tiktokAccountId: "acct1" };
    const r2 = router([[isAccounts, () => json({ message: `invalid key ${z.apiKey}` }, 401)]]);
    const [, y] = await checkTokenHealth({ fetch: r.fetch, youtube: yt });
    expect(y!.summary).not.toContain(yt.refreshToken.slice(4));
    expect(y!.summary).not.toContain(yt.clientSecret);
    const [, , zz] = await checkTokenHealth({ fetch: r2.fetch, zernio: z });
    expect(zz!.level).toBe("fail");
    expect(zz!.summary).not.toContain(z.apiKey);
  });
});
