import type { Platform } from "@autopilot/core";
import { IG_REEL_METRICS, type MetricsSource } from "./ingest.js";
import { EMPTY_METRICS, type Metrics } from "./types.js";

/**
 * Real metrics sources. Response shapes come from the official docs, logged in
 * docs/research.md ("Metrics response shapes", 2026-11-11). Every call is a GET with the
 * token in a header (never in the URL, so request logs can't leak it). Not registered in
 * apps/worker yet.
 */

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** A count that may arrive as number or numeric string (YouTube sends strings). Anything else → null. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

function apiError(platform: Platform, status: number, body: unknown): Error {
  const e = isObj(body) && isObj(body.error) ? body.error : isObj(body) ? body : {};
  const msg = typeof e.message === "string" ? e.message : typeof e.error === "string" ? e.error : "";
  const code = e.code !== undefined ? ` code ${String(e.code)}` : "";
  return new Error(`${platform} metrics: HTTP ${status}${code}${msg ? ` ${msg}` : ""}`);
}

// ---------------------------------------------------------------- Instagram (Graph API, FB Login)

export interface InstagramSourceConfig {
  accessToken: string;
  fetch: FetchLike;
  graphVersion?: string;
  baseUrl?: string;
}

/**
 * Insights envelope: `{ data: [{ name, period: "lifetime", values: [{ value }], total_value?: { value } }] }`.
 * One request per metric (one rejected metric fails a whole request). A metric that errors comes back
 * null rather than failing the snapshot; if every metric fails, the snapshot fails.
 * `like_count` is omitted when the owner hides likes → null, not 0.
 */
export function createInstagramMetricsSource(cfg: InstagramSourceConfig): MetricsSource {
  const base = `${cfg.baseUrl ?? "https://graph.facebook.com"}/${cfg.graphVersion ?? "v25.0"}`;
  const headers = { Authorization: `Bearer ${cfg.accessToken}` };

  async function insight(mediaId: string, metric: string): Promise<number | null> {
    const res = await cfg.fetch(`${base}/${mediaId}/insights?metric=${metric}`, { headers });
    const body = await res.json();
    if (res.status !== 200) throw apiError("instagram", res.status, body);
    const row = isObj(body) && Array.isArray(body.data) ? body.data.find((d) => isObj(d) && d.name === metric) : undefined;
    if (!isObj(row)) return null;
    const first = Array.isArray(row.values) ? row.values[0] : undefined;
    if (isObj(first) && num(first.value) !== null) return num(first.value);
    return isObj(row.total_value) ? num(row.total_value.value) : null;
  }

  return {
    platform: "instagram",
    async fetch(mediaId) {
      if (!/^\d+$/.test(mediaId)) throw new Error("instagram media id must be numeric");
      const settled = await Promise.allSettled(IG_REEL_METRICS.map((m) => insight(mediaId, m)));
      if (settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
      const v = Object.fromEntries(IG_REEL_METRICS.map((m, i) => [m, settled[i]!.status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<number | null>).value : null]));

      const res = await cfg.fetch(`${base}/${mediaId}?fields=like_count,comments_count`, { headers });
      const fields = await res.json();
      if (res.status !== 200) throw apiError("instagram", res.status, fields);
      const f = isObj(fields) ? fields : {};

      return {
        ...EMPTY_METRICS,
        views: v.views ?? null,
        reach: v.reach ?? null,
        saves: v.saved ?? null,
        shares: v.shares ?? null,
        reposts: v.reposts ?? null,
        likes: num(f.like_count),
        comments: num(f.comments_count),
        avgWatchTime: v.ig_reels_avg_watch_time ?? null,
        skipRate: v.reels_skip_rate ?? null,
      };
    },
  };
}

// ---------------------------------------------------------------- YouTube (Data API v3)

export interface YouTubeSourceConfig {
  /** OAuth access token (the worker refreshes it); youtube.readonly is enough for statistics. */
  accessToken: string;
  fetch: FetchLike;
  baseUrl?: string;
}

/**
 * `videos.list?part=statistics&id=…` → `{ items: [{ id, statistics: { viewCount, likeCount, commentCount, … } }] }`,
 * counts as strings. No reach/saves/shares/watch time in the Data API: watch time
 * (`averageViewDuration`, seconds) lives in the YouTube Analytics API, which needs the
 * yt-analytics.readonly scope, so avgWatchTime stays null here.
 */
export function createYouTubeMetricsSource(cfg: YouTubeSourceConfig): MetricsSource {
  const base = cfg.baseUrl ?? "https://www.googleapis.com/youtube/v3";
  return {
    platform: "youtube",
    async fetch(videoId) {
      if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error("youtube video id looks invalid");
      const res = await cfg.fetch(`${base}/videos?part=statistics&id=${videoId}`, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
      const body = await res.json();
      if (res.status !== 200) throw apiError("youtube", res.status, body);
      const item = isObj(body) && Array.isArray(body.items) ? body.items.find((i) => isObj(i) && i.id === videoId) : undefined;
      if (!isObj(item) || !isObj(item.statistics)) throw new Error(`youtube metrics: video ${videoId} not found`);
      const s = item.statistics;
      return { ...EMPTY_METRICS, views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
    },
  };
}

// ---------------------------------------------------------------- TikTok via Zernio

export interface ZernioSourceConfig {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

/**
 * `GET /v1/analytics?postId=…` (Zernio, native or external id). 200 → `analytics` + `platformAnalytics[]`;
 * 202 = still syncing/publishing → throw so the next pass retries (nothing written);
 * 402 = analytics add-on required on legacy plans → throw with that message.
 * `igReelsAvgWatchTime` is milliseconds per Zernio (TikTok: business-app connections only).
 */
export function createZernioTikTokMetricsSource(cfg: ZernioSourceConfig): MetricsSource {
  const base = cfg.baseUrl ?? "https://zernio.com/api/v1";
  return {
    platform: "tiktok",
    async fetch(postId) {
      if (!/^[\w-]{1,64}$/.test(postId)) throw new Error("zernio post id looks invalid");
      const res = await cfg.fetch(`${base}/analytics?postId=${encodeURIComponent(postId)}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
      const body = await res.json();
      if (res.status === 202) throw new Error("tiktok metrics: Zernio still syncing (202), retry next pass");
      if (res.status !== 200) throw apiError("tiktok", res.status, body);
      if (!isObj(body)) throw new Error("tiktok metrics: empty response");
      const plat = Array.isArray(body.platformAnalytics)
        ? body.platformAnalytics.find((p) => isObj(p) && p.platform === "tiktok")
        : undefined;
      if (isObj(plat) && plat.syncStatus === "pending") throw new Error("tiktok metrics: Zernio still syncing, retry next pass");
      const a = isObj(plat) && isObj(plat.analytics) ? plat.analytics : isObj(body.analytics) ? body.analytics : null;
      if (!a) throw new Error("tiktok metrics: no analytics in response");
      // Zernio documents only likes/comments/shares/views for TikTok ("more on Business app
      // connections"); its schema is integers, so an unsupported field would read 0. Keep
      // reach/saves null (missing ≠ 0) and take watch time only when it's actually reported.
      const watch = num(a.igReelsAvgWatchTime);
      const metrics: Metrics = {
        ...EMPTY_METRICS,
        views: num(a.views),
        likes: num(a.likes),
        comments: num(a.comments),
        shares: num(a.shares),
        avgWatchTime: watch && watch > 0 ? watch : null,
      };
      return metrics;
    },
  };
}
