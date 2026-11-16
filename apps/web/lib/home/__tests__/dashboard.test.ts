import { describe, expect, it } from "vitest";
import type { EditorRender } from "../../editor/view.js";
import {
  activityBars,
  buildKpis,
  deltaOf,
  editorTiles,
  gainRows,
  hasActivity,
  kpiText,
  mondayOf,
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
    expect(parseRange("last-week")).toBe("last-week");
    expect(parseRange("x")).toBe("week");
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
  it("last week and 30 days", () => {
    expect(periodsFor("last-week", TODAY).current).toMatchObject({ start: "2026-11-09", endExcl: "2026-11-16" });
    expect(periodsFor("last-week", TODAY).previous).toMatchObject({ start: "2026-11-02", endExcl: "2026-11-09" });
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
  it("delta words: down, same, nothing to compare", () => {
    expect(deltaOf(90, 100, "vs last week")).toEqual({ text: "▼ 10% vs last week", tone: "down" });
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

describe("editor and reply tiles", () => {
  const render = (n: number, approvable: string[]): EditorRender =>
    ({
      key: `b:m${n}`,
      batchId: "b",
      mediaId: `m${n}`,
      label: `Clip ${n}`,
      durationS: 30,
      pillar: "gym",
      source: null,
      captionLines: [],
      lines: [
        { itemId: "i1", platform: "instagram", slot: "No slot", blocked: false, blockReason: null },
        { itemId: "i2", platform: "youtube", slot: "Tomorrow 18:30", blocked: false, blockReason: null },
      ],
      chips: [],
      itemIds: ["i1", "i2"],
      approvableIds: approvable,
      edits: [],
      newest: "2026-11-18T00:00:00Z",
    }) as EditorRender;
  it("max 4 editor tiles; meta = platforms + first slot; blocked when nothing approvable", () => {
    const t = editorTiles([1, 2, 3, 4, 5].map((n) => render(n, n === 2 ? [] : ["i1"])));
    expect(t).toHaveLength(4);
    expect(t[0]).toMatchObject({ title: "Clip 1", meta: "Instagram, YouTube · Tomorrow 18:30", blocked: false });
    expect(t[1]!.blocked).toBe(true);
  });
  it("max 4 reply tiles; empty drafts become null (Open only)", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ commentId: `c${n}`, platform: "instagram", authorHandle: n === 1 ? null : `gym_fan_${n}`, text: "nice", commentedAt: "2026-11-18T00:00:00Z", draft: n === 2 ? "  " : "Thanks!" }));
    const r = replyTiles(rows);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ who: "Someone", draft: "Thanks!", href: "/inbox/item/c1" });
    expect(r[1]).toMatchObject({ who: "@gym_fan_2", draft: null });
  });
});
