import { describe, expect, it } from "vitest";
import { buildFindings, classifyPillar, pillarOf, selectFindings, viewGainsByDay, FINDING_MIN_N } from "../account-report.js";
import { buildWeeklyReport } from "../report.js";
import type { AccountPostRecord } from "../account-types.js";

let n = 0;
function ap(over: Partial<AccountPostRecord> & { views?: number | null; likes?: number | null }): AccountPostRecord {
  const { views, likes, ...rest } = over;
  const id = `ap${++n}`;
  return {
    id,
    platform: "instagram",
    platformPostId: id,
    permalink: `https://www.instagram.com/reel/${id}/`,
    kind: "reels",
    caption: "Just stacking days",
    title: null,
    publishedAt: "2026-11-02T12:00:00Z",
    durationS: 20,
    batchItemId: null,
    mediaId: null,
    matchedBy: null,
    pillar: null,
    capturedAt: "2026-11-09T00:00:00Z",
    ...rest,
    metrics: rest.metrics === null ? null : { views: views === undefined ? 100 : views, likes: likes ?? 10, comments: 1, shares: null, saves: null, reach: null, avgWatchS: null, ...(rest.metrics ?? {}) },
  };
}
const TZ = "UTC";
const many = (k: number, over: Parameters<typeof ap>[0]) => Array.from({ length: k }, () => ap(over));

describe("pillar keyword rule", () => {
  it("classifies clear gym / trading captions, else other", () => {
    expect(classifyPillar("Pull day, slow negatives #gym")).toBe("gym");
    expect(classifyPillar("Leg day, no skipping")).toBe("gym");
    expect(classifyPillar("November P/L +$120, took the 1:1R. Not financial advice.")).toBe("trading");
    expect(classifyPillar("Welp, I was the liquidity today")).toBe("trading");
    expect(classifyPillar("Sunday reset, coffee and a walk")).toBe("other");
    expect(classifyPillar("Gym first, then trading the open")).toBe("other"); // both → unsure → other
    expect(classifyPillar(null)).toBe("other");
    expect(classifyPillar("Shorts compilation")).toBe("other"); // "short" is not a trading word
  });
  it("matched posts keep their clip's pillar", () => {
    expect(pillarOf({ pillar: "meal", caption: "Leg day", title: null })).toBe("meal");
    expect(pillarOf({ pillar: null, caption: "Leg day", title: null })).toBe("gym");
  });
});

describe("findings", () => {
  it("duration: short clips vs the rest, with n and a plain sentence", () => {
    const posts = [...many(6, { durationS: 10, views: 360 }), ...many(8, { durationS: 40, views: 200 })];
    const f = buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "instagram:duration:<15s")!;
    expect(f).toMatchObject({ status: "ok", n: 6, restN: 8, medianViews: 360, restMedianViews: 200, direction: "up", metric: "median views" });
    expect(f.viewsRatio).toBeCloseTo(1.8);
    expect(f.text).toBe("Instagram: clips under 15 s got 1.8× the median views (n = 6 vs 8).");
  });

  it("insufficient when either side has fewer than 5 posts", () => {
    const posts = [...many(4, { durationS: 10, views: 900 }), ...many(10, { durationS: 40, views: 100 })];
    const f = buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "instagram:duration:<15s")!;
    expect(f).toMatchObject({ status: "insufficient", n: 4, restN: 10, minN: FINDING_MIN_N, direction: null });
    expect(f.text).toBe("Instagram: clips under 15 s: not enough posts yet (n = 4 vs 10, need 5 each).");
  });

  it("engagement rate = (likes+comments+shares+saves)/views, compared as medians", () => {
    const posts = [...many(5, { caption: "Leg day", views: 100, likes: 20 }), ...many(5, { caption: "Took the 1:1R. Not financial advice.", views: 100, likes: 4 })];
    const f = buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "instagram:pillar:gym")!;
    expect(f.medianEr).toBeCloseTo(0.21);
    expect(f.restMedianEr).toBeCloseTo(0.05);
    expect(f.direction).toBe("same");
    expect(f.text).toBe("Instagram: gym posts got about the same median views (1.0×, n = 5 vs 5).");
  });

  it("pillar: by-hand posts are classified from the caption; 'other' is not a group", () => {
    const posts = [...many(5, { caption: "Leg day", views: 300 }), ...many(5, { caption: "Took the 1:1R. Not financial advice.", views: 100 }), ...many(3, { caption: "coffee", views: 150 })];
    const fs = buildFindings(posts, { timeZone: TZ });
    expect(fs.find((x) => x.key === "instagram:pillar:trading")).toMatchObject({ status: "ok", n: 5, restN: 8, direction: "down" });
    expect(fs.find((x) => x.key === "instagram:pillar:other")).toBeUndefined();
    expect(fs.find((x) => x.key === "instagram:pillar:trading")!.text).toBe("Instagram: trading posts got only 0.3× the median views (n = 5 vs 8).");
  });

  it("hour buckets use the given zone, never a hard-coded one", () => {
    const posts = [...many(5, { publishedAt: "2026-11-02T19:00:00Z", views: 400 }), ...many(5, { publishedAt: "2026-11-02T08:00:00Z", views: 100 })];
    const utc = buildFindings(posts, { timeZone: "UTC" });
    expect(utc.find((x) => x.key === "instagram:hour:evening")).toMatchObject({ n: 5, direction: "up" });
    const shifted = buildFindings(posts, { timeZone: "Etc/GMT+10" }); // UTC−10: 19:00Z → 09:00, 08:00Z → 22:00
    expect(shifted.find((x) => x.key === "instagram:hour:morning")).toMatchObject({ n: 5, direction: "up" });
    expect(shifted.find((x) => x.key === "instagram:hour:late")).toMatchObject({ n: 5, direction: "down" });
    expect(shifted.find((x) => x.key === "instagram:hour:late")!.text).toBe("Instagram: late-night posts (22–5 h) got only 0.3× the median views (n = 5 vs 5).");
    expect(shifted.find((x) => x.key === "instagram:hour:morning")!.text).toBe("Instagram: posts in the morning (5–11 h) got 4.0× the median views (n = 5 vs 5).");
  });

  it("hook pattern uses the research classifier (title on YouTube)", () => {
    const posts = [
      ...many(5, { platform: "youtube", title: "Why your bench stalls?", caption: "desc", views: 500 }),
      ...many(5, { platform: "youtube", title: "Full push day", caption: "desc", views: 100 }),
    ];
    const f = buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "youtube:hook:question")!;
    expect(f).toMatchObject({ status: "ok", n: 5, restN: 5 });
    expect(f.text).toBe("YouTube: question hooks got 5.0× the median views (n = 5 vs 5).");
  });

  it("by platform compares a platform with the others", () => {
    const posts = [...many(5, { platform: "youtube", views: 400 }), ...many(5, { views: 100 })];
    const f = buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "youtube:platform:youtube")!;
    expect(f.text).toBe("YouTube posts got 4.0× the median views of the other platforms (n = 5 vs 5).");
    expect(buildFindings(posts, { timeZone: TZ, platform: "youtube" }).some((x) => x.dimension === "platform")).toBe(false);
  });

  it("posts without a views number don't count", () => {
    const posts = [...many(5, { durationS: 10, views: null }), ...many(5, { durationS: 10, metrics: null }), ...many(5, { durationS: 40 })];
    expect(buildFindings(posts, { timeZone: TZ }).find((x) => x.key === "instagram:duration:<15s")).toBeUndefined();
  });

  it("selectFindings: strongest real differences first, then 'same', then a few insufficient", () => {
    const posts = [
      ...many(6, { durationS: 10, views: 900, caption: "Leg day" }),
      ...many(6, { durationS: 40, views: 100, caption: "Leg day" }),
      ...many(2, { durationS: 70, views: 100, caption: "Leg day" }),
    ];
    const sel = selectFindings(buildFindings(posts, { timeZone: TZ }));
    expect(sel[0]!.key).toBe("instagram:duration:<15s");
    const st = sel.map((f) => f.status);
    expect(st.indexOf("insufficient")).toBeGreaterThan(st.lastIndexOf("ok"));
  });
});

describe("viewGainsByDay", () => {
  const p = { id: "x", publishedAt: "2026-11-01T20:00:00Z" };
  it("one snapshot → all its views on the publish day", () => {
    const g = viewGainsByDay([p], [{ accountPostId: "x", capturedAt: "2026-11-05T00:00:00Z", views: 500 }], "UTC");
    expect([...g.get("x")!]).toEqual([["2026-11-01", 500]]);
  });
  it("later snapshots add their differences on the capture day; nulls skipped; drops ignored", () => {
    const g = viewGainsByDay(
      [p],
      [
        { accountPostId: "x", capturedAt: "2026-11-02T06:00:00Z", views: 300 },
        { accountPostId: "x", capturedAt: "2026-11-03T06:00:00Z", views: null },
        { accountPostId: "x", capturedAt: "2026-11-04T06:00:00Z", views: 450 },
        { accountPostId: "x", capturedAt: "2026-11-05T06:00:00Z", views: 440 },
      ],
      "UTC",
    );
    expect(Object.fromEntries(g.get("x")!)).toEqual({ "2026-11-01": 300, "2026-11-04": 150 });
  });
  it("days are in the given zone", () => {
    const g = viewGainsByDay([p], [{ accountPostId: "x", capturedAt: "2026-11-02T00:00:00Z", views: 10 }], "Etc/GMT-5"); // UTC+5: 20:00Z → next day
    expect([...g.get("x")!.keys()]).toEqual(["2026-11-02"]);
  });
});

describe("weekly report with account posts", () => {
  it("'What worked' runs over all account posts and says 'not enough posts yet' otherwise", () => {
    const posts = [...many(6, { durationS: 10, views: 900 }), ...many(6, { durationS: 40, views: 100 })];
    const r = buildWeeklyReport([], { weekStart: "2026-11-02", timeZone: TZ, accountPosts: posts });
    expect(r.findings!.some((f) => f.status === "ok")).toBe(true);
    expect(r.markdown).toContain("## What worked (all posts on the account, last 60 days)");
    expect(r.markdown).toContain("- Instagram: clips under 15 s got 9.0× the median views (n = 6 vs 6).");
    const empty = buildWeeklyReport([], { weekStart: "2026-11-02", timeZone: TZ, accountPosts: many(2, {}) });
    expect(empty.markdown).toContain("- Not enough posts yet.");
    const old = buildWeeklyReport([], { weekStart: "2026-11-02", timeZone: TZ });
    expect(old.findings).toBeUndefined();
    expect(old.markdown).toContain("Nothing stands out yet.");
  });
});
