import { classifyFailure, decideAfterAttempt } from "@autopilot/core";
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

  it("invalidPublishAt is NonRetryable; any other error once the upload PUT is issued is ambiguous (timeout-class), never retried", async () => {
    const mk = (body: unknown, status: number) =>
      router([
        [isToken, () => json(fixture("yt-token"))],
        [isInit, () => new Response("", { status: 200, headers: { location: "https://upload.example/session123" } })],
        [isMedia, () => new Response("bytes", { status: 200 })],
        [isSession, () => json(body, status)],
      ]);
    await expect(createYouTubeAdapter({ ...cfg, fetch: mk(fixture("yt-upload-invalid-publishat"), 400).fetch }).publish(post)).rejects.toMatchObject({ name: "NonRetryableError" });
    const quota = await createYouTubeAdapter({ ...cfg, fetch: mk({ error: { message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }, 403).fetch }).publish(post).catch((e: unknown) => e);
    expect(quota).toMatchObject({ name: "TimeoutError", status: 403 });
    expect(classifyFailure(quota)).toBe("timeout");
  });

  // F7 A4: YouTube has no findExisting, so a retry after bytes may have landed could double-upload.
  describe("errors after the upload PUT started → unknown (F7 A4)", () => {
    const withSession = (respond: () => Response | Promise<Response>) =>
      router([
        [isToken, () => json(fixture("yt-token"))],
        [isInit, () => new Response("", { status: 200, headers: { location: "https://upload.example/session123" } })],
        [isMedia, () => new Response("bytes", { status: 200 })],
        [isSession, respond],
      ]);
    const failWith = (respond: () => Response | Promise<Response>) => createYouTubeAdapter({ ...cfg, fetch: withSession(respond).fetch }).publish(post).catch((e: unknown) => e);

    it("503 on the PUT classifies as timeout → decideAfterAttempt marks unknown, not queued", async () => {
      const err = await failWith(() => json({ error: { message: "backendError", errors: [{ reason: "backendError" }] } }, 503));
      expect(classifyFailure(err)).toBe("timeout");
      expect(decideAfterAttempt({ kind: "failure", cls: classifyFailure(err) }, 0, new Date("2026-12-01T09:00:00Z")).status).toBe("unknown");
    });

    it("an unparseable PUT response (HTML 502 page) classifies as timeout", async () => {
      const err = await failWith(() => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
      expect(classifyFailure(err)).toBe("timeout");
    });

    it("200 without an id classifies as timeout", async () => {
      expect(classifyFailure(await failWith(() => json({}, 200)))).toBe("timeout");
    });

    it("a non-network throw from the PUT itself classifies as timeout", async () => {
      expect(classifyFailure(await failWith(() => Promise.reject(new Error("stream broke"))))).toBe("timeout");
    });

    it("errors before the PUT keep their classification (session init 4xx → rejected, invalid_grant → permanent)", async () => {
      const r = router([
        [isToken, () => json(fixture("yt-token"))],
        [isInit, () => json({ error: { message: "forbidden" } }, 403)],
      ]);
      const initErr = await createYouTubeAdapter({ ...cfg, fetch: r.fetch }).publish(post).catch((e: unknown) => e);
      expect(classifyFailure(initErr)).toBe("rejected");
      const g = router([[isToken, () => json(fixture("yt-invalid-grant"), 400)]]);
      expect(classifyFailure(await createYouTubeAdapter({ ...cfg, fetch: g.fetch }).publish(post).catch((e: unknown) => e))).toBe("permanent");
    });
  });

  it("has no existence check (documented gap)", () => {
    expect(createYouTubeAdapter(cfg).findExisting).toBeUndefined();
  });
});
