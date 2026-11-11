import { describe, expect, it } from "vitest";
import { blocklistFromEnv, hashtags, lintText } from "../voice-lint.js";

const rules = (r: ReturnType<typeof lintText>) => r.issues.map((i) => i.rule);

describe("lintText: his real captions pass", () => {
  it.each([
    ["My lats are not a fan of this pull day…", "gym"],
    ["Welp, I was the liquidity today 🥀", "trading"],
    ["Just stacking days is all 🙂‍↕️…", "gym"],
    ["Got absolutely wrecked by blisters on both feet post run 😔", "running"],
    ["Most people don't need more back days. They need better reps.", "tip"],
  ] as const)("%s", (text, pillar) => {
    const r = lintText({ text, kind: "caption", platform: "instagram", pillar });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("a ZWJ emoji counts once, two emojis is an error, meal lists are exempt", () => {
    expect(rules(lintText({ text: "Pull day 😔🥀", kind: "caption" }))).toContain("tone.emoji-count");
    const meal = "Weekly Meal Prep 🥣🌯\n- 🍌 oats\n- 🌯 wraps\nKeeping it simple, high protein, and consistent.";
    expect(lintText({ text: meal, kind: "caption", pillar: "meal" }).ok).toBe(true);
  });
});

describe("lintText: privacy (location boundary) is always an error", () => {
  it.each([
    ["Leg day at Riverside Fitness…", "privacy.place"],
    ["Morning run on Oak Ridge Trail", "privacy.place"],
    ["Finals week at University of Somewhere", "privacy.place"],
    ["Right now at the Downtown spot", "privacy.realtime"],
    ["heading to the gym, come find me", "privacy.realtime"],
    ["spot: 21.3069, -157.8583", "privacy.coords"],
  ])("%s", (text, rule) => {
    const r = lintText({ text, kind: "caption" });
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain(rule);
  });

  it("vague references are fine", () => {
    expect(lintText({ text: "Balancing college, lifting, and everything in between.", kind: "caption" }).ok).toBe(true);
    expect(lintText({ text: "Back on campus, back to the grind…", kind: "caption" }).ok).toBe(true);
  });

  it("runtime blocklist terms are caught case-insensitively and never echoed", () => {
    const r = lintText({ text: "Leg day in springfield…", kind: "caption", blocklist: ["Springfield"] });
    expect(rules(r)).toContain("privacy.blocklist");
    expect(JSON.stringify(r)).not.toMatch(/springfield/i);
  });

  it("reads PRIVACY_BLOCKLIST", () => {
    expect(blocklistFromEnv({ PRIVACY_BLOCKLIST: " a, b ,," })).toEqual(["a", "b"]);
    expect(blocklistFromEnv({})).toEqual([]);
  });
});

describe("lintText: tone, numbers, trading, platform", () => {
  it("rejects hype, 🔥 strings and engagement bait", () => {
    expect(rules(lintText({ text: "INSANE pump let's gooo", kind: "caption" }))).toEqual(expect.arrayContaining(["tone.hype", "tone.caps"]));
    expect(rules(lintText({ text: "Pump 🔥", kind: "caption" }))).toContain("tone.emoji-hype");
    expect(rules(lintText({ text: "Follow for more…", kind: "caption" }))).toContain("tone.cta");
    expect(rules(lintText({ text: "Comment PLAN for my split", kind: "caption" }))).toContain("tone.cta");
  });

  it("keeps trading acronyms, blocks placeholders and trade calls, wants NFA on results", () => {
    const ok = "November 2nd P/L +$806, SMT + BOS towards data high for a 1:1R. Not financial advice.";
    expect(lintText({ text: ok, kind: "caption", pillar: "trading" }).issues).toEqual([]);
    expect(rules(lintText({ text: "P/L {{P/L}} today", kind: "caption", pillar: "trading" }))).toContain("numbers.placeholder");
    expect(rules(lintText({ text: "Buy here before the open", kind: "caption", pillar: "trading" }))).toContain("trading.call");
    const noNfa = lintText({ text: "P/L +$200 on a 1:2R", kind: "caption", pillar: "trading" });
    expect(noNfa.ok).toBe(true);
    expect(rules(noNfa)).toContain("trading.nfa");
  });

  it("hashtag limits per platform; IG over 5 is an error, others warn", () => {
    const six = "Pull day… #a #b #c #d #e #f";
    expect(hashtags(six)).toHaveLength(6);
    expect(lintText({ text: six, kind: "caption", platform: "instagram" }).ok).toBe(false);
    const tt = lintText({ text: "Pull day… #gym", kind: "caption", platform: "tiktok" });
    expect(tt.ok).toBe(true);
    expect(rules(tt)).toContain("hashtags.min");
    expect(rules(lintText({ text: "x #a #b #c", kind: "caption", platform: "snapchat" }))).toContain("hashtags.max");
  });

  it("YouTube titles cap at 60 characters", () => {
    expect(lintText({ text: "I was the liquidity today 🥀", kind: "title" }).ok).toBe(true);
    expect(rules(lintText({ text: "x".repeat(61), kind: "title" }))).toContain("youtube.title");
  });

  it("replies and DMs never swear; captions may", () => {
    expect(lintText({ text: "damn this pump…", kind: "caption" }).ok).toBe(true);
    expect(rules(lintText({ text: "damn thanks man", kind: "reply" }))).toContain("tone.swear");
    expect(rules(lintText({ text: "Appreciate you man, really means a lot to me", kind: "reply" }))).toContain("reply.length");
  });
});
