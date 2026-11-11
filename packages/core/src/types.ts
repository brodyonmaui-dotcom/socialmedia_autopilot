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
  lastError?: string;
  platformPostId?: string;
  platformPostUrl?: string;
}

export interface PublishResult {
  platformPostId: string;
  platformPostUrl?: string;
}

/** Implemented per platform in later milestones; this is the shared contract. */
export interface PlatformAdapter {
  platform: Platform;
  publish(post: OutboxPost): Promise<PublishResult>;
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
