import { describe, expect, it } from "vitest";
import { planActions } from "../planner.js";
import { preRules } from "../rules.js";
import { DEFAULT_ENGAGEMENT, normalizeEngagement } from "../settings.js";
import type { ActionHistory, EngagementPlatform, InboundComment, TriageResult } from "../types.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");

interface FakeAnswers {
  lastReplies?: string[];
  toAuthor?: (since: Date) => string[];
  uses?: (text: string) => number;
  blocked?: boolean;
}
function fakeHistory(a: FakeAnswers = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const h: ActionHistory = {
    async lastRepliesOn(platform: EngagementPlatform, n: number) {
      calls.push({ fn: "lastRepliesOn", args: [platform, n] });
      return a.lastReplies ?? [];
    },
    async repliesToAuthorSince(platform, authorId, since) {
      calls.push({ fn: "repliesToAuthorSince", args: [platform, authorId, since] });
      return a.toAuthor?.(since) ?? [];
    },
    async countSent() {
      return 0;
    },
    async textUseCount(_p, text) {
      return a.uses?.(text) ?? 0;
    },
    async isBlockedAuthor(platform, authorId) {
      calls.push({ fn: "isBlockedAuthor", args: [platform, authorId] });
      return a.blocked ?? false;
    },
  };
  return { h, calls };
}

const comment = (over: Partial<InboundComment> = {}): InboundComment => ({
  platform: "instagram",
  platformCommentId: "c1",
  platformMediaId: "m1",
  authorId: "a1",
  text: "great video",
  createdAt: NOW.toISOString(),
  isOwn: false,
  ownRepliesInThread: [],
  ...over,
});
const triage = (over: Partial<TriageResult> = {}): TriageResult => ({
  bucket: "simple_positive",
  reply: "Appreciate you man",
  confidence: 0.9,
  reasons: [],
  model: "test",
  ...over,
});
const S = DEFAULT_ENGAGEMENT;

describe("planActions", () => {
  it("a location question is flagged, never replied to", async () => {
    const c = comment({ text: "which gym do you go to?" });
    const hit = preRules(c);
    expect(hit?.bucket).toBe("flag");
    const t = triage({ bucket: "flag", reply: null, reasons: [hit!.reason], model: "rules" });
    const out = await planActions(c, t, S, fakeHistory().h, NOW);
    expect(out).toEqual([{ kind: "flag", reason: "question, location/schedule" }]);
  });

  it("joins flag reasons", async () => {
    const out = await planActions(comment(), triage({ bucket: "flag", reasons: ["a", "b"] }), S, fakeHistory().h, NOW);
    expect(out).toEqual([{ kind: "flag", reason: "a; b" }]);
  });

  it("own comments → none", async () => {
    expect(await planActions(comment({ isOwn: true }), triage(), S, fakeHistory().h, NOW)).toEqual([
      { kind: "none", reason: "own comment" },
    ]);
  });

  it("mode off → none (TikTok is off by default); shadow still plans", async () => {
    expect(await planActions(comment({ platform: "tiktok" }), triage(), S, fakeHistory().h, NOW)).toEqual([
      { kind: "none", reason: "mode off" },
    ]);
    const off = normalizeEngagement({ mode: { instagram: "off" } });
    expect(await planActions(comment(), triage(), off, fakeHistory().h, NOW)).toEqual([{ kind: "none", reason: "mode off" }]);
    expect((await planActions(comment(), triage(), S, fakeHistory().h, NOW))[0]?.kind).toBe("reply");
  });

  it("per-person limit → none, looking back perPersonDays", async () => {
    const { h, calls } = fakeHistory({ toAuthor: (since) => (since.getTime() === NOW.getTime() - 7 * 86_400_000 ? ["Thanks man"] : []) });
    expect(await planActions(comment(), triage(), S, h, NOW)).toEqual([{ kind: "none", reason: "per-person limit" }]);
    expect(calls.find((c) => c.fn === "repliesToAuthorSince")?.args.slice(0, 2)).toEqual(["instagram", "a1"]);
  });

  it("human replied in the thread → none", async () => {
    const c = comment({ ownRepliesInThread: [{ platformCommentId: "r1", text: "thanks bro", createdAt: NOW.toISOString() }] });
    expect(await planActions(c, triage(), S, fakeHistory().h, NOW)).toEqual([{ kind: "none", reason: "human replied" }]);
  });

  it("blocked author → flag", async () => {
    expect(await planActions(comment(), triage(), S, fakeHistory({ blocked: true }).h, NOW)).toEqual([
      { kind: "flag", reason: "blocked author" },
    ]);
  });

  it("hide_flag: hideEnabled false → flag, true → hide with the veto delay", async () => {
    const t = triage({ bucket: "hide_flag", reply: null, reasons: ["threat"] });
    expect(await planActions(comment(), t, S, fakeHistory().h, NOW)).toEqual([{ kind: "flag", reason: "hide suggested: threat" }]);
    const on = normalizeEngagement({ hideEnabled: { instagram: true } });
    expect(await planActions(comment(), t, on, fakeHistory().h, NOW)).toEqual([
      { kind: "hide", notBefore: "2026-11-13T12:10:00.000Z" },
    ]);
  });

  it("a reply gets notBefore = now + 10 min and comes from the draft or the right pool", async () => {
    const out = await planActions(comment(), triage(), S, fakeHistory().h, NOW);
    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a?.kind).toBe("reply");
    if (a?.kind !== "reply") return;
    expect(a.notBefore).toBe("2026-11-13T12:10:00.000Z");
    expect(["Appreciate you man", ...S.pools.positive]).toContain(a.text);

    const neg = await planActions(comment(), triage({ bucket: "negative", reply: null }), S, fakeHistory().h, NOW);
    expect(neg[0]?.kind === "reply" && S.pools.negative.includes(neg[0].text)).toBe(true);
  });

  it("is deterministic per comment id", async () => {
    const a = await planActions(comment(), triage(), S, fakeHistory().h, NOW);
    const b = await planActions(comment(), triage(), S, fakeHistory().h, NOW);
    expect(a).toEqual(b);
  });

  it("never picks a recent, overused or already-sent-to-author text", async () => {
    const s = normalizeEngagement({ pools: { positive: ["Glad it helped", "Haha thanks man", "Really appreciate that", "Appreciate the love"] } });
    const { h } = fakeHistory({
      lastReplies: ["Glad it helped"],
      toAuthor: (since) => (since.getTime() === NOW.getTime() - 30 * 86_400_000 ? ["Haha thanks man"] : []),
      uses: (text) => (text === "Really appreciate that" ? 3 : 2),
    });
    for (let i = 0; i < 20; i++) {
      const out = await planActions(comment({ platformCommentId: `c${i}` }), triage({ reply: null }), s, h, NOW);
      expect(out).toEqual([{ kind: "reply", text: "Appreciate the love", notBefore: "2026-11-13T12:10:00.000Z" }]);
    }
  });

  it("rotation exhausted → flag", async () => {
    const s = normalizeEngagement({ pools: { positive: ["Glad it helped"] } });
    const { h } = fakeHistory({ lastReplies: ["Appreciate you man", "Glad it helped"] });
    expect(await planActions(comment(), triage(), s, h, NOW)).toEqual([{ kind: "flag", reason: "rotation exhausted" }]);
  });

  it("authorId null still plans a reply without author lookups (caps hold at send time)", async () => {
    const { h, calls } = fakeHistory({ blocked: true, toAuthor: () => ["x"] });
    const out = await planActions(comment({ authorId: null }), triage(), S, h, NOW);
    expect(out[0]?.kind).toBe("reply");
    expect(calls.some((c) => c.fn === "isBlockedAuthor" || c.fn === "repliesToAuthorSince")).toBe(false);
  });
});
