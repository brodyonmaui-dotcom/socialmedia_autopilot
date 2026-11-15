import type { Platform } from "@autopilot/core";

/**
 * One normalized metrics snapshot. Every field is nullable: platforms differ, and a missing
 * metric must read "not available", never 0. Units are whatever the platform returns; we only
 * ever compare a metric with itself on the same platform (never across platforms).
 */
export interface Metrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  /** IG reposts (reel reposted by others). IG only; null elsewhere. */
  reposts: number | null;
  /** IG ig_reels_avg_watch_time / Zernio igReelsAvgWatchTime: milliseconds per Zernio (Meta's page gives no unit). Compare within a platform only. */
  avgWatchTime: number | null;
  /** IG reels_skip_rate: percentage (0–100) of initial views skipped in the first 3 s. Lower is better; IG only. */
  skipRate: number | null;
}

export const EMPTY_METRICS: Metrics = {
  views: null,
  reach: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  reposts: null,
  avgWatchTime: null,
  skipRate: null,
};

/** A published post plus its latest snapshot: the unit every comparison works on. */
export interface PostRecord {
  batchItemId: string;
  /** The clip (media row). The same clip posted to IG and TikTok shares one mediaId. */
  mediaId?: string;
  platform: Platform;
  pillar: string | null;
  caption: string;
  durationS: number | null;
  /** When it went public (scheduled_for: the server fires IG at it, YT/TikTok hold the clock to it). */
  postedAt: string;
  /** Instagram trial reel that actually published as a trial (not the plain-reel fallback). */
  isTrial: boolean;
  /** He already shared the trial to the main feed (from batch_items.trial.sharedAt). */
  trialSharedAt: string | null;
  metrics: Metrics;
  /** When the latest snapshot was taken; null = no snapshot yet. */
  capturedAt: string | null;
}
