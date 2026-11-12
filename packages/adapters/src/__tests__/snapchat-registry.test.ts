import { describe, expect, it } from "vitest";
import { buildAdapters, credentialsFromEnv } from "../registry.js";
import { buildSnapchatHandoff, createSnapchatAdapter, snapchatCaption, SNAPCHAT_CHECKLIST } from "../snapchat.js";
import { samplePost } from "./helpers.js";

describe("snapchat (assisted)", () => {
  it("publish() always refuses, permanently: the outbox can never fire Snapchat", async () => {
    await expect(createSnapchatAdapter().publish({ ...samplePost, platform: "snapchat" })).rejects.toMatchObject({ name: "NonRetryableError" });
  });
  it("handoff caption is the one-liner with at most 2 topic tags, and the checklist keeps location off", () => {
    expect(snapchatCaption("My lats are not a fan of this pull day…\n\n#gym #gymbro #hypertrophy")).toBe("My lats are not a fan of this pull day… #gym #gymbro");
    expect(snapchatCaption("Welp, I was the liquidity today 🥀")).toBe("Welp, I was the liquidity today 🥀");
    const h = buildSnapchatHandoff({ ...samplePost, platform: "snapchat" });
    expect(h).toEqual({ postId: "item-1", mediaUrl: samplePost.mediaUrl, caption: "My lats are not a fan of this pull day… #gym #gymbro", checklist: SNAPCHAT_CHECKLIST });
    expect(h.checklist.some((l) => /location OFF/.test(l))).toBe(true);
  });
});

describe("registry", () => {
  it("builds only the adapters with credentials; never snapchat", () => {
    const none = buildAdapters({});
    expect(Object.keys(none)).toEqual([]);
    const some = buildAdapters({ tiktok: { apiKey: "k", accountId: "a" }, instagram: { accessToken: "t", igUserId: "1" } });
    expect(Object.keys(some).sort()).toEqual(["instagram", "tiktok"]);
    expect(some.instagram!.platform).toBe("instagram");
  });
  it("reads credentials from env names the probes use, without partial configs", () => {
    const c = credentialsFromEnv({ META_ACCESS_TOKEN: "t", IG_USER_ID: "1", GOOGLE_CLIENT_ID: "c", ZERNIO_API_KEY: "k", ZERNIO_TIKTOK_ACCOUNT_ID: "a" } as NodeJS.ProcessEnv);
    expect(c.instagram).toEqual({ accessToken: "t", igUserId: "1", graphVersion: undefined });
    expect(c.youtube).toBeUndefined(); // client id alone isn't enough
    expect(c.tiktok).toEqual({ apiKey: "k", accountId: "a" });
  });
});
