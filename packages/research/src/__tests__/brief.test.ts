import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildResearchBrief, classifyHook, fetchCreatorSnapshot, firstLine, type CreatorSnapshot } from "../brief.js";
import type { Creator } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/research-sample.json", import.meta.url), "utf8")) as {
  creators: Creator[];
  snapshots: CreatorSnapshot[];
};
const now = new Date("2026-11-11T12:00:00Z");

describe("buildResearchBrief", () => {
  const brief = buildResearchBrief(fixture.creators, fixture.snapshots, { now, windowDays: 14 });

  it("covers active creators only and drops posts outside the window", () => {
    expect(brief.creatorsCovered).toBe(3);
    expect(brief.creatorsSkipped).toBe(1);
    expect(brief.topPosts.some((p) => p.hook.includes("Old post"))).toBe(false);
    expect(brief.topPosts.some((p) => p.creatorHandle === "example_paused")).toBe(false);
  });

  it("drops hooks that name a place or real-time whereabouts, and never prints them", () => {
    expect(brief.droppedForPrivacy).toBe(1);
    expect(brief.markdown).not.toMatch(/Riverside/);
  });

  it("ranks by (likes+comments)/followers, unknown followers last, numbers exact", () => {
    expect(brief.topPosts.map((p) => p.hook)).toEqual([
      "My lats did not sign up for this…", // 9300/120000 = 7.75%
      "Why I stopped trading the open?", // 2400/45000 = 5.33%
      "3 mistakes that cost me my first funded account", // 1700/45000 = 3.78%
      "Most people don't need more volume. They need better reps.", // 4500/120000 = 3.75%
      "Weekly meal prep, simple and high protein", // followers unknown
    ]);
    const lats = brief.topPosts.find((p) => p.hook.startsWith("My lats"))!;
    expect(lats.engagementRate).toBeCloseTo(9300 / 120000, 10);
    expect(brief.topPosts.at(-1)!.engagementRate).toBeNull();
  });

  it("strips hashtags from the hook and summarizes pillars", () => {
    expect(brief.topPosts.find((p) => p.hook.startsWith("My lats"))!.hook).toBe("My lats did not sign up for this…");
    const gym = brief.byPillar.find((b) => b.pillar === "gym")!;
    expect(gym.posts).toBe(2);
    expect(gym.medianEngagementRate).toBeCloseTo((9300 / 120000 + 4500 / 120000) / 2, 10);
    expect(brief.markdown).toMatch(/^# Research brief \(2026-11-11, last 14 days\)/);
  });

  it("is deterministic", () => {
    expect(buildResearchBrief(fixture.creators, fixture.snapshots, { now }).markdown).toBe(brief.markdown);
  });
});

describe("classifyHook / firstLine", () => {
  it("tags the common shapes", () => {
    expect(classifyHook("Why I stopped trading the open?")).toEqual(["question", "how-why"]);
    expect(classifyHook("3 mistakes that cost me my account")).toEqual(["list"]);
    expect(classifyHook("Most people don't need more back days.")).toEqual(["contrarian"]);
    expect(classifyHook("My lats are not a fan…")).toEqual(["story", "deadpan"]);
    expect(classifyHook("Pump")).toEqual(["other"]);
  });
  it("first non-empty line, hashtags removed, capped at 120 chars", () => {
    expect(firstLine("\n\nHello #gym\nsecond")).toBe("Hello");
    expect([...firstLine("a".repeat(200))].length).toBe(120);
  });
});

it("the Business Discovery fetcher is an explicit stub until the fields are verified", async () => {
  await expect(fetchCreatorSnapshot(fixture.creators[0]!)).rejects.toThrow(/not verified/);
});
