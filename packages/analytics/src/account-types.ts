import type { Platform } from "@autopilot/core";

/**
 * Account-wide analytics (0011_account_posts.sql): every recent post on the account, including the ones
 * the creator posted by hand. Every metric is nullable: null = the platform didn't give it, never 0.
 */
export interface AccountMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  /** Average watch time in seconds (IG ig_reels_avg_watch_time / 1000; YouTube: not in the Data API → null). */
  avgWatchS: number | null;
}

export const EMPTY_ACCOUNT_METRICS: AccountMetrics = { views: null, likes: null, comments: null, shares: null, saves: null, reach: null, avgWatchS: null };

/** One post as read from a platform list call (no thumbnails, no media URLs, no location, no other people's handles). */
export interface FetchedAccountPost {
  platformPostId: string;
  permalink: string;
  kind: string | null;
  caption: string | null;
  title: string | null;
  publishedAt: string;
  durationS: number | null;
  /** null = no numbers this run (insights skipped by the request budget or a rate limit): no snapshot is written. */
  metrics: AccountMetrics | null;
}

/** Account-level totals for the daily account snapshot. */
export interface AccountTotals {
  followers: number | null;
  totalViews: number | null;
  postsCount: number | null;
}

export type AccountStop = "rate-limit" | "budget" | "error";

export interface AccountFetchResult {
  platform: Platform;
  posts: FetchedAccountPost[];
  /** null = not requested this run (already have today's) or not available. */
  account: AccountTotals | null;
  requests: number;
  /** Why the run ended early for this platform; null = it finished. Partial data is still returned. */
  stoppedBy: AccountStop | null;
  /** Sanitised, short. */
  error: string | null;
}

export type MatchedBy = "id" | "caption";

/** A stored account post with its latest snapshot: the unit the findings and the web loaders work on. */
export interface AccountPostRecord {
  id: string;
  platform: Platform;
  platformPostId: string;
  permalink: string;
  kind: string | null;
  caption: string | null;
  title: string | null;
  publishedAt: string;
  /** The post's own duration, else the matched clip's (media.duration_s). */
  durationS: number | null;
  batchItemId: string | null;
  /** The matched app item's clip; null when posted by hand. */
  mediaId: string | null;
  matchedBy: MatchedBy | null;
  /** The matched clip's pillar (media.pillar); null when posted by hand (findings classify the caption then). */
  pillar: string | null;
  metrics: AccountMetrics | null;
  capturedAt: string | null;
}

export interface AccountSnapshotRow {
  accountPostId: string;
  capturedAt: string;
  views: number | null;
}

export interface AccountDailyRow {
  platform: Platform;
  /** YYYY-MM-DD (the creator's local day when it was captured). */
  capturedOn: string;
  followers: number | null;
  totalViews: number | null;
  postsCount: number | null;
}
