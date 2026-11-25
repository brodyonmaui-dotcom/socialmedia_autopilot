// engagement_status: after each send tick the worker writes per-platform reply readiness for the web.
import { describe, expect, it } from "vitest";
import { normalizeEngagement, parseEngagementStatus, replyReadiness, type CommentSource, type EngagementPlatform, type EngagementStatus } from "@autopilot/engagement";
import { MemoryEngagementStore } from "@autopilot/engagement/src/testing/fake-store.js";
import { createTikTokCommentSource, createYouTubeCommentSource } from "@autopilot/adapters";
import { buildEngagementStatus, runEngagementSendWith } from "../jobs/engagement-send.js";
import type { ReplyStatusFacts } from "../jobs/engagement-store.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const quiet = () => {};

class StatusStore extends MemoryEngagementStore {
  settings = normalizeEngagement({});
  saved: EngagementStatus[] = [];
  async loadSettings() { return this.settings; }
  async replyStatusFacts(): Promise<ReplyStatusFacts> {
    const out: ReplyStatusFacts = {};
    for (const a of this.actions) {
      const f = (out[a.platform] ??= { lastSentAt: null, lastError: null, lastHeldReason: null, waiting: 0 });
      if (a.status === "sent") f.lastSentAt = a.sentAt;
      if (a.status === "planned" && a.origin === "manual") { f.waiting++; f.lastHeldReason = a.lastError ?? f.lastHeldReason; }
    }
    return out;
  }
  async saveEngagementStatus(s: EngagementStatus) { this.saved.push(s); }
}

const yt = () => createYouTubeCommentSource({ clientId: "x", clientSecret: "y", refreshToken: "z", channelId: "UCfake" });
const okSource = (platform: EngagementPlatform): CommentSource => ({
  platform,
  async fetchRecent(c) { return { comments: [], cursor: c }; },
  async fetchThread(id) { return { platform, platformCommentId: id, platformMediaId: "v", authorId: "u", text: "hi", createdAt: NOW.toISOString(), isOwn: false, ownRepliesInThread: [] }; },
  async reply() { return { platformReplyId: "r1" }; },
});

describe("engagement_status", () => {
  it("buildEngagementStatus: source/canReply/live/killed per platform, placeholder counts as no source, no secrets", () => {
    const sources = new Map<EngagementPlatform, CommentSource>([["youtube", yt()], ["tiktok", createTikTokCommentSource()], ["instagram", okSource("instagram")]]);
    const s = buildEngagementStatus(sources, { instagram: { lastSentAt: "2026-11-25T10:00:00.000Z", lastError: null, lastHeldReason: null, waiting: 0 } }, { live: true, killed: false }, null, NOW);
    expect(s.platforms.instagram).toMatchObject({ source: true, canReply: true, live: true, killed: false, lastSentAt: "2026-11-25T10:00:00.000Z" });
    expect(s.platforms.youtube).toMatchObject({ source: true, canReply: false, replyUnavailableReason: "YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)" });
    expect(s.platforms.tiktok).toMatchObject({ source: false, canReply: false, replyUnavailableReason: expect.stringMatching(/ZERNIO_API_KEY/) });
    expect(JSON.stringify(s)).not.toMatch(/"x"|"y"|"z"|UCfake/);
    const parsed = parseEngagementStatus(JSON.parse(JSON.stringify(s)));
    expect(replyReadiness("instagram", parsed!.platforms.instagram)).toEqual({ ready: true, text: "Ready to send" });
    expect(replyReadiness("youtube", parsed!.platforms.youtube).text).toMatch(/YT_COMMENT_REPLIES=1/);
    expect(replyReadiness("tiktok", parsed!.platforms.tiktok).text).toMatch(/ZERNIO_TIKTOK_ACCOUNT_ID/);
  });

  it("each send tick writes it, with this tick's held reason; dry run shows live=false", async () => {
    const store = new StatusStore();
    store.addAction({ id: "m1", platform: "youtube", origin: "manual", notBefore: "2026-11-25T11:00:00Z" });
    const sources = new Map<EngagementPlatform, CommentSource>([["youtube", yt()]]);
    await runEngagementSendWith(store, sources, { dryRun: false, live: true, killEnv: false, log: quiet, now: () => NOW });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]!.platforms.youtube).toMatchObject({ live: true, canReply: false, lastHeldReason: "YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)", waiting: 1 });
    expect(store.get("m1").status).toBe("planned");
    await runEngagementSendWith(store, sources, { dryRun: true, live: true, killEnv: false, log: quiet, now: () => NOW });
    expect(store.saved[1]!.platforms.youtube).toMatchObject({ live: false });
  });

  it("a store without the status methods still ticks (older fakes)", async () => {
    const store = Object.assign(new MemoryEngagementStore(), { loadSettings: async () => normalizeEngagement({}) });
    const r = await runEngagementSendWith(store, new Map(), { dryRun: true, live: false, killEnv: false, log: quiet, now: () => NOW });
    expect(r.considered).toBe(0);
  });
});
