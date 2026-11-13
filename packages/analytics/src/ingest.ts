import { sanitizeError, type Platform } from "@autopilot/core";
import type { Metrics } from "./types.js";

/**
 * Metrics ingestion: snapshot each published post at fixed ages. Read-only on the platforms
 * (GETs only), so it isn't gated by DRY_RUN, but real sources need tokens and live on the
 * worker; tests and the report run on fakes.
 */
export const SNAPSHOT_AGES_H = [24, 72, 168, 672] as const;

export interface MetricsSource {
  platform: Platform;
  fetch(platformPostId: string): Promise<Metrics>;
}

export interface PublishedPost {
  batchItemId: string;
  platform: Platform;
  platformPostId: string;
  postedAt: string;
  /** Ages (hours) already captured for this post. */
  capturedAges: number[];
}

/**
 * Which checkpoint (if any) a post is due for now: the latest age that has passed and isn't
 * captured yet. Missed earlier checkpoints are skipped, not back-filled with today's numbers
 * under an old label (that would make 24 h numbers look better than they were).
 */
export function dueAge(post: PublishedPost, now: Date): number | null {
  const ageH = (now.getTime() - Date.parse(post.postedAt)) / 3_600_000;
  const passed = SNAPSHOT_AGES_H.filter((a) => ageH >= a);
  const latest = passed.at(-1);
  if (latest === undefined || post.capturedAges.includes(latest)) return null;
  return latest;
}

export interface SnapshotWrite {
  batchItemId: string;
  ageHours: number;
  metrics: Metrics;
}

export interface IngestResult {
  captured: number;
  skippedNoSource: number;
  failed: number;
  writes: SnapshotWrite[];
  /** Fetches tried per platform this pass (due posts with a source). */
  attemptedByPlatform: Partial<Record<Platform, number>>;
  failedByPlatform: Partial<Record<Platform, number>>;
  /** Last error per platform, sanitised (no tokens) and at most ERROR_MAX_CHARS long. */
  lastErrorByPlatform: Partial<Record<Platform, string>>;
}

export const ERROR_MAX_CHARS = 200;

/** One error as a safe, short line for logs and alerts: through the core sanitiser, then cut. */
export function safeErrorMessage(err: unknown): string {
  return sanitizeError(err).slice(0, ERROR_MAX_CHARS);
}

/**
 * The posts due for a snapshot now, oldest due checkpoint first (postedAt + due age), capped at
 * `limit` so a backlog can't burst the platform rate limits. The rest wait for the next pass.
 */
export function orderForIngest(posts: PublishedPost[], now: Date, limit: number): PublishedPost[] {
  const due: Array<{ p: PublishedPost; at: number }> = [];
  for (const p of posts) {
    const age = dueAge(p, now);
    if (age !== null) due.push({ p, at: Date.parse(p.postedAt) + age * 3_600_000 });
  }
  due.sort((a, b) => a.at - b.at || a.p.batchItemId.localeCompare(b.p.batchItemId));
  return due.slice(0, Math.max(0, limit)).map((d) => d.p);
}

/**
 * One ingestion pass. A failing post is counted per platform and skipped; its error is kept
 * sanitised for the caller's log line. The next pass retries it naturally because nothing was written.
 */
export async function ingestOnce(
  posts: PublishedPost[],
  sources: Partial<Record<Platform, MetricsSource>>,
  write: (w: SnapshotWrite) => Promise<void>,
  now = new Date(),
): Promise<IngestResult> {
  const res: IngestResult = { captured: 0, skippedNoSource: 0, failed: 0, writes: [], attemptedByPlatform: {}, failedByPlatform: {}, lastErrorByPlatform: {} };
  for (const p of posts) {
    const age = dueAge(p, now);
    if (age === null) continue;
    const source = sources[p.platform];
    if (!source) {
      res.skippedNoSource++;
      continue;
    }
    res.attemptedByPlatform[p.platform] = (res.attemptedByPlatform[p.platform] ?? 0) + 1;
    try {
      const metrics = await source.fetch(p.platformPostId);
      const w = { batchItemId: p.batchItemId, ageHours: age, metrics };
      await write(w);
      res.writes.push(w);
      res.captured++;
    } catch (err) {
      res.failed++;
      res.failedByPlatform[p.platform] = (res.failedByPlatform[p.platform] ?? 0) + 1;
      res.lastErrorByPlatform[p.platform] = safeErrorMessage(err);
    }
  }
  return res;
}

/**
 * Instagram reel insight metric names accepted in Graph v25 (research.md, M0 probe 2026-11-10).
 * One request per metric: a single unknown metric fails the whole request (research.md, Meta setup).
 * `follows` and `profile_visits` are rejected per reel, so they're not here.
 */
export const IG_REEL_METRICS = [
  "views",
  "reach",
  "saved",
  "shares",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
  "reels_skip_rate",
  "reposts",
] as const;

export function instagramInsightPaths(mediaId: string): string[] {
  if (!/^\d+$/.test(mediaId)) throw new Error("instagram media id must be numeric");
  return IG_REEL_METRICS.map((m) => `/${mediaId}/insights?metric=${m}`);
}

/**
 * Throwing placeholder for a platform with no verified metrics source (Snapchat: assisted, no API).
 * Instagram, YouTube and TikTok (Zernio) have real sources in sources.ts (docs/research.md, 2026-11-11).
 */
export function createUnverifiedSource(platform: Platform): MetricsSource {
  return {
    platform,
    async fetch() {
      throw new Error(`${platform} metrics source not implemented: response shape not verified in docs/research.md`);
    },
  };
}
