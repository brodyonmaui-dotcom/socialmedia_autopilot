import { describe, expect, it } from "vitest";
import { engagementRate, lengthBucket, localHour, median, timeBucket } from "../stats.js";
import { recommendTrialShares } from "../trials.js";
import { EMPTY_METRICS } from "../types.js";
import { post } from "./helpers.js";

describe("stats", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("engagement rate uses only reported interactions; no views → n/a", () => {
    expect(engagementRate({ ...EMPTY_METRICS, views: 200, likes: 10, comments: 2, saves: null, shares: 4 })).toBeCloseTo(16 / 200, 12);
    expect(engagementRate({ ...EMPTY_METRICS, views: 200 })).toBeNull();
    expect(engagementRate({ ...EMPTY_METRICS, views: 0, likes: 3 })).toBeNull();
  });

  it("length and time buckets have stable edges", () => {
    expect([null, 14.9, 15, 29.9, 30, 60, 60.1].map(lengthBucket)).toEqual(["unknown", "<15s", "15–30s", "15–30s", "30–60s", "30–60s", ">60s"]);
    expect([4, 5, 10, 11, 13, 14, 17, 18, 21, 22, 0].map(timeBucket)).toEqual([
      "late", "morning", "morning", "midday", "midday", "afternoon", "afternoon", "evening", "evening", "late", "late",
    ]);
    expect(localHour("2026-11-02T16:30:00Z", "UTC")).toBe(16);
    expect(localHour("2026-11-02T16:30:00Z", "Asia/Tokyo")).toBe(1);
  });
});

describe("recommendTrialShares", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const baseline = [100, 200, 300].map((v, i) =>
    post({ views: v, postedAt: `2026-11-0${i + 2}T16:00:00Z`, metrics: { ...EMPTY_METRICS, views: v, likes: v / 10, skipRate: 40 } }),
  );
  // baseline median views 200, median ER 0.1, median skip 40
  const trial = (views: number | null, postedAt: string, extra: Partial<typeof EMPTY_METRICS> = {}) =>
    post({ isTrial: true, postedAt, views, metrics: { ...EMPTY_METRICS, views, likes: views === null ? null : views / 10, skipRate: 35, ...extra } });

  const verdicts = (posts: ReturnType<typeof post>[]) => recommendTrialShares(posts, now).recommendations.map((r) => [r.verdict, r.reason]);

  it("shares a trial that beats the regular-reel median on views without losing engagement or skip rate", () => {
    const r = recommendTrialShares([...baseline, trial(250, "2026-11-08T12:00:00Z")], now);
    expect(r.baselineN).toBe(3);
    expect(r.recommendations[0]).toMatchObject({ verdict: "share", ageHours: 48, views: 250, viewsVsBaseline: 1.25 });
  });

  it("waits when too young, without insights, or without a baseline", () => {
    expect(verdicts([...baseline, trial(999, "2026-11-10T00:00:00Z")])[0]![0]).toBe("wait");
    expect(verdicts([...baseline, trial(null, "2026-11-08T12:00:00Z")])[0]![1]).toMatch(/no trial insights/);
    expect(verdicts([baseline[0]!, trial(999, "2026-11-08T12:00:00Z")])[0]![1]).toMatch(/n=1, need 3/);
  });

  it("doesn't share when views are strong but engagement or skip rate is worse; says why", () => {
    expect(verdicts([...baseline, trial(300, "2026-11-08T12:00:00Z", { likes: 3 })])[0]).toEqual(["wait", expect.stringMatching(/engagement/)]);
    expect(verdicts([...baseline, trial(300, "2026-11-08T12:00:00Z", { skipRate: 60 })])[0]).toEqual(["wait", expect.stringMatching(/skip rate/)]);
  });

  it("says don't share only after 72 h and under half the median", () => {
    expect(verdicts([...baseline, trial(90, "2026-11-08T12:00:00Z")])[0]![0]).toBe("wait"); // 48 h
    expect(verdicts([...baseline, trial(90, "2026-11-07T11:00:00Z")])[0]![0]).toBe("dont-share"); // 73 h, 0.45×
    expect(verdicts([...baseline, trial(110, "2026-11-07T11:00:00Z")])[0]![0]).toBe("wait"); // 0.55×
  });

  it("lists only trials from the last 14 days and counts the older unshared ones", () => {
    const old = post({ isTrial: true, postedAt: "2026-10-26T11:00:00Z", views: 900 });
    const r = recommendTrialShares([...baseline, old, trial(250, "2026-11-08T12:00:00Z")], now);
    expect(r.recommendations.map((x) => x.views)).toEqual([250]);
    expect(r.olderUnshared).toBe(1);
  });

  it("skips trials already shared, non-IG posts, and ignores trials in the baseline", () => {
    const shared = post({ isTrial: true, trialSharedAt: "2026-11-09T00:00:00Z", postedAt: "2026-11-08T00:00:00Z", views: 5000 });
    const yt = post({ platform: "youtube", isTrial: true, postedAt: "2026-11-08T00:00:00Z" });
    const r = recommendTrialShares([...baseline, shared, yt], now);
    expect(r.recommendations).toEqual([]);
    expect(r.baselineN).toBe(3);
  });
});
