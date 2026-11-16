import { lintText } from "@autopilot/research";
import { describe, expect, it } from "vitest";
import { NEGATIVE_POOL, POSITIVE_POOL } from "../pools.js";
import { MIN_CONFIDENCE, isRhetoricalPraise, postRules, preRules, promoAuthorKey, promoRule } from "../rules.js";
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
    ["see you there tomorrow", "location/schedule"],
    ["are you near shelbyville", "location/schedule"],
    ["can we meet sometime", "location/schedule"],
    ["when are you there usually", "location/schedule"],
    ["what part of town is that", "location/schedule"],
    ["your location?", "location/schedule"],
    ["how long have you been training", "question"],
    ["do you take creatine", "question"],
    ["what shoes are those", "question"],
    ["do you offer coaching?", "brand/business"],
    ["send me your rate card", "brand/business"],
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

  it.each([
    "love the gym content", "park sessions are the best kind", "beach workouts hit different", "can't wait for tomorrow's video",
    "tonight's upload was great", "best channel in the city honestly", "this lands near the top of my feed", "gonna visit this again",
    "love how you schedule your blocks", "meet the new PR king", "the brand of discipline is unreal", "business mindset in the gym is gold",
    "pricing in the discipline lol", "this promo-free channel is great", "what a lift", "what a set 🔥", "nice trail run",
    "@friend look at this", "@gym_buddy_91 we need to try this", "made +12500 on that trade", "hit 10000 subs soon",
  ])("bare topical words / plain mentions no longer flag: %j", (text) => {
    expect(preRules(comment(text))).toBeNull();
  });

  it.each(["how are you this good?!", "bro what 🔥?"])("rhetorical praise %j is left to the model", (text) => {
    expect(isRhetoricalPraise(text)).toBe(true);
    expect(preRules(comment(text))).toBeNull();
  });

  it.each(["is this your gym?", "how are you this strong at the park?!", "📍?", "what 🔥 gym is that?"])("a question with a whereabouts topic is never rhetorical: %j", (text) => {
    expect(isRhetoricalPraise(text)).toBe(false);
    expect(preRules(comment(text))?.bucket).toBe("flag");
  });
});

describe("promoRule", () => {
  it.each([
    ["love it 🔥 send it to @fit_features_hub", "promo:send-to"],
    ["send this to @gains_repost_page", "promo:send-to"],
    ["post it on @gymtok_features_hub please", "promo:send-to"],
    ["DM us to be featured", "promo:dm-feature"],
    ["dm @trade_feature_daily for promo", "promo:dm-feature"],
    ["amazing! dm us for collab and promo", "promo:dm-feature"],
    ["Great content! Promote it on @fitness_boost_hub", "promo:promote-on"],
    ["get featured on our page", "promo:get-featured"],
    ["We’d love to feature you on our page!", "promo:feature-you"],
    ["paid promotion available, inbox us", "promo:paid-promo"],
    ["shoutout for shoutout?", "promo:s4s"],
    ["s4s 🔥", "promo:s4s"],
    ["check out our page for more gains", "promo:check-our-page"],
    ["grow your page with real followers", "promo:growth"],
    ["buy 10k followers cheap", "promo:growth"],
    ["nice 🔥 submit to @gym_reels_spot", "promo:send-to"],
  ])("%j → %s", (text, reason) => {
    expect(promoRule(text)).toEqual({ bucket: "spam_promo", reason });
    expect(preRules(comment(text))).toEqual({ bucket: "spam_promo", reason });
  });

  it.each(["@friend look at this", "@lift_pal_3 we need to try this", "i'll send this to @my_bro_22", "just sent it to @gym_buddy_91 lol", "love to collab with you", "dm me for a partnership"])(
    "is conservative: %j is not promo",
    (text) => {
      expect(promoRule(text)).toBeNull();
    },
  );

  it("matches the promo list by author id, else by lower-cased handle, per platform", () => {
    const list = [{ platform: "instagram" as const, authorKey: "17840001" }, { platform: "instagram" as const, authorKey: "spam_repeat_7" }];
    expect(promoRule("nice video", { platform: "instagram", authorId: "17840001" }, list)?.reason).toBe("promo:list");
    expect(promoRule("nice video", { platform: "instagram", authorId: null, authorHandle: "@Spam_Repeat_7" }, list)?.reason).toBe("promo:list");
    expect(promoRule("nice video", { platform: "youtube", authorId: "17840001" }, list)).toBeNull();
    expect(promoRule("nice video", { platform: "instagram", authorId: "other" }, list)).toBeNull();
    expect(promoAuthorKey(" 1784 ", "x")).toBe("1784");
    expect(promoAuthorKey(null, "@Some_Page")).toBe("some_page");
    expect(promoAuthorKey(null, undefined)).toBeNull();
  });

  it("HIDE beats promo; whereabouts and blocklist beat promo; promo beats link and business", () => {
    expect(preRules(comment("kys, send it to @hate_page"))?.bucket).toBe("hide_flag");
    const loc = preRules(comment("send it to @x_page, where is this gym?"));
    expect(loc?.bucket).toBe("flag");
    expect(loc?.reason).toContain("promo:send-to");
    expect(preRules(comment("send it to @x_page fooville"), ["fooville"])?.bucket).toBe("flag");
    expect(preRules(comment("DM us for promo www.example.org"))?.bucket).toBe("spam_promo");
    expect(preRules(comment("dm us to be featured, collab?"))?.bucket).toBe("spam_promo");
  });

  it("skipPromo (Not spam) re-runs the rules without the promo rule", () => {
    expect(preRules(comment("check out our page"), [], { skipPromo: true })).toBeNull();
    expect(preRules(comment("send it to @page_x"), [], { skipPromo: true, promoAccounts: [{ platform: "instagram", authorKey: "a1" }] })).toBeNull();
    expect(preRules(comment("nice"), [], { promoAccounts: [{ platform: "instagram", authorKey: "a1" }] })?.reason).toBe("promo:list");
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

  it("spam_promo stays promo with no reply; after Not spam (allowPromo false) it becomes a flag", () => {
    const p = triage("Appreciate you man", { bucket: "spam_promo" });
    expect(postRules(p, c)).toMatchObject({ bucket: "spam_promo", reply: null });
    expect(postRules(p, c, [], { allowPromo: false })).toMatchObject({ bucket: "flag", reply: null });
  });

  it("a question-shaped comment never gets the negative pool", () => {
    expect(postRules(triage("Have a great day 😊👍", { bucket: "negative" }), comment("is this fake?")).bucket).toBe("flag");
    expect(postRules(triage("Appreciate you man"), comment("how are you this good?!")).bucket).toBe("simple_positive");
    expect(postRules(triage("Appreciate you man", { confidence: 0.6 }), comment("how are you this good?!")).bucket).toBe("flag");
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
