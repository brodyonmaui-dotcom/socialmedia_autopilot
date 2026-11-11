import { describe, expect, it } from "vitest";
import { buildWeeklyReport } from "../report.js";
import { syntheticPosts } from "../seed.js";
import { post } from "./helpers.js";

const opts = { weekStart: "2026-11-02", timeZone: "UTC" };

describe("buildWeeklyReport: totals", () => {
  const posts = [
    post({ views: 100, postedAt: "2026-11-02T10:00:00Z", caption: "A…" }),
    post({ views: 300, postedAt: "2026-11-03T10:00:00Z", caption: "B…" }),
    post({ views: null, postedAt: "2026-11-04T10:00:00Z", caption: "C…" }),
    post({ views: 200, postedAt: "2026-10-28T10:00:00Z", caption: "last week" }),
    post({ platform: "tiktok", views: 50, postedAt: "2026-11-08T23:59:00Z" }),
    post({ platform: "tiktok", views: 999, postedAt: "2026-11-09T00:00:00Z" }), // next week: excluded
    post({ platform: "snapchat", views: null, postedAt: "2026-11-05T10:00:00Z" }),
  ];
  const r = buildWeeklyReport(posts, opts);

  it("sums views this week and last, week-over-week ratio, null when no comparison", () => {
    const ig = r.platforms.find((p) => p.platform === "instagram")!;
    expect(ig).toMatchObject({ posts: 3, withMetrics: 2, views: 400, prevViews: 200, weekOverWeek: 2 });
    const tt = r.platforms.find((p) => p.platform === "tiktok")!;
    expect(tt).toMatchObject({ posts: 1, views: 50, prevViews: null, weekOverWeek: null });
  });

  it("top posts by views, metrics-less posts left out", () => {
    expect(r.platforms.find((p) => p.platform === "instagram")!.top.map((t) => t.hook)).toEqual(["B…", "A…"]);
  });

  it("lists data gaps instead of guessing", () => {
    expect(r.dataGaps).toEqual([
      "instagram: 1 of 3 post(s) this week have no metrics yet",
      "snapchat: 1 of 1 post(s) this week have no metrics yet",
      "snapchat: assisted posting, no metrics API; check the app",
    ]);
    expect(r.weekEnd).toBe("2026-11-09");
  });

  it("says too early with few posts and recommends nothing", () => {
    expect(r.recommendations).toEqual([]);
    expect(r.tooEarly).toEqual(["instagram", "tiktok"]);
    expect(r.markdown).toMatch(/Too early to tell on instagram, tiktok/);
  });
});

describe("buildWeeklyReport: recommendations", () => {
  // 8 IG posts in the window: 4 gym at 400 views, 4 trading at 100 → platform median 250.
  const posts = [
    ...[0, 1, 2, 3].map((i) => post({ pillar: "gym", views: 400, caption: "Pull day…", durationS: 10, postedAt: `2026-11-0${2 + i}T16:00:00Z` })),
    ...[0, 1, 2, 3].map((i) => post({ pillar: "trading", views: 100, caption: "Recap +$1", durationS: 45, postedAt: `2026-11-0${2 + i}T21:00:00Z` })),
  ];
  const r = buildWeeklyReport(posts, opts);

  it("computes lift against the platform median with exact numbers", () => {
    const gym = r.groups.find((g) => g.dimension === "pillar" && g.group === "gym")!;
    expect(gym).toMatchObject({ n: 4, medianViews: 400, lift: 1.6 });
    const trading = r.groups.find((g) => g.dimension === "pillar" && g.group === "trading")!;
    expect(trading.lift).toBeCloseTo(0.4, 12);
  });

  it("recommends more/less only for n≥3 and strong lifts, strongest first, with sample sizes", () => {
    const texts = r.recommendations.map((x) => x.text);
    expect(r.recommendations[0]!.lift).toBeCloseTo(0.4, 12); // |log 0.4| > |log 1.6|: strongest first
    expect(texts).toContain("instagram: trading posts got ×0.40 your median views (n=4) → do fewer or rework");
    expect(texts).toContain("instagram: gym posts got ×1.60 your median views (n=4) → do more");
    expect(texts).toContain("instagram: <15s videos got ×1.60 your median views (n=4) → do more");
    expect(texts).toContain("instagram: evening posts got ×0.40 your median views (n=4) → do fewer or rework");
    for (const rec of r.recommendations) expect(rec.n).toBeGreaterThanOrEqual(3);
  });

  it("never prints the time zone, and is deterministic", () => {
    const tz = buildWeeklyReport(posts, { ...opts, timeZone: "Pacific/Honolulu" });
    expect(tz.markdown).not.toMatch(/Honolulu|Pacific/);
    expect(buildWeeklyReport(posts, opts).markdown).toBe(r.markdown);
  });

  it("rejects a bad week", () => {
    expect(() => buildWeeklyReport(posts, { ...opts, weekStart: "nope" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("synthetic demo data", () => {
  it("lets the report find the built-in pattern (gym up, trading down on TikTok)", () => {
    const r = buildWeeklyReport(syntheticPosts({ weekStart: "2026-11-02" }), opts);
    const tt = r.recommendations.filter((x) => x.platform === "tiktok" && x.dimension === "pillar");
    expect(tt.find((x) => x.group === "gym")?.kind).toBe("more");
    expect(tt.find((x) => x.group === "trading")?.kind).toBe("less");
    expect(r.trials.recommendations.length).toBeGreaterThan(0);
  });
});
