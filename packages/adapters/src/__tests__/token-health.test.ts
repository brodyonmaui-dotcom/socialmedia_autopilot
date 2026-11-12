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
});
