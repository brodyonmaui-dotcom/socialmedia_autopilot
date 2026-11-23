import { describe, expect, it } from "vitest";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import { planActions } from "../planner.js";
import { POSITIVE_POOL } from "../pools.js";
import { postRules, preRules } from "../rules.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { simulateEngagement } from "../sim/simulate-engagement.js";
import { createRulesOnlyTriageClient, RULES_ONLY_MODEL } from "../triage-rules.js";
import type { InboundComment, TriageResult } from "../types.js";

const NOW = new Date("2026-11-22T12:00:00Z");
const c = (text: string, p: Partial<InboundComment> = {}): InboundComment => ({
  platform: "instagram",
  platformCommentId: `c-${text}`,
  platformMediaId: "m",
  authorId: "fan-1",
  text,
  createdAt: "2026-11-22T11:00:00.000Z",
  isOwn: false,
  ownRepliesInThread: [],
  ...p,
});

/** The worker's pipeline without a model key: preRules → rules-only → postRules. */
async function triage(comment: InboundComment): Promise<TriageResult> {
  const hit = preRules(comment, []);
  if (hit) return { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" };
  return postRules(await createRulesOnlyTriageClient().triage(comment, {}), comment, []);
}

describe("createRulesOnlyTriageClient", () => {
  it.each(["love this", "this is fire 🔥", "🔥🔥🔥", "clean form bro", "great tip, thanks", "W"])("simple praise %s → drafted pool reply", async (text) => {
    const r = await triage(c(text));
    expect(r).toMatchObject({ bucket: "simple_positive", model: RULES_ONLY_MODEL });
    const actions = await planActions(c(text), r, DEFAULT_ENGAGEMENT, new MemoryEngagementStore(), NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("reply");
    expect(POSITIVE_POOL).toContain((actions[0] as { text: string }).text);
  });

  it.each([
    ["how many sets do you do?", "question"],
    ["how are you this good?!", "question"],
    ["what program do you run", "question"],
    ["this is so fake", "negative"],
    ["cringe", "negative"],
    ["nobody asked 👎", "negative"],
    ["rip to my grandpa he loved these", "sensitive"],
    ["honestly this video came at the right time for me because I have been struggling a lot with my training lately", "long"],
  ])("%s → Needs you (%s)", async (text) => {
    const r = await triage(c(text));
    expect(r.bucket).toBe("flag");
    expect(r.reply).toBeNull();
  });

  it("pre-rules still win: promo stays promo (no reply), whereabouts and business flag", async () => {
    expect((await triage(c("love it 🔥 send it to @fit_features_hub"))).bucket).toBe("spam_promo");
    expect((await triage(c("nice, which gym is this"))).bucket).toBe("flag");
    expect((await triage(c("love it, dm me for a collab"))).bucket).toBe("flag");
    // A listed promo account never gets a draft, however nice the text.
    const listed = c("great stuff", { authorId: "spam-1" });
    expect(preRules(listed, [], { promoAccounts: [{ platform: "instagram", authorKey: "spam-1" }] })?.bucket).toBe("spam_promo");
  });

  it("same per-person limit and rotation as model drafts", async () => {
    const store = new MemoryEngagementStore();
    store.addAction({ commentId: "old", kind: "reply", text: "Appreciate you man", status: "sent", notBefore: NOW.toISOString(), platform: "instagram", platformCommentId: "old", authorId: "fan-1", sentAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() });
    const r = await triage(c("love this"));
    const out = await planActions(c("love this"), r, DEFAULT_ENGAGEMENT, store, NOW);
    expect(out).toEqual([{ kind: "none", reason: "per-person limit" }]);
  });

  it("full simulation with rules-only triage: every invariant 0 (no double, promo or location replies)", async () => {
    for (const mode of ["shadow", "live-fake"] as const) {
      const r = await simulateEngagement({ mode, triage: createRulesOnlyTriageClient() });
      expect(r.ok, r.summary).toBe(true);
      expect(r.replies).toBeGreaterThan(0);
      expect(r.flags).toBeGreaterThan(0);
    }
  });
});
