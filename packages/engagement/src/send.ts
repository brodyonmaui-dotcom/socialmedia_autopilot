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
import { REPLY_PLATFORM_NAME } from "./status.js";
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
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    // Bare keys/tokens with no `key=` in front (F7 B6): Anthropic keys, and any long run that mixes
    // letters and digits (Meta/Google tokens). Numeric platform ids (≤ 20 digits) are left alone.
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
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
 * A thread-read error as a short, stable class for the row / alert ("HTTP 400 PLATFORM_LIMITATION", "timed out").
 * Stable so the daily alert dedupe works; never the raw body (no ids, no tokens).
 */
export function threadErrorClass(err: unknown): string {
  if (err instanceof PublishTimeoutError) return "timed out";
  const msg = errMessage(err);
  if (/PLATFORM_LIMITATION/.test(msg)) return "PLATFORM_LIMITATION (connect TikTok through the Business app in Zernio)";
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) {
    const code = /HTTP \d{3}\s+([A-Za-z][A-Za-z0-9_]{2,40})\b/.exec(msg)?.[1];
    return `HTTP ${http[1]}${code && /[_A-Z]/.test(code) && code === code.toUpperCase() ? ` ${code}` : ""}`;
  }
  if (/abort|timeout|timed out/i.test(msg)) return "timed out";
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|network/i.test(msg)) return "network error";
  const name = (err as Error | undefined)?.name;
  return name && name !== "Error" ? name : "error";
}

/**
 * Why a gate held a row, in plain words for the creator (stored on the row, shown in the Inbox).
 * Never includes KILL_PATTERN words (a planned row's last_error feeds the kill auto-trip after a retry).
 */
export function heldReason(a: EngagementActionRow, reason: SendGateReason, detail: string | undefined, source: CommentSource | undefined): { text: string; transient: boolean } {
  const name = REPLY_PLATFORM_NAME[a.platform];
  switch (reason) {
    case "dry-run":
      return { text: "Worker is in dry run (it sends only with DRY_RUN=false and the live start)", transient: false };
    case "killed":
      return { text: "Replies are paused (kill switch is on)", transient: false };
    case "no-capability":
      if (!source) return { text: `${name} isn't connected on the server`, transient: false };
      return { text: source.replyUnavailableReason ?? `${name} ${a.kind === "hide" ? "hiding" : "replies"} aren't available on the server`, transient: false };
    case "mode":
      return { text: detail === "hide disabled" ? `Hiding is switched off for ${name} in Settings` : `${name} replies are ${detail ?? "off"}`, transient: false };
    case "too-early":
      return { text: `Waiting for its send time${detail ? ` (${detail})` : ""}`, transient: true };
    case "limit":
      return { text: `Waiting for the reply cap to free up${detail ? ` (${detail})` : ""}`, transient: true };
    default:
      return { text: reason, transient: false };
  }
}

/**
 * One send tick. Rows the gate holds (dry-run, mode, killed, too-early, limit, no-capability) keep
 * status `planned` and are counted in `skipped`; a held manual row also gets the reason on the row
 * (`markHeld`) and, unless transient, one daily engagement-failure alert (see `hold`). Timeouts become `unknown` and are never retried.
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
  const result: SendTickResult = { considered: 0, sent: 0, skipped: {}, retried: 0, failed: 0, unknown: 0, cancelled: 0, staleSettled: 0, killedNow: null, alerts: [], held: [] };

  const skip = (a: EngagementActionRow, reason: SendGateReason, detail?: string): void => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
    log(`[engage] skip ${a.platform} ${a.kind} ${a.id}: ${reason}${detail ? ` (${detail})` : ""}`);
  };
  const raise = async (alert: EngagementAlert): Promise<void> => {
    if (!(await store.recordAlert(alert))) return;
    result.alerts.push(alert);
    if (cfg.alerts) await cfg.alerts.send(alert);
  };
  /**
   * A creator-approved (manual) row is held: store the reason on the row (status stays planned, so it sends
   * once the cause is gone, and still only once), log it once per new reason, and (non-transient) raise one
   * engagement-failure alert per (platform, reason) per day. Auto rows keep the plain skip log.
   */
  const hold = async (a: EngagementActionRow, text: string, transient: boolean): Promise<void> => {
    result.held.push({ platform: a.platform, actionId: a.id, origin: a.origin, reason: text, transient });
    const fresh = store.markHeld ? await store.markHeld(a.id, text, now) : true;
    if (fresh) log(`[engage] waiting ${a.platform} ${a.kind} ${a.id}: ${text}`);
    if (transient) return;
    const alert: EngagementAlert = { kind: "engagement-failure", platform: a.platform, actionId: null, message: `${REPLY_PLATFORM_NAME[a.platform]} reply waiting: ${text}`, at: now.toISOString() };
    const isNew = store.recordDailyAlert ? await store.recordDailyAlert(alert, now) : await store.recordAlert(alert);
    if (!isNew) return;
    result.alerts.push(alert);
    if (cfg.alerts) await cfg.alerts.send(alert);
  };

  // Crashed sends first: a row still "sending" well past the send deadline may or may not have reached the
  // platform. It is settled as unknown (+ alert) and never resent. Dry-run persists nothing.
  if (!dryRun) {
    const stale = await store.listStaleSending(new Date(now.getTime() - policy.publishTimeoutMs * 2), DUE_BATCH);
    for (const a of stale) {
      const message = "crashed send: settled as unknown";
      await store.markUnknown(a.id, message, now);
      result.staleSettled++;
      log(`[engage] UNKNOWN ${a.platform} ${a.id}: ${message}`);
      await raise({ kind: "engagement-unknown", platform: a.platform, actionId: a.id, message: `${a.kind} ${message} (not retried; check the thread)`, at: now.toISOString() });
    }
  }

  const due = await store.listDueActions(now, DUE_BATCH);
  result.considered = due.length;

  for (const a of due) {
    const source = sources.get(a.platform);
    const caps = { canReply: typeof source?.reply === "function", canHide: typeof source?.hide === "function" };
    const counts = await store.limitCounts(a.platform, a.authorId, cfg.settings.limits, now);
    const gate = sendGate(a, cfg.settings, { dryRun, killEnv: cfg.killEnv }, counts, now, caps);
    if (!gate.ok) {
      if (a.origin === "manual") {
        result.skipped[gate.reason] = (result.skipped[gate.reason] ?? 0) + 1;
        const h = heldReason(a, gate.reason, gate.detail, source);
        await hold(a, h.text, h.transient);
      } else skip(a, gate.reason, gate.detail);
      continue;
    }
    if (!source) {
      if (a.origin === "manual") {
        result.skipped["no-capability"] = (result.skipped["no-capability"] ?? 0) + 1;
        await hold(a, heldReason(a, "no-capability", undefined, undefined).text, false);
      } else skip(a, "no-capability", "no source");
      continue;
    }
    if (a.kind === "reply" && !a.text?.trim()) {
      await store.markFailed(a.id, "reply has no text", now);
      result.failed++;
      log(`[engage] FAILED ${a.platform} ${a.id}: reply has no text`);
      continue;
    }

    // Pre-flight: re-read the thread before EVERY send (first attempts too), not only before retries:
    // the creator may have replied by hand during the veto window (F7 A15 red-team found this).
    // Cost: one read per send (IG 1 GET, YouTube 1 unit).
    {
      let thread: InboundComment | null;
      try {
        thread = await withTimeout((signal) => source.fetchThread(a.platformCommentId, { signal }), policy.lookupTimeoutMs);
      } catch (err) {
        // The lookup sends nothing, so leaving the row planned and looking again next tick is safe.
        if (a.origin === "manual") await hold(a, `${REPLY_PLATFORM_NAME[a.platform]} thread couldn't be read: ${threadErrorClass(err)}`, false);
        else log(`[engage] hold ${a.platform} ${a.id}: thread check failed (${errMessage(err)}); will look again`);
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
        // The row is cancelled (not left planned): a planned row would be re-read every tick and, once 20
        // pile up, starve the due list.
        if (a.origin === "auto" && thread.ownRepliesInThread.length > 0) {
          await store.markCancelled(a.id, "creator replied first", now);
          result.cancelled++;
          log(`[engage] cancelled ${a.platform} ${a.id}: creator replied first (${thread.ownRepliesInThread.length} own repl${thread.ownRepliesInThread.length === 1 ? "y" : "ies"} in thread)`);
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
