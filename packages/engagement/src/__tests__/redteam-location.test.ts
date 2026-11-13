// F7 C6: location/schedule comments never get a reply; praise replies never carry a `?`, a URL,
// a place pattern (lintText privacy rules) or a blocklist term. Fuzzed from a seeded grammar.
import { describe, expect, it } from "vitest";
import { lintText } from "@autopilot/research";
import { planActions } from "../planner.js";
import { seededRng } from "../rotation.js";
import { postRules, preRules } from "../rules.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { createFakeTriageClient } from "../triage-fake.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import type { EngagementSettings, InboundComment, PlannedAction, TriageResult } from "../types.js";

const BLOCKLIST = ["fooville", "quuxton"]; // test-only private terms
const settings: EngagementSettings = {
  ...DEFAULT_ENGAGEMENT,
  mode: { instagram: "live", youtube: "live", tiktok: "off" },
  hideEnabled: { instagram: true, youtube: true, tiktok: false },
};
const triage = createFakeTriageClient();
const NOW = new Date("2026-01-05T15:00:00Z");

async function pipeline(text: string, i: number): Promise<{ t: TriageResult; plan: PlannedAction[] }> {
  const c: InboundComment = {
    platform: i % 2 ? "instagram" : "youtube", platformCommentId: `c${i}`, platformMediaId: "m", authorId: `u${i}`,
    text, createdAt: NOW.toISOString(), isOwn: false, ownRepliesInThread: [],
  };
  const hit = preRules(c, BLOCKLIST);
  const t: TriageResult = hit
    ? { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" }
    : postRules(await triage.triage(c, {}), c, BLOCKLIST);
  return { t, plan: await planActions(c, t, settings, new MemoryEngagementStore(), NOW) };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const PRAISE = ["love this", "so clean", "great video man", "nice form", "thank you for this", "this is fire 🔥", "love the energy", "great tip"];
const NAMES = ["Fooville", "Maple", "Oak Ridge", "Riverside", "Quuxton", "Elmwood"];
const LOCATION: Array<(r: () => number) => string> = [
  () => "where is this",
  () => "where is this?",
  () => "where u at",
  () => "which gym",
  () => "which gym is this",
  () => "what trail",
  () => "what trail is that",
  () => "📍?",
  () => "📍??",
  () => "see you at the park tomorrow",
  () => "see u at the beach tonight",
  (r) => `u live in ${pick(r, NAMES)}?`,
  (r) => `you live in ${pick(r, NAMES)}`,
  (r) => `do you train in ${pick(r, NAMES)}`,
  () => "drop the address",
  () => "whats the address",
  (r) => `${1 + Math.floor(r() * 9000)} ${pick(r, NAMES)} ${pick(r, ["St", "Street", "Ave", "Avenue", "Rd", "Road", "Blvd", "Lane", "Drive"])}`,
  (r) => `${1 + Math.floor(r() * 900)} ${pick(r, ["maple", "oak", "elm", "main"])} ${pick(r, ["st", "ave", "rd", "blvd"])}`,
  (r) => `${10000 + Math.floor(r() * 89999)}`,
  (r) => `is that ${10000 + Math.floor(r() * 89999)}`,
  (r) => `zip ${10000 + Math.floor(r() * 89999)}-${1000 + Math.floor(r() * 8999)}`,
  () => "when do you train",
  () => "when do u usually lift",
  () => "what time u there",
  () => "what time do you go",
  () => "meet up?",
  () => "lets meet up",
  () => "can i come train with you",
  () => "near me?",
  () => "what city",
];

describe("C6: location/schedule comments always flag, never reply (500 fuzzed)", () => {
  it("every one ends as flag/hide_flag with no reply text", async () => {
    const rng = seededRng("c6-location");
    const leaks: string[] = [];
    for (let i = 0; i < 500; i++) {
      const loc = pick(rng, LOCATION)(rng);
      const mix = rng();
      const text = mix < 0.33 ? loc : mix < 0.66 ? `${pick(rng, PRAISE)} ${loc}` : `${loc} ${pick(rng, PRAISE)}`;
      const { t, plan } = await pipeline(text, i);
      const ok = (t.bucket === "flag" || t.bucket === "hide_flag") && !plan.some((p) => p.kind === "reply");
      if (!ok) leaks.push(`${JSON.stringify(text)} → ${t.bucket}`);
    }
    expect([...new Set(leaks)]).toEqual([]);
  });
});

describe("C6: praise replies are clean (500 fuzzed)", () => {
  const EXTRA = ["", " 📍", " 📍🔥", " clean NY session", " great London open", " nice Asia session read", " NY open was clean", " 🙌"];
  it("no planned reply has a ?, a URL, a place pattern or a blocklist term; NY session + 📍 praise isn't flagged", async () => {
    const rng = seededRng("c6-praise");
    const bad: string[] = [];
    const flaggedSafe: string[] = [];
    let replies = 0;
    for (let i = 0; i < 500; i++) {
      const extra = pick(rng, EXTRA);
      const text = `${pick(rng, PRAISE)}${extra}`;
      const { t, plan } = await pipeline(text, i);
      for (const p of plan) {
        if (p.kind !== "reply") continue;
        replies++;
        const lint = lintText({ text: p.text, kind: "reply", blocklist: BLOCKLIST });
        const privacy = lint.issues.filter((x) => x.rule.startsWith("privacy."));
        if (p.text.includes("?") || /https?:|www\.|\.com\b/i.test(p.text) || privacy.length || BLOCKLIST.some((b) => p.text.toLowerCase().includes(b))) bad.push(p.text);
      }
      if (t.bucket === "flag" || t.bucket === "hide_flag") flaggedSafe.push(`${JSON.stringify(text)}: ${t.reasons.join("; ")}`);
    }
    expect(bad).toEqual([]);
    expect([...new Set(flaggedSafe)]).toEqual([]);
    expect(replies).toBe(500);
  });

  it("a praise comment carrying a blocklist term is flagged, not answered", async () => {
    const { t, plan } = await pipeline("love this, greetings from fooville", 1);
    expect(t.bucket).toBe("flag");
    expect(plan.some((p) => p.kind === "reply")).toBe(false);
  });
});
