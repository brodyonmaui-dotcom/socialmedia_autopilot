import type { OutboxAlert, OutboxPost, Platform, PlatformAdapter, PublishResult } from "../types.js";
import { CAPABILITIES } from "../capabilities.js";
import type { CadenceSettings } from "../cadence.js";
import { localDate } from "../time.js";
import { sanitizeError, sanitizeForLog } from "../log/sanitize.js";
import { classifyFailure, decideAfterAttempt, DEFAULT_RETRY_POLICY, PublishTimeoutError, type Decision, type RetryPolicy } from "./policy.js";

/**
 * Persistence the engine needs. The worker implements it over Postgres (batch_items), simulate-week
 * and the tests over memory. Every write is keyed by the post id; `claim` must be atomic so two
 * ticks can never fire the same post.
 */
export interface OutboxStore {
  /** Posts whose status is approved, or queued with next_attempt_at <= now, ordered by scheduled_for. */
  listDue(now: Date): Promise<OutboxPost[]>;
  /** "publishing" rows last touched before `before`: a worker died mid-publish, so the outcome is unknown. */
  listStale(before: Date): Promise<OutboxPost[]>;
  /** Flip approved/queued → publishing. Returns false if someone else got there first. */
  claim(postId: string, now: Date): Promise<boolean>;
  markPublished(postId: string, result: PublishResult, attempts: number, now: Date): Promise<void>;
  markQueued(postId: string, attempts: number, nextAttemptAt: string, error: string, now: Date): Promise<void>;
  markFailed(postId: string, attempts: number, error: string, now: Date): Promise<void>;
  markUnknown(postId: string, attempts: number, error: string, now: Date): Promise<void>;
  /** Posts published (or in flight / unknown) on this platform on the given local day: the cap guard counts these. */
  countSentOn(platform: Platform, localDay: string, timeZone: string): Promise<number>;
  /**
   * Alerts are persisted by the store (so the dashboard sees them). Returns false when the same
   * (kind, post) alert already exists, so a held post doesn't page the creator every minute.
   */
  recordAlert(alert: OutboxAlert): Promise<boolean>;
}

export interface AlertSink {
  send(alert: OutboxAlert): Promise<void>;
}

export interface EngineConfig {
  adapters: Partial<Record<Platform, PlatformAdapter>>;
  /** DRY_RUN=true (default): log what would fire, touch nothing, call no adapter. */
  dryRun: boolean;
  policy?: RetryPolicy;
  /** Daily caps come from cadence settings; the engine refuses to exceed them even if a batch does. */
  cadence: Pick<CadenceSettings, "dailyCaps">;
  timeZone: string;
  alerts?: AlertSink;
  log?: (line: string) => void;
  /** Injected clock (tests, simulate-week). */
  now?: () => Date;
  /** Native-scheduling platforms (YouTube, TikTok) are handed off this long before scheduled_for. Default 24 h. */
  nativeLeadMs?: number;
  /**
   * Last-line check right before a post is handed to its adapter (F7 C5: a caption edited after the
   * skill's lint must not slip out). Returns a reason to refuse, or null. A refusal (or a guard that
   * throws: fail closed) marks the post failed with that reason and raises a final-failure alert;
   * the adapter is never called. Core stays lint-free: the worker supplies the privacy lint.
   */
  captionGuard?: (post: OutboxPost) => string | null;
}

export interface TickResult {
  considered: number;
  published: number;
  queued: number;
  failed: number;
  unknown: number;
  /** Fired-as-recovered: the existence check found the post, nothing was resent. */
  recovered: number;
  skipped: number;
  dryRun: boolean;
  alerts: OutboxAlert[];
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctl.abort();
      reject(new PublishTimeoutError(ms));
    }, ms);
    run(ctl.signal).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Instagram fires at scheduled_for (server holds the clock). YouTube/TikTok hold their own clock, so we hand off ahead of time. Snapchat is assisted: never fired. */
export function isDueNow(post: OutboxPost, now: Date, nativeLeadMs: number): boolean {
  const cap = CAPABILITIES[post.platform];
  if (cap.scheduling === "none") return false;
  const at = Date.parse(post.scheduledFor);
  if (!Number.isFinite(at)) return false;
  if (post.status === "queued") return !post.nextAttemptAt || Date.parse(post.nextAttemptAt) <= now.getTime();
  const lead = cap.scheduling === "native" ? nativeLeadMs : 0;
  return at - lead <= now.getTime();
}

/**
 * One scheduler tick. For each due post: cap guard → claim → (retry? existence check) → publish
 * under a deadline → record the decision → alert on final failure / unknown.
 */
export async function runOutboxTick(store: OutboxStore, cfg: EngineConfig): Promise<TickResult> {
  const policy = cfg.policy ?? DEFAULT_RETRY_POLICY;
  const now = cfg.now?.() ?? new Date();
  // F7 B2/B3: every log line, last_error and alert message goes through one sanitiser.
  const rawLog = cfg.log ?? (() => {});
  const log = (line: string): void => rawLog(sanitizeForLog(line));
  const guardRefusal = (post: OutboxPost): string | null => {
    if (!cfg.captionGuard) return null;
    try {
      const reason = cfg.captionGuard(post);
      return reason ? sanitizeForLog(reason) : null;
    } catch (err) {
      return `caption guard errored (refusing to publish): ${sanitizeError(err)}`;
    }
  };
  const nativeLeadMs = cfg.nativeLeadMs ?? 24 * 3_600_000;
  const result: TickResult = { considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, dryRun: cfg.dryRun, alerts: [] };

  const raise = async (raw: OutboxAlert): Promise<void> => {
    const alert: OutboxAlert = { ...raw, message: sanitizeForLog(raw.message) };
    const isNew = await store.recordAlert(alert);
    if (!isNew) return;
    result.alerts.push(alert);
    if (cfg.alerts) await cfg.alerts.send(alert);
  };

  // Crashed attempts first: a row stuck in "publishing" is an unknown outcome until the platform says otherwise.
  const stale = await store.listStale(new Date(now.getTime() - policy.publishTimeoutMs));
  for (const post of stale) {
    const adapter = cfg.adapters[post.platform];
    let found: PublishResult | null = null;
    if (adapter?.findExisting && !cfg.dryRun) {
      try {
        found = await withTimeout((signal) => adapter.findExisting!(post, { signal }), policy.lookupTimeoutMs);
      } catch {
        found = null;
      }
    }
    // The crashed attempt counts (claim doesn't bump attempts): a row left at 0 would skip the
    // existence check if a human re-queued it later (F7 A8).
    const attempts = post.attempts + 1;
    if (found) {
      await store.markPublished(post.id, found, attempts, now);
      result.recovered++;
      result.published++;
      log(`[outbox] recovered ${post.platform} ${post.id} after a crashed attempt: on the platform as ${found.platformPostId}; not resent`);
    } else if (!cfg.dryRun) {
      const message = "worker stopped mid-publish; platform lookup found nothing (or isn't available)";
      await store.markUnknown(post.id, attempts, message, now);
      result.unknown++;
      log(`[outbox] UNKNOWN ${post.platform} ${post.id}: ${message}`);
      await raise({ kind: "unknown-outcome", platform: post.platform, postId: post.id, idempotencyKey: post.idempotencyKey, message, at: now.toISOString() });
    }
  }

  const due = (await store.listDue(now)).filter((p) => isDueNow(p, now, nativeLeadMs));
  result.considered = due.length;
  // Dry-run persists nothing, so count would-be sends here; live sends are counted by the store (claimed rows).
  const sentThisTick = new Map<string, number>();

  for (const post of due) {
    const adapter = cfg.adapters[post.platform];
    if (!adapter) {
      result.skipped++;
      continue;
    }
    const day = localDate(new Date(post.scheduledFor), cfg.timeZone);
    const capKey = `${post.platform}|${day}`;
    const cap = cfg.cadence.dailyCaps[post.platform];
    const already = (await store.countSentOn(post.platform, day, cfg.timeZone)) + (sentThisTick.get(capKey) ?? 0);
    if (already >= cap) {
      result.skipped++;
      log(`[outbox] cap: ${post.platform} already has ${already}/${cap} on ${day}; holding ${post.id}`);
      await raise({ kind: "cap-breach", platform: post.platform, postId: post.id, idempotencyKey: post.idempotencyKey, message: `daily cap ${cap} reached on ${day}; post held`, at: now.toISOString() });
      continue;
    }

    if (cfg.dryRun) {
      const refusal = guardRefusal(post);
      if (refusal) {
        result.skipped++;
        log(`[outbox] dry-run: would refuse ${post.platform} ${post.id}: ${refusal}`);
        continue;
      }
      log(`[outbox] dry-run: would publish ${post.platform} ${post.id} (scheduled_for ${post.scheduledFor}, attempt ${post.attempts + 1})`);
      sentThisTick.set(capKey, (sentThisTick.get(capKey) ?? 0) + 1);
      continue;
    }

    if (!(await store.claim(post.id, now))) {
      result.skipped++;
      continue;
    }

    // Retry path: before resending, ask the platform whether the post already exists.
    if (post.attempts > 0 && adapter.findExisting) {
      let found: PublishResult | null | undefined;
      try {
        found = await withTimeout((signal) => adapter.findExisting!(post, { signal }), policy.lookupTimeoutMs);
      } catch (err) {
        // The lookup sends nothing, so waiting and looking again is always safe. It still counts as an attempt (bounded).
        const message = `existence check failed: ${sanitizeError(err)}`;
        const d = decideAfterAttempt({ kind: "failure", cls: "rejected" }, post.attempts, now, policy);
        await applyDecision(store, post, d, message, now, raise, result, log);
        continue;
      }
      if (found) {
        await store.markPublished(post.id, found, post.attempts, now);
        result.recovered++;
        result.published++;
        log(`[outbox] recovered ${post.platform} ${post.id}: already on the platform as ${found.platformPostId}; not resent`);
        continue;
      }
    }

    // C5: the caption is checked again right before it leaves; a refusal is permanent (no retry fixes it).
    const refusal = guardRefusal(post);
    if (refusal) {
      const d = decideAfterAttempt({ kind: "failure", cls: "permanent" }, post.attempts, now, policy);
      await applyDecision(store, post, d, refusal, now, raise, result, log);
      continue;
    }

    // Only the platform call is inside the try: a store failure after a successful publish must NOT
    // look like a rejection (that would queue a resend). It propagates, the row stays "publishing",
    // and the stale-row path above settles it through the existence check.
    let published: PublishResult | undefined;
    let decision: Decision;
    let message = "";
    try {
      published = await withTimeout((signal) => adapter.publish(post, { signal }), policy.publishTimeoutMs);
      decision = decideAfterAttempt({ kind: "success" }, post.attempts, now, policy);
    } catch (err) {
      message = sanitizeError(err);
      decision = decideAfterAttempt({ kind: "failure", cls: classifyFailure(err) }, post.attempts, now, policy);
    }
    if (published) {
      await store.markPublished(post.id, published, decision.attempts, now);
      result.published++;
      log(`[outbox] published ${post.platform} ${post.id} -> ${published.platformPostUrl ?? published.platformPostId}`);
      continue;
    }
    await applyDecision(store, post, decision, message, now, raise, result, log);
  }
  return result;
}

async function applyDecision(
  store: OutboxStore,
  post: OutboxPost,
  d: Decision,
  message: string,
  now: Date,
  raise: (a: OutboxAlert) => Promise<void>,
  result: TickResult,
  log: (line: string) => void,
): Promise<void> {
  message = sanitizeForLog(message);
  const base = { platform: post.platform, postId: post.id, idempotencyKey: post.idempotencyKey, at: now.toISOString() };
  switch (d.status) {
    case "queued":
      await store.markQueued(post.id, d.attempts, d.nextAttemptAt, message, now);
      result.queued++;
      log(`[outbox] queued ${post.platform} ${post.id} for retry at ${d.nextAttemptAt} (attempt ${d.attempts}): ${message}`);
      return;
    case "failed":
      await store.markFailed(post.id, d.attempts, message, now);
      result.failed++;
      log(`[outbox] FAILED ${post.platform} ${post.id} after ${d.attempts} attempts: ${message}`);
      await raise({ ...base, kind: "final-failure", message: `gave up after ${d.attempts} attempts: ${message}` });
      return;
    case "unknown":
      await store.markUnknown(post.id, d.attempts, message, now);
      result.unknown++;
      log(`[outbox] UNKNOWN ${post.platform} ${post.id}: ${message} — check the platform by hand; the engine will not resend`);
      await raise({ ...base, kind: "unknown-outcome", message: `timed out; outcome unknown: ${message}` });
      return;
    case "published":
      return; // handled inline
  }
}
