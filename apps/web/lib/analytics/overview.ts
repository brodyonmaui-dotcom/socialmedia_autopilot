/**
 * Data layer for the account-wide analytics overview (/analytics). Pure builders (tested in
 * __tests__/overview.test.ts) + pg loaders (overview.db.test.ts). No React. Covers every post on the
 * account (0011 account_posts: the app's posts and the ones posted by hand). Missing numbers stay null.
 * Days are the creator's local days (timeZone = TZ_CREATOR, passed in, never hard-coded).
 */
import {
  ACCOUNT_LOOKBACK_DAYS,
  accountEngagementRate,
  buildFindings,
  loadAccountDaily,
  loadAccountPosts,
  loadAccountSnapshotViews,
  median,
  selectFindings,
  viewGainsByDay,
  type AccountDailyRow,
  type AccountPostRecord,
  type AccountSnapshotRow,
  type Finding,
  type QueryPool,
} from "@autopilot/analytics";
import { localDate, type Platform } from "@autopilot/core";
import { firstLine } from "@autopilot/research";

export type RangeDays = 7 | 30 | 60;
export const RANGE_DAYS: RangeDays[] = [7, 30, 60];
export const ALL_PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];
/** Platforms the account ingest collects. */
export const COLLECTED: Platform[] = ["instagram", "youtube"];
export const NOT_COLLECTED_REASON: Partial<Record<Platform, string>> = {
  tiktok: "TikTok numbers aren't collected on the free plan. Add them by hand here or upgrade later.",
  snapchat: "Snapchat has no metrics API. Check the numbers in the Snapchat app.",
};
/** "What worked" always looks at this many days (short ranges hold too few posts to compare). */
export const FINDINGS_DAYS = ACCOUNT_LOOKBACK_DAYS;
export const TOP_POSTS = 10;
const DAY = 86_400_000;

export interface Kpi {
  value: number | null;
  /**
   * Same measure over the previous range of the same length. Views/engagement/posts: null when that range
   * reaches past the 60 days the ingest keeps (so always null for the 60-day range). Followers: daily rows.
   */
  previous: number | null;
  /** value − previous; null when either is unknown. */
  delta: number | null;
  /** value / previous − 1; null when either is unknown or previous is 0. */
  deltaPct: number | null;
}

export interface OverviewKpis {
  /** Views gained in the range (snapshot differences, all collected platforms). */
  views: Kpi;
  /** Σ(likes+comments+shares+saves) / Σ views over posts published in the range (0–1). */
  engagementRate: Kpi;
  /** Posts published in the range (all platforms in account_posts). */
  posts: Kpi;
  /** Followers at the end of the range, summed over platforms with data. */
  followers: Kpi;
}

export interface ViewsDay {
  /** YYYY-MM-DD, local day. */
  date: string;
  /** Views gained that day; null = that platform has no collected data. */
  instagram: number | null;
  youtube: number | null;
  tiktok: number | null;
  snapchat: number | null;
}

export interface TopPost {
  accountPostId: string;
  platform: Platform;
  /** Title, else the caption's first line (hashtags removed, ≤ 80 chars). */
  title: string;
  permalink: string;
  /** The matched clip (for a Thumb); null when posted by hand. */
  mediaId: string | null;
  views: number | null;
  engagementRate: number | null;
  /** Not matched to an app item. */
  byHand: boolean;
  publishedAt: string;
}

export interface PlatformCard {
  platform: Platform;
  collected: boolean;
  /** Why it's not collected (TikTok / Snapchat); null when collected. */
  reason: string | null;
  followers: number | null;
  /** followers now − at the end of the previous range. */
  followersDelta: number | null;
  /** Views gained in the range. */
  views: number | null;
  posts: number;
  medianViews: number | null;
  engagementRate: number | null;
}

export interface DateRange {
  days: RangeDays;
  /** First and last local day of the range (inclusive). */
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

export interface Overview {
  range: DateRange;
  kpis: OverviewKpis;
  viewsPerDay: ViewsDay[];
  topPosts: TopPost[];
  /** "What worked": ok findings strongest first, then up to 3 `insufficient` ones ("not enough posts yet"). */
  findings: Finding[];
  findingsDays: number;
  platforms: PlatformCard[];
  /** false = no account posts at all yet (show an empty state). */
  hasData: boolean;
}

export interface OverviewOptions {
  days: RangeDays;
  timeZone: string;
  now: Date;
}

/** Everything the builders need, as loaded from the DB. */
export interface AccountData {
  posts: AccountPostRecord[];
  snapshots: AccountSnapshotRow[];
  daily: AccountDailyRow[];
}

// ---------------------------------------------------------------- small pure helpers

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function dateRange(days: RangeDays, now: Date, timeZone: string): DateRange {
  const to = localDate(now, timeZone);
  const from = addDays(to, -(days - 1));
  return { days, from, to, previousFrom: addDays(from, -days), previousTo: addDays(from, -1) };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function kpi(value: number | null, previous: number | null): Kpi {
  return {
    value,
    previous,
    delta: value !== null && previous !== null ? value - previous : null,
    deltaPct: value !== null && previous ? value / previous - 1 : null,
  };
}

export const postDay = (p: Pick<AccountPostRecord, "publishedAt">, timeZone: string) => localDate(new Date(p.publishedAt), timeZone);
export const inDays = (day: string, from: string, to: string) => day >= from && day <= to;

/** Title for lists: the title, else the caption's first line without hashtags. */
export function postTitle(p: Pick<AccountPostRecord, "title" | "caption">): string {
  const t = (p.title?.trim() || firstLine(p.caption ?? "")).trim();
  return [...t].length > 80 ? [...t].slice(0, 77).join("") + "..." : t || "(no caption)";
}

/** Σ interactions / Σ views over posts with a views number; null when none. */
export function aggregateEr(posts: AccountPostRecord[]): number | null {
  let views = 0;
  let inter = 0;
  let any = false;
  for (const p of posts) {
    const m = p.metrics;
    if (!m?.views) continue;
    const parts = [m.likes, m.comments, m.shares, m.saves].filter((x): x is number => x !== null);
    if (!parts.length) continue;
    any = true;
    views += m.views;
    inter += parts.reduce((a, b) => a + b, 0);
  }
  return any && views > 0 ? inter / views : null;
}

/** Per platform → (day → views gained). */
export function gainsByPlatformDay(data: Pick<AccountData, "posts" | "snapshots">, timeZone: string): Map<Platform, Map<string, number>> {
  const perPost = viewGainsByDay(data.posts, data.snapshots, timeZone);
  const out = new Map<Platform, Map<string, number>>();
  for (const p of data.posts) {
    const days = perPost.get(p.id);
    if (!days) continue;
    const m = out.get(p.platform) ?? out.set(p.platform, new Map()).get(p.platform)!;
    for (const [d, v] of days) m.set(d, (m.get(d) ?? 0) + v);
  }
  return out;
}

/** Views gained in [from, to]; null when there's no data on or before `to` at all (unknown, not 0). */
export function sumDays(m: Map<string, number> | undefined, from: string, to: string): number | null {
  if (!m) return null;
  let s = 0;
  let known = false;
  for (const [d, v] of m) {
    if (d <= to) known = true;
    if (inDays(d, from, to)) s += v;
  }
  return known ? s : null;
}

/** Latest followers on or before `day` per platform. */
export function followersAt(daily: AccountDailyRow[], platform: Platform, day: string): number | null {
  let best: AccountDailyRow | null = null;
  for (const r of daily) if (r.platform === platform && r.capturedOn <= day && r.followers !== null && (!best || r.capturedOn > best.capturedOn)) best = r;
  return best?.followers ?? null;
}

/** Sum over platforms that have a number; null when none has. */
export function sumKnown(xs: Array<number | null>): number | null {
  const k = xs.filter((x): x is number => x !== null);
  return k.length ? k.reduce((a, b) => a + b, 0) : null;
}

export function topPosts(posts: AccountPostRecord[], limit = TOP_POSTS): TopPost[] {
  return [...posts]
    .filter((p) => p.metrics?.views != null)
    .sort((a, b) => b.metrics!.views! - a.metrics!.views! || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit)
    .map((p) => ({
      accountPostId: p.id,
      platform: p.platform,
      title: postTitle(p),
      permalink: p.permalink,
      mediaId: p.mediaId,
      views: p.metrics!.views,
      engagementRate: accountEngagementRate(p.metrics),
      byHand: p.batchItemId === null,
      publishedAt: p.publishedAt,
    }));
}

export function platformCard(platform: Platform, data: AccountData, range: DateRange, gains: Map<Platform, Map<string, number>>, timeZone: string): PlatformCard {
  const reason = NOT_COLLECTED_REASON[platform] ?? null;
  const mine = data.posts.filter((p) => p.platform === platform && inDays(postDay(p, timeZone), range.from, range.to));
  const followers = followersAt(data.daily, platform, range.to);
  const prevFollowers = followersAt(data.daily, platform, range.previousTo);
  return {
    platform,
    collected: COLLECTED.includes(platform),
    reason,
    followers,
    followersDelta: followers !== null && prevFollowers !== null ? followers - prevFollowers : null,
    views: sumDays(gains.get(platform), range.from, range.to),
    posts: mine.length,
    medianViews: median(mine.map((p) => p.metrics?.views).filter((v): v is number => v != null)),
    engagementRate: aggregateEr(mine),
  };
}

// ---------------------------------------------------------------- builder + loader

export function buildOverview(data: AccountData, opts: OverviewOptions): Overview {
  const range = dateRange(opts.days, opts.now, opts.timeZone);
  const gains = gainsByPlatformDay(data, opts.timeZone);
  const day = (p: AccountPostRecord) => postDay(p, opts.timeZone);
  const cur = data.posts.filter((p) => inDays(day(p), range.from, range.to));
  const prev = data.posts.filter((p) => inDays(day(p), range.previousFrom, range.previousTo));
  const withData = new Set(data.posts.map((p) => p.platform));

  const viewsIn = (from: string, to: string) => sumKnown([...gains.values()].map((m) => sumDays(m, from, to)));
  const followersOn = (d: string) => sumKnown(ALL_PLATFORMS.map((p) => followersAt(data.daily, p, d)));

  const findingsFrom = addDays(range.to, -(FINDINGS_DAYS - 1));
  const findingPosts = data.posts.filter((p) => inDays(day(p), findingsFrom, range.to));

  // The ingest keeps FINDINGS_DAYS days of posts: a previous range reaching further back can't be known.
  const prevKnown = range.previousFrom >= findingsFrom;
  const prevOr = <T,>(v: T) => (prevKnown ? v : null);

  return {
    range,
    kpis: {
      views: kpi(viewsIn(range.from, range.to), prevOr(viewsIn(range.previousFrom, range.previousTo))),
      engagementRate: kpi(aggregateEr(cur), prevOr(aggregateEr(prev))),
      posts: kpi(data.posts.length ? cur.length : null, data.posts.length ? prevOr(prev.length) : null),
      followers: kpi(followersOn(range.to), followersOn(range.previousTo)),
    },
    viewsPerDay: daysBetween(range.from, range.to).map((date) => {
      const v = (p: Platform) => (withData.has(p) ? (gains.get(p)?.get(date) ?? 0) : null);
      return { date, instagram: v("instagram"), youtube: v("youtube"), tiktok: v("tiktok"), snapchat: v("snapchat") };
    }),
    topPosts: topPosts(cur),
    findings: selectFindings(buildFindings(findingPosts, { timeZone: opts.timeZone })),
    findingsDays: FINDINGS_DAYS,
    platforms: ALL_PLATFORMS.map((p) => platformCard(p, data, range, gains, opts.timeZone)),
    hasData: data.posts.length > 0,
  };
}

/**
 * Loads what a range needs: posts published since the start of the previous range minus the
 * lookback (older posts still gain views inside the range), their snapshots, and the daily rows.
 */
export async function loadAccountData(pool: QueryPool, opts: { days: number; now: Date; timeZone: string; platform?: Platform }): Promise<AccountData> {
  const since = new Date(opts.now.getTime() - (2 * opts.days + FINDINGS_DAYS + 2) * DAY);
  const range = dateRange(Math.max(opts.days, 1) as RangeDays, opts.now, opts.timeZone);
  // Sequential on purpose: `pool` may be a single client (one query at a time).
  const posts = await loadAccountPosts(pool, { since, platform: opts.platform });
  const snapshots = await loadAccountSnapshotViews(pool, { since, platform: opts.platform });
  const daily = await loadAccountDaily(pool, { fromDay: range.previousFrom, platform: opts.platform });
  return { posts, snapshots, daily };
}

export async function loadOverview(pool: QueryPool, opts: OverviewOptions): Promise<Overview> {
  return buildOverview(await loadAccountData(pool, opts), opts);
}

// ---------------------------------------------------------------- Home

export interface FollowerTotals {
  current: number | null;
  previous: number | null;
}

/**
 * Followers summed over platforms with data: `current` = latest row on or before `to`, `previous` =
 * latest on or before `from`. Dates are YYYY-MM-DD (local days) or Dates (their UTC date).
 */
export async function loadFollowerTotals(pool: QueryPool, opts: { from: string | Date; to: string | Date }): Promise<FollowerTotals> {
  const d = (x: string | Date) => (typeof x === "string" ? x : x.toISOString().slice(0, 10));
  const { rows } = await pool.query(
    `select (select sum(followers) from (select distinct on (platform) followers from account_snapshots
               where captured_on <= $2::date and followers is not null order by platform, captured_on desc) c) as current,
            (select sum(followers) from (select distinct on (platform) followers from account_snapshots
               where captured_on <= $1::date and followers is not null order by platform, captured_on desc) p) as previous`,
    [d(opts.from), d(opts.to)],
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { current: n(rows[0]?.current), previous: n(rows[0]?.previous) };
}
