import { describe, expect, it } from "vitest";
import type { Finding } from "@autopilot/analytics";
import { kpi, type Overview, type PlatformCard, type ViewsDay } from "../overview.js";
import type { HourStat, PlatformPostRow } from "../platform.js";
import {
  analyticsHref,
  clock,
  dayAxis,
  findingView,
  fmtInt,
  fmtRate,
  hourBars,
  kpiDelta,
  notCollectedCopy,
  overviewTiles,
  parseDays,
  parsePlatform,
  parseSort,
  platformTiles,
  sortPosts,
  splitFindings,
  trialMeta,
  viewsChart,
} from "../present.js";

function finding(over: Partial<Finding>): Finding {
  return {
    key: "k",
    platform: "instagram",
    dimension: "duration",
    group: "<15s",
    status: "ok",
    n: 14,
    restN: 22,
    minN: 5,
    metric: "median views",
    medianViews: 1800,
    restMedianViews: 1000,
    viewsRatio: 1.8,
    medianEr: null,
    restMedianEr: null,
    erRatio: null,
    direction: "up",
    text: "",
    ...over,
  };
}

const range = { days: 30 as const, from: "2026-10-18", to: "2026-11-16", previousFrom: "2026-09-18", previousTo: "2026-10-17" };

describe("params and links", () => {
  it("parses ?days, ?sort and the platform segment, with safe defaults", () => {
    expect(parseDays("7")).toBe(7);
    expect(parseDays("60")).toBe(60);
    expect(parseDays("14")).toBe(30);
    expect(parseDays(undefined)).toBe(30);
    expect(parseSort("views")).toBe("views");
    expect(parseSort("x")).toBe("date");
    expect(parsePlatform("youtube")).toBe("youtube");
    expect(parsePlatform("myspace")).toBeNull();
  });
  it("builds links that leave defaults out", () => {
    expect(analyticsHref()).toBe("/analytics");
    expect(analyticsHref({ days: 7 })).toBe("/analytics?days=7");
    expect(analyticsHref({ platform: "instagram", days: 30, sort: "views" })).toBe("/analytics/instagram?sort=views");
    expect(analyticsHref({ platform: "youtube", days: 7, all: true })).toBe("/analytics/youtube?days=7&all=1");
  });
});

describe("numbers", () => {
  it("formats counts and rates without fake zeros", () => {
    expect(fmtInt(12480)).toBe("12,480");
    expect(fmtInt(1_250_000)).toBe("1.3M");
    expect(fmtInt(null)).toBeNull();
    expect(fmtRate(0.0423)).toBe("4.2%");
    expect(fmtRate(0.125)).toBe("13%");
    expect(fmtRate(null)).toBeNull();
    expect(clock(42)).toBe("0:42");
    expect(clock(75.4)).toBe("1:15");
    expect(clock(null)).toBeNull();
  });
});

describe("KPI tiles", () => {
  it("count deltas read '▲ 12% vs the 30 days before'; rates change in points", () => {
    expect(kpiDelta(kpi(112, 100), 30)).toEqual({ text: "▲ 12% vs the 30 days before", tone: "up" });
    expect(kpiDelta(kpi(80, 100), 7)).toEqual({ text: "▼ 20% vs the 7 days before", tone: "down" });
    expect(kpiDelta(kpi(0, 100), 30)).toEqual({ text: "None yet", tone: "flat" });
    expect(kpiDelta(kpi(5, 0), 30)).toBeNull();
    expect(kpiDelta(kpi(5, null), 30)).toBeNull();
    expect(kpiDelta(kpi(0.046, 0.04), 30, "rate")).toEqual({ text: "▲ 0.6 pts vs the 30 days before", tone: "up" });
  });
  it("previous null → no delta and a quiet 'No earlier data'; value null → '–' with a reason", () => {
    const tiles = overviewTiles({
      range,
      kpis: { followers: kpi(1754, 1700), views: kpi(9000, null), engagementRate: kpi(null, null), posts: kpi(12, 10) },
    } as Pick<Overview, "kpis" | "range">);
    expect(tiles.map((t) => t.label)).toEqual(["Followers", "Views", "Engagement rate", "Posts"]);
    expect(tiles[0]).toMatchObject({ value: "1,754", delta: { text: "▲ 3% vs the 30 days before" }, note: null });
    expect(tiles[1]).toMatchObject({ value: "9,000", delta: null, note: "No earlier data" });
    expect(tiles[2]).toMatchObject({ value: null, delta: null, note: "Needs posts with views" });
  });
  it("platform tiles show the follower change and plain notes", () => {
    const card: PlatformCard = { platform: "instagram", collected: true, reason: null, followers: 1200, followersDelta: 42, views: 5000, posts: 9, medianViews: 410, engagementRate: 0.05 };
    const t = platformTiles(card, 30);
    expect(t[0]!.delta).toEqual({ text: "▲ 42 in 30 days", tone: "up" });
    expect(t[3]!.note).toBe("Median 410 views each");
    expect(platformTiles({ ...card, followers: null, followersDelta: null, posts: 0 }, 7)[3]!.note).toBe("Nothing posted in this range");
  });
});

describe("charts", () => {
  it("omits platforms with no data at all and names them instead of drawing a 0 line", () => {
    const days: ViewsDay[] = [
      { date: "2026-11-15", instagram: 10, youtube: 0, tiktok: null, snapchat: null },
      { date: "2026-11-16", instagram: 20, youtube: 5, tiktok: null, snapchat: null },
    ];
    const c = viewsChart(days);
    expect(c.series.map((s) => s.id)).toEqual(["instagram", "youtube"]);
    expect(c.values.instagram).toEqual([10, 20]);
    expect(c.missing.map((m) => m.text)).toEqual(["TikTok: not collected", "Snapchat: not collected"]);
    expect(c.total).toBe(35);
  });
  it("labels a week by weekday and longer ranges by date, spaced out", () => {
    const week = dayAxis(["2026-11-10", "2026-11-11"]);
    expect(week).toMatchObject({ labels: ["Tue", "Wed"], labelEvery: 1 });
    expect(week.titles[0]).toBe("Tue, Nov 10");
    const month = dayAxis(Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`));
    expect(month.labels[0]).toBe("Oct 1");
    expect(month.labelEvery).toBe(7);
    expect(dayAxis(Array.from({ length: 60 }, () => "2026-10-01")).labelEvery).toBe(14);
  });
});

describe("What worked", () => {
  it("writes one sentence per finding with the sample size split off", () => {
    expect(findingView(finding({}))).toMatchObject({ sentence: "On Instagram, clips under 15 s got 1.8× the median views of your other posts.", sample: "n = 14 posts vs 22 others" });
    expect(findingView(finding({ direction: "down", viewsRatio: 0.6 })).sentence).toContain("got only 0.6× the median views");
    expect(findingView(finding({ dimension: "platform", group: "youtube", platform: "youtube" })).sentence).toBe("YouTube posts got 1.8× the median views of posts on the other platforms.");
    expect(findingView(finding({ status: "insufficient", n: 3, direction: null, viewsRatio: null }))).toMatchObject({ sentence: "On Instagram, clips under 15 s: not enough posts yet.", sample: "n = 3 posts, needs 5" });
  });
  it("picks the strongest real difference as the lead and collapses the thin ones", () => {
    const s = splitFindings([
      finding({ key: "same", direction: "same", viewsRatio: 1.05 }),
      finding({ key: "up", direction: "up" }),
      finding({ key: "thin", status: "insufficient", n: 2, direction: null }),
    ]);
    expect(s.lead?.key).toBe("up");
    expect(s.ok.map((f) => f.key)).toEqual(["same"]);
    expect(s.insufficient.map((f) => f.key)).toEqual(["thin"]);
    expect(splitFindings([finding({ direction: "same" })]).lead).toBeNull();
  });
});

describe("platform page", () => {
  it("best posting time: five bars, the best one named in words", () => {
    const h = (bucket: HourStat["bucket"], n: number, medianViews: number | null, best = false): HourStat => ({ bucket, label: bucket, n, medianViews, status: n >= 5 ? "ok" : "insufficient", best });
    const bars = hourBars([h("morning", 6, 500), h("midday", 2, 900), h("afternoon", 0, null), h("evening", 8, 1000, true), h("late", 5, 250)]);
    expect(bars).toHaveLength(5);
    expect(bars[3]).toMatchObject({ width: 100, value: "1,000", note: "Best · n = 8", best: true });
    expect(bars[0]).toMatchObject({ width: 50, note: "n = 6" });
    expect(bars[1]).toMatchObject({ width: 0, value: null, note: "n = 2, too few", enough: false });
  });
  it("sorts posts by views on request, unknown views last", () => {
    const p = (id: string, views: number | null, publishedAt: string) => ({ accountPostId: id, views, publishedAt }) as PlatformPostRow;
    const rows = [p("a", 10, "2026-11-16"), p("b", null, "2026-11-15"), p("c", 99, "2026-11-14")];
    expect(sortPosts(rows, "date").map((r) => r.accountPostId)).toEqual(["a", "b", "c"]);
    expect(sortPosts(rows, "views").map((r) => r.accountPostId)).toEqual(["c", "a", "b"]);
  });
  it("explains uncollected platforms without promising a form that isn't there", () => {
    const t = notCollectedCopy("tiktok", "TikTok numbers aren't collected on the free plan. Check them in the TikTok app; a paid plan would let the app collect them.");
    expect(t.headline).toBe("TikTok numbers aren't collected on the free plan.");
    expect(t.turnOn).toContain("needs your OK");
    expect(notCollectedCopy("snapchat", "Snapchat has no metrics API. Check the numbers in the Snapchat app.").turnOn).toContain("Snapchat doesn't offer");
  });
  it("trial meta in plain words", () => {
    expect(trialMeta({ ageHours: 36, views: 1240, viewsVsBaseline: 1.4 })).toBe("36 h old · 1,240 views · 1.4× your usual");
    expect(trialMeta({ ageHours: 5, views: null, viewsVsBaseline: null })).toBe("5 h old · views not in yet");
  });
});
