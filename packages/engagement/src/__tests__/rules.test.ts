import { lintText } from "@autopilot/research";
import { describe, expect, it } from "vitest";
import { NEGATIVE_POOL, POSITIVE_POOL } from "../pools.js";
import { MIN_CONFIDENCE, postRules, preRules } from "../rules.js";
import type { InboundComment, TriageResult } from "../types.js";

const comment = (text: string, over: Partial<InboundComment> = {}): InboundComment => ({
  platform: "instagram",
  platformCommentId: "c1",
  platformMediaId: "m1",
  authorId: "a1",
  text,
  createdAt: "2026-11-13T12:00:00.000Z",
  isOwn: false,
  ownRepliesInThread: [],
  ...over,
});
const triage = (reply: string | null, over: Partial<TriageResult> = {}): TriageResult => ({
  bucket: "simple_positive",
  reply,
  confidence: 0.9,
  reasons: [],
  model: "test",
  ...over,
});

describe("preRules", () => {
  it.each([
    ["How long have you been lifting?", "question"],
    ["check out www.example.org", "link"],
    ["my page http://x.io", "link"],
    ["t.me/mygroup for more", "link"],
    ["linktree in my bio bro", "link"],
    ["which gym is that", "location/schedule"],
    ["is that the beach by you", "location/schedule"],
    ["what time do you train", "location/schedule"],
    ["we should meet up sometime", "location/schedule"],
    ["going tomorrow too", "location/schedule"],
    ["love to collab with you", "brand/business"],
    ["our brand wants to sponsor you", "brand/business"],
    ["dm me for a partnership", "brand/business"],
    ["join my telegram for signals", "brand/business"],
  ])("flags %j as %s", (text, reason) => {
    const hit = preRules(comment(text));
    expect(hit?.bucket).toBe("flag");
    expect(hit?.reason).toContain(reason);
  });

  it("flags blocklist terms case-insensitively", () => {
    expect(preRules(comment("Saw you at SECRETPLACE lol"), ["secretplace"])).toEqual({ bucket: "flag", reason: "blocklist" });
  });

  it("flags own comments", () => {
    expect(preRules(comment("nice", { isOwn: true }))).toEqual({ bucket: "flag", reason: "own comment" });
  });

  it.each(["Nice NY session", "London session was clean", "Asia session chop again", "NYSE open was wild", "Nasdaq ran hard"])(
    "does not flag market-session talk %j",
    (text) => {
      expect(preRules(comment(text))).toBeNull();
    },
  );

  it("market sessions are allowed even when the city is blocklisted, but the city alone is not", () => {
    expect(preRules(comment("London session was clean"), ["london"])).toBeNull();
    expect(preRules(comment("you live in London right"), ["london"])?.bucket).toBe("flag");
  });

  it.each([
    ["kys", "threat"],
    ["just kill yourself", "threat"],
    ["I know where you live", "doxxing"],
    ["call me 555-123-4567", "phone number"],
    ["You are a giveaway winner, send me $50", "scam"],
    ["drop your cash app", "scam"],
  ])("hide_flags %j (%s)", (text, reason) => {
    const hit = preRules(comment(text));
    expect(hit?.bucket).toBe("hide_flag");
    expect(hit?.reason).toContain(reason);
  });

  it("passes plain praise", () => {
    expect(preRules(comment("clean form, love this"))).toBeNull();
  });
});

describe("postRules", () => {
  const c = comment("great video");
  const flagged = (r: TriageResult) => r.bucket === "flag";

  it("passes a clean 3-word reply with confidence 0.9", () => {
    const r = triage("Appreciate you man");
    expect(postRules(r, c)).toEqual(r);
  });

  it.each([
    ["swearing", triage("Damn appreciate it man")],
    ["9 words", triage("Thanks so much man this really means a lot")],
    ["place name", triage("see you at Riverside Park")],
    ["low confidence", triage("Appreciate you man", { confidence: 0.6 })],
    ["refused", triage("Appreciate you man", { refused: true })],
    ["question", triage("Appreciate it, you train too?")],
    ["link", triage("More at www.example.org")],
    ["null reply", triage(null)],
    ["negative bucket swearing", triage("Have a damn great day", { bucket: "negative" })],
  ])("flags %s", (_name, r) => {
    const out = postRules(r, c);
    expect(flagged(out)).toBe(true);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("names its reasons and appends to existing ones", () => {
    expect(postRules(triage(null, { reasons: ["model"] }), c).reasons).toEqual(["model", "no draft"]);
    expect(postRules(triage("Appreciate you man", { confidence: MIN_CONFIDENCE - 0.1 }), c).reasons).toContain("low confidence");
    expect(postRules(triage("Appreciate you man", { refused: true }), c).reasons).toContain("model refused");
    expect(postRules(triage("Damn appreciate it man"), c).reasons.join()).toContain("tone.swear");
    expect(postRules(triage("see you at Riverside Park"), c).reasons.join()).toContain("privacy.place");
  });

  it("applies the blocklist to the draft", () => {
    expect(postRules(triage("Greetings from Secretville man"), c, ["secretville"]).bucket).toBe("flag");
  });

  it("leaves flag and hide_flag untouched", () => {
    const f = triage(null, { bucket: "flag", reasons: ["q"] });
    const h = triage(null, { bucket: "hide_flag", reasons: ["threat"] });
    expect(postRules(f, c)).toBe(f);
    expect(postRules(h, c)).toBe(h);
  });
});

describe("pools", () => {
  it("has enough lines", () => {
    expect(POSITIVE_POOL.length).toBeGreaterThanOrEqual(12);
    expect(NEGATIVE_POOL.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps the voice.md seeds verbatim", () => {
    expect(POSITIVE_POOL.slice(0, 5)).toEqual([
      "Appreciate you man",
      "Thanks, means a lot",
      "Appreciate it 🙏",
      "Haha appreciate that",
      "Thank you, more coming",
    ]);
    expect(NEGATIVE_POOL.slice(0, 4)).toEqual([
      "Have a great day 😊👍",
      "Appreciate you watching 😊",
      "Hope your day's going well 👍",
      "Thanks for stopping by 😊",
    ]);
  });

  it.each([...POSITIVE_POOL, ...NEGATIVE_POOL])("%j passes lintText(reply) and the post-rules", (line) => {
    const lint = lintText({ text: line, kind: "reply" });
    expect(lint.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(lint.issues.filter((i) => i.rule === "reply.length")).toEqual([]);
    expect(postRules(triage(line), comment("great video")).bucket).toBe("simple_positive");
  });

  it("has no duplicates", () => {
    const all = [...POSITIVE_POOL, ...NEGATIVE_POOL].map((s) => s.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});
