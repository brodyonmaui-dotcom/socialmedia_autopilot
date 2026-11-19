import { describe, expect, it } from "vitest";
import {
  activityBars,
  buildKpis,
  captionsDue,
  deltaOf,
  gainRows,
  hasActivity,
  HOME_SQL,
  kpiText,
  loadCaptionsDue,
  mondayOf,
  nextWeekStart,
  parseMetric,
  parseRange,
  periodsFor,
  rangeText,
  replyTiles,
  viewsIn,
  weekSchedule,
  type PostMetricRow,
  type ViewGainRow,
} from "../dashboard.js";

// Wed 18 Nov 2026
const TODAY = "2026-11-18";

describe("ranges", () => {
  it("parses with safe defaults", () => {
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("week")).toBe("week");
    expect(parseRange("last-week")).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
    expect(parseMetric("engagement")).toBe("engagement");
    expect(parseMetric(undefined)).toBe("views");
  });
  it("this week = Mon..today vs the same days last week; the chart shows Mon–Sun", () => {
    const { current, previous } = periodsFor("week", TODAY);
    expect(mondayOf(TODAY)).toBe("2026-11-16");
    expect(current).toMatchObject({ start: "2026-11-16", endExcl: "2026-11-19" });
    expect(current.days).toHaveLength(7);
    expect(current.days[6]).toBe("2026-11-22");
    expect(previous).toMatchObject({ start: "2026-11-09", endExcl: "2026-11-12" });
  });
  it("rolling 7 and 30 days compare with the equal-length period before", () => {
    const w = periodsFor("7d", TODAY);
    expect(w.current).toMatchObject({ start: "2026-11-12", endExcl: "2026-11-19" });
    expect(w.current.days).toHaveLength(7);
    expect(w.previous).toMatchObject({ start: "2026-11-05", endExcl: "2026-11-12" });
    const m = periodsFor("30d", TODAY);
    expect(m.current.days).toHaveLength(30);
    expect(m.current.days[29]).toBe(TODAY);
    expect(m.previous.endExcl).toBe(m.current.start);
  });
  it("writes weeks as dates", () => {
    expect(rangeText("2026-11-16", "2026-11-22")).toBe("Nov 16 – 22");
    expect(rangeText("2026-11-30", "2026-12-06")).toBe("Nov 30 – Dec 6");
  });
});

const post = (day: string, o: Partial<PostMetricRow> = {}): PostMetricRow => ({ platform: "instagram", day, views: 100, likes: 10, comments: 2, shares: 1, ...o });
const gain = (day: string, views: number, platform: ViewGainRow["platform"] = "instagram"): ViewGainRow => ({ platform, day, views });

describe("KPIs", () => {
  const periods = periodsFor("week", TODAY);
  it("compare with the previous period; views from daily gains, engagement = likes + comments + shares", () => {
    const k = buildKpis(
      { posts: [post("2026-11-16"), post("2026-11-17", { platform: "youtube", likes: 20, comments: 0, shares: 0 }), post("2026-11-10")], gains: [gain("2026-11-16", 300), gain("2026-11-18", 100, "youtube"), gain("2026-11-10", 200)] },
      periods,
      "week",
      { current: 1210, previous: 1100 },
    );
    const by = Object.fromEntries(k.map((x) => [x.id, x]));
    expect(by.views!.value).toBe(400);
    expect(by.views!.delta).toEqual({ text: "▲ 100% vs last week", tone: "up" });
    expect(by.engagement!.value).toBe(13 + 20);
    expect(by.posts!.value).toBe(2);
    expect(by.followers!.value).toBe(1210);
    expect(by.followers!.delta).toEqual({ text: "▲ 10% vs last week", tone: "up" });
    expect(k.map((x) => x.label)).toEqual(["Followers", "Views", "Engagement", "Posts published"]);
  });
  it("no data yet → null with a reason, never 0", () => {
    const k = buildKpis({ posts: [], gains: [] }, periods, "week", { current: null, previous: null });
    for (const x of k) {
      expect(x.value).toBeNull();
      expect(x.note).toBeTruthy();
    }
    expect(k[0]!.note).toBe("Collected after the next sync");
  });
  it("delta words: down, same, none yet, nothing to compare", () => {
    expect(deltaOf(90, 100, "vs last week")).toEqual({ text: "▼ 10% vs last week", tone: "down" });
    expect(deltaOf(0, 12, "vs last week")).toEqual({ text: "None yet", tone: "flat" });
    expect(deltaOf(0, 0, "vs last week")).toBeNull();
    expect(deltaOf(100, 100, "vs last week")).toEqual({ text: "Same as last week", tone: "flat" });
    expect(deltaOf(5, 0, "vs last week")).toBeNull();
    expect(deltaOf(null, 3, "vs last week")).toBeNull();
  });
  it("views are unknown before the first gain, 0 after it", () => {
    expect(viewsIn([gain("2026-11-20", 5)], { start: "2026-11-09", endExcl: "2026-11-12" })).toBeNull();
    expect(viewsIn([gain("2026-11-01", 5)], { start: "2026-11-09", endExcl: "2026-11-12" })).toBe(0);
  });
  it("numbers as shown", () => {
    expect(kpiText(12480)).toBe("12,480");
    expect(kpiText(1_250_000)).toBe("1.3M");
    expect(kpiText(null)).toBeNull();
  });
});

describe("activity bars", () => {
  it("stack by platform per day; today highlighted; engagement uses publish days", () => {
    const p = periodsFor("week", TODAY).current;
    const data = { posts: [post("2026-11-17", { likes: 5, comments: 1, shares: 0 })], gains: [gain("2026-11-17", 40), gain("2026-11-17", 10, "youtube")] };
    const v = activityBars(data, p, "views", TODAY);
    expect(v).toHaveLength(7);
    expect(v[1]).toMatchObject({ label: "Tue", title: "Tue Nov 17" });
    expect(v[1]!.values).toMatchObject({ instagram: 40, youtube: 10, tiktok: 0, snapchat: 0 });
    expect(v[2]!.highlight).toBe(true);
    expect(activityBars(data, p, "engagement", TODAY)[1]!.values.instagram).toBe(6);
    expect(hasActivity(v)).toBe(true);
    expect(hasActivity(activityBars({ posts: [], gains: [] }, p, "views", TODAY))).toBe(false);
  });
  it("30 days label every 5th day from the newest", () => {
    const b = activityBars({ posts: [], gains: [] }, periodsFor("30d", TODAY).current, "views", TODAY);
    expect(b[29]!.label).toBe("18");
    expect(b[24]!.label).toBe("13");
    expect(b[28]!.label).toBe("");
  });
  it("flattens analytics gain maps", () => {
    expect(gainRows(new Map([["youtube", new Map([["2026-11-17", 3]])]]))).toEqual([{ platform: "youtube", day: "2026-11-17", views: 3 }]);
  });
});

describe("this week", () => {
  it("Mon–Sun counts with today marked and calendar links; rejected left out", () => {
    const w = weekSchedule(
      [
        { day: "2026-11-18", platform: "instagram", status: "approved" },
        { day: "2026-11-18", platform: "youtube", status: "draft" },
        { day: "2026-11-19", platform: "tiktok", status: "rejected" },
        { day: "2026-11-23", platform: "tiktok", status: "approved" },
      ],
      TODAY,
    );
    expect(w.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(w[2]).toMatchObject({ count: 2, needsYou: 1, isToday: true, platforms: ["instagram", "youtube"], href: "/calendar?day=2026-11-18" });
    expect(w[3]!.count).toBe(0);
    expect(w[0]!.isPast).toBe(true);
    expect(w.reduce((s, d) => s + d.count, 0)).toBe(2);
  });
});

describe("reply tiles", () => {
  it("max 4 reply tiles; empty drafts become null (Open only)", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ commentId: `c${n}`, platform: "instagram", authorHandle: n === 1 ? null : `gym_fan_${n}`, text: "nice", commentedAt: "2026-11-18T00:00:00Z", draft: n === 2 ? "  " : "Thanks!" }));
    const r = replyTiles(rows);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ who: "Someone", draft: "Thanks!", href: "/inbox/item/c1" });
    expect(r[1]).toMatchObject({ who: "@gym_fan_2", draft: null });
  });
});

describe("Next week: captions strip (F14)", () => {
  it("next week starts the Monday after today (a Monday gives the following one)", () => {
    expect(nextWeekStart(TODAY)).toBe("2026-11-23");
    expect(nextWeekStart("2026-11-22")).toBe("2026-11-23");
    expect(nextWeekStart("2026-11-23")).toBe("2026-11-30");
  });
  it("shows only when something needs text and links to that calendar week", () => {
    expect(captionsDue(0, "2026-11-23")).toBeNull();
    expect(captionsDue(Number.NaN, "2026-11-23")).toBeNull();
    expect(captionsDue(1, "2026-11-23")).toMatchObject({ text: "Next week: 1 post needs captions" });
    expect(captionsDue(15, "2026-11-23")).toEqual({
      weekStart: "2026-11-23",
      count: 15,
      text: "Next week: 15 posts need captions",
      href: "/calendar?view=week&d=2026-11-23&status=draft",
    });
  });
  it("counts next week's drafts in the creator zone: drafts only, empty caption or empty YouTube title", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = { query: async (sql: string, params?: unknown[]) => (calls.push({ sql, params }), { rows: [{ n: 4 }] }) } as never;
    // Sun 22 Nov 18:00 in the fixture zone = 23:00 UTC.
    const due = await loadCaptionsDue(pool, new Date("2026-11-22T23:00:00Z"), "America/New_York");
    expect(due).toMatchObject({ weekStart: "2026-11-23", count: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toBe(HOME_SQL.needsCaptions);
    expect(calls[0]!.params).toEqual(["2026-11-23", new Date("2026-11-23T05:00:00Z"), new Date("2026-11-30T05:00:00Z")]);
    expect(HOME_SQL.needsCaptions).toMatch(/bi\.status = 'draft'/);
    expect(HOME_SQL.needsCaptions).toMatch(/btrim\(bi\.caption\) = ''/);
    expect(HOME_SQL.needsCaptions).toMatch(/bi\.platform = 'youtube' and coalesce\(btrim\(bi\.title\), ''\) = ''/);
    expect(HOME_SQL.needsCaptions).not.toMatch(/origin/);
  });
});
