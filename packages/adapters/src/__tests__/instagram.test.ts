import { describe, expect, it } from "vitest";
import { createInstagramAdapter } from "../instagram.js";
import { fixture, hasLocationKey, json, router, samplePost } from "./helpers.js";

const cfg = { accessToken: "page-token", igUserId: "1784", pollIntervalMs: 0, maxPolls: 3 };
const isCreate = (u: string, i?: RequestInit) => u.endsWith("/1784/media") && i?.method === "POST";
const isStatus = (u: string) => /\/17900000000000001\?fields=status_code/.test(u);
const isPublish = (u: string) => u.endsWith("/1784/media_publish");
const isPermalink = (u: string) => /\/17944070922377356\?fields=permalink/.test(u);
const isList = (u: string) => /\/1784\/media\?fields=/.test(u);

describe("createInstagramAdapter", () => {
  it("plain reel: create container → poll until FINISHED → media_publish → permalink", async () => {
    let polls = 0;
    const r = router([
      [isCreate, () => json(fixture("ig-container-created"))],
      [isStatus, () => json(fixture(++polls < 2 ? "ig-status-in-progress" : "ig-status-finished"))],
      [isPublish, () => json(fixture("ig-publish"))],
      [isPermalink, () => json(fixture("ig-media-permalink"))],
    ]);
    const result = await createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish(samplePost);
    expect(result).toEqual({ platformPostId: "17944070922377356", platformPostUrl: "https://www.instagram.com/reel/ABC123/", trialFellBack: false, flags: [] });
    const create = r.calls[0]!;
    expect(create.url).toBe("https://graph.facebook.com/v25.0/1784/media");
    expect(create.form).toEqual({ media_type: "REELS", video_url: samplePost.mediaUrl, caption: samplePost.caption, share_to_feed: "true" });
    expect(create.headers.authorization).toBe("Bearer page-token");
    expect(polls).toBe(2);
    expect(r.calls.find((c) => isPublish(c.url))!.form).toEqual({ creation_id: "17900000000000001" });
    expect(r.calls.some((c) => hasLocationKey(c.form) || /location_id/.test(c.url))).toBe(false);
  });

  it("trial reel: sends trial_params; a 2207081 refusal falls back to a plain reel and flags it", async () => {
    const r = router([
      [(u, i) => isCreate(u, i) && new URLSearchParams(i!.body as URLSearchParams).has("trial_params"), () => json(fixture("ig-trial-refused"), 400)],
      [isCreate, () => json(fixture("ig-container-created"))],
      [isStatus, () => json(fixture("ig-status-finished"))],
      [isPublish, () => json(fixture("ig-publish"))],
      [isPermalink, () => json(fixture("ig-media-permalink"))],
    ]);
    const result = await createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish({ ...samplePost, trial: { graduationStrategy: "MANUAL" } });
    expect(result.trialFellBack).toBe(true);
    expect(result.flags).toEqual(["trial refused: posted as a regular reel"]);
    expect(r.calls[0]!.form!.trial_params).toBe(JSON.stringify({ graduation_strategy: "MANUAL" }));
    expect(r.calls[1]!.form).not.toHaveProperty("trial_params");
  });

  it("trial accepted: no fallback, trialFellBack false", async () => {
    const r = router([
      [isCreate, () => json(fixture("ig-container-created"))],
      [isStatus, () => json(fixture("ig-status-finished"))],
      [isPublish, () => json(fixture("ig-publish"))],
      [isPermalink, () => json(fixture("ig-media-permalink"))],
    ]);
    const result = await createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish({ ...samplePost, trial: { graduationStrategy: "SS_PERFORMANCE" } });
    expect(result.trialFellBack).toBe(false);
    expect(r.calls.filter((c) => isCreate(c.url, { method: c.method }))).toHaveLength(1);
  });

  it("a non-trial container rejection is a retryable PlatformRequestError, not a fallback", async () => {
    const r = router([[isCreate, () => json(fixture("ig-container-rejected"), 400)]]);
    await expect(createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish(samplePost)).rejects.toMatchObject({ name: "PlatformRequestError", status: 400 });
  });

  it("container ERROR → plain Error (retry makes a fresh container); never calls media_publish", async () => {
    const r = router([
      [isCreate, () => json(fixture("ig-container-created"))],
      [isStatus, () => json(fixture("ig-status-error"))],
    ]);
    await expect(createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish(samplePost)).rejects.toThrow(/ERROR/);
    expect(r.calls.some((c) => isPublish(c.url))).toBe(false);
  });

  it("still IN_PROGRESS after maxPolls → Error, no publish", async () => {
    const r = router([
      [isCreate, () => json(fixture("ig-container-created"))],
      [isStatus, () => json(fixture("ig-status-in-progress"))],
    ]);
    await expect(createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish(samplePost)).rejects.toThrow(/still IN_PROGRESS after 3 polls/);
    expect(r.calls.filter((c) => isStatus(c.url))).toHaveLength(4);
    expect(r.calls.some((c) => isPublish(c.url))).toBe(false);
  });

  it("refuses more than 5 hashtags before any network call (NonRetryable)", async () => {
    const r = router([]);
    await expect(createInstagramAdapter({ ...cfg, fetch: r.fetch }).publish({ ...samplePost, caption: "x #a #b #c #d #e #f" })).rejects.toMatchObject({ name: "NonRetryableError" });
    expect(r.calls).toHaveLength(0);
  });

  it("network failure propagates as a TypeError (the engine records unknown)", async () => {
    const adapter = createInstagramAdapter({ ...cfg, fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(adapter.publish(samplePost)).rejects.toBeInstanceOf(TypeError);
  });

  it("findExisting matches a recent media by caption, else null", async () => {
    const r = router([[isList, () => json(fixture("ig-media-list"))]]);
    const adapter = createInstagramAdapter({ ...cfg, fetch: r.fetch });
    expect(await adapter.findExisting!(samplePost)).toEqual({ platformPostId: "17944070922377356", platformPostUrl: "https://www.instagram.com/reel/ABC123/" });
    expect(await adapter.findExisting!({ ...samplePost, caption: "something else" })).toBeNull();
    // Same caption but far from scheduled_for: not ours.
    expect(await adapter.findExisting!({ ...samplePost, scheduledFor: "2026-12-10T09:00:00Z" })).toBeNull();
  });
});
