import { describe, expect, it } from "vitest";
import { creatorSubtitle, heroLines, hookMeta, ideaMeta, researchTabs, stageBadge } from "../view.js";

const c = { ideas: 3, hooks: 3, creators: 3, activeCreators: 2 };

describe("research view", () => {
  it("hero shows the idea count padded", () => {
    expect(heroLines(c).map((l) => l.text)).toEqual(["Research", "this week", "03"]);
  });
  it("tabs mark the current one", () => {
    const t = researchTabs("ideas");
    expect(t.filter((x) => x.active).map((x) => x.href)).toEqual(["/research/ideas"]);
    expect(t.map((x) => x.label)).toEqual(["Overview", "Creators", "Ideas", "Hooks"]);
  });
  it("maps stages and tolerates unknown ones", () => {
    expect(stageBadge("scripted").tone).toBe("accent");
    expect(stageBadge("weird")).toEqual({ label: "weird", tone: "neutral" });
  });
  it("builds meta lines", () => {
    expect(ideaMeta({ pillar: "gym", hook: "Hi" })).toBe('GYM · "HI"');
    expect(ideaMeta({ pillar: null, hook: " " })).toBe("NO PILLAR");
    expect(hookMeta({ pillar: "tip", timesUsed: 2, source: "creator" }, ["question"])).toBe("TIP · QUESTION · USED 2× · CREATOR PATTERN");
    expect(creatorSubtitle({ pillar: null, followers: 12000, notes: "" })).toBe("no pillar · 12,000");
  });
});
