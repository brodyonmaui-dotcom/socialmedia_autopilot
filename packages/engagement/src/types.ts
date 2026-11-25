// Shared types for engagement (F3). Pure: no pg, no fetch, no SDK here.
// Design: docs/archive/design/F3.md + docs/archive/prep/run-2-decisions.md. Platform facts: docs/research.md (Instagram + YouTube sections, comment API bullets).

import type { AlertKind, Platform, RetryPolicy } from "@autopilot/core";

/** spam_promo (run 4): promo spam ("send it to @page", "DM us to be featured"). Never replied to, never hidden, no action row. */
export type Bucket = "simple_positive" | "negative" | "hide_flag" | "flag" | "spam_promo";
export const BUCKETS: readonly Bucket[] = ["simple_positive", "negative", "hide_flag", "flag", "spam_promo"];
export type EngagementPlatform = Extract<Platform, "instagram" | "youtube" | "tiktok">;
export type Mode = "off" | "shadow" | "live";
export type ActionKind = "reply" | "hide";
export type ActionStatus = "planned" | "sending" | "sent" | "failed" | "unknown" | "cancelled" | "shadow";
export type ActionOrigin = "auto" | "manual";
/** Phone pings for drafted/flagged comments (settings engagement.pings). Default hourly. */
export type PingMode = "each" | "hourly" | "off";

/** A row of engagement_promo_accounts (open = removed_at is null). authorKey: platform author id, else the lower-cased handle. */
export interface PromoAccount { platform: EngagementPlatform; authorKey: string }

/** A comment as fetched from a platform (normalised). */
export interface InboundComment {
  platform: EngagementPlatform;
  platformCommentId: string;
  platformMediaId: string;
  parentId?: string;
  /** Null when the platform hides the author (Meta Development mode may omit `from`). */
  authorId: string | null;
  authorHandle?: string;
  text: string;
  createdAt: string; // ISO
  isOwn: boolean;
  /** Our own replies already in this thread: existence check before a retry + human-takeover pause. */
  ownRepliesInThread: Array<{ platformCommentId: string; text: string; createdAt: string }>;
}

export interface CommentSource {
  platform: EngagementPlatform;
  fetchRecent(cursor: unknown, opts?: { signal?: AbortSignal }): Promise<{ comments: InboundComment[]; cursor: unknown }>;
  /** Re-read one comment with its thread (null if gone). Used before any retry. */
  fetchThread(platformCommentId: string, opts?: { signal?: AbortSignal }): Promise<InboundComment | null>;
  reply?(platformCommentId: string, text: string, opts: { signal?: AbortSignal; idempotencyKey: string }): Promise<{ platformReplyId: string }>;
  hide?(platformCommentId: string, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Plain words for why reply() is missing ("YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)"). */
  replyUnavailableReason?: string;
  /** A no-credentials placeholder (polls return nothing): not a real source for the status page. */
  placeholder?: boolean;
}

export interface TriageResult {
  bucket: Bucket;
  reply: string | null;
  confidence: number; // 0..1
  reasons: string[];
  model: string; // "rules" when no model ran
  refused?: boolean;
}
export interface TriageContext { postCaption?: string; pillar?: string | null }
export interface TriageClient {
  triage(c: InboundComment, ctx: TriageContext): Promise<TriageResult>;
}

export interface EngagementLimits {
  perPersonDays: number; // 7: max 1 auto-reply per person per window
  perPlatformPerHour: number; // 10
  perPlatformPerDay: number; // 40
  globalPerDay: number; // 80
}
export interface EngagementSettings {
  mode: Record<EngagementPlatform, Mode>; // default shadow / shadow / off
  killed: boolean;
  killedReason?: string;
  hideEnabled: Record<EngagementPlatform, boolean>; // default false; hide also needs live
  limits: EngagementLimits;
  minDelayMin: number; // 10: veto window before an auto action may be sent
  pollMinutes: { instagram: number; youtube: number }; // 5, 15
  pools: { positive: string[]; negative: string[] };
  dmPollVerified: boolean; // false until the read-only DM probe confirms access
  pings: PingMode; // "hourly": one digest push per hour while something waits
}

/** What the planner needs to know about past actions (backed by engagement_actions). */
export interface ActionHistory {
  lastRepliesOn(platform: EngagementPlatform, n: number): Promise<string[]>; // newest first
  repliesToAuthorSince(platform: EngagementPlatform, authorId: string, since: Date): Promise<string[]>;
  countSent(platform: EngagementPlatform | "all", since: Date): Promise<number>; // sent + sending
  textUseCount(platform: EngagementPlatform, text: string, since: Date): Promise<number>;
  isBlockedAuthor(platform: EngagementPlatform, authorId: string): Promise<boolean>;
}

export type PlannedAction =
  | { kind: "reply"; text: string; notBefore: string }
  | { kind: "hide"; notBefore: string }
  | { kind: "flag"; reason: string }
  | { kind: "none"; reason: string };

/** A row of engagement_actions as the send tick sees it. */
export interface EngagementActionRow {
  id: string;
  commentId: string;
  platform: EngagementPlatform;
  platformCommentId: string;
  authorId: string | null;
  kind: ActionKind;
  text: string | null;
  idempotencyKey: string;
  status: ActionStatus;
  notBefore: string;
  attempts: number;
  nextAttemptAt: string | null;
  origin: ActionOrigin;
  createdAt: string;
}

export interface LimitCounts {
  platformHour: number;
  platformDay: number;
  globalDay: number;
  /** auto-replies to this author within perPersonDays (0 when authorId is null) */
  authorWindow: number;
}

export type SendGateReason =
  | "dry-run" | "mode" | "killed" | "limit" | "too-early" | "human-replied" | "already-exists" | "blocked-author" | "no-capability";
export type SendGate = { ok: true } | { ok: false; reason: SendGateReason; detail?: string };

export interface EngagementAlert { kind: AlertKind; platform: EngagementPlatform; actionId: string | null; message: string; at: string }
export interface EngagementAlertSink { send(alert: EngagementAlert): Promise<void> }

/** Store surface used by the send tick (pg in the worker, in-memory fake in tests). */
export interface EngagementStore extends ActionHistory {
  listDueActions(now: Date, limit?: number): Promise<EngagementActionRow[]>; // status planned, not_before <= now, backoff due
  claimAction(id: string, now: Date): Promise<boolean>; // planned → sending, conditional
  markSent(id: string, platformActionId: string | null, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: string, now: Date): Promise<void>; // sending → planned, attempts+1
  markFailed(id: string, error: string, now: Date): Promise<void>;
  markUnknown(id: string, error: string, now: Date): Promise<void>;
  /** planned → cancelled (e.g. the creator replied first). Cancelled rows never return from listDueActions. */
  markCancelled(id: string, reason: string, now: Date): Promise<void>;
  /** Rows stuck in 'sending' longer than `olderThan` (a crashed send): settled as unknown, never resent. */
  listStaleSending(olderThan: Date, limit?: number): Promise<EngagementActionRow[]>;
  limitCounts(platform: EngagementPlatform, authorId: string | null, limits: EngagementLimits, now: Date): Promise<LimitCounts>;
  recentOutcomes(platform: EngagementPlatform, n: number): Promise<Array<{ ok: boolean; error?: string }>>; // newest first, for the auto-trip
  recordAlert(alert: EngagementAlert): Promise<boolean>; // true when new (dedupe per kind+action)
  setKilled(reason: string, now: Date): Promise<void>;
  /**
   * Stores why a planned row is held (last_error) without touching its status. True when the reason is new
   * for that row (so the tick logs it once). Optional: older stores just don't record it.
   */
  markHeld?(id: string, reason: string, now: Date): Promise<boolean>;
  /** Inserts an alert unless one with the same kind + platform + message exists in the last 24 h. True when new. */
  recordDailyAlert?(alert: EngagementAlert, now: Date): Promise<boolean>;
}

/** A due row the gate (or a failed thread check) held this tick. Status stays planned. */
export interface HeldAction {
  platform: EngagementPlatform;
  actionId: string;
  origin: ActionOrigin;
  reason: string;
  /** too-early / limits: clears by itself, so no alert. */
  transient: boolean;
}

export interface SendTickResult {
  considered: number;
  sent: number;
  skipped: Partial<Record<SendGateReason, number>>;
  retried: number;
  failed: number;
  unknown: number;
  cancelled: number;
  staleSettled: number;
  killedNow: string | null;
  alerts: EngagementAlert[];
  /** Manual (creator-approved) rows held this tick, with the plain-words reason stored on the row. */
  held: HeldAction[];
}

export interface SendTickConfig {
  settings: EngagementSettings;
  dryRun: boolean;
  killEnv: boolean;
  policy?: RetryPolicy;
  alerts?: EngagementAlertSink;
  log?: (line: string) => void;
  now?: () => Date;
  timeoutMs?: number; // per send, default policy.publishTimeoutMs
}

// DMs (read + draft only; there is deliberately no DmSource.send)
export interface DmMessage { id: string; dir: "in" | "out"; text: string; at: string }
export interface DmThreadInput { platformThreadId: string; participantId: string; handle?: string; messages: DmMessage[] }
export interface DmSource {
  fetchThreads(cursor: unknown, opts?: { signal?: AbortSignal }): Promise<{ threads: DmThreadInput[]; cursor: unknown }>;
}
export interface DmWindow { endsAt: string; msLeft: number; open: boolean }
