// In-memory EngagementStore for tests and scripts/simulate-engagement.ts. Not for production.

import type {
  EngagementActionRow,
  EngagementAlert,
  EngagementLimits,
  EngagementPlatform,
  EngagementStore,
  LimitCounts,
} from "../types.js";

/** A stored action plus what the pg row would also hold. */
export interface MemoryActionRow extends EngagementActionRow {
  sentAt: string | null;
  lastError: string | null;
  platformActionId: string | null;
}

/** A reply sent outside the `actions` array (e.g. history seeded for planner tests). Counts as an auto reply. */
export interface SentText { platform: EngagementPlatform; authorId: string | null; text: string; sentAt: string }

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let seq = 0;

/**
 * `MemoryEngagementStore` — everything public so tests can assert on it:
 *  - `actions`: rows (use `addAction(partial)` to create one with sane defaults: planned reply, auto, attempts 0)
 *  - `alerts`: alerts accepted by `recordAlert` (deduped per kind + actionId)
 *  - `outcomes`: send outcomes, newest LAST; only transitions out of `sending` are recorded (a pre-flight
 *    "comment gone" or "already exists" is not a send attempt and doesn't feed the kill auto-trip)
 *  - `killed`: every `setKilled` call; `isKilled` mirrors the setting
 *  - `sentTexts`: extra history for ActionHistory/limit counts; `blocked`: "platform:authorId" keys
 *  - `loseClaims`: action ids whose `claimAction` returns false (simulates another worker)
 * Limit counts and history are computed from `actions` with status sent/sending (by `sentAt`) plus `sentTexts`.
 */
export class MemoryEngagementStore implements EngagementStore {
  actions: MemoryActionRow[] = [];
  alerts: EngagementAlert[] = [];
  outcomes: Array<{ platform: EngagementPlatform; actionId: string; ok: boolean; error?: string; at: string }> = [];
  killed: Array<{ reason: string; at: string }> = [];
  isKilled = false;
  sentTexts: SentText[] = [];
  blocked = new Set<string>();
  loseClaims = new Set<string>();

  /** Add a row; defaults: planned auto instagram reply "thanks!", notBefore = createdAt = epoch. */
  addAction(p: Partial<MemoryActionRow> = {}): MemoryActionRow {
    const id = p.id ?? `act-${++seq}`;
    const row: MemoryActionRow = {
      id,
      commentId: `c-${id}`,
      platform: "instagram",
      platformCommentId: `pc-${id}`,
      authorId: `author-${id}`,
      kind: "reply",
      text: "thanks!",
      idempotencyKey: `engage:${id}`,
      status: "planned",
      notBefore: new Date(0).toISOString(),
      attempts: 0,
      nextAttemptAt: null,
      origin: "auto",
      createdAt: new Date(0).toISOString(),
      sentAt: null,
      lastError: null,
      platformActionId: null,
      ...p,
    };
    this.actions.push(row);
    return row;
  }

  get(id: string): MemoryActionRow {
    const r = this.actions.find((x) => x.id === id);
    if (!r) throw new Error(`no action ${id}`);
    return r;
  }

  private outcome(r: MemoryActionRow, ok: boolean, now: Date, error?: string): void {
    if (r.status !== "sending") return;
    this.outcomes.push({ platform: r.platform, actionId: r.id, ok, ...(error !== undefined ? { error } : {}), at: now.toISOString() });
  }

  /** Sent auto replies (actions + sentTexts) for history/limits. */
  private sentReplies(): SentText[] {
    const fromRows = this.actions
      .filter((r) => (r.status === "sent" || r.status === "sending") && r.kind === "reply" && r.origin === "auto" && r.sentAt)
      .map((r) => ({ platform: r.platform, authorId: r.authorId, text: r.text ?? "", sentAt: r.sentAt! }));
    return [...fromRows, ...this.sentTexts];
  }

  /** All sent/sending actions (any kind/origin) + sentTexts, as {platform, at}. */
  private sentAll(): Array<{ platform: EngagementPlatform; at: number }> {
    return [
      ...this.actions.filter((r) => (r.status === "sent" || r.status === "sending") && r.sentAt).map((r) => ({ platform: r.platform, at: Date.parse(r.sentAt!) })),
      ...this.sentTexts.map((s) => ({ platform: s.platform, at: Date.parse(s.sentAt) })),
    ];
  }

  // ---- EngagementStore ----
  async listDueActions(now: Date, limit = 20): Promise<EngagementActionRow[]> {
    const t = now.getTime();
    return this.actions
      .filter((r) => r.status === "planned" && Date.parse(r.notBefore) <= t && (!r.nextAttemptAt || Date.parse(r.nextAttemptAt) <= t))
      .sort((x, y) => Date.parse(x.notBefore) - Date.parse(y.notBefore))
      .slice(0, limit)
      .map(({ sentAt: _s, lastError: _e, platformActionId: _p, ...row }) => ({ ...row }));
  }
  async claimAction(id: string, now: Date): Promise<boolean> {
    const r = this.get(id);
    if (this.loseClaims.has(id) || r.status !== "planned") return false;
    r.status = "sending";
    r.sentAt = now.toISOString();
    return true;
  }
  async markSent(id: string, platformActionId: string | null, now: Date): Promise<void> {
    const r = this.get(id);
    this.outcome(r, true, now);
    if (r.status === "sending") r.attempts += 1;
    r.status = "sent";
    r.sentAt = now.toISOString();
    r.platformActionId = platformActionId;
  }
  async markRetry(id: string, nextAttemptAt: Date, error: string, now: Date): Promise<void> {
    const r = this.get(id);
    this.outcome(r, false, now, error);
    r.status = "planned";
    r.sentAt = null;
    r.attempts += 1;
    r.nextAttemptAt = nextAttemptAt.toISOString();
    r.lastError = error;
  }
  async markFailed(id: string, error: string, now: Date): Promise<void> {
    const r = this.get(id);
    this.outcome(r, false, now, error);
    if (r.status === "sending") r.attempts += 1;
    r.status = "failed";
    r.sentAt = null;
    r.lastError = error;
  }
  async markUnknown(id: string, error: string, now: Date): Promise<void> {
    const r = this.get(id);
    this.outcome(r, false, now, error);
    if (r.status === "sending") r.attempts += 1;
    r.status = "unknown";
    r.lastError = error;
  }
  async markCancelled(id: string, reason: string, _now: Date): Promise<void> {
    const r = this.get(id);
    if (r.status !== "planned") return; // conditional, like the pg store
    r.status = "cancelled";
    r.lastError = reason;
  }
  /** Rows in `sending` whose claim (`sentAt`, set by claimAction) is older than `olderThan`. */
  async listStaleSending(olderThan: Date, limit = 20): Promise<EngagementActionRow[]> {
    return this.actions
      .filter((r) => r.status === "sending" && r.sentAt !== null && Date.parse(r.sentAt) < olderThan.getTime())
      .slice(0, limit)
      .map(({ sentAt: _s, lastError: _e, platformActionId: _p, ...row }) => ({ ...row }));
  }
  async limitCounts(platform: EngagementPlatform, authorId: string | null, limits: EngagementLimits, now: Date): Promise<LimitCounts> {
    const t = now.getTime();
    const all = this.sentAll();
    const since = (ms: number) => all.filter((x) => x.at > t - ms && x.at <= t);
    return {
      platformHour: since(HOUR).filter((x) => x.platform === platform).length,
      platformDay: since(DAY).filter((x) => x.platform === platform).length,
      globalDay: since(DAY).length,
      authorWindow: authorId === null ? 0 : (await this.repliesToAuthorSince(platform, authorId, new Date(t - limits.perPersonDays * DAY))).length,
    };
  }
  async recentOutcomes(platform: EngagementPlatform, n: number): Promise<Array<{ ok: boolean; error?: string }>> {
    return this.outcomes
      .filter((o) => o.platform === platform)
      .slice(-n)
      .reverse()
      .map((o) => ({ ok: o.ok, ...(o.error !== undefined ? { error: o.error } : {}) }));
  }
  async recordAlert(alert: EngagementAlert): Promise<boolean> {
    if (this.alerts.some((x) => x.kind === alert.kind && x.actionId === alert.actionId)) return false;
    this.alerts.push(alert);
    return true;
  }
  async setKilled(reason: string, now: Date): Promise<void> {
    this.killed.push({ reason, at: now.toISOString() });
    this.isKilled = true;
  }

  // ---- ActionHistory ----
  async lastRepliesOn(platform: EngagementPlatform, n: number): Promise<string[]> {
    return this.sentReplies()
      .filter((s) => s.platform === platform)
      .sort((x, y) => Date.parse(y.sentAt) - Date.parse(x.sentAt))
      .slice(0, n)
      .map((s) => s.text);
  }
  async repliesToAuthorSince(platform: EngagementPlatform, authorId: string, since: Date): Promise<string[]> {
    return this.sentReplies()
      .filter((s) => s.platform === platform && s.authorId === authorId && Date.parse(s.sentAt) >= since.getTime())
      .map((s) => s.text);
  }
  async countSent(platform: EngagementPlatform | "all", since: Date): Promise<number> {
    return this.sentAll().filter((x) => (platform === "all" || x.platform === platform) && x.at >= since.getTime()).length;
  }
  async textUseCount(platform: EngagementPlatform, text: string, since: Date): Promise<number> {
    return this.sentReplies().filter((s) => s.platform === platform && s.text === text && Date.parse(s.sentAt) >= since.getTime()).length;
  }
  async isBlockedAuthor(platform: EngagementPlatform, authorId: string): Promise<boolean> {
    return this.blocked.has(`${platform}:${authorId}`);
  }
}
