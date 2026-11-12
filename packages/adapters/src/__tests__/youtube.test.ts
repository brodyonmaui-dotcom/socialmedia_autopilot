import { describe, expect, it } from "vitest";
import { createYouTubeAdapter } from "../youtube.js";
import { fixture, hasLocationKey, json, router, samplePost } from "./helpers.js";

const cfg = { clientId: "cid", clientSecret: "secret", refreshToken: "rt" };
const post = { ...samplePost, platform: "youtube" as const, title: "My lats are not a fan of this pull day…" };
const isToken = (u: string) => u.includes("oauth2.googleapis.com/token");
const isInit = (u: string) => u.includes("/upload/youtube/v3/videos");
const isMedia = (u: string) => u === post.mediaUrl;
const isSession = (u: string) => u === "https://upload.example/session123";

describe("createYouTubeAdapter", () => {
  it("refreshes the token, uploads private + publishAt, streams the file, returns the watch URL", async () => {
    const r = router([
      [isToken, () => json(fixture("yt-token"))],
      [isInit, () => new Response("", { status: 200, headers: { location: "https://upload.example/session123" } })],
      [isMedia, () => new Response("fake-bytes", { status: 200, headers: { "content-length": "10" } })],
      [isSession, () => json(fixture("yt-upload-ok"))],
    ]);
    const result = await createYouTubeAdapter({ ...cfg, fetch: r.fetch }).publish(post);
    expect(result).toEqual({ platformPostId: "dQw4w9WgXcQ", platformPostUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    const init = r.calls.find((c) => isInit(c.url))!;
    expect(init.json.status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false, publishAt: "2026-12-01T09:00:00Z" });
    expect(init.json.snippet.title).toBe(post.title);
    expect(hasLocationKey(init.json)).toBe(false); // no recordingDetails, ever
    expect(r.calls.find((c) => isSession(c.url))!.method).toBe("PUT");
    expect(r.calls.find((c) => isToken(c.url))!.body).toContain("grant_type=refresh_token");
  });

  it("invalid_grant on refresh is NonRetryable (the creator must re-run probe:yt)", async () => {
    const r = router([[isToken, () => json(fixture("yt-invalid-grant"), 400)]]);
    await expect(createYouTubeAdapter({ ...cfg, fetch: r.fetch }).publish(post)).rejects.toMatchObject({ name: "NonRetryableError" });
  });

  it("invalidPublishAt is NonRetryable; other upload errors are retryable PlatformRequestErrors", async () => {
    const mk = (body: unknown, status: number) =>
      router([
        [isToken, () => json(fixture("yt-token"))],
        [isInit, () => new Response("", { status: 200, headers: { location: "https://upload.example/session123" } })],
        [isMedia, () => new Response("bytes", { status: 200 })],
        [isSession, () => json(body, status)],
      ]);
    await expect(createYouTubeAdapter({ ...cfg, fetch: mk(fixture("yt-upload-invalid-publishat"), 400).fetch }).publish(post)).rejects.toMatchObject({ name: "NonRetryableError" });
    await expect(createYouTubeAdapter({ ...cfg, fetch: mk({ error: { message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }, 403).fetch }).publish(post)).rejects.toMatchObject({ name: "PlatformRequestError", status: 403 });
  });

  it("has no existence check (documented gap)", () => {
    expect(createYouTubeAdapter(cfg).findExisting).toBeUndefined();
  });
});
