export type Platform = "instagram" | "youtube" | "tiktok" | "snapchat";

/** How a post reaches the platform. See CLAUDE.md "Platform routes". */
export type PlatformRoute = "direct" | "middleman" | "assisted";

export interface PlatformCapability {
  route: PlatformRoute;
  /** Who holds the publish clock. */
  scheduling: "server-fires" | "native" | "none";
  commentHandling: "polling" | "webhook" | "none";
  /** 15/day, ≤5 hashtags, etc. — the facts that change adapter behavior. */
  notes: string;
}

export type PostStatus =
  | "draft"
  | "approved"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "unknown"; // a timeout: never downgrade this to "failed" without checking first

export interface OutboxPost {
  id: string;
  /** One per logical post; reused on retry so a resend can't double-post. */
  idempotencyKey: string;
  platform: Platform;
  mediaUrl: string;
  caption: string;
  /** YouTube only. */
  title?: string;
  scheduledFor: string; // ISO 8601
  status: PostStatus;
  attempts: number;
  /** Set while a retry waits out its backoff (status "queued"). */
  nextAttemptAt?: string;
  /** Last status change (ISO); a "publishing" row older than the publish deadline is a crashed attempt. */
  updatedAt?: string;
  lastError?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  /** Library clip id, when known (duplicate detection across the outbox). */
  mediaId?: string;
  /** TikTok only: send to the Creator Inbox as a draft (sound-dependent posts). */
  tiktokDraft?: boolean;
  /** Instagram only: post as a trial reel (decisions.md §5). Absent = plain reel. */
  trial?: { graduationStrategy: "MANUAL" | "SS_PERFORMANCE" };
}

export interface PublishResult {
  platformPostId: string;
  platformPostUrl?: string;
  /** Instagram: the trial was refused and the post went out as a plain reel (stored as trial.fellBack=true). */
  trialFellBack?: boolean;
  /** Anything the creator should know about how it went out ("draft in Creator Inbox", …). */
  flags?: string[];
}

export interface PublishOptions {
  /** Aborted by the outbox when the publish deadline passes; adapters should pass it to fetch. */
  signal?: AbortSignal;
}

/** Implemented per platform; this is the shared contract the outbox engine drives. */
export interface PlatformAdapter {
  platform: Platform;
  publish(post: OutboxPost, opts?: PublishOptions): Promise<PublishResult>;
  /**
   * "Did this post already land?" — looked up by idempotency key (or media + caption) before any
   * retry, so a resend can never double-post. Returns null when nothing is found. Adapters without a
   * platform-side lookup leave it undefined; the engine then retries only deliberate rejections.
   */
  findExisting?(post: OutboxPost, opts?: PublishOptions): Promise<PublishResult | null>;
}

/** Every alerts.kind the code writes: the single source for AlertKind (db re-exports it) and for runtime validation. */
export const ALERT_KINDS = [
  "final-failure", "unknown-outcome", "cap-breach", "duplicate", "token-health",
  "auth", "engagement-kill", "engagement-failure", "engagement-unknown", "engagement-mode",
  "metrics-health", // F9 analytics ingest (page-only)
  "config", // worker misconfiguration, e.g. PUBLIC_MEDIA_BASE (page-only)
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export function isAlertKind(x: unknown): x is AlertKind {
  return typeof x === "string" && (ALERT_KINDS as readonly string[]).includes(x);
}

/**
 * What alerts.platform actually holds: a platform (outbox, engagement, token-health "youtube"),
 * "web" (auth), "meta" / "zernio" (token-health services), or "all" (the inbox kill switch).
 */
export type AlertSource = Platform | "web" | "meta" | "zernio" | "all";

/** Kinds the alert-push job sends by default (F8 OQ1); the rest are page-only. Override: settings 'alert_push'. */
export const PUSH_KINDS_DEFAULT: readonly AlertKind[] = [
  "engagement-kill", "unknown-outcome", "final-failure", "token-health", "auth",
];

/** Raised by the outbox for anything a human must look at. Delivered by an AlertSink (log, DB, push). */
export interface OutboxAlert {
  kind: AlertKind;
  platform: Platform;
  postId: string;
  idempotencyKey: string;
  message: string;
  at: string; // ISO 8601
}

/**
 * A posting window in the creator's local wall-clock time ("HH:MM", 24h), editable via
 * Settings → cadence. The time zone that makes this meaningful is TZ_CREATOR (.env only —
 * never commit it); the window bounds themselves aren't location-revealing.
 */
export interface PostingWindow {
  start: string;
  end: string;
}
