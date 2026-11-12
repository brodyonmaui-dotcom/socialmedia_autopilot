/**
 * Fakes for the scheduler/outbox tests and simulate-week. No network, no DB, no real clock.
 * The FakePlatform is the oracle: it records every post it *created*, keyed by idempotency key,
 * so a double-post is observable even when the engine's own bookkeeping says all is well.
 */
import type { OutboxAlert, OutboxPost, Platform, PlatformAdapter, PublishOptions, PublishResult } from "../types.js";
import type { OutboxStore } from "../outbox/engine.js";
import { localDate } from "../time.js";

export class FakeClock {
  private t: number;
  constructor(start: Date | string) {
    this.t = typeof start === "string" ? Date.parse(start) : start.getTime();
  }
  now = (): Date => new Date(this.t);
  advanceMs(ms: number): void {
    this.t += ms;
  }
  set(d: Date | string): void {
    this.t = typeof d === "string" ? Date.parse(d) : d.getTime();
  }
}

/** What the fake platform does on the Nth publish call for a post (default: "ok"). */
export type FakeOutcome =
  | "ok"
  | "reject" // deliberate 4xx-style rejection: nothing created
  | "timeout-not-created" // the call hung and the platform did NOT act
  | "timeout-created"; // the call hung but the platform DID create the post (the dangerous case)

export interface FakePlatformOptions {
  platform: Platform;
  /** Per idempotency key: the outcome sequence; missing entries mean "ok". */
  script?: Record<string, FakeOutcome[]>;
  /** Zernio-style: a repeated idempotency key returns the original post instead of creating another. */
  honorsIdempotencyKey?: boolean;
  /** Whether the adapter can look a post up (findExisting); YouTube can't today. */
  canLookup?: boolean;
}

export interface FakeCreated {
  idempotencyKey: string;
  postId: string;
  platformPostId: string;
  at: string;
}

export class FakePlatform {
  readonly platform: Platform;
  readonly created: FakeCreated[] = [];
  readonly calls: Array<{ postId: string; idempotencyKey: string; outcome: FakeOutcome; at: string }> = [];
  private counters = new Map<string, number>();
  private seq = 0;
  constructor(private readonly opts: FakePlatformOptions, private readonly clock: FakeClock) {
    this.platform = opts.platform;
  }

  /** Idempotency keys that were created more than once = double posts. */
  doublePosts(): string[] {
    const n = new Map<string, number>();
    for (const c of this.created) n.set(c.idempotencyKey, (n.get(c.idempotencyKey) ?? 0) + 1);
    return [...n].filter(([, v]) => v > 1).map(([k]) => k);
  }

  countOn(localDay: string, timeZone: string): number {
    return this.created.filter((c) => localDate(new Date(c.at), timeZone) === localDay).length;
  }

  private create(post: OutboxPost): PublishResult {
    const platformPostId = `${this.platform}-${++this.seq}`;
    this.created.push({ idempotencyKey: post.idempotencyKey, postId: post.id, platformPostId, at: this.clock.now().toISOString() });
    return { platformPostId, platformPostUrl: `https://fake.${this.platform}/${platformPostId}` };
  }

  adapter(): PlatformAdapter {
    const self = this;
    const adapter: PlatformAdapter = {
      platform: this.platform,
      async publish(post: OutboxPost, _opts?: PublishOptions): Promise<PublishResult> {
        const n = self.counters.get(post.idempotencyKey) ?? 0;
        self.counters.set(post.idempotencyKey, n + 1);
        const outcome: FakeOutcome = self.opts.script?.[post.idempotencyKey]?.[n] ?? "ok";
        self.calls.push({ postId: post.id, idempotencyKey: post.idempotencyKey, outcome, at: self.clock.now().toISOString() });

        const existing = self.created.find((c) => c.idempotencyKey === post.idempotencyKey);
        if (existing && self.opts.honorsIdempotencyKey) return { platformPostId: existing.platformPostId, platformPostUrl: `https://fake.${self.platform}/${existing.platformPostId}` };

        switch (outcome) {
          case "ok":
            return self.create(post);
          case "reject":
            throw new Error(`fake ${self.platform}: rejected (HTTP 400)`);
          case "timeout-not-created": {
            const e = new Error("fake: request timed out");
            e.name = "TimeoutError";
            throw e;
          }
          case "timeout-created": {
            self.create(post);
            const e = new Error("fake: response never arrived (but the platform created it)");
            e.name = "TimeoutError";
            throw e;
          }
        }
      },
    };
    if (this.opts.canLookup !== false) {
      adapter.findExisting = async (post: OutboxPost): Promise<PublishResult | null> => {
        const existing = self.created.find((c) => c.idempotencyKey === post.idempotencyKey);
        return existing ? { platformPostId: existing.platformPostId, platformPostUrl: `https://fake.${self.platform}/${existing.platformPostId}` } : null;
      };
    }
    return adapter;
  }
}

/** In-memory OutboxStore with the same semantics the pg store must have (atomic claim, deduped alerts). */
export class MemoryOutboxStore implements OutboxStore {
  readonly posts = new Map<string, OutboxPost>();
  readonly alerts: OutboxAlert[] = [];
  readonly history: Array<{ postId: string; status: OutboxPost["status"]; at: string }> = [];
  /** Simulates a worker crash: markPublished throws once for these ids, leaving the row in "publishing". */
  readonly crashBeforeMarkPublished = new Set<string>();

  add(post: OutboxPost): void {
    if (this.posts.has(post.id)) throw new Error(`duplicate post id ${post.id}`);
    for (const p of this.posts.values()) if (p.idempotencyKey === post.idempotencyKey) throw new Error(`duplicate idempotency key ${post.idempotencyKey}`);
    this.posts.set(post.id, { ...post });
  }

  all(): OutboxPost[] {
    return [...this.posts.values()];
  }

  private set(postId: string, patch: Partial<OutboxPost>, now: Date): void {
    const cur = this.posts.get(postId);
    if (!cur) throw new Error(`unknown post ${postId}`);
    const next = { ...cur, ...patch, updatedAt: now.toISOString() };
    this.posts.set(postId, next);
    this.history.push({ postId, status: next.status, at: now.toISOString() });
  }

  async listDue(now: Date): Promise<OutboxPost[]> {
    return this.all()
      .filter((p) => p.status === "approved" || (p.status === "queued" && (!p.nextAttemptAt || Date.parse(p.nextAttemptAt) <= now.getTime())))
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
      .map((p) => ({ ...p }));
  }
  async claim(postId: string, now: Date): Promise<boolean> {
    const cur = this.posts.get(postId);
    if (!cur || (cur.status !== "approved" && cur.status !== "queued")) return false;
    this.set(postId, { status: "publishing", nextAttemptAt: undefined }, now);
    return true;
  }
  async listStale(before: Date): Promise<OutboxPost[]> {
    return this.all().filter((p) => p.status === "publishing" && p.updatedAt !== undefined && Date.parse(p.updatedAt) < before.getTime()).map((p) => ({ ...p }));
  }
  async markPublished(postId: string, result: PublishResult, attempts: number, now: Date): Promise<void> {
    if (this.crashBeforeMarkPublished.delete(postId)) throw new Error(`simulated crash before markPublished(${postId})`);
    this.set(postId, { status: "published", attempts, platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl, nextAttemptAt: undefined }, now);
  }
  async markQueued(postId: string, attempts: number, nextAttemptAt: string, error: string, now: Date): Promise<void> {
    this.set(postId, { status: "queued", attempts, nextAttemptAt, lastError: error }, now);
  }
  async markFailed(postId: string, attempts: number, error: string, now: Date): Promise<void> {
    this.set(postId, { status: "failed", attempts, lastError: error, nextAttemptAt: undefined }, now);
  }
  async markUnknown(postId: string, attempts: number, error: string, now: Date): Promise<void> {
    this.set(postId, { status: "unknown", attempts, lastError: error, nextAttemptAt: undefined }, now);
  }
  async countSentOn(platform: Platform, localDay: string, timeZone: string): Promise<number> {
    return this.all().filter((p) => p.platform === platform && (p.status === "published" || p.status === "publishing" || p.status === "unknown") && localDate(new Date(p.scheduledFor), timeZone) === localDay).length;
  }
  async recordAlert(alert: OutboxAlert): Promise<boolean> {
    if (this.alerts.some((a) => a.kind === alert.kind && a.postId === alert.postId)) return false;
    this.alerts.push(alert);
    return true;
  }
}

let idSeq = 0;
/** A minimal approved post for tests. Ids and idempotency keys are unique per call. */
export function makePost(overrides: Partial<OutboxPost> & { platform: Platform; scheduledFor: string }): OutboxPost {
  const n = ++idSeq;
  return {
    id: overrides.id ?? `post-${n}`,
    idempotencyKey: overrides.idempotencyKey ?? `idem-${n}`,
    mediaUrl: overrides.mediaUrl ?? `https://media.example/clip-${n}.mp4`,
    caption: overrides.caption ?? "Just stacking days is all…",
    status: overrides.status ?? "approved",
    attempts: overrides.attempts ?? 0,
    ...overrides,
  };
}
