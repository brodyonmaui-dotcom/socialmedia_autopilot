import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../sources.js";
import { fetchInstagramAccount, parseInstagramMedia, parseInsights } from "../sources/instagram-account.js";
import { fetchYouTubeAccount, parseIsoDuration, parseYouTubeChannel } from "../sources/youtube-account.js";
import { stripMentions } from "../sources/common.js";

const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/account/${name}`, import.meta.url), "utf8"));
const NOW = new Date("2026-11-16T12:00:00Z");

function fakeFetch(route: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    headers.push(init.headers);
    const r = route(url);
    return { status: r.status, json: async () => r.body };
  };
  return { fetch, calls, headers };
}

const IG = { accessToken: "tok", igUserId: "17841400000000001" };

function igRoute(over: (url: string) => { status: number; body: unknown } | null = () => null) {
  return (url: string) => {
    const o = over(url);
    if (o) return o;
    if (/\/17841400000000001\?fields=followers_count,media_count$/.test(url)) return { status: 200, body: fx("ig-user.json") };
    if (url.includes("/media?") && url.includes("after=QVFIUAFTER1")) return { status: 200, body: fx("ig-media-page2.json") };
    if (url.includes("/media?")) return { status: 200, body: fx("ig-media-page1.json") };
    if (url.includes("18000000000000003/insights?metric=views,")) return { status: 400, body: fx("ig-error-unsupported.json") };
    if (url.includes("18000000000000003/insights?metric=views")) return { status: 200, body: fx("ig-insights-views-only.json") };
    if (url.includes("/insights?")) return { status: 200, body: fx("ig-insights-reel.json") };
    return { status: 404, body: {} };
  };
}

describe("instagram account source", () => {
  it("parses media items without media URLs, location or other people's handles", () => {
    const p = parseInstagramMedia((fx("ig-media-page1.json") as { data: unknown[] }).data[1])!;
    expect(p).toMatchObject({ platformPostId: "18000000000000002", kind: "reels", publishedAt: "2026-11-12T18:30:00.000Z", durationS: null });
    expect(p.caption).toBe("Leg day with gym_fan_22 @… tagged");
    expect(p.listMetrics.likes).toBeNull(); // like_count omitted (likes hidden) → null, not 0
    expect(p.listMetrics.comments).toBe(0);
    expect(stripMentions("hi @a.b_c and @d")).toBe("hi @… and @…");
  });

  it("parses the insights envelope", () => {
    expect(parseInsights(fx("ig-insights-reel.json"))).toMatchObject({ views: 1532, reach: 1100, saved: 14, shares: 6, ig_reels_avg_watch_time: 4210 });
  });

  it("pages by cursor, stops at 60 days, reads account totals and per-item insights", async () => {
    const { fetch, calls, headers } = fakeFetch(igRoute());
    const r = await fetchInstagramAccount({ ...IG, fetch }, { now: NOW, includeAccount: true });
    expect(r.stoppedBy).toBeNull();
    expect(r.account).toEqual({ followers: 142, totalViews: null, postsCount: 61 });
    expect(r.posts.map((p) => p.platformPostId)).toEqual(["18000000000000001", "18000000000000002", "18000000000000003", "18000000000000004"]);
    const first = r.posts[0]!;
    expect(first.metrics).toEqual({ views: 1532, reach: 1100, saves: 14, shares: 6, likes: 41, comments: 3, avgWatchS: 4.21 });
    expect(calls.some((u) => /media_url|thumbnail|location/.test(u))).toBe(false);
    expect(calls.every((u) => !u.includes("tok"))).toBe(true);
    expect(headers.every((h) => h.Authorization === "Bearer tok")).toBe(true);
    expect(calls.filter((u) => u.includes("/media?"))).toHaveLength(2); // page 2 holds the cutoff
  });

  it("a metric not supported for one media type doesn't fail the run (retry with views alone)", async () => {
    const { fetch } = fakeFetch(igRoute());
    const r = await fetchInstagramAccount({ ...IG, fetch }, { now: NOW, includeAccount: false });
    const feed = r.posts.find((p) => p.platformPostId === "18000000000000003")!;
    expect(feed.kind).toBe("feed");
    expect(feed.metrics).toEqual({ views: 220, reach: null, saves: null, shares: null, likes: 9, comments: 1, avgWatchS: null });
    expect(r.account).toBeNull();
  });

  it("a rate limit ends the run cleanly and keeps partial data", async () => {
    const { fetch, calls } = fakeFetch(igRoute((u) => (u.includes("18000000000000002/insights") ? { status: 400, body: fx("ig-error-rate-limit.json") } : null)));
    const r = await fetchInstagramAccount({ ...IG, fetch }, { now: NOW, includeAccount: true });
    expect(r.stoppedBy).toBe("rate-limit");
    expect(r.error).toMatch(/rate limited.*code 4/);
    expect(r.posts).toHaveLength(4);
    expect(r.posts[0]!.metrics?.views).toBe(1532);
    expect(r.posts.slice(1).every((p) => p.metrics === null)).toBe(true);
    expect(calls.filter((u) => u.includes("/insights")).length).toBe(2); // nothing after the 429-equivalent
  });

  it("HTTP 429 also counts as a rate limit", async () => {
    const { fetch } = fakeFetch(igRoute((u) => (u.includes("/media?") ? { status: 429, body: {} } : null)));
    const r = await fetchInstagramAccount({ ...IG, fetch }, { now: NOW, includeAccount: false });
    expect(r).toMatchObject({ stoppedBy: "rate-limit", posts: [] });
  });

  it("the request budget is a hard cap", async () => {
    const { fetch, calls } = fakeFetch(igRoute());
    const r = await fetchInstagramAccount({ ...IG, fetch, maxRequests: 4 }, { now: NOW, includeAccount: true });
    expect(calls).toHaveLength(4);
    expect(r.stoppedBy).toBe("budget");
    expect(r.requests).toBe(4);
    expect(r.posts).toHaveLength(4);
    expect(r.posts.filter((p) => p.metrics !== null)).toHaveLength(1);
  });

  it("stops at maxItems", async () => {
    const { fetch } = fakeFetch(igRoute());
    const r = await fetchInstagramAccount({ ...IG, fetch, maxItems: 2 }, { now: NOW, includeAccount: false });
    expect(r.posts).toHaveLength(2);
  });
});

function ytRoute(over: (url: string) => { status: number; body: unknown } | null = () => null) {
  return (url: string) => {
    const o = over(url);
    if (o) return o;
    if (url.includes("/channels?")) return { status: 200, body: fx("yt-channels-mine.json") };
    if (url.includes("/playlistItems?")) return { status: 200, body: fx("yt-playlist-items.json") };
    if (url.includes("/videos?")) return { status: 200, body: fx("yt-videos-account.json") };
    return { status: 404, body: {} };
  };
}

describe("youtube account source", () => {
  it("parses ISO 8601 durations", () => {
    expect(parseIsoDuration("PT42S")).toBe(42);
    expect(parseIsoDuration("PT1M5S")).toBe(65);
    expect(parseIsoDuration("PT1H")).toBe(3600);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration("PT")).toBeNull();
    expect(parseIsoDuration(42)).toBeNull();
  });

  it("parses channel statistics (strings) and the uploads playlist", () => {
    expect(parseYouTubeChannel(fx("yt-channels-mine.json"))).toEqual({ uploads: "UUaaaaaaaaaaaaaaaaaaaaaa", account: { followers: 312, totalViews: 48210, postsCount: 57 } });
  });

  it("uploads → videos: skips not-yet-public items and anything over 60 days old", async () => {
    const { fetch, calls } = fakeFetch(ytRoute());
    const r = await fetchYouTubeAccount({ accessToken: "t", fetch }, { now: NOW, includeAccount: true });
    expect(r.stoppedBy).toBeNull();
    expect(r.requests).toBe(3); // 3 quota units
    expect(r.posts.map((p) => p.platformPostId)).toEqual(["vidAAAAAAA2", "vidAAAAAAA3"]);
    expect(r.posts[0]).toMatchObject({
      permalink: "https://www.youtube.com/watch?v=vidAAAAAAA2",
      title: "Full push day, every set",
      publishedAt: "2026-11-14T18:00:00.000Z", // playlist videoPublishedAt (go-public), not the upload time
      durationS: 42,
      metrics: { views: 2410, likes: 131, comments: 12, shares: null, saves: null, reach: null, avgWatchS: null },
    });
    expect(r.posts[1]!.metrics?.likes).toBeNull();
    expect(calls.find((u) => u.includes("/videos?"))).toContain("part=snippet,statistics,contentDetails&id=vidAAAAAAA2,vidAAAAAAA3");
    expect(calls.some((u) => /thumbnails|recordingDetails/.test(u))).toBe(false);
  });

  it("quotaExceeded ends the run cleanly", async () => {
    const { fetch } = fakeFetch(ytRoute((u) => (u.includes("/videos?") ? { status: 403, body: fx("yt-quota-exceeded.json") } : null)));
    const r = await fetchYouTubeAccount({ accessToken: "t", fetch }, { now: NOW, includeAccount: true });
    expect(r.stoppedBy).toBe("rate-limit");
    expect(r.account).toMatchObject({ followers: 312 });
    expect(r.posts).toEqual([]);
  });

  it("other errors end the run as 'error'", async () => {
    const { fetch } = fakeFetch(ytRoute((u) => (u.includes("/channels?") ? { status: 401, body: { error: { code: 401, message: "Invalid Credentials" } } } : null)));
    const r = await fetchYouTubeAccount({ accessToken: "t", fetch }, { now: NOW, includeAccount: true });
    expect(r.stoppedBy).toBe("error");
    expect(r.error).toMatch(/HTTP 401/);
  });
});
