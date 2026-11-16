// Run 4: promo spam gets a triage row and nothing else; "Not spam" re-triage; repeat spammers listed by
// rule; reply-ready pings paced by engagement.pings; promo DM threads ignored without a draft.
import { describe, expect, it } from "vitest";
import {
  normalizeEngagement,
  type ActionKind,
  type DmSource,
  type DmThreadInput,
  type EngagementPlatform,
  type EngagementSettings,
  type InboundComment,
  type PingState,
  type PromoAccount,
  type TriageClient,
  type TriageResult,
} from "@autopilot/engagement";
import { MemoryEngagementStore } from "@autopilot/engagement/src/testing/fake-store.js";
import type { UntriagedComment } from "../jobs/engagement-store.js";
import { runEngagementTriageWith, type TriageStore } from "../jobs/engagement-triage.js";
import { runDmPollWith, type DmPollStore } from "../jobs/dm-poll.js";

const NOW = new Date("2026-11-13T12:00:00Z");
const quiet = () => {};

class Store extends MemoryEngagementStore implements TriageStore {
  settings: EngagementSettings = normalizeEngagement({});
  comments: Array<{ id: string; c: InboundComment; skipPromo?: boolean }> = [];
  triaged = new Map<string, TriageResult>();
  promo: Array<PromoAccount & { source: string }> = [];
  pingAlerts: Array<{ commentId: string | null; platform: string; message: string }> = [];
  ping: PingState = { sentLastHour: 0, lastPingAt: null, lastDigestAt: null, waiting: { drafted: 0, flagged: 0 }, newSinceLastPing: 0 };

  add(id: string, text: string, over: Partial<InboundComment> = {}) {
    this.comments.push({ id, c: { platform: "instagram", platformCommentId: id, platformMediaId: "m", authorId: `a-${id}`, authorHandle: `fan_${id}`, text, createdAt: NOW.toISOString(), isOwn: false, ownRepliesInThread: [], ...over } });
  }
  async loadSettings() { return this.settings; }
  async listUntriaged(limit: number): Promise<UntriagedComment[]> {
    return this.comments.filter((x) => !this.triaged.has(x.id) || x.skipPromo).slice(0, limit).map((x) => ({ id: x.id, comment: x.c, ctx: { pillar: null }, ...(x.skipPromo ? { skipPromo: true } : {}) }));
  }
  async saveTriage(id: string, r: TriageResult) {
    this.triaged.set(id, r);
    const row = this.comments.find((x) => x.id === id);
    if (row) delete row.skipPromo;
  }
  async insertAction(commentId: string, kind: ActionKind, text: string | null, status: "planned" | "shadow", notBefore: Date | string) {
    if (this.actions.some((a) => a.commentId === commentId && a.kind === kind)) return false;
    const c = this.comments.find((x) => x.id === commentId)!.c;
    this.addAction({ commentId, kind, text, status, notBefore: new Date(notBefore).toISOString(), platform: c.platform, platformCommentId: c.platformCommentId, authorId: c.authorId });
    return true;
  }
  async loadPromoAccounts() { return this.promo.map(({ platform, authorKey }) => ({ platform, authorKey })); }
  async promoHitCount(platform: EngagementPlatform, authorId: string | null) {
    return this.comments.filter((x) => x.c.platform === platform && x.c.authorId === authorId && this.triaged.get(x.id)?.bucket === "spam_promo").length;
  }
  async addPromoAccount(platform: EngagementPlatform, authorKey: string, _h: string | null, source: "manual" | "rule") {
    if (this.promo.some((p) => p.platform === platform && p.authorKey === authorKey)) return false;
    this.promo.push({ platform, authorKey, source });
    return true;
  }
  async pingState() { return this.ping; }
  async insertReplyReadyAlert(commentId: string | null, platform: string, message: string) { this.pingAlerts.push({ commentId, platform, message }); }
}

function model(result: Omit<TriageResult, "model"> = { bucket: "simple_positive", reply: "Appreciate you man", confidence: 0.95, reasons: ["praise"] }) {
  let calls = 0;
  const client: TriageClient = { async triage() { calls++; return { ...result, model: "test" }; } };
  return { client, calls: () => calls };
}

describe("triage job: promo spam", () => {
  it("promo gets a triage row and nothing else: no model call, no action, no ping", async () => {
    const s = new Store();
    s.settings = normalizeEngagement({ pings: "each" });
    s.add("p1", "love it 🔥 send it to @fit_features_hub");
    s.add("p2", "DM us to be featured");
    const m = model();
    const r = await runEngagementTriageWith(s, m.client, { blocklist: [], now: NOW, log: quiet });
    expect(m.calls()).toBe(0);
    expect(r.buckets).toEqual({ spam_promo: 2 });
    expect(s.actions).toEqual([]);
    expect(s.pingAlerts).toEqual([]);
    expect(s.triaged.get("p1")).toMatchObject({ bucket: "spam_promo", reply: null, reasons: ["promo:send-to"] });
  });

  it("a model promo verdict is kept (never a reply); a listed author is promo before the model", async () => {
    const s = new Store();
    s.add("m1", "nice");
    s.add("l1", "great video", { authorId: "spammer-1" });
    s.promo.push({ platform: "instagram", authorKey: "spammer-1", source: "manual" });
    const m = model({ bucket: "spam_promo", reply: "Appreciate you man", confidence: 0.9, reasons: ["promo"] });
    await runEngagementTriageWith(s, m.client, { blocklist: [], now: NOW, log: quiet });
    expect(m.calls()).toBe(1);
    expect(s.triaged.get("m1")).toMatchObject({ bucket: "spam_promo", reply: null });
    expect(s.triaged.get("l1")).toMatchObject({ bucket: "spam_promo", reasons: ["promo:list"] });
    expect(s.actions).toEqual([]);
  });

  it("the second text-rule hit from one author lists them (source rule)", async () => {
    const s = new Store();
    s.add("a", "check out our page", { authorId: "page-9" });
    await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(s.promo).toEqual([]);
    s.add("b", "s4s?", { authorId: "page-9" });
    const r = await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(r.promoListed).toBe(1);
    expect(s.promo).toEqual([{ platform: "instagram", authorKey: "page-9", source: "rule" }]);
  });

  it("Not spam: re-triaged without the promo rule; a model promo verdict becomes a flag, praise gets a shadow draft", async () => {
    const s = new Store();
    s.add("n1", "check out our page");
    s.add("n2", "love this, check out my page too");
    await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(s.triaged.get("n1")?.bucket).toBe("spam_promo");
    for (const row of s.comments) row.skipPromo = true;
    const promoModel = model({ bucket: "spam_promo", reply: null, confidence: 0.9, reasons: ["promo"] });
    await runEngagementTriageWith(s, promoModel.client, { blocklist: [], now: NOW, log: quiet, }, 1);
    expect(s.triaged.get("n1")).toMatchObject({ bucket: "flag" });
    expect(s.triaged.get("n1")!.reasons[0]).toBe("not spam (creator)");
    await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(s.triaged.get("n2")?.bucket).toBe("simple_positive");
    expect(s.actions.map((a) => [a.commentId, a.status])).toEqual([["n2", "shadow"]]);
  });
});

describe("triage job: reply-ready pings", () => {
  it("each: one ping per drafted/flagged item with the privacy-safe message; promo never pings", async () => {
    const s = new Store();
    s.settings = normalizeEngagement({ pings: "each" });
    s.add("d1", "love the energy");
    s.add("f1", "which gym is this?");
    s.add("p1", "DM us to be featured");
    await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    const stored = s.actions.find((x) => x.commentId === "d1")!.text; // the rotation's pick, as stored in the shadow row
    expect(s.pingAlerts).toEqual([
      { commentId: "d1", platform: "instagram", message: `@fan_d1 commented: "love the energy". Drafted: "${stored}". Approve?` },
      { commentId: "f1", platform: "instagram", message: "A comment needs you" },
    ]);
  });

  it("hourly (default): a digest only, from the stored state, even on a tick with no new comments", async () => {
    const s = new Store();
    s.ping = { sentLastHour: 0, lastPingAt: null, lastDigestAt: null, waiting: { drafted: 5, flagged: 2 }, newSinceLastPing: 7 };
    const r = await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(r.pings).toBe(1);
    expect(s.pingAlerts).toEqual([{ commentId: null, platform: "all", message: "5 replies drafted, 2 need you" }]);
  });

  it("off: never a ping", async () => {
    const s = new Store();
    s.settings = normalizeEngagement({ pings: "off" });
    s.add("d1", "love the energy");
    s.ping = { ...s.ping, waiting: { drafted: 1, flagged: 0 }, newSinceLastPing: 1 };
    await runEngagementTriageWith(s, model().client, { blocklist: [], now: NOW, log: quiet });
    expect(s.pingAlerts).toEqual([]);
  });
});

describe("dm poll: promo threads", () => {
  const thread = (id: string, text: string, participantId = `p-${id}`): DmThreadInput => ({ platformThreadId: id, participantId, handle: `h_${id}`, messages: [{ id: `${id}-m1`, dir: "in", text, at: NOW.toISOString() }] });
  class DmStore implements DmPollStore {
    drafts: string[] = [];
    ignored: Array<[string, string]> = [];
    promo: PromoAccount[] = [];
    async loadSettings() { return normalizeEngagement({ dmPollVerified: true }); }
    async getCursor() { return null; }
    async setCursor() {}
    async upsertDmThreads(ts: DmThreadInput[]) { return ts.map((t) => ({ threadId: `t-${t.platformThreadId}`, thread: t })); }
    async latestDraft() { return null; }
    async insertDmDraft(threadId: string) { this.drafts.push(threadId); }
    async loadPromoAccounts() { return this.promo; }
    notSpam = new Set<string>();
    async ignoreDmThread(threadId: string, reason: string) {
      if (this.notSpam.has(threadId)) return false;
      this.ignored.push([threadId, reason]);
      return true;
    }
  }

  it("a promo thread (rule or listed account) is ignored with no draft; a fan thread still gets one", async () => {
    const store = new DmStore();
    store.promo = [{ platform: "instagram", authorKey: "p-listed" }];
    const src: DmSource = { async fetchThreads() { return { threads: [thread("a", "We'd love to feature you on our page"), thread("b", "love your videos"), thread("c", "hey", "p-listed")], cursor: null }; } };
    const r = await runDmPollWith(store, src, null, quiet, NOW);
    expect(r).toMatchObject({ ran: true, threads: 3, drafts: 1, ignored: 2 });
    expect(store.drafts).toEqual(["t-b"]);
    expect(store.ignored).toEqual([["t-a", "promo:feature-you"], ["t-c", "promo:list"]]);
  });

  it("a thread the creator marked Not spam drafts as usual", async () => {
    const store = new DmStore();
    store.notSpam.add("t-a");
    const src: DmSource = { async fetchThreads() { return { threads: [thread("a", "We'd love to feature you on our page")], cursor: null }; } };
    expect(await runDmPollWith(store, src, null, quiet, NOW)).toMatchObject({ drafts: 1 });
    expect(store.ignored).toEqual([]);
  });
});
