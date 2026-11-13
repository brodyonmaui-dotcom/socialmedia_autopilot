// Send engine (F3): one tick over due engagement actions. Mirrors the outbox discipline in
// @autopilot/core (engine.ts): gate → (retry/manual? thread check) → claim → send under a deadline →
// record the decision → alert on final failure / unknown → auto-trip the kill switch.

import {
  DEFAULT_RETRY_POLICY,
  PublishTimeoutError,
  classifyFailure,
  decideAfterAttempt,
  type Decision,
} from "@autopilot/core";
import { sendGate } from "./gate.js";
import { shouldTripKill } from "./kill.js";
import type {
  CommentSource,
  EngagementActionRow,
  EngagementAlert,
  EngagementPlatform,
  EngagementStore,
  InboundComment,
  SendGateReason,
  SendTickConfig,
  SendTickResult,
} from "./types.js";

const DUE_BATCH = 20;

/** Run `fn` with an AbortSignal; reject with PublishTimeoutError (classified "timeout") after `ms`. */
function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctl.abort();
      reject(new PublishTimeoutError(ms));
    }, ms);
    fn(ctl.signal).then(
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

/** Strip anything token-like before an error reaches the store, a log line or an alert. */
export function redactSecrets(s: string): string {
  return s
    .replace(/\b(access_token|refresh_token|client_secret|token|key|api_key|apikey|secret)=([^&\s"']+)/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

/** Compare reply texts loosely: case, whitespace, Unicode form and a leading @mention (platforms may prefix one). */
export function normaliseReplyText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/^(\s*@[\w.]+\s*)+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const errMessage = (err: unknown): string => redactSecrets((err as Error | undefined)?.message ?? String(err));

/**
 * One send tick. Rows the gate holds (dry-run, mode, killed, too-early, limit, no-capability) keep
 * status `planned` and are only counted in `skipped`. Timeouts become `unknown` and are never retried.
 * A lost claim is logged and not counted (no SendGateReason fits; another worker owns the row).
 */
export async function runSendTick(
  store: EngagementStore,
  sources: Map<EngagementPlatform, CommentSource>,
  cfg: SendTickConfig,
): Promise<SendTickResult> {
  const policy = cfg.policy ?? DEFAULT_RETRY_POLICY;
  const now = cfg.now?.() ?? new Date();
  const log = cfg.log ?? (() => {});
  const dryRun = cfg.dryRun ?? true;
  const timeoutMs = cfg.timeoutMs ?? policy.publishTimeoutMs;
  const result: SendTickResult = { considered: 0, sent: 0, skipped: {}, retried: 0, failed: 0, unknown: 0, killedNow: null, alerts: [] };

  const skip = (a: EngagementActionRow, reason: SendGateReason, detail?: string): void => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
    log(`[engage] skip ${a.platform} ${a.kind} ${a.id}: ${reason}${detail ? ` (${detail})` : ""}`);
  };
  const raise = async (alert: EngagementAlert): Promise<void> => {
    if (!(await store.recordAlert(alert))) return;
    result.alerts.push(alert);
    if (cfg.alerts) await cfg.alerts.send(alert);
  };

  const due = await store.listDueActions(now, DUE_BATCH);
  result.considered = due.length;

  for (const a of due) {
    const source = sources.get(a.platform);
    const caps = { canReply: typeof source?.reply === "function", canHide: typeof source?.hide === "function" };
    const counts = await store.limitCounts(a.platform, a.authorId, cfg.settings.limits, now);
    const gate = sendGate(a, cfg.settings, { dryRun, killEnv: cfg.killEnv }, counts, now, caps);
    if (!gate.ok) {
      skip(a, gate.reason, gate.detail);
      continue;
    }
    if (!source) {
      skip(a, "no-capability", "no source");
      continue;
    }
    if (a.kind === "reply" && !a.text?.trim()) {
      await store.markFailed(a.id, "reply has no text", now);
      result.failed++;
      log(`[engage] FAILED ${a.platform} ${a.id}: reply has no text`);
      continue;
    }

    // Pre-flight: before a retry, and for every manual action, re-read the thread.
    if (a.attempts > 0 || a.origin === "manual") {
      let thread: InboundComment | null;
      try {
        thread = await withTimeout((signal) => source.fetchThread(a.platformCommentId, { signal }), policy.lookupTimeoutMs);
      } catch (err) {
        // The lookup sends nothing, so leaving the row planned and looking again next tick is safe.
        log(`[engage] hold ${a.platform} ${a.id}: thread check failed (${errMessage(err)}); will look again`);
        continue;
      }
      if (!thread) {
        await store.markFailed(a.id, "comment gone", now);
        log(`[engage] ${a.platform} ${a.id}: comment gone; marked failed, nothing sent`);
        continue;
      }
      if (a.kind === "reply") {
        const want = normaliseReplyText(a.text ?? "");
        const mine = thread.ownRepliesInThread.find((r) => normaliseReplyText(r.text) === want);
        if (mine) {
          await store.markSent(a.id, mine.platformCommentId, now);
          skip(a, "already-exists", `already on the platform as ${mine.platformCommentId}; not resent`);
          continue;
        }
        // Someone (the human) already answered in this thread: automation steps back. Manual actions are
        // the human, so they are not paused by their own earlier replies.
        if (a.origin === "auto" && thread.ownRepliesInThread.length > 0) {
          skip(a, "human-replied", `${thread.ownRepliesInThread.length} own repl${thread.ownRepliesInThread.length === 1 ? "y" : "ies"} in thread`);
          continue;
        }
      }
    }

    if (!(await store.claimAction(a.id, now))) {
      log(`[engage] claim lost ${a.platform} ${a.id}; another worker has it`);
      continue;
    }

    // Only the platform call is inside the try: a store failure after a successful send must not look
    // like a rejection (that would queue a resend). It propagates and the row stays "sending".
    let replyId: string | null = null;
    let decision: Decision;
    let message = "";
    try {
      if (a.kind === "reply") {
        const r = await withTimeout((signal) => source.reply!(a.platformCommentId, a.text!, { signal, idempotencyKey: a.idempotencyKey }), timeoutMs);
        replyId = r.platformReplyId ?? null;
      } else {
        await withTimeout((signal) => source.hide!(a.platformCommentId, { signal }), timeoutMs);
      }
      decision = decideAfterAttempt({ kind: "success" }, a.attempts, now, policy);
    } catch (err) {
      message = errMessage(err);
      decision = decideAfterAttempt({ kind: "failure", cls: classifyFailure(err) }, a.attempts, now, policy);
    }

    const at = now.toISOString();
    switch (decision.status) {
      case "published":
        await store.markSent(a.id, replyId, now);
        result.sent++;
        log(`[engage] sent ${a.platform} ${a.kind} ${a.id}${replyId ? ` -> ${replyId}` : ""}`);
        break;
      case "queued":
        await store.markRetry(a.id, new Date(decision.nextAttemptAt), message, now);
        result.retried++;
        log(`[engage] retry ${a.platform} ${a.id} at ${decision.nextAttemptAt} (attempt ${decision.attempts}): ${message}`);
        break;
      case "failed":
        await store.markFailed(a.id, message, now);
        result.failed++;
        log(`[engage] FAILED ${a.platform} ${a.id} after ${decision.attempts} attempt(s): ${message}`);
        await raise({ kind: "engagement-failure", platform: a.platform, actionId: a.id, message: `${a.kind} failed: ${message}`, at });
        break;
      case "unknown":
        await store.markUnknown(a.id, message, now);
        result.unknown++;
        log(`[engage] UNKNOWN ${a.platform} ${a.id}: ${message}`);
        await raise({ kind: "engagement-unknown", platform: a.platform, actionId: a.id, message: `${a.kind} outcome unknown (not retried): ${message}`, at });
        break;
    }

    const why = shouldTripKill(await store.recentOutcomes(a.platform, 3));
    if (why) {
      await store.setKilled(why, now);
      result.killedNow = why;
      log(`[engage] KILL tripped on ${a.platform}: ${why}; stopping this tick`);
      await raise({ kind: "engagement-kill", platform: a.platform, actionId: a.id, message: `engagement stopped: ${why}`, at });
      break;
    }
  }

  return result;
}
