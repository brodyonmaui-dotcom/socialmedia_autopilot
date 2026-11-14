import { describe, expect, it } from "vitest";
import { EMPTY_METRICS, type PostRecord, type Recommendation } from "@autopilot/analytics";
import {
  compact,
  heroLines,
  isoWeekOf,
  lastCompleteWeek,
  overallWeekOverWeek,
  platformShare,
  rangeLabel,
  recRows,
  roundTo100,
  topInsight,
  trialMeta,
  weekTotals,
  weeklyViews,
} from "../view.js";

const post = (over: Partial<PostRecord> & { postedAt: string }, m: Partial<PostRecord["metrics"]> = {}): PostRecord => ({
  batchItemId: Math.random().toString(36).slice(2),
  platform: "instagram",
  pillar: null,
  caption: "Hook",
  durationS: 20,
  isTrial: false,
  trialSharedAt: null,
  capturedAt: null,
  ...over,
  metrics: { ...EMPTY_METRICS, ...m },
});

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  platform: "instagram",
  kind: "more",
  text: "t",
  dimension: "hook",
  group: "question",
  n: 4,
  lift: 1.5,
  ...over,
});

describe("weeks", () => {
  it("lastCompleteWeek is the Monday before this week", () => {
    expect(lastCompleteWeek(new Date("2026-11-14T12:00:00Z"))).toBe("2026-11-02");
    expect(lastCompleteWeek(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-02");
  });
  it("isoWeekOf handles year edges", () => {
    expect(isoWeekOf("2026-11-02")).toBe(45);
    expect(isoWeekOf("2026-01-01")).toBe(1);
    expect(isoWeekOf("2027-01-01")).toBe(53);
    expect(isoWeekOf("2024-12-30")).toBe(1);
  });
  it("rangeLabel shows an inclusive end", () => {
    expect(rangeLabel("2026-11-02", "2026-11-09")).toBe("2026-11-02 → 11-08");
    expect(rangeLabel("2026-12-28", "2027-01-04")).toBe("2026-12-28 → 2027-01-03");
  });
});

describe("compact", () => {
  it("keeps small numbers exact and shortens big ones", () => {
    expect(compact(null)).toBe("n/a");
    expect(compact(9999)).toBe("9,999");
    expect(compact(12_449)).toBe("12.4K");
    expect(compact(40_000)).toBe("40K");
    expect(compact(1_250_000)).toBe("1.3M");
  });
});

describe("weekTotals", () => {
  it("sums the report week only and keeps missing metrics as null", () => {
    const posts = [
      post({ postedAt: "2026-11-02T10:00:00Z" }, { views: 100, likes: 10 }),
      post({ postedAt: "2026-11-08T23:00:00Z" }, { views: 50, likes: null }),
      post({ postedAt: "2026-11-09T00:00:00Z" }, { views: 999 }),
    ];
    expect(weekTotals(posts, "2026-11-02")).toEqual({ posts: 2, views: 150, likes: 10, comments: null, shares: null });
  });
});

describe("weeklyViews", () => {
  it("buckets by week, drops leading empty weeks, labels with ISO weeks", () => {
    const posts = [
      post({ postedAt: "2026-10-27T10:00:00Z" }, { views: 30 }),
      post({ postedAt: "2026-11-03T10:00:00Z" }, { views: 70 }),
      post({ postedAt: "2026-11-04T10:00:00Z" }, { views: null }),
    ];
    expect(weeklyViews(posts, "2026-11-02")).toEqual([
      { weekStart: "2026-10-26", label: "W44", views: 30, posts: 1 },
      { weekStart: "2026-11-02", label: "W45", views: 70, posts: 2 },
    ]);
  });
  it("keeps two points even with no data", () => {
    expect(weeklyViews([], "2026-11-02").map((w) => w.views)).toEqual([0, 0]);
  });
});

describe("platformShare", () => {
  it("ranks by posts, accent first, percentages sum to 100", () => {
    const segs = platformShare({
      platforms: [
        { platform: "instagram", posts: 1, withMetrics: 1, views: 1, prevViews: null, weekOverWeek: null, top: [] },
        { platform: "youtube", posts: 1, withMetrics: 1, views: 1, prevViews: null, weekOverWeek: null, top: [] },
        { platform: "tiktok", posts: 2, withMetrics: 1, views: 1, prevViews: null, weekOverWeek: null, top: [] },
        { platform: "snapchat", posts: 0, withMetrics: 0, views: null, prevViews: null, weekOverWeek: null, top: [] },
      ],
    });
    expect(segs.map((s) => [s.label, s.tone, s.pct])).toEqual([
      ["TikTok", "accent", 50],
      ["Instagram", "hi", 25],
      ["YouTube", "gray1", 25],
    ]);
  });
  it("roundTo100 uses largest remainders", () => {
    expect(roundTo100([33.3, 33.3, 33.4])).toEqual([33, 33, 34]);
    expect(roundTo100([0, 0])).toEqual([0, 0]);
  });
});

describe("overallWeekOverWeek", () => {
  it("divides summed views and is null without a previous week", () => {
    const pw = (views: number | null, prevViews: number | null) => ({ platform: "instagram" as const, posts: 1, withMetrics: 1, views, prevViews, weekOverWeek: null, top: [] });
    expect(overallWeekOverWeek({ platforms: [pw(150, 100), pw(50, 100)] })).toBe(1);
    expect(overallWeekOverWeek({ platforms: [pw(150, null)] })).toBeNull();
  });
});

describe("recommendations", () => {
  it("rows carry the sample size and direction", () => {
    expect(recRows([rec(), rec({ kind: "less", dimension: "length", group: "long", lift: 0.6, n: 3, platform: "youtube" })])).toEqual([
      { key: "t", platform: "instagram", title: "“question” hooks", meta: "Instagram · n=4 · hook", lift: "×1.50", direction: "up", action: "Do more" },
      { key: "t", platform: "youtube", title: "Long videos", meta: "YouTube · n=3 · length", lift: "×0.60", direction: "down", action: "Rework" },
    ]);
  });
  it("topInsight reads the strongest one, or null", () => {
    expect(topInsight([])).toBeNull();
    expect(topInsight([rec({ dimension: "pillar", group: "tutorial" })])).toEqual({
      text: "Tutorial posts got ×1.50 your median views on Instagram.",
      source: "Top insight · n=4 · last 28 days · correlation, not cause",
    });
  });
  it("trialMeta keeps n/a for missing views", () => {
    expect(trialMeta({ ageHours: 30, views: 1234, viewsVsBaseline: 1.2 })).toBe("30 h · 1,234 views · ×1.20 baseline");
    expect(trialMeta({ ageHours: 5, views: null, viewsVsBaseline: null })).toBe("5 h · n/a views");
  });
});

describe("heroLines", () => {
  it("stroke week, serif word, solid views", () => {
    expect(heroLines("2026-11-02", 48_213)).toEqual([
      { text: "WEEK 45", style: "stroke" },
      { text: "in review", style: "serif" },
      { text: "48.2K", style: "solid" },
    ]);
  });
});
