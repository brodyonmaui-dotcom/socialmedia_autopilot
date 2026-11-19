// v3 Home dashboard: pure shaping (tested in __tests__/dashboard.test.ts) + one read-only loader.
import { addCalendarDays, localDate, localToUtc, PLATFORMS, weekdayIndex, type Platform } from "@autopilot/core";
import type { Pool } from "pg";
import { gainsByPlatformDay, loadAccountData, loadFollowerTotals } from "../analytics/overview.js";

// ---------------------------------------------------------------- ranges

export type RangeId = "7d" | "30d" | "week";
export type MetricId = "views" | "engagement";

export const RANGES: ReadonlyArray<{ id: RangeId; label: string; compare: string }> = [
  { id: "7d", label: "Last 7 days", compare: "vs the 7 days before" },
  { id: "30d", label: "Last 30 days", compare: "vs the 30 days before" },
  { id: "week", label: "This week", compare: "vs last week" },
];

/** Default: the rolling 7 days (a calendar week makes Monday look like a crash). */
export const DEFAULT_RANGE: RangeId = "7d";
export const parseRange = (raw: unknown): RangeId => (raw === "30d" || raw === "week" ? raw : "7d");
export const parseMetric = (raw: unknown): MetricId => (raw === "engagement" ? "engagement" : "views");

/** A window of creator-local calendar days: [start, endExcl). `days` = the days the chart shows. */
export interface Period {
  start: string;
  endExcl: string;
  days: string[];
}

const span = (start: string, n: number): string[] => Array.from({ length: n }, (_, i) => addCalendarDays(start, i));
export const mondayOf = (ymd: string): string => addCalendarDays(ymd, -weekdayIndex(ymd));

/**
 * The range's window and the one it is compared with. Rolling ranges (7 / 30 days, today included)
 * compare with the equal-length period just before. "This week" counts Monday..today and compares with
 * the same days last week (a fair partial-week comparison); its chart still shows Mon–Sun.
 */
export function periodsFor(range: RangeId, today: string): { current: Period; previous: Period } {
  if (range === "30d" || range === "7d") {
    const n = range === "30d" ? 30 : 7;
    const start = addCalendarDays(today, -(n - 1));
    const pStart = addCalendarDays(start, -n);
    return { current: { start, endExcl: addCalendarDays(today, 1), days: span(start, n) }, previous: { start: pStart, endExcl: start, days: span(pStart, n) } };
  }
  const thisMon = mondayOf(today);
  const elapsed = weekdayIndex(today) + 1;
  const pStart = addCalendarDays(thisMon, -7);
  return {
    current: { start: thisMon, endExcl: addCalendarDays(today, 1), days: span(thisMon, 7) },
    previous: { start: pStart, endExcl: addCalendarDays(pStart, elapsed), days: span(pStart, 7) },
  };
}

const inPeriod = (ymd: string, p: Pick<Period, "start" | "endExcl">) => ymd >= p.start && ymd < p.endExcl;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const md = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

/** "Nov 16 – 22", "Nov 30 – Dec 6" (dates, never "Week 47"). */
export function rangeText(first: string, last: string): string {
  if (first === last) return md(first);
  if (first.slice(0, 7) === last.slice(0, 7)) return `${md(first)} – ${Number(last.slice(8, 10))}`;
  return `${md(first)} – ${md(last)}`;
}

// ---------------------------------------------------------------- KPIs

/** One account post (app or by hand) on its creator-local publish day, with its latest numbers. */
export interface PostMetricRow {
  platform: Platform;
  /** Creator-local publish day. */
  day: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/** Views gained on one local day on one platform (snapshot differences, from lib/analytics/overview). */
export interface ViewGainRow {
  platform: Platform;
  day: string;
  views: number;
}

/** Account follower totals (all platforms) at the end of the range and of the previous one. null = not collected yet. */
export interface FollowerTotals {
  current: number | null;
  previous: number | null;
}

export type Delta = { text: string; tone: "up" | "down" | "flat" };
export interface Kpi {
  id: "followers" | "views" | "engagement" | "posts";
  label: string;
  value: number | null;
  delta: Delta | null;
  /** Why there is no delta / no value (one line). */
  note: string | null;
}

const num = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? 0 : x);
export const engagementOf = (r: Pick<PostMetricRow, "likes" | "comments" | "shares">) => num(r.likes) + num(r.comments) + num(r.shares);
const hasMetrics = (r: PostMetricRow) => r.views != null || r.likes != null || r.comments != null || r.shares != null;

/**
 * "▲ 12% vs last week" / "▼ 8% …" / "Same as …". No delta when there is nothing to compare with (previous
 * null or 0); a current 0 reads "None yet" (muted) instead of "▼ 100%".
 */
export function deltaOf(cur: number | null, prev: number | null, compare: string): Delta | null {
  if (cur == null || prev == null || prev <= 0) return null;
  if (cur === 0) return { text: "None yet", tone: "flat" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { text: `Same as ${compare.replace(/^vs /, "")}`, tone: "flat" };
  return pct > 0 ? { text: `▲ ${pct}% ${compare}`, tone: "up" } : { text: `▼ ${Math.abs(pct)}% ${compare}`, tone: "down" };
}

/** Views gained in a period; null when no gain was ever recorded on or before its last day (unknown, not 0). */
export function viewsIn(gains: ViewGainRow[], p: Pick<Period, "start" | "endExcl">): number | null {
  if (!gains.some((g) => g.day < p.endExcl)) return null;
  return gains.filter((g) => inPeriod(g.day, p)).reduce((s, g) => s + g.views, 0);
}

/**
 * The four KPI tiles. Views = views gained in the range (all posts, also older ones); Engagement = likes +
 * comments + shares of posts published in the range; Posts = posts published in the range (by hand too).
 * A metric with no data yet shows null ("–") and a one-line reason, never 0.
 */
export function buildKpis(
  data: { posts: PostMetricRow[]; gains: ViewGainRow[] },
  periods: { current: Period; previous: Period },
  range: RangeId,
  followers: FollowerTotals,
): Kpi[] {
  const { posts, gains } = data;
  const compare = RANGES.find((r) => r.id === range)!.compare;
  const cur = posts.filter((p) => inPeriod(p.day, periods.current));
  const prev = posts.filter((p) => inPeriod(p.day, periods.previous));
  const measured = (xs: PostMetricRow[]) => xs.filter(hasMetrics);
  const sum = (xs: PostMetricRow[], f: (r: PostMetricRow) => number) => xs.reduce((s, r) => s + f(r), 0);

  const curM = measured(cur);
  const prevM = measured(prev);
  const views = viewsIn(gains, periods.current);
  const pViews = viewsIn(gains, periods.previous);
  const eng = curM.length ? sum(curM, engagementOf) : null;
  const pEng = prevM.length ? sum(prevM, engagementOf) : null;
  const noNumbers = cur.length ? "Numbers arrive a day after posting" : "Nothing posted in this range";
  const firstPeriod = "Nothing to compare with yet";

  return [
    {
      id: "followers",
      label: "Followers",
      value: followers.current,
      delta: deltaOf(followers.current, followers.previous, compare),
      note: followers.current == null ? "Collected after the next sync" : followers.previous == null ? firstPeriod : null,
    },
    { id: "views", label: "Views", value: views, delta: deltaOf(views, pViews, compare), note: views == null ? "Collected after the next sync" : pViews == null ? firstPeriod : null },
    { id: "engagement", label: "Engagement", value: eng, delta: deltaOf(eng, pEng, compare), note: eng == null ? noNumbers : pEng == null ? firstPeriod : "Likes, comments and shares" },
    {
      id: "posts",
      label: "Posts published",
      value: posts.length ? cur.length : null,
      delta: deltaOf(posts.length ? cur.length : null, prev.length, compare),
      note: posts.length === 0 ? "Collected after the next sync" : prev.length === 0 ? (cur.length === 0 ? "Nothing went out in this range" : firstPeriod) : null,
    },
  ];
}

/** KPI number as shown: "12,480"; ≥ 1M compact ("1.2M"). null → null (the tile shows "–"). */
export function kpiText(v: number | null): string | null {
  if (v == null) return null;
  if (Math.abs(v) >= 1_000_000) return `${Number((v / 1_000_000).toFixed(1))}M`;
  return Math.round(v).toLocaleString("en-US");
}

// ---------------------------------------------------------------- Activity chart

export interface ActivityBar {
  label: string;
  title: string;
  values: Record<string, number>;
  highlight: boolean;
}

/**
 * Per-day bars for the chart, stacked by platform: views gained that day, or likes + comments + shares of
 * the posts published that day.
 */
export function activityBars(data: { posts: PostMetricRow[]; gains: ViewGainRow[] }, period: Period, metric: MetricId, today: string): ActivityBar[] {
  const long = period.days.length > 7;
  return period.days.map((day, i) => {
    const values: Record<string, number> = {};
    for (const p of PLATFORMS) values[p] = 0;
    if (metric === "views") for (const g of data.gains) if (g.day === day) values[g.platform] = (values[g.platform] ?? 0) + g.views;
    if (metric === "engagement") for (const r of data.posts) if (r.day === day) values[r.platform] = (values[r.platform] ?? 0) + engagementOf(r);
    // 30 bars: label every 5th day from the newest so the axis stays readable at 390 px.
    const label = long ? ((period.days.length - 1 - i) % 5 === 0 ? String(Number(day.slice(8, 10))) : "") : WD[weekdayIndex(day)]!;
    return { label, title: `${WD[weekdayIndex(day)]} ${md(day)}`, values, highlight: day === today };
  });
}

/** True when the chart has any value at all (else the card shows its empty line). */
export const hasActivity = (bars: ActivityBar[]) => bars.some((b) => Object.values(b.values).some((v) => v > 0));

// ---------------------------------------------------------------- This week

export interface WeekDay {
  day: string;
  weekday: string;
  dayNum: number;
  count: number;
  /** Platforms with something that day, in PLATFORMS order. */
  platforms: Platform[];
  needsYou: number;
  isToday: boolean;
  isPast: boolean;
  href: string;
}

export interface ScheduledRow {
  day: string;
  platform: Platform;
  status: string;
}

/** Mon–Sun of the current week with the number of posts per day (rejected left out); today marked. */
export function weekSchedule(rows: ScheduledRow[], today: string): WeekDay[] {
  const mon = mondayOf(today);
  return span(mon, 7).map((day, i) => {
    const mine = rows.filter((r) => r.day === day && r.status !== "rejected");
    return {
      day,
      weekday: WD[i]!,
      dayNum: Number(day.slice(8, 10)),
      count: mine.length,
      platforms: PLATFORMS.filter((p) => mine.some((r) => r.platform === p)),
      needsYou: mine.filter((r) => r.status === "draft" || r.status === "failed" || r.status === "unknown").length,
      isToday: day === today,
      isPast: day < today,
      href: `/calendar?day=${day}`,
    };
  });
}

// ---------------------------------------------------------------- Needs a reply

export interface FlaggedRow {
  commentId: string;
  platform: string;
  authorHandle: string | null;
  text: string;
  commentedAt: string;
  draft: string | null;
}

export interface ReplyTile {
  commentId: string;
  who: string;
  platform: Platform;
  text: string;
  draft: string | null;
  commentedAt: string;
  href: string;
}

/** Up to 4 flagged comments: who, the comment, the drafted reply (null = nothing to approve, only "Open"). */
export function replyTiles(rows: FlaggedRow[], max = 4): ReplyTile[] {
  return rows.slice(0, max).map((r) => ({
    commentId: r.commentId,
    who: r.authorHandle ? `@${r.authorHandle}` : "Someone",
    platform: r.platform as Platform,
    text: r.text,
    draft: r.draft?.trim() ? r.draft.trim() : null,
    commentedAt: r.commentedAt,
    href: `/inbox/item/${r.commentId}`,
  }));
}

// ---------------------------------------------------------------- Next week: captions

/** Next week's Monday (creator-local): the Monday after today, so on a Monday it is the following one. */
export const nextWeekStart = (today: string): string => addCalendarDays(mondayOf(today), 7);

export interface CaptionsDue {
  weekStart: string;
  count: number;
  text: string;
  href: string;
}

/**
 * The Home strip "Next week: N posts need captions" (F14): null when nothing needs text, so the strip only
 * shows when N > 0. Links to that week on the calendar with drafts emphasised.
 */
export function captionsDue(count: number, weekStart: string): CaptionsDue | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return {
    weekStart,
    count,
    text: `Next week: ${count === 1 ? "1 post needs" : `${count} posts need`} captions`,
    href: `/calendar?view=week&d=${weekStart}&status=draft`,
  };
}

// ---------------------------------------------------------------- loader

export const HOME_SQL = {
  /** Everything with a time in a window (for the This week card). */
  scheduled: `select platform, scheduled_for, status from batch_items
               where status <> 'rejected' and scheduled_for >= $1 and scheduled_for < $2`,
  /**
   * Draft items of a creator-local week with an empty caption or an empty YouTube title, any origin (the
   * Sunday weekly-draft job, editors, the app). Week membership is the calendar's: timed items by their time,
   * untimed drafts by their batch's week. Same predicate as `pnpm skill:weekly-batch pending`
   * (scripts/skills/lib/weekly-fill.ts PENDING_SQL); keep the two in step.
   * $1 week start (date), $2 / $3 the week's UTC bounds.
   */
  needsCaptions: `select count(*)::int as n
                    from batch_items bi join batches b on b.id = bi.batch_id
                   where bi.status = 'draft'
                     and b.status <> 'archived'
                     and ((bi.scheduled_for >= $2 and bi.scheduled_for < $3) or (bi.scheduled_for is null and b.week_start = $1::date))
                     and (btrim(bi.caption) = '' or (bi.platform = 'youtube' and coalesce(btrim(bi.title), '') = ''))`,
} as const;

const utcStart = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

export interface HomeData {
  today: string;
  posts: PostMetricRow[];
  gains: ViewGainRow[];
  scheduled: ScheduledRow[];
  followers: FollowerTotals;
}

/** Flattens the analytics per-platform day maps into rows. Pure. */
export function gainRows(gains: Map<Platform, Map<string, number>>): ViewGainRow[] {
  const out: ViewGainRow[] = [];
  for (const [platform, days] of gains) for (const [day, views] of days) out.push({ platform, day, views });
  return out;
}

/**
 * Read-only loader for the KPI tiles, the Activity chart and the This week card. Account numbers come from
 * lib/analytics/overview (account_posts + snapshots + daily follower rows, every post including those
 * posted by hand); the week's schedule from batch_items. Days are cut in the creator zone.
 */
export async function loadHome(pool: Pick<Pool, "query">, now: Date, timeZone: string, range: RangeId): Promise<HomeData> {
  const today = localDate(now, timeZone);
  const { current, previous } = periodsFor(range, today);
  const weekStart = mondayOf(today);
  // 30 days back covers the previous period of every range (the loader adds its own lookback).
  const account = await loadAccountData(pool, { days: 30, now, timeZone });
  const followers = await loadFollowerTotals(pool, { from: addCalendarDays(previous.endExcl, -1), to: addCalendarDays(current.endExcl, -1) });
  const s = await pool.query(HOME_SQL.scheduled, [utcStart(addCalendarDays(weekStart, -1)), utcStart(addCalendarDays(weekStart, 8))]);
  const posts: PostMetricRow[] = account.posts.map((p) => ({
    platform: p.platform,
    day: localDate(new Date(p.publishedAt), timeZone),
    views: p.metrics?.views ?? null,
    likes: p.metrics?.likes ?? null,
    comments: p.metrics?.comments ?? null,
    shares: p.metrics?.shares ?? null,
  }));
  const scheduled: ScheduledRow[] = s.rows.map((r: Record<string, unknown>) => ({
    platform: r.platform as Platform,
    day: localDate(new Date(r.scheduled_for as string | Date), timeZone),
    status: String(r.status),
  }));
  return { today, posts, gains: gainRows(gainsByPlatformDay(account, timeZone)), scheduled, followers };
}

/** Read-only: how many of next week's drafts still need text, shaped for the Home strip (null = hide it). */
export async function loadCaptionsDue(pool: Pick<Pool, "query">, now: Date, timeZone: string): Promise<CaptionsDue | null> {
  const weekStart = nextWeekStart(localDate(now, timeZone));
  const from = localToUtc(weekStart, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(weekStart, 7), "00:00", timeZone);
  const { rows } = await pool.query(HOME_SQL.needsCaptions, [weekStart, from, to]);
  return captionsDue(Number(rows[0]?.n ?? 0), weekStart);
}
