// Shared types for engagement (F3). Pure: no pg, no fetch, no SDK here.
// Design: docs/design/F3.md + docs/prep/run-2-decisions.md. Platform facts: docs/research.md:190-197.

import type { AlertKind, Platform, RetryPolicy } from "@autopilot/core";

export type Bucket = "simple_positive" | "negative" | "hide_flag" | "flag";
export type EngagementPlatform = Extract<Platform, "instagram" | "youtube" | "tiktok">;
export type Mode = "off" | "shadow" | "live";
export type ActionKind = "reply" | "hide";
export type ActionStatus = "planned" | "sending" | "sent" | "failed" | "unknown" | "cancelled" | "shadow";
export type ActionOrigin = "auto" | "manual";

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
  limitCounts(platform: EngagementPlatform, authorId: string | null, limits: EngagementLimits, now: Date): Promise<LimitCounts>;
  recentOutcomes(platform: EngagementPlatform, n: number): Promise<Array<{ ok: boolean; error?: string }>>; // newest first, for the auto-trip
  recordAlert(alert: EngagementAlert): Promise<boolean>; // true when new (dedupe per kind+action)
  setKilled(reason: string, now: Date): Promise<void>;
}

export interface SendTickResult {
  considered: number;
  sent: number;
  skipped: Partial<Record<SendGateReason, number>>;
  retried: number;
  failed: number;
  unknown: number;
  killedNow: string | null;
  alerts: EngagementAlert[];
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
