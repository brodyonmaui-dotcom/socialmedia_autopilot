import { classifyFailure, decideAfterAttempt, DEFAULT_CADENCE, runOutboxTick, type OutboxPost, type OutboxStore, type PublishResult } from "@autopilot/core";
import { describe, expect, it } from "vitest";
import { createYouTubeAdapter } from "../youtube.js";
import { PlatformRequestError } from "../http.js";
import { fixture, hasLocationKey, json, router, samplePost, type Route } from "./helpers.js";

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

  // F7 A4: once bytes may have landed the outcome is unknown; the engine never resends a timeout-class error.
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

});

// F13 T3: title match on the owner's uploads playlist (fixtures in the discovery-document shape, fake ids).
describe("YouTube findExisting", () => {
  const isChannels = (u: string) => u.startsWith("https://www.googleapis.com/youtube/v3/channels?");
  const isItems = (u: string) => u.startsWith("https://www.googleapis.com/youtube/v3/playlistItems?");
  const lookup = (items: () => Response = () => json(fixture("yt-uploads-playlist")), channels: () => Response = () => json(fixture("yt-channels-mine"))) => {
    const routes: Route[] = [
      [isToken, () => json(fixture("yt-token"))],
      [isChannels, channels],
      [isItems, items],
    ];
    const r = router(routes);
    return { r, adapter: createYouTubeAdapter({ ...cfg, fetch: r.fetch }) };
  };
  const hit = { platformPostId: "fakeVid0001", platformPostUrl: "https://www.youtube.com/watch?v=fakeVid0001" };

  it("a title match uploaded inside the window returns the video (same URL shape as publish)", async () => {
    const { r, adapter } = lookup();
    expect(await adapter.findExisting!(post)).toEqual(hit);
    expect(r.calls.find((c) => isChannels(c.url))!.url).toBe("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true");
    expect(r.calls.find((c) => isItems(c.url))!.url).toBe("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&playlistId=UUfakeChannelId000000000&maxResults=25");
  });

  it("falls back to the caption's first line when the post has no title (same as publish)", async () => {
    const { adapter } = lookup();
    expect(await adapter.findExisting!({ ...post, title: undefined })).toEqual(hit);
  });

  it("a different title → null", async () => {
    const { adapter } = lookup();
    expect(await adapter.findExisting!({ ...post, title: "Something else entirely" })).toBeNull();
    expect(await adapter.findExisting!({ ...post, title: "   " })).toBeNull();
  });

  it("same title outside [scheduledFor − 14 d, scheduledFor + 36 h] of upload time → null", async () => {
    const { adapter } = lookup();
    // Uploaded 2026-11-30T08:12Z: 15+ days before this scheduledFor…
    expect(await adapter.findExisting!({ ...post, scheduledFor: "2026-12-15T09:00:00Z" })).toBeNull();
    // …and 47 h after this one.
    expect(await adapter.findExisting!({ ...post, scheduledFor: "2026-11-28T09:00:00Z" })).toBeNull();
    // Edges inside the window still match.
    expect(await adapter.findExisting!({ ...post, scheduledFor: "2026-12-14T08:00:00Z" })).toEqual(hit);
    expect(await adapter.findExisting!({ ...post, scheduledFor: "2026-11-28T21:00:00Z" })).toEqual(hit);
  });

  it("titles compare normalised: case, whitespace runs, Unicode form (NFC vs NFD)", async () => {
    const { adapter } = lookup();
    const nfc = { ...post, title: "café pull  DAY".normalize("NFC"), scheduledFor: "2026-11-30T09:00:00Z" };
    expect(await adapter.findExisting!(nfc)).toEqual({ platformPostId: "fakeVid0002", platformPostUrl: "https://www.youtube.com/watch?v=fakeVid0002" });
    expect(await adapter.findExisting!({ ...post, title: "  my LATS are not a fan\nof this pull day…  " })).toEqual(hit);
    expect(await adapter.findExisting!({ ...nfc, title: "Cafe pull day" })).toBeNull(); // no accent folding
  });

  it("non-2xx or malformed responses throw PlatformRequestError, never null", async () => {
    const cases: Array<ReturnType<typeof lookup>> = [
      lookup(() => json({ error: { message: "backendError", errors: [{ reason: "backendError" }] } }, 500)),
      lookup(() => json({ error: { message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }, 403)),
      lookup(() => new Response("<html>Bad Gateway</html>", { status: 200, headers: { "content-type": "text/html" } })),
      lookup(() => json({ kind: "youtube#playlistItemListResponse" })),
      lookup(undefined, () => json({ error: { message: "backendError" } }, 503)),
      lookup(undefined, () => json({ kind: "youtube#channelListResponse", items: [] })),
      lookup(() => json({ items: [{ snippet: { title: post.title, resourceId: { videoId: "fakeVid0009" } } }] })), // title match, no upload time
    ];
    for (const { adapter } of cases) {
      const err = await adapter.findExisting!(post).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformRequestError);
      expect((err as Error).message).toContain("existence check");
    }
  });

  it("issues only GETs to the YouTube API (the one POST is the OAuth token refresh) and sends no location fields", async () => {
    const { r, adapter } = lookup();
    await adapter.findExisting!(post);
    await adapter.findExisting!({ ...post, title: "Something else entirely" });
    const api = r.calls.filter((c) => !isToken(c.url));
    expect(api.length).toBeGreaterThan(0);
    expect(api.every((c) => c.method === "GET" && c.body === undefined)).toBe(true);
    expect(r.calls.filter((c) => c.method !== "GET").every((c) => isToken(c.url))).toBe(true);
    expect(r.calls.some((c) => /recordingDetails/i.test(c.url) || hasLocationKey(c.json))).toBe(false);
  });

  it("caches the uploads playlist id per adapter instance (channels.list once, not per lookup)", async () => {
    const { r, adapter } = lookup();
    await adapter.findExisting!(post);
    await adapter.findExisting!(post);
    await adapter.findExisting!({ ...post, title: "x" });
    expect(r.calls.filter((c) => isChannels(c.url))).toHaveLength(1);
    expect(r.calls.filter((c) => isItems(c.url))).toHaveLength(3);
  });

  it("does not cache a failed channels lookup", async () => {
    let n = 0;
    const { r, adapter } = lookup(undefined, () => (n++ === 0 ? json({ error: { message: "backendError" } }, 500) : json(fixture("yt-channels-mine"))));
    await expect(adapter.findExisting!(post)).rejects.toBeInstanceOf(PlatformRequestError);
    expect(await adapter.findExisting!(post)).toEqual(hit);
    expect(r.calls.filter((c) => isChannels(c.url))).toHaveLength(2);
  });

  describe("engine (runOutboxTick) with the real adapter", () => {
    const now = new Date("2026-11-30T09:30:00Z");
    function oneRowStore(row: OutboxPost) {
      const state = { row: { ...row }, publishedWith: undefined as PublishResult | undefined };
      const set = (patch: Partial<OutboxPost>) => (state.row = { ...state.row, ...patch });
      const store: OutboxStore = {
        listDue: async () => (state.row.status === "approved" || state.row.status === "queued" ? [{ ...state.row }] : []),
        listStale: async () => [],
        claim: async () => (state.row.status === "queued" || state.row.status === "approved" ? (set({ status: "publishing" }), true) : false),
        markPublished: async (_id, result, attempts) => {
          state.publishedWith = result;
          set({ status: "published", attempts, platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl });
        },
        markQueued: async (_id, attempts, nextAttemptAt, error) => void set({ status: "queued", attempts, nextAttemptAt, lastError: error }),
        markFailed: async (_id, attempts, error) => void set({ status: "failed", attempts, lastError: error }),
        markUnknown: async (_id, attempts, error) => void set({ status: "unknown", attempts, lastError: error }),
        countSentOn: async () => 0,
        recordAlert: async () => true,
      };
      return { state, store };
    }
    const engineCfg = (fetchImpl: ReturnType<typeof router>["fetch"]) => ({
      adapters: { youtube: createYouTubeAdapter({ ...cfg, fetch: fetchImpl }) },
      dryRun: false,
      cadence: DEFAULT_CADENCE,
      timeZone: "UTC",
      now: () => now,
    });
    const queued: OutboxPost = { ...post, status: "queued", attempts: 1 };

    it("attempts > 0 + lookup hit → published, no second upload", async () => {
      const r = router([
        [isToken, () => json(fixture("yt-token"))],
        [isChannels, () => json(fixture("yt-channels-mine"))],
        [isItems, () => json(fixture("yt-uploads-playlist"))],
      ]); // no upload route: a publish() would throw "unexpected fetch"
      const { state, store } = oneRowStore(queued);
      const res = await runOutboxTick(store, engineCfg(r.fetch));
      expect(res).toMatchObject({ published: 1, recovered: 1 });
      expect(state.row).toMatchObject({ status: "published", attempts: 1, platformPostId: "fakeVid0001" });
      expect(r.calls.some((c) => isInit(c.url) || c.method === "PUT")).toBe(false);
    });

    it("attempts > 0 + lookup error → re-queued (never resent)", async () => {
      const r = router([
        [isToken, () => json(fixture("yt-token"))],
        [isChannels, () => json(fixture("yt-channels-mine"))],
        [isItems, () => json({ error: { message: "backendError" } }, 500)],
      ]);
      const { state, store } = oneRowStore(queued);
      await runOutboxTick(store, engineCfg(r.fetch));
      expect(state.row).toMatchObject({ status: "queued", attempts: 2 });
      expect(r.calls.some((c) => isInit(c.url))).toBe(false);
    });
  });
});
