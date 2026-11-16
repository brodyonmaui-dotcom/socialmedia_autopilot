import {
  METRICS_FAIL_THRESHOLD,
  fetchInstagramAccount,
  fetchYouTubeAccount,
  formatAccountIngestLine,
  ingestAccountOnce,
  nextHealth,
  safeErrorMessage,
  type AccountFetcher,
  type AccountIngestSummary,
  type MetricsHealthState,
} from "@autopilot/analytics";
import { refreshAccessToken } from "@autopilot/adapters";
import { sanitizeForLog, type Platform } from "@autopilot/core";
import { getSetting, setSetting } from "@autopilot/db";
import type { OutboxPool } from "./outbox.js";
import type { BossLike } from "./register-engagement.js";
import { raiseMetricsHealthAlert, type AnalyticsSourcesEnv } from "./analytics-ingest.js";

/**
 * Account-wide analytics: every recent post on Instagram and YouTube (the app's and the ones posted by
 * hand) → account_posts + one snapshot per post per run + one account row per day (0011_account_posts.sql).
 * Read-only GETs (plus the YouTube token refresh POST, no public side effect), so it runs in dry-run too,
 * like analytics-ingest. TikTok stays off (free Zernio plan, docs/tiktok-free-plan.md); Snapchat has no API.
 * A rate limit ends that platform's run (partial data kept) and raises one 'metrics-health' alert
 * (deduped while open); a platform failing ACCOUNT_FAIL_THRESHOLD runs in a row raises one too.
 */
export const ACCOUNT_INGEST_QUEUE = "account-ingest"; // own name here: queue.ts is outside this change
export const ACCOUNT_INGEST_CRON = "41 */6 * * *"; // every 6 h, off the hour; the account row is written once a day
export const ACCOUNT_HEALTH_KEY = "account_metrics_health";

export type AccountPlatform = "instagram" | "youtube";

/** Which platforms have what the account ingest needs (IG also needs IG_USER_ID). */
export function accountPlatforms(cfg: AnalyticsSourcesEnv): AccountPlatform[] {
  const out: AccountPlatform[] = [];
  if (cfg.instagram?.igUserId) out.push("instagram");
  if (cfg.youtube) out.push("youtube");
  return out;
}

/** Builds one fetcher per configured platform. A failed YouTube token refresh becomes a fetcher that reports the error. */
export async function buildAccountFetchers(cfg: AnalyticsSourcesEnv, fetchImpl: typeof fetch = fetch): Promise<Partial<Record<AccountPlatform, AccountFetcher>>> {
  const out: Partial<Record<AccountPlatform, AccountFetcher>> = {};
  const ig = cfg.instagram;
  if (ig?.igUserId) {
    const igUserId = ig.igUserId;
    out.instagram = (o) => fetchInstagramAccount({ accessToken: ig.accessToken, igUserId, graphVersion: ig.graphVersion, fetch: fetchImpl }, o);
  }
  if (cfg.youtube) {
    try {
      const accessToken = await refreshAccessToken({ ...cfg.youtube, fetch: fetchImpl });
      out.youtube = (o) => fetchYouTubeAccount({ accessToken, fetch: fetchImpl }, o);
    } catch (err) {
      const error = `youtube token refresh failed: ${safeErrorMessage(err)}`;
      out.youtube = async () => ({ platform: "youtube", posts: [], account: null, requests: 0, stoppedBy: "error", error });
    }
  }
  return out;
}

export async function runAccountIngestOnce(
  pool: Pick<OutboxPool, "query">,
  cfg: AnalyticsSourcesEnv,
  opts: { now?: Date; timeZone?: string; log?: (l: string) => void; fetchImpl?: typeof fetch; fetchers?: Partial<Record<AccountPlatform, AccountFetcher>> } = {},
): Promise<AccountIngestSummary[]> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone || "UTC";
  const fetchers = opts.fetchers ?? (accountPlatforms(cfg).length ? await buildAccountFetchers(cfg, opts.fetchImpl) : {});
  const platforms = Object.keys(fetchers) as AccountPlatform[];
  if (!platforms.length) {
    log("[account] account analytics: no sources");
    return [];
  }
  const out: AccountIngestSummary[] = [];
  const attempted: Partial<Record<Platform, number>> = {};
  const failed: Partial<Record<Platform, number>> = {};
  for (const platform of platforms) {
    let s: AccountIngestSummary;
    try {
      s = await ingestAccountOnce(pool, platform, fetchers[platform]!, { now, timeZone });
    } catch (err) {
      s = { platform, posts: 0, snapshots: 0, matchedById: 0, matchedByCaption: 0, byHand: 0, account: false, requests: 0, stoppedBy: "error", error: safeErrorMessage(err) };
    }
    out.push(s);
    log(formatAccountIngestLine(s));
    if (s.error) log(`[account] ${platform} ${s.stoppedBy ?? "error"}: ${s.error}`);
    attempted[platform] = 1;
    failed[platform] = s.stoppedBy === "error" && s.posts === 0 ? 1 : 0;
    if (s.stoppedBy === "rate-limit") {
      const msg = sanitizeForLog(`${platform} account analytics hit the rate limit: partial data kept, next try in 6 h`).slice(0, 300);
      const raised = await raiseMetricsHealthAlert(pool, platform, msg, now);
      log(`[account] metrics-health ${platform}: ${raised ? "alert raised" : "alert already open"}`);
    }
  }

  const prev = (await getSetting<MetricsHealthState>(pool, ACCOUNT_HEALTH_KEY)) ?? {};
  const health = nextHealth(prev, { attemptedByPlatform: attempted, failedByPlatform: failed }, now);
  for (const p of health.trip) {
    const last = out.find((s) => s.platform === p)?.error ?? "unknown error";
    const raised = await raiseMetricsHealthAlert(pool, p, sanitizeForLog(`${p} account analytics failed ${METRICS_FAIL_THRESHOLD} runs in a row: ${last}`).slice(0, 300), now);
    log(`[account] metrics-health ${p}: ${raised ? "alert raised" : "alert already open"}`);
  }
  await setSetting(pool, ACCOUNT_HEALTH_KEY, health.state);
  return out;
}

export function accountStartupLine(cfg: AnalyticsSourcesEnv): string {
  return `account-analytics=read-only · sources=${accountPlatforms(cfg).join(",") || "none"} · cron=${ACCOUNT_INGEST_CRON}`;
}

export async function registerAccountIngestJob(boss: BossLike, pool: OutboxPool, cfg: AnalyticsSourcesEnv, timeZone: string | undefined): Promise<void> {
  await boss.createQueue(ACCOUNT_INGEST_QUEUE);
  await boss.work(ACCOUNT_INGEST_QUEUE, async () => {
    await runAccountIngestOnce(pool, cfg, { timeZone });
  });
  await boss.schedule(ACCOUNT_INGEST_QUEUE, ACCOUNT_INGEST_CRON);
}
