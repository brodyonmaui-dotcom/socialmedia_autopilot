import {
  METRICS_HEALTH_KEY,
  METRICS_HEALTH_KIND,
  METRICS_FAIL_THRESHOLD,
  createInstagramMetricsSource,
  createYouTubeMetricsSource,
  createZernioTikTokMetricsSource,
  ingestOnce,
  loadPublishedForIngest,
  nextHealth,
  orderForIngest,
  safeErrorMessage,
  writeSnapshot,
  type IngestResult,
  type MetricsHealthState,
  type MetricsSource,
} from "@autopilot/analytics";
import { refreshAccessToken } from "@autopilot/adapters";
import { sanitizeForLog, type Platform } from "@autopilot/core";
import { getSetting, setSetting } from "@autopilot/db";
import { QUEUES } from "../queue.js";
import type { OutboxPool } from "./outbox.js";
import type { BossLike } from "./register-engagement.js";

/**
 * F9: hourly metrics ingest. Read-only on the platforms (GETs, plus the YouTube token refresh POST,
 * which has no public side effect), so it runs in dry-run too (docs/prep/run-3-decisions.md).
 * Snapshots at 24/72/168/672 h go through writeSnapshot (unique batch_item_id + age_hours).
 * A platform whose every fetch fails for METRICS_FAIL_THRESHOLD runs in a row gets one open
 * 'metrics-health' alert (page-only). Tokens never reach a log line or an alert: errors go through
 * the core sanitiser and URLs are never logged.
 */
export const ANALYTICS_INGEST_CRON = "23 * * * *"; // hourly, off the hour
export const ANALYTICS_INGEST_LIMIT = 50;
export const ANALYTICS_LOOKBACK_DAYS = 30;

export interface AnalyticsSourcesEnv {
  instagram?: { accessToken: string; graphVersion: string };
  youtube?: { clientId: string; clientSecret: string; refreshToken: string };
  tiktok?: { apiKey: string };
}

/** Env → sources config. TikTok (Zernio analytics) only with ZERNIO_ANALYTICS=1: off on the free plan. Never logs values. */
export function analyticsSourcesFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsSourcesEnv {
  const cfg: AnalyticsSourcesEnv = {};
  if (env.META_ACCESS_TOKEN) cfg.instagram = { accessToken: env.META_ACCESS_TOKEN, graphVersion: env.META_GRAPH_VERSION || "v25.0" };
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YT_REFRESH_TOKEN) {
    cfg.youtube = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN };
  }
  if (env.ZERNIO_ANALYTICS === "1" && env.ZERNIO_API_KEY) cfg.tiktok = { apiKey: env.ZERNIO_API_KEY };
  return cfg;
}

export function configuredPlatforms(cfg: AnalyticsSourcesEnv): Platform[] {
  return (["instagram", "youtube", "tiktok"] as const).filter((p) => cfg[p]);
}

/** A source that fails every fetch with one already-sanitised message (e.g. the YT token refresh failed). */
function failingSource(platform: Platform, message: string): MetricsSource {
  return {
    platform,
    async fetch() {
      throw new Error(message);
    },
  };
}

/**
 * Builds the sources whose credentials exist. YouTube gets a fresh access token per run; when the
 * refresh fails, YouTube gets a source that fails every fetch, so its due posts count as failed for
 * youtube (feeding metrics-health) and the other platforms still run.
 */
export async function buildMetricsSources(cfg: AnalyticsSourcesEnv, fetchImpl: typeof fetch = fetch): Promise<Partial<Record<Platform, MetricsSource>>> {
  const sources: Partial<Record<Platform, MetricsSource>> = {};
  if (cfg.instagram) sources.instagram = createInstagramMetricsSource({ accessToken: cfg.instagram.accessToken, graphVersion: cfg.instagram.graphVersion, fetch: fetchImpl });
  if (cfg.youtube) {
    try {
      const accessToken = await refreshAccessToken({ ...cfg.youtube, fetch: fetchImpl });
      sources.youtube = createYouTubeMetricsSource({ accessToken, fetch: fetchImpl });
    } catch (err) {
      sources.youtube = failingSource("youtube", `youtube token refresh failed: ${safeErrorMessage(err)}`);
    }
  }
  if (cfg.tiktok) sources.tiktok = createZernioTikTokMetricsSource({ apiKey: cfg.tiktok.apiKey, fetch: fetchImpl });
  return sources;
}

const SHORT: Partial<Record<Platform, string>> = { instagram: "ig", youtube: "yt", tiktok: "tt", snapchat: "snap" };

export function formatIngestLine(res: IngestResult): string {
  const per = (Object.keys(res.attemptedByPlatform) as Platform[]).map((p) => `${SHORT[p] ?? p} ${res.failedByPlatform[p] ?? 0}`);
  return `[analytics] captured ${res.captured} · failed ${res.failed}${per.length ? ` (${per.join(", ")})` : ""} · no-source ${res.skippedNoSource}`;
}

/** One open 'metrics-health' row per platform: skipped while an unacknowledged one exists. */
async function raiseMetricsHealthAlert(pool: OutboxPool, platform: Platform, message: string, now: Date): Promise<boolean> {
  const { rows } = await pool.query(
    `insert into alerts (kind, batch_item_id, platform, message, created_at)
     select $1, null, $2, $3, $4
      where not exists (select 1 from alerts where kind = $1 and platform = $2 and acknowledged_at is null)
     returning id`,
    [METRICS_HEALTH_KIND, platform, message, now.toISOString()],
  );
  return rows.length === 1;
}

export async function runAnalyticsIngestOnce(
  pool: OutboxPool,
  cfg: AnalyticsSourcesEnv,
  opts: { now?: Date; limit?: number; log?: (l: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<IngestResult> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? new Date();
  if (configuredPlatforms(cfg).length === 0) {
    log("[analytics] analytics: no sources");
    return { captured: 0, skippedNoSource: 0, failed: 0, writes: [], attemptedByPlatform: {}, failedByPlatform: {}, lastErrorByPlatform: {} };
  }
  const sources = await buildMetricsSources(cfg, opts.fetchImpl);
  const since = new Date(now.getTime() - ANALYTICS_LOOKBACK_DAYS * 86_400_000);
  const posts = orderForIngest(await loadPublishedForIngest(pool, since), now, opts.limit ?? ANALYTICS_INGEST_LIMIT);
  const res = await ingestOnce(posts, sources, (w) => writeSnapshot(pool, w), now);
  log(formatIngestLine(res));
  for (const [p, e] of Object.entries(res.lastErrorByPlatform)) log(`[analytics] ${SHORT[p as Platform] ?? p} last error: ${e}`);

  const prev = (await getSetting<MetricsHealthState>(pool, METRICS_HEALTH_KEY)) ?? {};
  const health = nextHealth(prev, res, now);
  // Alerts before the state save: if an insert fails, the counter isn't advanced, so the next run trips
  // again (the not-exists guard keeps that to one open row) instead of the trip being lost.
  for (const p of health.trip) {
    const msg = sanitizeForLog(`${p} metrics failed ${METRICS_FAIL_THRESHOLD} runs in a row: ${res.lastErrorByPlatform[p] ?? "unknown error"}`).slice(0, 300);
    const raised = await raiseMetricsHealthAlert(pool, p, msg, now);
    log(`[analytics] metrics-health ${p}: ${raised ? "alert raised" : "alert already open"}`);
  }
  if (Object.keys(res.attemptedByPlatform).length > 0) await setSetting(pool, METRICS_HEALTH_KEY, health.state);
  for (const p of health.recovered) log(`[analytics] metrics-health ${p}: recovered`);
  return res;
}

export function analyticsStartupLine(cfg: AnalyticsSourcesEnv): string {
  const ps = configuredPlatforms(cfg).map((p) => SHORT[p] ?? p);
  return `analytics=read-only · sources=${ps.join(",") || "none"} · cron=${ANALYTICS_INGEST_CRON}`;
}

export async function registerAnalyticsIngestJob(boss: BossLike, pool: OutboxPool, cfg: AnalyticsSourcesEnv): Promise<void> {
  await boss.createQueue(QUEUES.analyticsIngest);
  await boss.work(QUEUES.analyticsIngest, async () => {
    await runAnalyticsIngestOnce(pool, cfg);
  });
  await boss.schedule(QUEUES.analyticsIngest, ANALYTICS_INGEST_CRON);
}
