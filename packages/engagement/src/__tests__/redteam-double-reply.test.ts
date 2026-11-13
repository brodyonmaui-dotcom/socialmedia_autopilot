// F7 A15: property test — 1,000 comments, random failures/timeouts/blocks/claim losses/crashes,
// arrivals interleaved with send ticks, humans replying mid-run → at most one reply per comment, ever.
import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, NonRetryableError } from "@autopilot/core";
import { planActions } from "../planner.js";
import { seededRng } from "../rotation.js";
import { postRules, preRules } from "../rules.js";
import { runSendTick } from "../send.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { createFakeTriageClient } from "../triage-fake.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import type { CommentSource, EngagementPlatform, EngagementSettings, InboundComment, TriageResult } from "../types.js";

type Outcome = "ok" | "reject" | "permanent" | "block" | "timeout" | "timeout-created" | "lost-response";
const WEIGHTS: Array<[Outcome, number]> = [["ok", 66], ["reject", 12], ["permanent", 5], ["block", 3], ["timeout", 4], ["timeout-created", 5], ["lost-response", 5]];

/** A fake platform with real state: replies it created live in the thread, which fetchThread returns. */
class PlatformSim implements CommentSource {
  threads = new Map<string, InboundComment>();
  created = new Map<string, number>();
  calls: Array<{ id: string; ownAtCall: number }> = [];
  constructor(readonly platform: EngagementPlatform, private rng: () => number) {}

  private outcome(): Outcome {
    let r = this.rng() * WEIGHTS.reduce((n, [, w]) => n + w, 0);
    for (const [o, w] of WEIGHTS) if ((r -= w) < 0) return o;
    return "ok";
  }
  private create(id: string, text: string): string {
    const th = this.threads.get(id)!;
    const rid = `${id}-r${th.ownRepliesInThread.length + 1}`;
    th.ownRepliesInThread.push({ platformCommentId: rid, text, createdAt: new Date(0).toISOString() });
    this.created.set(id, (this.created.get(id) ?? 0) + 1);
    return rid;
  }
  async fetchRecent(cursor: unknown) {
    return { comments: [], cursor };
  }
  async fetchThread(id: string) {
    const th = this.threads.get(id);
    return th ? { ...th, ownRepliesInThread: [...th.ownRepliesInThread] } : null;
  }
  reply = async (id: string, text: string, o: { signal?: AbortSignal; idempotencyKey: string }) => {
    this.calls.push({ id, ownAtCall: this.threads.get(id)?.ownRepliesInThread.length ?? -1 });
    const hang = () =>
      new Promise<never>((_, reject) => o.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    switch (this.outcome()) {
      case "ok":
        return { platformReplyId: this.create(id, text) };
      case "reject":
        throw new Error("bad request");
      case "permanent":
        throw new NonRetryableError("permission denied");
      case "block":
        throw new Error("Action Blocked: spam");
      case "timeout":
        return hang();
      case "timeout-created":
        this.create(id, text);
        return hang();
      case "lost-response":
        this.create(id, text);
        throw new TypeError("fetch failed"); // network error after the platform acted
    }
  };
}

/** Crashes (throws) in markSent for chosen claims: the row stays `sending`, like a worker dying mid-send. */
class CrashingStore extends MemoryEngagementStore {
  crashNext = new Set<string>();
  crashed = new Set<string>();
  constructor(private rng: () => number) {
    super();
  }
  override async claimAction(id: string, now: Date) {
    const ok = await super.claimAction(id, now);
    if (ok && this.rng() < 0.03) this.crashNext.add(id);
    return ok;
  }
  unknownCalls = new Map<string, number>();
  override async markUnknown(id: string, error: string, now: Date) {
    this.unknownCalls.set(id, (this.unknownCalls.get(id) ?? 0) + 1);
    return super.markUnknown(id, error, now);
  }
  override async markSent(id: string, platformActionId: string | null, now: Date) {
    if (this.crashNext.delete(id)) {
      this.crashed.add(id);
      throw new Error("worker crashed before markSent");
    }
    return super.markSent(id, platformActionId, now);
  }
}

const TEXTS = ["love this", "great video man", "so clean", "nice form", "lol no", "cringe", "this is so fake", "thank you for this", "where is this?", "collab?", "🔥🔥", "clean NY session"];

describe("A15: no double replies under random failure (property, 1,000 comments)", () => {
  for (const seed of ["a15-1", "a15-2", "a15-3"]) {
    it(`seed ${seed}`, async () => {
      const rng = seededRng(seed);
      const store = new CrashingStore(seededRng(`${seed}-store`));
      const platforms = new Map<EngagementPlatform, PlatformSim>([
        ["instagram", new PlatformSim("instagram", seededRng(`${seed}-ig`))],
        ["youtube", new PlatformSim("youtube", seededRng(`${seed}-yt`))],
      ]);
      const settings: EngagementSettings = {
        ...DEFAULT_ENGAGEMENT,
        mode: { instagram: "live", youtube: "live", tiktok: "off" },
        limits: { perPersonDays: 7, perPlatformPerHour: 1e6, perPlatformPerDay: 1e6, globalPerDay: 1e6 },
        minDelayMin: 3,
      };
      const triage = createFakeTriageClient();
      const policy = { ...DEFAULT_RETRY_POLICY, baseBackoffMs: 60_000, factor: 2, lookupTimeoutMs: 50 };
      const comments: InboundComment[] = [];
      let now = new Date("2026-01-05T15:00:00Z");
      let crashes = 0;

      for (let tick = 0; tick < 400; tick++) {
        // arrivals (10 a minute) + 5 % re-deliveries of an earlier comment
        for (let i = 0; i < 10 && comments.length < 1000; i++) {
          const again = comments.length > 10 && rng() < 0.05;
          const c: InboundComment = again
            ? comments[Math.floor(rng() * comments.length)]!
            : {
                platform: rng() < 0.6 ? "instagram" : "youtube",
                platformCommentId: `c${comments.length}`,
                platformMediaId: "m",
                authorId: rng() < 0.1 ? null : `u${Math.floor(rng() * 400)}`,
                text: TEXTS[Math.floor(rng() * TEXTS.length)]!,
                createdAt: now.toISOString(),
                isOwn: false,
                ownRepliesInThread: [],
              };
          if (!again) comments.push(c);
          const src = platforms.get(c.platform)!;
          if (!src.threads.has(c.platformCommentId)) src.threads.set(c.platformCommentId, { ...c, ownRepliesInThread: [] });
          const hit = preRules(c);
          const t: TriageResult = hit
            ? { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" }
            : postRules(await triage.triage(c, {}), c);
          for (const p of await planActions(c, t, settings, store, now)) {
            if (p.kind !== "reply") continue;
            // the DB's unique (comment_id, kind): a re-delivered comment doesn't get a second row
            if (store.actions.some((a) => a.commentId === c.platformCommentId && a.kind === "reply")) continue;
            store.addAction({ commentId: c.platformCommentId, platform: c.platform, platformCommentId: c.platformCommentId, authorId: c.authorId, text: p.text, notBefore: p.notBefore, idempotencyKey: `k-${c.platformCommentId}` });
          }
        }
        // humans: the creator replies by hand in ~1 % of open threads (inside the veto window or between retries)
        for (const a of store.actions) {
          if (a.status === "planned" && rng() < 0.01) {
            platforms.get(a.platform)!.threads.get(a.platformCommentId)!.ownRepliesInThread.push({ platformCommentId: `${a.platformCommentId}-human`, text: "haha thanks, more soon", createdAt: now.toISOString() });
          }
        }
        // claim losses for one tick (another worker raced us)
        store.loseClaims.clear();
        for (const a of store.actions) if (a.status === "planned" && rng() < 0.03) store.loseClaims.add(a.id);

        try {
          await runSendTick(store, platforms as Map<EngagementPlatform, CommentSource>, { settings, dryRun: false, killEnv: false, policy, now: () => now, timeoutMs: 2 });
        } catch (err) {
          expect((err as Error).message).toContain("worker crashed");
          crashes++;
        }
        now = new Date(now.getTime() + 60_000);
        if (comments.length >= 1000 && (await store.listDueActions(now, 1)).length === 0 && !store.actions.some((a) => a.status === "sending")) break;
      }

      expect(comments.length).toBe(1000);
      const totalCreated = [...platforms.values()].reduce((n, p) => n + [...p.created.values()].reduce((a, b) => a + b, 0), 0);
      expect(totalCreated).toBeGreaterThan(100); // the property is exercised, not vacuous
      expect(crashes).toBeGreaterThan(0);

      for (const p of platforms.values()) {
        // ≤ 1 reply we created per comment, ever
        for (const [id, n] of p.created) expect(n, `${p.platform} ${id} got ${n} replies`).toBe(1);
        // never a reply call on a thread that already has our (or the creator's) reply
        const bad = p.calls.filter((c) => c.ownAtCall !== 0);
        expect(bad, `reply calls on threads already answered: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
      }
      // no sent row twice per (comment, kind)
      const sent = new Map<string, number>();
      for (const a of store.actions.filter((x) => x.status === "sent")) sent.set(`${a.commentId}|${a.kind}`, (sent.get(`${a.commentId}|${a.kind}`) ?? 0) + 1);
      expect([...sent.values()].every((n) => n === 1)).toBe(true);
      // a crashed row is settled as unknown exactly once (stale-sending pass) and never resent
      for (const id of store.crashed) {
        const a = store.get(id);
        expect(a.status).toBe("unknown");
        expect(a.lastError).toBe("crashed send: settled as unknown");
        expect(store.unknownCalls.get(id)).toBe(1);
        // earlier rejected attempts and the settle each bumped `attempts`; the crashed call is the last one ever made
        expect(platforms.get(a.platform)!.calls.filter((c) => c.id === a.platformCommentId)).toHaveLength(a.attempts);
      }
      expect(store.actions.some((a) => a.status === "sending")).toBe(false);
    }, 30_000);
  }
});
