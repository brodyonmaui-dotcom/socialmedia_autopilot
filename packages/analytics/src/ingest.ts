import type { Platform } from "@autopilot/core";
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
}

/**
 * One ingestion pass. A failing post is counted and skipped (logged by the caller without
 * tokens); the next pass retries it naturally because nothing was written.
 */
export async function ingestOnce(
  posts: PublishedPost[],
  sources: Partial<Record<Platform, MetricsSource>>,
  write: (w: SnapshotWrite) => Promise<void>,
  now = new Date(),
): Promise<IngestResult> {
  const res: IngestResult = { captured: 0, skippedNoSource: 0, failed: 0, writes: [] };
  for (const p of posts) {
    const age = dueAge(p, now);
    if (age === null) continue;
    const source = sources[p.platform];
    if (!source) {
      res.skippedNoSource++;
      continue;
    }
    try {
      const metrics = await source.fetch(p.platformPostId);
      const w = { batchItemId: p.batchItemId, ageHours: age, metrics };
      await write(w);
      res.writes.push(w);
      res.captured++;
    } catch {
      res.failed++;
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
 * STUB. The insights response envelope, likes/comments field names, and units (watch time,
 * skip rate) aren't recorded in docs/research.md yet, so no parser is written against a guess.
 * Same for YouTube (Analytics/Data API statistics) and Zernio TikTok analytics.
 * → needsAttention: verify on the official docs, log in research.md, then implement.
 */
export function createUnverifiedSource(platform: Platform): MetricsSource {
  return {
    platform,
    async fetch() {
      throw new Error(`${platform} metrics source not implemented: response shape not verified in docs/research.md`);
    },
  };
}
