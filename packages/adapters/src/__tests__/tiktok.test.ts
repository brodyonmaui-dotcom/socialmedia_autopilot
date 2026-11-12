import { describe, expect, it } from "vitest";
import { createTikTokAdapter } from "../tiktok.js";
import { fixture, hasLocationKey, json, router, samplePost } from "./helpers.js";

const cfg = { apiKey: "key", accountId: "acct1" };
const post = { ...samplePost, platform: "tiktok" as const, caption: "My lats are not a fan of this pull day… #gym #gymbro #physique" };
const isPosts = (u: string) => u === "https://zernio.com/api/v1/posts";

describe("createTikTokAdapter", () => {
  it("sends scheduledFor/timezone at the top level, the Idempotency-Key header, and public-only settings", async () => {
    const r = router([[isPosts, () => json(fixture("zernio-post-scheduled"), 201)]]);
    const result = await createTikTokAdapter({ ...cfg, fetch: r.fetch }).publish(post);
    const call = r.calls[0]!;
    expect(call.headers["idempotency-key"]).toBe("idem-1");
    expect(call.headers.authorization).toBe("Bearer key");
    expect(call.json.scheduledFor).toBe("2026-12-01T09:00:00Z");
    expect(call.json.timezone).toBe("UTC");
    expect(call.json.platforms[0]).not.toHaveProperty("scheduledFor");
    expect(call.json.platforms[0].platformSpecificData.tiktokSettings).toMatchObject({ privacy_level: "PUBLIC_TO_EVERYONE", allow_duet: false, allow_stitch: false });
    expect(call.json.platforms[0].platformSpecificData.tiktokSettings).not.toHaveProperty("draft");
    expect(hasLocationKey(call.json)).toBe(false);
    expect(result).toEqual({ platformPostId: "6730000000000000000000a2", platformPostUrl: undefined, flags: [] });
  });

  it("published immediately with an empty platformPostUrl (M1 day 1 shape) → id from the platform result, no URL", async () => {
    const r = router([[isPosts, () => json(fixture("zernio-post-published"), 201)]]);
    const result = await createTikTokAdapter({ ...cfg, fetch: r.fetch }).publish(post);
    expect(result).toEqual({ platformPostId: "7430000000000000000", platformPostUrl: undefined, flags: [] });
  });

  it("tiktokDraft sends draft:true and flags the Creator Inbox handoff", async () => {
    const r = router([[isPosts, () => json(fixture("zernio-post-published"), 201)]]);
    const result = await createTikTokAdapter({ ...cfg, fetch: r.fetch }).publish({ ...post, tiktokDraft: true });
    expect(r.calls[0]!.json.platforms[0].platformSpecificData.tiktokSettings.draft).toBe(true);
    expect(result.flags).toEqual(["sent to the TikTok Creator Inbox as a draft: finish it in the app (add the sound)"]);
  });

  it("'Duplicate content detected' is NonRetryable; an unknown rejection is a retryable PlatformRequestError", async () => {
    const dup = router([[isPosts, () => json(fixture("zernio-post-failed"), 207)]]);
    await expect(createTikTokAdapter({ ...cfg, fetch: dup.fetch }).publish(post)).rejects.toMatchObject({ name: "NonRetryableError" });
    const other = router([[isPosts, () => json({ post: { platforms: [{ status: "failed", reason: "unaudited_client_can_only_post_to_private_accounts" }] } }, 207)]]);
    await expect(createTikTokAdapter({ ...cfg, fetch: other.fetch }).publish(post)).rejects.toMatchObject({ name: "PlatformRequestError" });
    const http = router([[isPosts, () => json({ error: { message: "rate limited" } }, 429)]]);
    await expect(createTikTokAdapter({ ...cfg, fetch: http.fetch }).publish(post)).rejects.toThrow(/HTTP 429/);
  });

  it("refuses more than 5 hashtags before any network call", async () => {
    const r = router([]);
    await expect(createTikTokAdapter({ ...cfg, fetch: r.fetch }).publish({ ...post, caption: "#a #b #c #d #e #f" })).rejects.toMatchObject({ name: "NonRetryableError" });
    expect(r.calls).toHaveLength(0);
  });
});
