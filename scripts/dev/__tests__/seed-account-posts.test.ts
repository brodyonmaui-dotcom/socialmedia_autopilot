import { describe, expect, it } from "vitest";
import { buildDemoAccountDaily, buildDemoAccountPosts } from "../lib/seed-account-posts.js";

const TODAY = new Date("2026-11-16T00:00:00Z");
const items = Array.from({ length: 60 }, (_, i) => ({
  id: `bi${i}`,
  platform: i % 2 ? "instagram" : "youtube",
  platformPostId: i % 2 ? `17980000000000${String(i).padStart(3, "0")}` : `demoAp${String(i).padStart(5, "0")}`,
  caption: "Pull day, slow negatives…",
  title: null,
  scheduledFor: new Date(TODAY.getTime() - (i + 1) * 12 * 3_600_000),
  durationS: 12,
  pillar: "gym",
}));

describe("account-posts demo seed", () => {
  it("is deterministic, ~70 IG + ~45 YT, about a third matched, none in the future", () => {
    const a = buildDemoAccountPosts(TODAY, items);
    expect(buildDemoAccountPosts(TODAY, items)).toEqual(a);
    const ig = a.filter((p) => p.platform === "instagram");
    const yt = a.filter((p) => p.platform === "youtube");
    expect(ig.length).toBeGreaterThanOrEqual(65);
    expect(yt.length).toBeGreaterThanOrEqual(40);
    expect(ig.filter((p) => p.batchItemId).length).toBeGreaterThan(15);
    expect(new Set(a.map((p) => `${p.platform}:${p.platformPostId}`)).size).toBe(a.length);
    const noon = TODAY.getTime() + 12 * 3_600_000;
    expect(a.every((p) => p.publishedAt.getTime() < noon && p.snapshots.every((s) => s.at.getTime() <= noon + 1))).toBe(true);
    expect(a.every((p) => p.snapshots.length >= 1 && p.snapshots.length <= 4)).toBe(true);
    expect(a.every((p) => !/instagram\.com\/.*(media|cdn)|fbcdn|ytimg/.test(p.permalink))).toBe(true);
    expect(yt.every((p) => p.snapshots.every((s) => s.shares === null && s.saves === null))).toBe(true);
  });

  it("daily rows: 61 days per platform, followers never shrink", () => {
    const d = buildDemoAccountDaily(TODAY);
    const ig = d.filter((r) => r.platform === "instagram").map((r) => r.followers);
    expect(ig).toHaveLength(61);
    expect(ig.every((f, i) => i === 0 || f >= ig[i - 1]!)).toBe(true);
  });
});
