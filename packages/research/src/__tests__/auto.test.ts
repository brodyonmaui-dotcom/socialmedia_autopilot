import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CreatorSnapshot, SnapshotPost } from "../brief.js";
import { lintText } from "../voice-lint.js";
import { canSpend, checkAiNotes, createFakeNoteWriter, type NoteRequest } from "../auto/ai-notes.js";
import { hookLine } from "../auto/hook-line.js";
import { loadNichePrompts, nicheIdeas, nicheSourceKey } from "../auto/niche.js";
import { aboutFromCode, adaptFromCode, ALL_ADAPT_TEXTS, HOOK_TEMPLATES } from "../auto/notes.js";
import { AUTO_PATTERNS, classifyPattern } from "../auto/patterns.js";
import { rankMedia } from "../auto/rank.js";
import { nextRefreshAt } from "../auto/refresh.js";
import { parseResearchSettings } from "../auto/settings.js";
import { parseYapScripts } from "../auto/yap.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const post = (id: string, likes: number | null, comments: number, age: number, caption = `Hook line for ${id}. More text`): SnapshotPost => ({
  id,
  caption,
  likes,
  comments,
  views: null,
  mediaType: "reel",
  postedAt: daysAgo(age),
  permalink: `https://www.instagram.com/reel/DEMO${id}/`,
});

describe("hookLine", () => {
  it("keeps the first sentence, drops hashtags, mentions, links and emoji runs", () => {
    expect(hookLine("Most people don't need more back days. They need better reps.\nSecond line")).toBe("Most people don't need more back days.");
    expect(hookLine("🔥🔥🔥 Stop skipping your warm-up 💯 #gym #legday @someone https://x.example/abc")).toBe("Stop skipping your warm-up");
    expect(hookLine("\n\n  Why do your lats never grow? Here's the fix")).toBe("Why do your lats never grow?");
  });
  it("caps at 140 chars and returns null when nothing usable is left", () => {
    const long = hookLine("word ".repeat(80));
    expect([...long!].length).toBeLessThanOrEqual(140);
    expect(hookLine("#gym #fitness")).toBeNull();
    expect(hookLine("🔥💯")).toBeNull();
    expect(hookLine("")).toBeNull();
    expect(hookLine(null)).toBeNull();
  });
  it("drops a line that names a place (location lint), and blocklisted terms", () => {
    expect(hookLine("Leg day at Riverside Fitness was brutal")).toBeNull();
    expect(hookLine("Heading to the park for sprints")).toBeNull();
    expect(hookLine("Quiet session in springfield today", ["springfield"])).toBeNull();
  });
});

describe("classifyPattern", () => {
  it.each([
    ["Why do your lats never grow?", "question"],
    ["3 mistakes I made on bench", "list"],
    ["Stop doing cardio before legs", "contrarian"],
    ["Cardio is a lie", "contrarian"],
    ["How to fix your squat depth", "how-to"],
    ["I used to skip leg day", "story"],
    ["Day 12 of journaling every session", "challenge"],
    ["I finally hit a 315 squat", "result-first"],
    ["POV: the bar is loaded wrong", "pov"],
    ["My lats are not a fan of this pull day…", "story"],
    ["Leg day", "statement"],
  ])("%s → %s", (hook, expected) => {
    expect(classifyPattern(hook)).toBe(expected);
  });
});

describe("rankMedia", () => {
  const snap = (posts: SnapshotPost[]): CreatorSnapshot => ({ creatorId: "c1", followers: 1000, posts });
  const base = [post("a", 100, 0, 1), post("b", 100, 0, 2), post("c", 100, 0, 3), post("d", 100, 0, 4), post("e", 100, 0, 5), post("f", 100, 0, 6)];

  it("scores relative to the creator's own median, recency-weighted, top 3", () => {
    const r = rankMedia(snap([...base, post("x", 400, 0, 1), post("y", 400, 0, 20), post("z", 300, 0, 2), post("w", 250, 0, 3)]), { now: NOW });
    expect(r.map((m) => m.post.id)).toEqual(["x", "z", "w"]); // y is as strong as x but older
    expect(r[0]!.ratio).toBeCloseTo(4, 5); // median of six 100s + 400,400,300,250 is 100
    expect(r[0]!.hookLine).toBe("Hook line for x.");
  });
  it("skips excluded media, below-usual posts, hidden likes and unusable hook lines", () => {
    const posts = [...base, post("x", 400, 0, 1), post("h", null, 900, 1), post("p", 500, 0, 1, "Leg day at Riverside Fitness"), post("n", 500, 0, 1, "#gym")];
    const r = rankMedia(snap(posts), { now: NOW, exclude: new Set(["x"]) });
    expect(r).toEqual([]);
  });
  it("returns nothing for an empty or zero-engagement snapshot", () => {
    expect(rankMedia(snap([]), { now: NOW })).toEqual([]);
    expect(rankMedia(snap([post("a", 0, 0, 1)]), { now: NOW })).toEqual([]);
  });
});

describe("about / adapt from code", () => {
  it("about quotes only the hook line and states the multiple", () => {
    const about = aboutFromCode({ kind: "reel", hookLine: "Stop skipping your warm-up", ratio: 2.34, pattern: "contrarian" }, { handle: "demo_lifter_one" });
    expect(about).toBe("A reel by @demo_lifter_one that opens with a contrarian hook: “Stop skipping your warm-up”. It got 2.3× their usual engagement.");
  });
  it("has a specific template per pattern × lane, all passing the voice + privacy lint", () => {
    for (const p of AUTO_PATTERNS) for (const lane of ["gym", "trading", null]) expect(adaptFromCode(p, lane)).toMatch(/Don't|own/);
    expect(adaptFromCode("question", "meal")).toBe(adaptFromCode("question", "lifestyle"));
    for (const t of [...ALL_ADAPT_TEXTS(), ...Object.values(HOOK_TEMPLATES)]) {
      const errors = lintText({ text: t, kind: "caption" }).issues.filter((i) => i.severity === "error");
      expect(errors, t).toEqual([]);
    }
  });
});

describe("nicheIdeas", () => {
  const prompts = loadNichePrompts();
  it("has at least 30 prompts per lane, unique keys, all lint-clean; trading stays on process", () => {
    for (const lane of ["gym", "trading", "other"] as const) {
      expect(prompts[lane].length).toBeGreaterThanOrEqual(30);
      expect(new Set(prompts[lane].map((p) => p.key)).size).toBe(prompts[lane].length);
      for (const p of prompts[lane]) {
        for (const t of [p.title, p.hook, p.about, p.adapt]) {
          const errors = lintText({ text: t, kind: "caption", pillar: lane === "other" ? "lifestyle" : lane }).issues.filter((i) => i.severity === "error");
          expect(errors, t).toEqual([]);
        }
      }
    }
    const trading = prompts.trading.map((p) => `${p.title} ${p.hook} ${p.about}`).join(" ");
    expect(trading).not.toMatch(/\$\d|\b\d+\s?R\b|\b(NQ|ES|SPY|BTC|ticker)\b|\bentry at\b|\b(buy|sell) (here|now)\b|%/);
  });
  it("is deterministic per week seed, rotates lanes and never repeats a present key", () => {
    const a = nicheIdeas(["gym", "trading", "lifestyle"], "2026-11-16", new Set());
    expect(a).toEqual(nicheIdeas(["gym", "trading", "lifestyle"], "2026-11-16", new Set()));
    expect(a.map((i) => i.lane)).toEqual(["gym", "trading", "other"]);
    expect(a.map((i) => i.pillar)).toEqual(["gym", "trading", "lifestyle"]);
    const b = nicheIdeas(["gym", "trading", "lifestyle"], "2026-11-16", new Set(a.map((i) => i.sourceKey)));
    expect(b).toHaveLength(3);
    expect(b.some((i) => a.some((x) => x.sourceKey === i.sourceKey))).toBe(false);
    expect(nicheIdeas(["gym"], "2026-11-16", new Set(prompts.gym.map((p) => nicheSourceKey("gym", p.key))))).toEqual([]);
  });
});

describe("parseYapScripts", () => {
  const md = readFileSync(new URL("../../../../docs/content/week-2026-11-16/yap-scripts.md", import.meta.url), "utf8");
  const data = parseYapScripts(md);
  it("finds all 20 scripts with hook, script, pillar, anchor text and URL", () => {
    expect(data.ideas).toHaveLength(20);
    const one = data.ideas[0]!;
    expect(one.sourceKey).toBe("yap-2026-11-16-#1");
    expect(one.title).toBe("Yap #1 · Trading: discipline vs. emotion");
    expect(one.pillar).toBe("trading");
    expect(one.hook).toBe("Your brain charges you double for every loss, and that's the whole reason you can't follow your own rules.");
    expect(one.script.startsWith("Your brain charges you double")).toBe(true);
    expect(one.script).toContain("You can stop letting it vote.");
    expect(one.script).not.toContain("<!--");
    expect(one.referenceUrl).toBe("https://en.wikipedia.org/wiki/Loss_aversion");
    expect(one.about).not.toMatch(/https?:|\*\*|verified/);
    expect(data.ideas[2]!.pillar).toBe("gym");
    expect(data.ideas[14]!.spare).toBe(true);
    expect(data.ideas[14]!.title).toBe("Yap #15 · Trading: discipline vs. emotion");
  });
  it("turns alt hooks into script hooks and passes the location lint everywhere", () => {
    expect(data.hooks).toHaveLength(20);
    expect(data.hooks[0]).toMatchObject({ sourceKey: "yap-2026-11-16-#1-alt", text: "The most expensive emotion in trading isn't greed." });
    for (const i of data.ideas) {
      for (const t of [i.title, i.hook, i.about, i.script]) expect(lintText({ text: t, kind: "hook" }).issues.filter((x) => x.rule.startsWith("privacy."))).toEqual([]);
    }
  });
  it("the committed bundle matches the markdown", () => {
    const bundled = JSON.parse(readFileSync(new URL("../../data/yap-2026-11-16.json", import.meta.url), "utf8"));
    expect(bundled).toEqual(JSON.parse(JSON.stringify(data)));
  });
});

describe("AI notes guard", () => {
  const req: NoteRequest = {
    kind: "reel",
    creatorHandle: "demo_lifter_one",
    pillar: "gym",
    pattern: "contrarian",
    hookLine: "Stop skipping your warm-up",
    ratio: 2.3,
    codeAbout: "a",
    codeAdapt: "b",
  };
  it("canSpend respects the monthly budget", () => {
    expect(canSpend({ inputTokens: 0, outputTokens: 0 }, 300_000, 1500)).toBe(true);
    expect(canSpend({ inputTokens: 299_000, outputTokens: 0 }, 300_000, 1500)).toBe(false);
    expect(canSpend({ inputTokens: 0, outputTokens: 0 }, 0, 1)).toBe(false);
  });
  it("discards notes that fail lint, name a place or quote beyond the hook line", () => {
    expect(checkAiNotes(req, { about: "A calm reel that opens with “Stop skipping your warm-up”.", adapt: "Use your own warm-up, said plainly." })).toBeNull();
    expect(checkAiNotes(req, { about: "This is INSANE!", adapt: "x y" })).toMatch(/tone/);
    expect(checkAiNotes(req, { about: "fine words here", adapt: "Film it at Riverside Fitness" })).toMatch(/privacy/);
    expect(checkAiNotes(req, { about: "They also said “here is my whole caption copy”", adapt: "fine" })).toMatch(/quotes/);
    expect(checkAiNotes(req, { about: "", adapt: "fine" })).toMatch(/empty/);
  });
  it("the fake writer records calls and reports tokens", async () => {
    const w = createFakeNoteWriter();
    const out = await w.write(req);
    expect(w.calls).toHaveLength(1);
    expect(out.usage.inputTokens).toBeGreaterThan(0);
  });
});

describe("settings + schedule", () => {
  it("AI notes default off with a 300k budget", () => {
    expect(parseResearchSettings(undefined)).toEqual({ aiNotes: false, aiMonthlyTokens: 300_000 });
    expect(parseResearchSettings({ aiNotes: "yes", aiMonthlyTokens: -1 })).toEqual({ aiNotes: false, aiMonthlyTokens: 300_000 });
    expect(parseResearchSettings({ aiNotes: true, aiMonthlyTokens: 1000 })).toEqual({ aiNotes: true, aiMonthlyTokens: 1000 });
  });
  it("nextRefreshAt follows the every-3-days cron", () => {
    expect(nextRefreshAt(new Date("2026-11-16T12:00:00Z")).toISOString()).toBe("2026-11-19T05:17:00.000Z");
    expect(nextRefreshAt(new Date("2026-11-19T05:00:00Z")).toISOString()).toBe("2026-11-19T05:17:00.000Z");
    expect(nextRefreshAt(new Date("2026-11-30T06:00:00Z")).toISOString()).toBe("2026-12-01T05:17:00.000Z");
  });
});
