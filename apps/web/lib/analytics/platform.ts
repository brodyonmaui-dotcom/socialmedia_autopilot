/**
 * Data layer for one platform's analytics page (/analytics/[platform]). Pure builder + pg loader, same
 * conventions as overview.ts. TikTok and Snapchat aren't collected: they get `{ collected: false, reason }`.
 */
import { accountEngagementRate, buildFindings, localHour, median, pillarOf, selectFindings, timeBucket, FINDING_MIN_N, type Finding, type QueryPool, type TimeBucket } from "@autopilot/analytics";
import type { Platform } from "@autopilot/core";
import {
  COLLECTED,
  FINDINGS_DAYS,
  NOT_COLLECTED_REASON,
  addDays,
  dateRange,
  daysBetween,
  gainsByPlatformDay,
  inDays,
  loadAccountData,
  platformCard,
  postDay,
  postTitle,
  type AccountData,
  type DateRange,
  type PlatformCard,
  type RangeDays,
} from "./overview.js";

export interface PlatformPostRow {
  accountPostId: string;
  title: string;
  permalink: string;
  publishedAt: string;
  durationS: number | null;
  /** The clip's pillar when matched, else the caption keyword rule (gym / trading / other). */
  pillar: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagementRate: number | null;
  /** Average watch time in seconds (Instagram reels only). */
  avgWatchS: number | null;
  byHand: boolean;
  mediaId: string | null;
}

export interface HourStat {
  bucket: TimeBucket;
  /** "6–10 PM" (local hours, the creator's zone). */
  label: string;
  n: number;
  medianViews: number | null;
  /** "insufficient" below FINDING_MIN_N posts. */
  status: "ok" | "insufficient";
  /** The ok bucket with the highest median views. */
  best: boolean;
}

export interface PlatformNotCollected {
  collected: false;
  platform: Platform;
  reason: string;
}

export interface PlatformAnalytics {
  collected: true;
  platform: Platform;
  range: DateRange;
  card: PlatformCard;
  /** One point per local day of the range; null = no account row that day. */
  followers: Array<{ date: string; followers: number | null }>;
  viewsPerDay: Array<{ date: string; views: number }>;
  /** Posts published in the range, newest first. */
  posts: PlatformPostRow[];
  /** Over the last `findingsDays` days, in day order (morning → late). */
  bestHours: HourStat[];
  findings: Finding[];
  findingsDays: number;
}

export type PlatformView = PlatformAnalytics | PlatformNotCollected;

export interface PlatformOptions {
  days: RangeDays;
  timeZone: string;
  now: Date;
}

const BUCKETS: Array<[TimeBucket, string]> = [
  ["morning", "5–11 AM"],
  ["midday", "11 AM–2 PM"],
  ["afternoon", "2–6 PM"],
  ["evening", "6–10 PM"],
  ["late", "10 PM–5 AM"],
];

export function buildPlatform(platform: Platform, data: AccountData, opts: PlatformOptions): PlatformView {
  if (!COLLECTED.includes(platform)) return { collected: false, platform, reason: NOT_COLLECTED_REASON[platform] ?? "Not collected." };
  const mine: AccountData = { ...data, posts: data.posts.filter((p) => p.platform === platform), daily: data.daily.filter((d) => d.platform === platform) };
  const range = dateRange(opts.days, opts.now, opts.timeZone);
  const gains = gainsByPlatformDay(mine, opts.timeZone);
  const g = gains.get(platform);
  const findingsFrom = addDays(range.to, -(FINDINGS_DAYS - 1));
  const recent = mine.posts.filter((p) => inDays(postDay(p, opts.timeZone), findingsFrom, range.to));
  const withViews = recent.filter((p) => p.metrics?.views != null);

  const hours: HourStat[] = BUCKETS.map(([bucket, label]) => {
    const xs = withViews.filter((p) => timeBucket(localHour(p.publishedAt, opts.timeZone)) === bucket);
    return { bucket, label, n: xs.length, medianViews: median(xs.map((p) => p.metrics!.views!)), status: xs.length >= FINDING_MIN_N ? "ok" : "insufficient", best: false };
  });
  const best = hours.filter((h) => h.status === "ok" && h.medianViews !== null).sort((a, b) => b.medianViews! - a.medianViews!)[0];
  if (best) best.best = true;

  return {
    collected: true,
    platform,
    range,
    card: platformCard(platform, mine, range, gains, opts.timeZone),
    followers: daysBetween(range.from, range.to).map((date) => ({ date, followers: mine.daily.find((d) => d.capturedOn === date)?.followers ?? null })),
    viewsPerDay: daysBetween(range.from, range.to).map((date) => ({ date, views: g?.get(date) ?? 0 })),
    posts: mine.posts
      .filter((p) => inDays(postDay(p, opts.timeZone), range.from, range.to))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((p) => ({
        accountPostId: p.id,
        title: postTitle(p),
        permalink: p.permalink,
        publishedAt: p.publishedAt,
        durationS: p.durationS,
        pillar: pillarOf(p),
        views: p.metrics?.views ?? null,
        likes: p.metrics?.likes ?? null,
        comments: p.metrics?.comments ?? null,
        shares: p.metrics?.shares ?? null,
        saves: p.metrics?.saves ?? null,
        engagementRate: accountEngagementRate(p.metrics),
        avgWatchS: p.metrics?.avgWatchS ?? null,
        byHand: p.batchItemId === null,
        mediaId: p.mediaId,
      })),
    bestHours: hours,
    findings: selectFindings(buildFindings(recent, { timeZone: opts.timeZone, platform })),
    findingsDays: FINDINGS_DAYS,
  };
}

export async function loadPlatform(pool: QueryPool, platform: Platform, opts: PlatformOptions): Promise<PlatformView> {
  if (!COLLECTED.includes(platform)) return buildPlatform(platform, { posts: [], snapshots: [], daily: [] }, opts);
  return buildPlatform(platform, await loadAccountData(pool, { ...opts, platform }), opts);
}
