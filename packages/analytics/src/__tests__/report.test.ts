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
    // gym ≡ <15s ≡ deadpan ≡ 16:00 and trading ≡ 30–60s ≡ "number" ≡ evening here: one rec per set of posts, pillar label wins
    expect(texts).toEqual([
      "instagram: trading posts got ×0.40 your median views (n=4) → do fewer or rework",
      "instagram: gym posts got ×1.60 your median views (n=4) → do more",
    ]);
    for (const rec of r.recommendations) expect(rec.n).toBeGreaterThanOrEqual(3);
  });

  it("caps the list for a phone screen and says how many were hidden", () => {
    const many = buildWeeklyReport(syntheticPosts({ weekStart: "2026-11-02" }), opts);
    expect(many.recommendations.length).toBeLessThanOrEqual(8);
    const sigs = new Set(many.recommendations.map((x) => `${x.platform}|${x.lift}|${x.n}`));
    expect(sigs.size).toBe(many.recommendations.length);
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
    const tt = (g: string) => r.groups.find((x) => x.platform === "tiktok" && x.dimension === "pillar" && x.group === g)!;
    expect(tt("gym").lift!).toBeGreaterThanOrEqual(1.25);
    expect(tt("trading").lift!).toBeLessThanOrEqual(0.75);
    expect(r.recommendations[0]!.text).toMatch(/<15s videos .* do more/);
    expect(r.trials.recommendations.length).toBeGreaterThan(0);
  });
});

describe("buildWeeklyReport: mix artifacts", () => {
  it("doesn't recommend a group whose complement is too small to compare against (1 trial vs 12 regular)", () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, i) => post({ pillar: "gym", views: 400, postedAt: `2026-11-0${2 + (i % 6)}T16:00:00Z` })),
      ...Array.from({ length: 6 }, (_, i) => post({ pillar: "trading", views: 150, postedAt: `2026-11-0${2 + (i % 6)}T16:00:00Z` })),
      post({ pillar: "gym", views: 400, isTrial: true, postedAt: "2026-11-08T16:00:00Z" }),
    ];
    const r = buildWeeklyReport(posts, opts);
    expect(r.recommendations.map((x) => `${x.dimension}:${x.group}`)).toEqual(["pillar:trading"]);
  });
});
