import { describe, expect, it } from "vitest";
import type { AccountDailyRow, AccountPostRecord, AccountSnapshotRow } from "@autopilot/analytics";
import { buildOverview, dateRange, kpi, postTitle, type AccountData } from "../overview.js";
import { buildPlatform } from "../platform.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const TZ = "UTC";
let n = 0;
function post(over: Partial<AccountPostRecord> & { views?: number }): AccountPostRecord {
  const { views, ...rest } = over;
  const id = `p${++n}`;
  return {
    id,
    platform: "instagram",
    platformPostId: id,
    permalink: `https://www.instagram.com/reel/${id}/`,
    kind: "reels",
    caption: "Leg day #gym",
    title: null,
    publishedAt: "2026-11-14T18:00:00Z",
    durationS: 20,
    batchItemId: null,
    mediaId: null,
    matchedBy: null,
    pillar: null,
    capturedAt: "2026-11-16T00:00:00Z",
    ...rest,
    metrics: { views: views ?? 100, likes: 8, comments: 1, shares: 1, saves: null, reach: null, avgWatchS: null },
  };
}
const snap = (p: AccountPostRecord, capturedAt: string, views: number): AccountSnapshotRow => ({ accountPostId: p.id, capturedAt, views });
const daily = (platform: AccountDailyRow["platform"], capturedOn: string, followers: number): AccountDailyRow => ({ platform, capturedOn, followers, totalViews: null, postsCount: null });

describe("overview builder", () => {
  it("ranges are local days, inclusive, with the previous range of the same length", () => {
    expect(dateRange(7, NOW, TZ)).toEqual({ days: 7, from: "2026-11-10", to: "2026-11-16", previousFrom: "2026-11-03", previousTo: "2026-11-09" });
    expect(kpi(120, 100)).toEqual({ value: 120, previous: 100, delta: 20, deltaPct: expect.closeTo(0.2) });
    expect(kpi(5, null)).toMatchObject({ delta: null, deltaPct: null });
  });

  it("per-day views from snapshot differences; one snapshot → the publish day", () => {
    const a = post({ publishedAt: "2026-11-12T18:00:00Z", views: 450 });
    const b = post({ platform: "youtube", publishedAt: "2026-11-14T10:00:00Z", views: 70, permalink: "https://www.youtube.com/watch?v=x" });
    const data: AccountData = {
      posts: [a, b],
      snapshots: [snap(a, "2026-11-13T06:00:00Z", 300), snap(a, "2026-11-15T06:00:00Z", 450), snap(b, "2026-11-16T06:00:00Z", 70)],
      daily: [],
    };
    const o = buildOverview(data, { days: 7, timeZone: TZ, now: NOW });
    const byDate = Object.fromEntries(o.viewsPerDay.map((d) => [d.date, d]));
    expect(o.viewsPerDay).toHaveLength(7);
    expect(byDate["2026-11-12"]).toEqual({ date: "2026-11-12", instagram: 300, youtube: 0, tiktok: null, snapchat: null });
    expect(byDate["2026-11-15"]!.instagram).toBe(150);
    expect(byDate["2026-11-14"]!.youtube).toBe(70);
    expect(o.kpis.views).toMatchObject({ value: 520, previous: null });
  });

  it("KPIs: posts, engagement and followers with deltas; null when unknown", () => {
    const cur = [post({ views: 100 }), post({ views: 300 })];
    const prev = [post({ publishedAt: "2026-11-05T10:00:00Z", views: 100 })];
    const data: AccountData = {
      posts: [...cur, ...prev],
      snapshots: [],
      daily: [daily("instagram", "2026-11-09", 1000), daily("instagram", "2026-11-16", 1030), daily("youtube", "2026-11-15", 300)],
    };
    const o = buildOverview(data, { days: 7, timeZone: TZ, now: NOW });
    expect(o.kpis.posts).toMatchObject({ value: 2, previous: 1, delta: 1 });
    expect(o.kpis.engagementRate.value).toBeCloseTo(20 / 400);
    expect(o.kpis.engagementRate.previous).toBeCloseTo(10 / 100);
    expect(o.kpis.followers).toMatchObject({ value: 1330, previous: 1000, delta: 330 });
    expect(o.kpis.views.value).toBeNull(); // no snapshots → unknown, not 0
    expect(buildOverview({ posts: [], snapshots: [], daily: [] }, { days: 7, timeZone: TZ, now: NOW }).kpis).toMatchObject({ posts: { value: null }, followers: { value: null } });
  });

  it("top posts: by views, with byHand and the matched clip", () => {
    const hand = post({ views: 900, caption: "Why your bench stalls? #gym" });
    const app = post({ views: 400, batchItemId: "bi1", mediaId: "m1", matchedBy: "id" });
    const o = buildOverview({ posts: [app, hand], snapshots: [], daily: [] }, { days: 7, timeZone: TZ, now: NOW });
    expect(o.topPosts.map((t) => [t.accountPostId, t.byHand, t.mediaId])).toEqual([
      [hand.id, true, null],
      [app.id, false, "m1"],
    ]);
    expect(o.topPosts[0]!.title).toBe("Why your bench stalls?");
    expect(o.topPosts[0]!.engagementRate).toBeCloseTo(10 / 900);
  });

  it("platform cards: TikTok and Snapchat say why they aren't collected", () => {
    const o = buildOverview({ posts: [post({})], snapshots: [], daily: [] }, { days: 7, timeZone: TZ, now: NOW });
    expect(o.platforms.map((p) => [p.platform, p.collected])).toEqual([
      ["instagram", true],
      ["youtube", true],
      ["tiktok", false],
      ["snapchat", false],
    ]);
    expect(o.platforms[2]!.reason).toMatch(/free plan/);
    expect(o.platforms[0]).toMatchObject({ posts: 1, medianViews: 100 });
  });

  it("findings cover 60 days of posts, and return 'insufficient' with n when there are too few", () => {
    const posts = Array.from({ length: 3 }, () => post({ durationS: 10 }));
    const o = buildOverview({ posts, snapshots: [], daily: [] }, { days: 7, timeZone: TZ, now: NOW });
    expect(o.findingsDays).toBe(60);
    expect(o.findings.length).toBeGreaterThan(0);
    expect(o.findings.every((f) => f.status === "insufficient")).toBe(true);
    expect(o.findings[0]!.text).toMatch(/not enough posts yet \(n = 3/);
  });

  it("postTitle falls back to the caption's first line", () => {
    expect(postTitle({ title: null, caption: "Pull day…\nmore #gym" })).toBe("Pull day…");
    expect(postTitle({ title: "  ", caption: null })).toBe("(no caption)");
  });
});

describe("platform builder", () => {
  it("TikTok → { collected: false, reason }", () => {
    expect(buildPlatform("tiktok", { posts: [], snapshots: [], daily: [] }, { days: 30, timeZone: TZ, now: NOW })).toEqual({
      collected: false,
      platform: "tiktok",
      reason: expect.stringMatching(/aren't collected on the free plan/),
    });
  });

  it("followers series, posts table, best hours (≥ 5 posts per bucket)", () => {
    const evening = Array.from({ length: 5 }, () => post({ publishedAt: "2026-11-14T19:00:00Z", views: 500 }));
    const morning = Array.from({ length: 5 }, () => post({ publishedAt: "2026-11-14T08:00:00Z", views: 100 }));
    const yt = post({ platform: "youtube", views: 9999 });
    const v = buildPlatform("instagram", { posts: [...evening, ...morning, yt], snapshots: [], daily: [daily("instagram", "2026-11-15", 1010), daily("youtube", "2026-11-15", 5)] }, { days: 7, timeZone: TZ, now: NOW });
    if (!v.collected) throw new Error("expected collected");
    expect(v.followers.find((f) => f.date === "2026-11-15")!.followers).toBe(1010);
    expect(v.followers.find((f) => f.date === "2026-11-16")!.followers).toBeNull();
    expect(v.posts).toHaveLength(10);
    expect(v.posts.every((p) => p.byHand && p.pillar === "gym")).toBe(true);
    const ev = v.bestHours.find((h) => h.bucket === "evening")!;
    expect(ev).toMatchObject({ n: 5, medianViews: 500, status: "ok", best: true, label: "18–22 h" });
    expect(v.bestHours.find((h) => h.bucket === "midday")).toMatchObject({ n: 0, status: "insufficient", best: false });
    expect(v.findings.find((f) => f.key === "instagram:hour:evening")).toMatchObject({ status: "ok", direction: "up" });
    expect(v.findings.some((f) => f.platform !== "instagram")).toBe(false);
  });
});
