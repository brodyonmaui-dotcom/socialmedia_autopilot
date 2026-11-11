import { describe, expect, it } from "vitest";
import { pickSnapchatDaily } from "../snapchat.js";
import { EMPTY_METRICS, type PostRecord } from "../types.js";

const NOW = new Date("2026-11-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
let n = 0;
const post = (platform: PostRecord["platform"], views: number | null, ageH: number, mediaId?: string): PostRecord => ({
  batchItemId: `bi-${++n}`,
  mediaId,
  platform,
  pillar: "gym",
  caption: "",
  durationS: 20,
  postedAt: hoursAgo(ageH),
  isTrial: false,
  trialSharedAt: null,
  metrics: { ...EMPTY_METRICS, views },
  capturedAt: NOW.toISOString(),
});
/** Baseline: IG median 1000, TikTok median 4000 (older than 48 h). */
const baseline = () => [
  post("instagram", 800, 100), post("instagram", 1000, 120), post("instagram", 1200, 140),
  post("tiktok", 3000, 100), post("tiktok", 4000, 120), post("tiktok", 5000, 140),
];

describe("pickSnapchatDaily", () => {
  it("picks by views relative to the platform median, not raw views", () => {
    const ig = post("instagram", 2500, 20, "m-ig"); // 2.5× IG median
    const tt = post("tiktok", 6000, 20, "m-tt"); // 1.5× TikTok median, more raw views
    const pick = pickSnapchatDaily([...baseline(), ig, tt], { now: NOW });
    expect(pick?.mediaId).toBe("m-ig");
    expect(pick?.platform).toBe("instagram");
  });

  it("only considers the previous 48 h (and nothing in the future)", () => {
    const old = post("instagram", 9000, 49, "m-old");
    const future = post("instagram", 9000, -1, "m-future");
    const recent = post("instagram", 1100, 47, "m-recent");
    expect(pickSnapchatDaily([...baseline(), old, future, recent], { now: NOW })?.mediaId).toBe("m-recent");
  });

  it("excludes clips already sent to Snapchat, on any platform", () => {
    const igBest = post("instagram", 3000, 10, "m-1");
    const ttSameClip = post("tiktok", 9000, 10, "m-1");
    const runnerUp = post("tiktok", 5000, 10, "m-2");
    const pick = pickSnapchatDaily([...baseline(), igBest, ttSameClip, runnerUp], { now: NOW, alreadySent: ["m-1"] });
    expect(pick?.mediaId).toBe("m-2");
  });

  it("ignores YouTube/Snapchat posts and posts with no view count", () => {
    const yt = post("youtube", 99999, 5, "m-yt");
    const noViews = post("instagram", null, 5, "m-null");
    const ok = post("tiktok", 4100, 5, "m-ok");
    expect(pickSnapchatDaily([...baseline(), yt, noViews, ok], { now: NOW })?.mediaId).toBe("m-ok");
  });

  it("returns null when nothing qualifies (empty window, or no baseline yet)", () => {
    expect(pickSnapchatDaily(baseline(), { now: NOW })).toBeNull();
    expect(pickSnapchatDaily([post("instagram", 5000, 5, "m")], { now: NOW })).toBeNull(); // 1 post < minBaseline
    expect(pickSnapchatDaily([], { now: NOW })).toBeNull();
  });

  it("falls back to the batch item id as the clip key when mediaId is unknown", () => {
    const p = post("instagram", 2000, 5);
    const pick = pickSnapchatDaily([...baseline(), p], { now: NOW });
    expect(pick?.clipKey).toBe(p.batchItemId);
    expect(pickSnapchatDaily([...baseline(), p], { now: NOW, alreadySent: [p.batchItemId] })).toBeNull();
  });

  it("is deterministic on ties (score, then raw views, then older post)", () => {
    const a = post("instagram", 2000, 30, "m-a");
    const b = post("instagram", 2000, 10, "m-b");
    expect(pickSnapchatDaily([...baseline(), b, a], { now: NOW })?.mediaId).toBe("m-a");
    expect(pickSnapchatDaily([...baseline(), a, b], { now: NOW })?.mediaId).toBe("m-a");
  });

  it("reports score and the median used", () => {
    const pick = pickSnapchatDaily([...baseline(), post("tiktok", 8000, 3, "m")], { now: NOW });
    // The baseline includes recent posts too (3000, 4000, 5000, 8000 → median 4500).
    expect(pick).toMatchObject({ platformMedian: 4500, views: 8000 });
    expect(pick!.score).toBeCloseTo(8000 / 4500);
  });
});
