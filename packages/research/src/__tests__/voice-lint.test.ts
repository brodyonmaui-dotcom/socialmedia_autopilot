import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// F7 C4: fuzzed privacy phrasings, plus the market-session allowlist (run-2-decisions F7 #2).
const privacyRules = (r: ReturnType<typeof lintText>) => rules(r).filter((x) => x.startsWith("privacy."));

describe("lintText: privacy hardening (F7 C4)", () => {
  it.each([
    ["📍 Riverside", "privacy.pin"],
    ["Leg day 📍downtown", "privacy.pin"],
    ["🗺️ my running loop", "privacy.pin"],
    ["🧭 north side spot", "privacy.pin"],
    ["Springfield, IL 62701", "privacy.postcode"],
    ["zip 62701-1234 if you want to send stuff", "privacy.postcode"],
    ["new place, Illinois 62701", "privacy.postcode"],
    ["Ended up near SW1A 1AA after the run", "privacy.postcode"],
    ["post run M1 1AE", "privacy.postcode"],
    ["Lifting at 123 Main St today", "privacy.address"],
    ["moved to 42 Elm Drive", "privacy.address"],
    ["850 Cedar Ln is the spot", "privacy.address"],
    ["at the Riverside gym rn", "privacy.place"],
    ["Hit the Oak Ridge trail again…", "privacy.place"],
    ["hit the trail by the River again", "privacy.place"],
    ["Pull day @ Riverside…", "privacy.place"],
  ])("%s → %s", (text, rule) => {
    const r = lintText({ text, kind: "caption" });
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain(rule);
  });

  it.each([
    "Scalped the NY session open, BOS then FVG fill. Not financial advice.",
    "Right now in the NY session, CHoCH on the 5m",
    "London session was choppy, sat on my hands",
    "currently in the London session, waiting",
    "Asia session range held overnight",
    "Tokyo session did nothing again…",
    "NYSE closed early today",
    "Nasdaq ripped at the open #nasdaq",
    "Took one trade at the London open, BE",
    "New York open was a mess",
    "Flat into the New York close",
    "Only trade the killzone now…",
    "rn in the killzone, waiting on a sweep",
    "Pull day @ NY open lol",
    "NQ 21500 tapped, CHoCH + FVG, entry on M5 1PM",
    "SMT + BOS on H1 4PM candle",
  ])("market-session / trading terms are not places: %s", (text) => {
    expect(privacyRules(lintText({ text, kind: "caption", pillar: "trading" }))).toEqual([]);
  });

  it("pins without text, ordinary numbers and the campus gym stay fine", () => {
    for (const text of ["Rest day 🧭", "Ran 10000 steps, 12345 total this week", "Hit the campus gym after class…", "New PR at the gym 🗺️", "Week 3 of the 5x5 program"]) {
      expect(privacyRules(lintText({ text, kind: "caption" }))).toEqual([]);
    }
  });

  // Every example caption/reply quoted in docs/voice.md (the file quotes ~25 lines, not 20 full captions).
  const VOICE_EXAMPLES = [
    "My lats are not a fan of this pull day…",
    "Definitely due for a bull again…",
    "Just stacking days is all 🙂‍↕️…",
    "November 2nd P/L +$806, SMT + BOS towards data high for a 1:1R. Happy to take profits before price reversed and dumped the rest of the day",
    "Welp, I was the liquidity today 🥀",
    "Great learning experience today, psychology needs some work.",
    "Keeping it simple, high protein, and consistent.",
    "Another day of eating while balancing college, training, and everything in between.",
    "Most people don't need more back days. They need better reps.",
    "Get shredded, not stiff",
    "Got absolutely wrecked by blisters on both feet post run 😔",
    "What's your go-to back exercise? 👇",
    "I was the liquidity today 🥀",
    "BOS (break of structure)",
    "revenge traded and took an L",
    "stops set too tight",
    "Appreciate you man",
    "Thanks, means a lot",
    "Appreciate it 🙏",
    "Haha appreciate that",
    "Thank you, more coming",
    "Have a great day 😊👍",
    "Appreciate you watching 😊",
    "Hope your day's going well 👍",
    "Thanks for stopping by 😊",
  ];
  const voiceMd = readFileSync(fileURLToPath(new URL("../../../../docs/voice.md", import.meta.url)), "utf8");
  it.each(VOICE_EXAMPLES)("voice.md example has no privacy issues: %s", (text) => {
    expect(voiceMd).toContain(text);
    expect(privacyRules(lintText({ text, kind: "caption" }))).toEqual([]);
  });
});
