import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createInstagramMetricsSource,
  createYouTubeMetricsSource,
  createZernioTikTokMetricsSource,
  type FetchLike,
} from "../sources.js";

const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

/** Fake fetch: routes by URL, records calls, never touches the network. */
function fakeFetch(route: (url: string) => { status: number; body: unknown }) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = route(url);
    return { status: r.status, json: async () => r.body };
  };
  return { fetch, calls };
}

/** The documented insights envelope for any metric, with a given value. */
function insight(metric: string, value: number) {
  const base = fx("ig-insight-views.json") as { data: Array<Record<string, unknown>> };
  return { data: [{ ...base.data[0], name: metric, values: [{ value }] }] };
}

describe("createInstagramMetricsSource", () => {
  const values: Record<string, number> = {
    views: 1532, reach: 1100, saved: 14, shares: 6, ig_reels_avg_watch_time: 4210,
    ig_reels_video_view_total_time: 6450000, reels_skip_rate: 38, reposts: 1,
  };
  const route = (url: string) => {
    const m = url.match(/insights\?metric=(\w+)/);
    if (m) return { status: 200, body: insight(m[1]!, values[m[1]!]!) };
    return { status: 200, body: fx("ig-media-fields.json") };
  };

  it("maps the documented envelope (data[].values[0].value) and media fields", async () => {
    const { fetch, calls } = fakeFetch(route);
    const m = await createInstagramMetricsSource({ accessToken: "tok", fetch }).fetch("17944070922377356");
    expect(m).toEqual({ views: 1532, reach: 1100, likes: 87, comments: 9, saves: 14, shares: 6, avgWatchTime: 4210, skipRate: 38 });
    expect(calls).toHaveLength(9); // 8 metrics, one request each, + fields
    expect(calls.every((c) => !c.url.includes("tok") && c.headers.Authorization === "Bearer tok")).toBe(true);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/17944070922377356/insights?metric=views");
  });

  it("one rejected metric → that field is null, the rest still land", async () => {
    const { fetch } = fakeFetch((url) => (url.includes("metric=reels_skip_rate") ? { status: 400, body: fx("ig-error-metric.json") } : route(url)));
    const m = await createInstagramMetricsSource({ accessToken: "t", fetch }).fetch("1");
    expect(m.skipRate).toBeNull();
    expect(m.views).toBe(1532);
  });

  it("hidden like count (field omitted) reads null, never 0", async () => {
    const { fetch } = fakeFetch((url) => (url.includes("fields=") ? { status: 200, body: { comments_count: 2, id: "1" } } : route(url)));
    const m = await createInstagramMetricsSource({ accessToken: "t", fetch }).fetch("1");
    expect(m.likes).toBeNull();
    expect(m.comments).toBe(2);
  });

  it("falls back to total_value.value when values is absent", async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes("metric=views") ? { status: 200, body: { data: [{ name: "views", period: "lifetime", total_value: { value: 77 } }] } } : route(url),
    );
    expect((await createInstagramMetricsSource({ accessToken: "t", fetch }).fetch("1")).views).toBe(77);
  });

  it("every metric failing fails the snapshot (so nothing is written); bad ids are refused", async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: fx("ig-error-metric.json") }));
    const src = createInstagramMetricsSource({ accessToken: "t", fetch });
    await expect(src.fetch("1")).rejects.toThrow(/HTTP 400 code 100/);
    await expect(src.fetch("../me")).rejects.toThrow(/numeric/);
  });
});

describe("createYouTubeMetricsSource", () => {
  it("parses string counts from statistics; watch time stays null (Analytics API)", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: fx("yt-videos-statistics.json") }));
    const m = await createYouTubeMetricsSource({ accessToken: "t", fetch }).fetch("dQw4w9WgXcQ");
    expect(m).toEqual({ views: 2410, reach: null, likes: 131, comments: 12, saves: null, shares: null, avgWatchTime: null, skipRate: null });
    expect(calls[0]!.url).toBe("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=dQw4w9WgXcQ");
  });

  it("hidden like count → null; missing video → throws", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: { items: [{ id: "abcdefghijk", statistics: { viewCount: "5", commentCount: "0" } }] } }));
    const src = createYouTubeMetricsSource({ accessToken: "t", fetch });
    expect((await src.fetch("abcdefghijk")).likes).toBeNull();
    await expect(src.fetch("zzzzzzzzzzz")).rejects.toThrow(/not found/);
  });
});

describe("createZernioTikTokMetricsSource", () => {
  it("reads the tiktok platformAnalytics entry; undocumented fields (reach/saves, 0 watch time) stay null", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: fx("zernio-analytics-post.json") }));
    const m = await createZernioTikTokMetricsSource({ apiKey: "k", fetch }).fetch("6731c0ffee0000000000abcd");
    expect(m).toEqual({ views: 980, reach: null, likes: 44, comments: 3, saves: null, shares: 2, avgWatchTime: null, skipRate: null });
    expect(calls[0]!.url).toBe("https://zernio.com/api/v1/analytics?postId=6731c0ffee0000000000abcd");
    expect(calls[0]!.headers.Authorization).toBe("Bearer k");
  });

  it("202 (syncing) and 402 (add-on required) throw, so the next pass retries", async () => {
    const pending = fakeFetch(() => ({ status: 202, body: { syncStatus: "pending" } }));
    await expect(createZernioTikTokMetricsSource({ apiKey: "k", fetch: pending.fetch }).fetch("p1")).rejects.toThrow(/syncing/);
    const paywall = fakeFetch(() => ({ status: 402, body: fx("zernio-402.json") }));
    await expect(createZernioTikTokMetricsSource({ apiKey: "k", fetch: paywall.fetch }).fetch("p1")).rejects.toThrow(/402 Analytics add-on required/);
  });
});
