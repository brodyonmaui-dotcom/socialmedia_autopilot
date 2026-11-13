import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGAGEMENT,
  normalizeEngagement,
  type ActionKind,
  type CommentSource,
  type DmSource,
  type DmThreadInput,
  type EngagementPlatform,
  type EngagementSettings,
  type InboundComment,
  type TriageClient,
  type TriageResult,
} from "@autopilot/engagement";
import { MemoryEngagementStore } from "@autopilot/engagement/src/testing/fake-store.js";
import type { CursorRow, EngagementJobStore, UntriagedComment, UpsertedDmThread } from "../jobs/engagement-store.js";
import { runEngagementPollWith } from "../jobs/engagement-poll.js";
import { runEngagementTriageWith } from "../jobs/engagement-triage.js";
import { runEngagementSendWith } from "../jobs/engagement-send.js";
import { runDmPollWith } from "../jobs/dm-poll.js";
import { ENGAGEMENT_SCHEDULES, engagementStartupLine, registerEngagementJobs, triageClientFromEnv, type BossLike } from "../jobs/register-engagement.js";

const NOW = new Date("2026-11-13T12:00:00Z");
const quiet = () => {};

/** MemoryEngagementStore + the job-only methods, in memory. */
class JobStore extends MemoryEngagementStore implements EngagementJobStore {
  settings: EngagementSettings = normalizeEngagement({});
  comments: Array<{ id: string; c: InboundComment }> = [];
  triaged = new Map<string, TriageResult>();
  cursors = new Map<string, CursorRow>();
  dmThreads: UpsertedDmThread[] = [];
  dmDrafts: Array<{ threadId: string; forMessageId: string | null; text: string; bucket: string | null }> = [];
  dmUpserts = 0;

  async loadSettings() { return this.settings; }
  async upsertComments(cs: InboundComment[]) {
    let n = 0;
    for (const c of cs) {
      if (this.comments.some((x) => x.c.platform === c.platform && x.c.platformCommentId === c.platformCommentId)) continue;
      this.comments.push({ id: `cm-${this.comments.length + 1}`, c });
      n++;
    }
    return n;
  }
  async listUntriaged(limit: number): Promise<UntriagedComment[]> {
    return this.comments.filter((x) => !x.c.isOwn && !this.triaged.has(x.id)).slice(0, limit).map((x) => ({ id: x.id, comment: x.c, ctx: { pillar: null } }));
  }
  async saveTriage(id: string, r: TriageResult) { this.triaged.set(id, r); }
  async insertAction(commentId: string, kind: ActionKind, text: string | null, status: "planned" | "shadow", notBefore: Date | string) {
    if (this.actions.some((a) => a.commentId === commentId && a.kind === kind)) return false;
    const c = this.comments.find((x) => x.id === commentId)!.c;
    this.addAction({ commentId, kind, text, status, notBefore: new Date(notBefore).toISOString(), platform: c.platform, platformCommentId: c.platformCommentId, authorId: c.authorId });
    return true;
  }
  async getCursor(p: string) { return this.cursors.get(p) ?? null; }
  async setCursor(p: string, cursor: unknown, now: Date) { this.cursors.set(p, { cursor, polledAt: now }); }
  async upsertDmThreads(threads: DmThreadInput[]) {
    this.dmUpserts++;
    return threads.map((t) => ({ threadId: `t-${t.platformThreadId}`, thread: t }));
  }
  async latestDraft(threadId: string) {
    const d = this.dmDrafts.filter((x) => x.threadId === threadId).at(-1);
    return d ? { id: "d", forPlatformMessageId: d.forMessageId } : null;
  }
  async insertDmDraft(threadId: string, forMessageId: string | null, text: string, bucket: string | null) {
    this.dmDrafts.push({ threadId, forMessageId, text, bucket });
  }
}

const comment = (id: string, text: string, p: Partial<InboundComment> = {}): InboundComment => ({
  platform: "youtube",
  platformCommentId: id,
  platformMediaId: "vid-1",
  authorId: `author-${id}`,
  text,
  createdAt: "2026-11-13T11:00:00Z",
  isOwn: false,
  ownRepliesInThread: [],
  ...p,
});

/** Records every call; reply/hide throw so a test fails loudly if anything tries to send. */
function source(platform: EngagementPlatform, comments: InboundComment[]) {
  const calls: string[] = [];
  const s: CommentSource = {
    platform,
    async fetchRecent(cursor) {
      calls.push(`fetchRecent:${JSON.stringify(cursor)}`);
      return { comments, cursor: { page: 1 } };
    },
    async fetchThread(id) { calls.push(`fetchThread:${id}`); return null; },
    async reply(id) { calls.push(`reply:${id}`); throw new Error("must not send"); },
    async hide(id) { calls.push(`hide:${id}`); throw new Error("must not send"); },
  };
  return { s, calls };
}

function countingTriage(result: Omit<TriageResult, "model"> = { bucket: "simple_positive", reply: "Appreciate you man", confidence: 0.95, reasons: ["praise"] }) {
  let calls = 0;
  const client: TriageClient = { async triage() { calls++; return { ...result, model: "test" }; } };
  return { client, calls: () => calls };
}

describe("engagement poll", () => {
  it("is idempotent: the same fixture twice inserts once", async () => {
    const store = new JobStore();
    const yt = source("youtube", [comment("c1", "nice"), comment("c2", "great vid")]);
    const sources = new Map([["youtube" as const, yt.s]]);
    const first = await runEngagementPollWith(store, sources, quiet, NOW);
    expect(first.youtube).toEqual({ fetched: 2, inserted: 2 });
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const second = await runEngagementPollWith(store, sources, quiet, later);
    expect(second.youtube).toEqual({ fetched: 2, inserted: 0 });
    expect(yt.calls).toEqual(["fetchRecent:null", 'fetchRecent:{"page":1}']);
  });

  it("respects pollMinutes, skips mode off, and one platform's error doesn't stop the others", async () => {
    const store = new JobStore();
    store.settings = normalizeEngagement({ mode: { instagram: "shadow", youtube: "shadow", tiktok: "off" } });
    const ig: CommentSource = { platform: "instagram", async fetchRecent() { throw new Error("boom access_token=SECRET123"); }, async fetchThread() { return null; } };
    const yt = source("youtube", [comment("c1", "nice")]);
    const tt = source("tiktok", [comment("t1", "nice", { platform: "tiktok" })]);
    const lines: string[] = [];
    const r = await runEngagementPollWith(store, new Map<EngagementPlatform, CommentSource>([["instagram", ig], ["youtube", yt.s], ["tiktok", tt.s]]), (l) => lines.push(l), NOW);
    expect(r.instagram).toEqual({ error: "boom access_token=[redacted]" });
    expect(r.youtube).toEqual({ fetched: 1, inserted: 1 });
    expect(r.tiktok).toBeUndefined();
    expect(tt.calls).toEqual([]);
    expect(lines.join("\n")).not.toContain("SECRET123");
    const again = await runEngagementPollWith(store, new Map([["youtube" as const, yt.s]]), quiet, new Date(NOW.getTime() + 60_000));
    expect(again.youtube).toEqual({ skipped: "not due" });
  });
});

describe("engagement triage", () => {
  it("a pre-rule hit never calls the model and stores a rules verdict", async () => {
    const store = new JobStore();
    await store.upsertComments([comment("q1", "where is this gym?"), comment("k1", "kys")]);
    const t = countingTriage();
    const r = await runEngagementTriageWith(store, t.client, { blocklist: [], now: NOW, log: quiet });
    expect(t.calls()).toBe(0);
    expect(r).toMatchObject({ triaged: 2, modelCalls: 0, buckets: { flag: 1, hide_flag: 1 }, planned: 0, shadow: 0 });
    expect([...store.triaged.values()].every((x) => x.model === "rules" && x.reply === null && x.confidence === 1)).toBe(true);
    expect(store.actions).toEqual([]);
  });

  it("shadow mode stores 'shadow' and a send tick over shadow rows makes zero source calls", async () => {
    const store = new JobStore();
    await store.upsertComments([comment("p1", "clean form"), comment("p2", "love this")]);
    const t = countingTriage();
    const r = await runEngagementTriageWith(store, t.client, { blocklist: [], now: NOW, log: quiet });
    expect(t.calls()).toBe(2);
    expect(r.shadow).toBe(2);
    expect(store.actions.map((a) => a.status)).toEqual(["shadow", "shadow"]);
    expect(store.actions.every((a) => a.kind === "reply" && a.text)).toBe(true);

    const yt = source("youtube", []);
    const later = () => new Date(NOW.getTime() + 60 * 60_000);
    const tick = await runEngagementSendWith(store, new Map([["youtube" as const, yt.s]]), { dryRun: false, live: true, killEnv: false, log: quiet, now: later });
    expect(tick.considered).toBe(0);
    expect(yt.calls).toEqual([]);
    // Triaging again plans nothing new (one reply per comment, ever).
    const again = await runEngagementTriageWith(store, t.client, { blocklist: [], now: NOW, log: quiet });
    expect(again.triaged).toBe(0);
  });

  it("live mode stores 'planned'; dry-run or a missing live key still sends nothing", async () => {
    const store = new JobStore();
    store.settings = normalizeEngagement({ mode: { youtube: "live" } });
    await store.upsertComments([comment("p1", "clean form")]);
    await runEngagementTriageWith(store, countingTriage().client, { blocklist: [], now: NOW, log: quiet });
    expect(store.actions.map((a) => a.status)).toEqual(["planned"]);
    const yt = source("youtube", []);
    const later = () => new Date(NOW.getTime() + 60 * 60_000);
    for (const keys of [{ dryRun: true, live: true }, { dryRun: false, live: false }]) {
      const tick = await runEngagementSendWith(store, new Map([["youtube" as const, yt.s]]), { ...keys, killEnv: false, log: quiet, now: later });
      expect(tick.skipped["dry-run"]).toBe(1);
    }
    expect(yt.calls).toEqual([]);
    expect(store.actions[0]!.status).toBe("planned");
  });
});

describe("dm poll", () => {
  const thread: DmThreadInput = { platformThreadId: "th1", participantId: "u1", messages: [{ id: "m1", dir: "in", text: "thanks for the videos", at: "2026-11-13T10:00:00Z" }] };
  const dmSource = () => {
    let calls = 0;
    const s: DmSource = { async fetchThreads() { calls++; return { threads: [thread], cursor: null }; } };
    return { s, calls: () => calls };
  };

  it("does nothing while dmPollVerified is false", async () => {
    const store = new JobStore();
    const src = dmSource();
    const r = await runDmPollWith(store, src.s, null, quiet, NOW);
    expect(r).toMatchObject({ ran: false, drafts: 0 });
    expect(src.calls()).toBe(0);
    expect(store.dmUpserts).toBe(0);
  });

  it("drafts once per inbound message when verified", async () => {
    const store = new JobStore();
    store.settings = { ...DEFAULT_ENGAGEMENT, dmPollVerified: true };
    const src = dmSource();
    expect(await runDmPollWith(store, src.s, null, quiet, NOW)).toMatchObject({ ran: true, threads: 1, drafts: 1 });
    expect(await runDmPollWith(store, src.s, null, quiet, NOW)).toMatchObject({ ran: true, drafts: 0 });
    expect(store.dmDrafts).toHaveLength(1);
    expect(store.dmDrafts[0]).toMatchObject({ threadId: "t-th1", forMessageId: "m1", bucket: "fan" });
  });
});

describe("register + startup", () => {
  it("creates each queue before working and scheduling it", async () => {
    const calls: string[] = [];
    const boss: BossLike = {
      async createQueue(n) { calls.push(`create:${n}`); },
      async work(n) { calls.push(`work:${n}`); },
      async schedule(n, cron) { calls.push(`schedule:${n}:${cron}`); },
    };
    const pool = { query: async () => ({ rows: [] }) };
    await registerEngagementJobs(boss, pool, { sources: new Map(), dmSource: null, triage: countingTriage().client, blocklist: [], dryRun: true, live: false, log: quiet });
    expect(calls).toEqual(
      ENGAGEMENT_SCHEDULES.flatMap(([n, cron]) => [`create:${n}`, `work:${n}`, `schedule:${n}:${cron}`]),
    );
    expect(calls.filter((c) => c.startsWith("schedule:")).map((c) => c.split(":").slice(1).join(":"))).toEqual([
      "engagement-poll:*/5 * * * *",
      "engagement-triage:* * * * *",
      "engagement-send:* * * * *",
      "dm-poll:*/5 * * * *",
    ]);
  });

  it("startup line shows modes, live and killEnv", () => {
    expect(engagementStartupLine(DEFAULT_ENGAGEMENT, false, false)).toBe("engagement modes: instagram=shadow youtube=shadow tiktok=off · live=false · killEnv=false");
  });

  it("without ANTHROPIC_API_KEY triage is rules only and flags everything", async () => {
    const lines: string[] = [];
    const client = triageClientFromEnv({}, (l) => lines.push(l));
    expect(lines).toEqual(["triage: rules only (no ANTHROPIC_API_KEY)"]);
    expect((await client.triage(comment("x", "love this"), {})).bucket).toBe("flag");
  });
});
