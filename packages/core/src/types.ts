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

export interface FindExistingOptions extends PublishOptions {
  /**
   * Platform post ids already stored on OTHER outbox rows (same platform, near this post). A caption/title
   * match must never return one of these: two posts that share a caption would otherwise let a retry adopt
   * the other post's id and mark this one published when it never went out (non-negotiable 3).
   */
  excludeIds?: ReadonlySet<string>;
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
  findExisting?(post: OutboxPost, opts?: FindExistingOptions): Promise<PublishResult | null>;
}

/** Every alerts.kind the code writes: the single source for AlertKind (db re-exports it) and for runtime validation. */
export const ALERT_KINDS = [
  "final-failure", "unknown-outcome", "cap-breach", "duplicate", "token-health",
  "auth", "engagement-kill", "engagement-failure", "engagement-unknown", "engagement-mode",
  "metrics-health", // F9 analytics ingest (page-only)
  "config", // worker misconfiguration, e.g. PUBLIC_MEDIA_BASE (page-only)
  "ready-for-approval", // F15: an editor render landed as draft items (pushed)
  "settings-change", // F15: audit row for a Settings edit (caps, DM drafts); inserted acknowledged, never pushed
  "reply-ready", // run 4: a drafted/flagged comment waits (paced by settings engagement.pings); pushed with a privacy-linted line
  "auto-scheduled", // editor approval counts: a render approved in the editor was scheduled without a tap here (pushed)
  "batch-ready", // F14: the Sunday weekly-draft job topped up next week's drafts; captions wait (pushed)
  "report-ready", // F14: Monday, last week had published posts; the 7-day analytics view is ready (page-only)
  "missed-slot", // F18: an approved post is > 60 min past its time and was held, not sent (page-only)
  "trial-reels-ready", // F20-F: Instagram reached the follower minimum for trial reels; the toggle is in Settings (pushed, once)
  "duplicate-held", // F26 A: the outbox held an approved post because the same video already went out on that platform (pushed)
] as const;

/** F20-F: Instagram trial reels by default. Setting keys + defaults shared by the worker and Settings. */
export const IG_TRIAL_REELS_KEY = "ig_trial_reels"; // jsonb boolean, default off
export const TRIAL_REELS_MIN_FOLLOWERS_KEY = "trial_reels_min_followers"; // jsonb number
export const TRIAL_REELS_MIN_FOLLOWERS_DEFAULT = 200;
export const TRIAL_REELS_ALERTED_KEY = "trial_reels_alerted"; // jsonb true once the alert was raised
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
  "ready-for-approval", // F15; "settings-change" is never pushed
  "reply-ready", // run 4; volume capped by engagement.pings (each ≤ 6/h, hourly digest, off)
  "auto-scheduled", // only while Settings → Editor approval counts is on; one per item
  "batch-ready", // F14: at most one per Sunday run; "report-ready" stays page-only
  "trial-reels-ready", // F20-F: once, when Instagram first reaches the follower minimum
  "duplicate-held", // F26 A: one per held item (the alert dedupes per kind + item)
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
