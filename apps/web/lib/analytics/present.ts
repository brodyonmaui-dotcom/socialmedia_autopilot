/**
 * Pure view helpers for the v3 Analytics screens (/analytics and /analytics/[platform]). They turn the
 * loader output (overview.ts, platform.ts) into the words, numbers and chart inputs the pages render.
 * No React, no DB, no time zone of their own (dates are already local YYYY-MM-DD). Tested in
 * __tests__/present.test.ts.
 */
import { groupLabel, type Finding, type TrialRecommendation } from "@autopilot/analytics";
import type { Platform } from "@autopilot/core";
import { rangeText } from "../home/dashboard.js";
import { ALL_PLATFORMS, RANGE_DAYS, type Kpi, type Overview, type PlatformCard, type RangeDays, type ViewsDay } from "./overview.js";
import type { HourStat, PlatformAnalytics, PlatformPostRow } from "./platform.js";

export { rangeText };

export const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };
export const DEFAULT_DAYS: RangeDays = 30;

// ---------------------------------------------------------------- params + links

export function parseDays(v: string | string[] | undefined): RangeDays {
  const n = Number(typeof v === "string" ? v : NaN);
  return (RANGE_DAYS as number[]).includes(n) ? (n as RangeDays) : DEFAULT_DAYS;
}

export function parsePlatform(v: string | undefined): Platform | null {
  return ALL_PLATFORMS.includes(v as Platform) ? (v as Platform) : null;
}

export type PostSort = "date" | "views";
export function parseSort(v: string | string[] | undefined): PostSort {
  return v === "views" ? "views" : "date";
}

/** "/analytics", "/analytics?days=7", "/analytics/instagram?days=60&sort=views" (defaults left out). */
export function analyticsHref(opts: { platform?: Platform; days?: RangeDays; sort?: PostSort } = {}): string {
  const q = new URLSearchParams();
  if (opts.days && opts.days !== DEFAULT_DAYS) q.set("days", String(opts.days));
  if (opts.sort && opts.sort !== "date") q.set("sort", opts.sort);
  const s = q.toString();
  return `/analytics${opts.platform ? `/${opts.platform}` : ""}${s ? `?${s}` : ""}`;
}

export const rangeLabel = (days: RangeDays) => `Last ${days} days`;
export const compareText = (days: RangeDays) => `vs the ${days} days before`;

export function rangeOptions(current: RangeDays, href: (d: RangeDays) => string) {
  return RANGE_DAYS.map((d) => ({ label: rangeLabel(d), href: href(d), current: d === current }));
}

// ---------------------------------------------------------------- numbers

export function fmtInt(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  return Math.round(n).toLocaleString("en-US");
}

/** 0.0423 → "4.2%"; below 10 % one decimal, else whole. */
export function fmtRate(r: number | null | undefined): string | null {
  if (r == null || !Number.isFinite(r)) return null;
  const p = r * 100;
  return `${p >= 10 ? Math.round(p) : Number(p.toFixed(1))}%`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- KPI tiles

export type Delta = { text: string; tone: "up" | "down" | "flat" };

/**
 * Counts: "▲ 12% vs the 30 days before". Rates: the change in percentage points ("▲ 0.6 pts …"), since
 * a percent of a percent misleads. No delta when either side is unknown or the previous count is 0;
 * a current 0 against a real previous reads "None yet".
 */
export function kpiDelta(k: Kpi, days: RangeDays, kind: "count" | "rate" = "count"): Delta | null {
  if (k.value == null || k.previous == null) return null;
  const vs = compareText(days);
  if (kind === "rate") {
    const pts = Math.round((k.value - k.previous) * 1000) / 10;
    if (pts === 0) return { text: `Same as the ${days} days before`, tone: "flat" };
    return pts > 0 ? { text: `▲ ${pts} pts ${vs}`, tone: "up" } : { text: `▼ ${Math.abs(pts)} pts ${vs}`, tone: "down" };
  }
  if (k.previous <= 0) return null;
  if (k.value === 0) return { text: "None yet", tone: "flat" };
  const pct = Math.round((k.value / k.previous - 1) * 100);
  if (pct === 0) return { text: `Same as the ${days} days before`, tone: "flat" };
  return pct > 0 ? { text: `▲ ${pct}% ${vs}`, tone: "up" } : { text: `▼ ${Math.abs(pct)}% ${vs}`, tone: "down" };
}

export type TileId = "followers" | "views" | "engagement" | "posts";
export interface Tile {
  id: TileId;
  label: string;
  value: string | null;
  delta: Delta | null;
  /** Shown when there's no delta: why the value is "–", or "No earlier data". */
  note: string | null;
}

function tile(id: TileId, label: string, k: Kpi, days: RangeDays, kind: "count" | "rate", emptyNote: string): Tile {
  const value = kind === "rate" ? fmtRate(k.value) : fmtInt(k.value);
  const delta = kpiDelta(k, days, kind);
  const note = delta ? null : value == null ? emptyNote : k.previous == null ? "No earlier data" : k.previous === 0 ? "Nothing to compare with" : null;
  return { id, label, value, delta, note };
}

/** The four overview tiles: Followers, Views, Engagement rate, Posts. */
export function overviewTiles(o: Pick<Overview, "kpis" | "range">): Tile[] {
  const d = o.range.days;
  return [
    tile("followers", "Followers", o.kpis.followers, d, "count", "No follower counts yet"),
    tile("views", "Views", o.kpis.views, d, "count", "Views arrive a day after posting"),
    tile("engagement", "Engagement rate", o.kpis.engagementRate, d, "rate", "Needs posts with views"),
    tile("posts", "Posts", o.kpis.posts, d, "count", "Nothing posted yet"),
  ];
}

/** A platform page's tiles (only followers has an earlier value to compare with). */
export function platformTiles(card: PlatformCard, days: RangeDays): Tile[] {
  const fd = card.followersDelta;
  const followersDelta: Delta | null =
    fd == null || card.followers == null ? null : fd === 0 ? { text: `Same as ${days} days ago`, tone: "flat" } : { text: `${fd > 0 ? "▲" : "▼"} ${fmtInt(Math.abs(fd))} in ${days} days`, tone: fd > 0 ? "up" : "down" };
  const median = fmtInt(card.medianViews);
  return [
    { id: "followers", label: "Followers", value: fmtInt(card.followers), delta: followersDelta, note: card.followers == null ? "No follower counts yet" : followersDelta ? null : "No earlier data" },
    { id: "views", label: "Views", value: fmtInt(card.views), delta: null, note: card.views == null ? "Views arrive a day after posting" : "Gained in this range" },
    { id: "engagement", label: "Engagement rate", value: fmtRate(card.engagementRate), delta: null, note: card.engagementRate == null ? "Needs posts with views" : "Of posts in this range" },
    { id: "posts", label: "Posts", value: fmtInt(card.posts), delta: null, note: card.posts === 0 ? "Nothing posted in this range" : median ? `Median ${median} views each` : "Views still coming in" },
  ];
}

// ---------------------------------------------------------------- dates + chart inputs

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** "Nov 3". */
export const shortDay = (ymd: string) => DAY_FMT.format(at(ymd));
/** "Tue, Nov 3" (tooltips, hidden tables). */
export const longDay = (ymd: string) => `${WEEKDAY_FMT.format(at(ymd))}, ${DAY_FMT.format(at(ymd))}`;

/** X labels: weekdays for a week, dates otherwise; `labelEvery` keeps them from colliding on a phone. */
export function dayAxis(dates: string[]): { labels: string[]; titles: string[]; labelEvery: number } {
  const week = dates.length <= 7;
  return {
    labels: dates.map((d) => (week ? WEEKDAY_FMT.format(at(d)) : shortDay(d))),
    titles: dates.map(longDay),
    labelEvery: week ? 1 : dates.length <= 31 ? 7 : 14,
  };
}

export interface SeriesSpec {
  id: Platform;
  label: string;
  platform: Platform;
}

/**
 * Views per day by platform for the LineChart. A platform whose every day is null (not collected, or no
 * posts there yet) is left out of the chart and named in `missing` instead of drawn as a fake 0 line.
 */
export function viewsChart(days: ViewsDay[]): {
  series: SeriesSpec[];
  values: Record<string, Array<number | null>>;
  missing: Array<{ platform: Platform; text: string }>;
  total: number;
} {
  const series: SeriesSpec[] = [];
  const values: Record<string, Array<number | null>> = {};
  const missing: Array<{ platform: Platform; text: string }> = [];
  let total = 0;
  for (const p of ALL_PLATFORMS) {
    const xs = days.map((d) => d[p]);
    if (xs.every((x) => x === null)) {
      missing.push({ platform: p, text: `${PLATFORM_LABEL[p]}: not collected` });
      continue;
    }
    series.push({ id: p, label: PLATFORM_LABEL[p], platform: p });
    values[p] = xs;
    total += xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  }
  return { series, values, missing, total };
}

// ---------------------------------------------------------------- top posts

/** "Nov 12 · 4.2% engagement" (the local publish day, then the rate when known). */
export function postMeta(localDay: string, engagementRate: number | null): string {
  const er = fmtRate(engagementRate);
  return er ? `${shortDay(localDay)} · ${er} engagement` : shortDay(localDay);
}

// ---------------------------------------------------------------- What worked

export interface FindingView {
  key: string;
  platform: Platform;
  /** One sentence without the sample size. */
  sentence: string;
  /** "n = 14 posts vs 22 others" / "n = 3 posts, needs 5". */
  sample: string;
}

const cap1 = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const ratio = (x: number) => `${x.toFixed(1)}×`;

/** One plain sentence per finding, the sample size split off into its own small note. */
export function findingView(f: Finding): FindingView {
  const subject = groupLabel(f.dimension, f.group);
  const byPlatform = f.dimension === "platform";
  const lead = byPlatform ? cap1(subject) : `On ${PLATFORM_LABEL[f.platform]}, ${subject}`;
  const others = byPlatform ? "posts on the other platforms" : "your other posts";
  let sentence: string;
  if (f.status !== "ok" || f.viewsRatio == null) sentence = `${lead}: not enough posts yet.`;
  else if (f.direction === "same") sentence = `${lead} got about the same views as ${others}.`;
  else if (f.direction === "down") sentence = `${lead} got only ${ratio(f.viewsRatio)} the median views of ${others}.`;
  else sentence = `${lead} got ${ratio(f.viewsRatio)} the median views of ${others}.`;
  const sample = f.status === "ok" ? `n = ${f.n} ${f.n === 1 ? "post" : "posts"} vs ${f.restN} others` : `n = ${f.n} ${f.n === 1 ? "post" : "posts"}, needs ${f.minN}`;
  return { key: f.key, platform: f.platform, sentence, sample };
}

/**
 * Splits the loader's findings: `lead` = the strongest ok finding that isn't "about the same" (the page's
 * one italic pull-quote), `ok` = the rest of the ok ones, `insufficient` = collapsed "not enough posts yet".
 */
export function splitFindings(findings: Finding[]): { lead: FindingView | null; ok: FindingView[]; insufficient: FindingView[] } {
  const ok = findings.filter((f) => f.status === "ok");
  const leadF = ok.find((f) => f.direction === "up" || f.direction === "down") ?? null;
  return {
    lead: leadF ? findingView(leadF) : null,
    ok: ok.filter((f) => f !== leadF).map(findingView),
    insufficient: findings.filter((f) => f.status !== "ok").map(findingView),
  };
}

// ---------------------------------------------------------------- platform page

export interface HourBar {
  bucket: string;
  label: string;
  /** Bar width 0–100 relative to the highest median. */
  width: number;
  value: string | null;
  /** "Best" on the winning bucket, "n = 3, too few" below the minimum, else "n = 12". */
  note: string;
  best: boolean;
  enough: boolean;
}

export function hourBars(hours: HourStat[]): HourBar[] {
  const max = Math.max(0, ...hours.map((h) => (h.status === "ok" ? (h.medianViews ?? 0) : 0)));
  return hours.map((h) => {
    const enough = h.status === "ok" && h.medianViews != null;
    return {
      bucket: h.bucket,
      label: h.label,
      width: enough && max > 0 ? Math.max(2, Math.round((h.medianViews! / max) * 100)) : 0,
      value: enough ? fmtInt(h.medianViews) : null,
      note: h.best ? `Best · n = ${h.n}` : enough ? `n = ${h.n}` : `n = ${h.n}, too few`,
      best: h.best,
      enough,
    };
  });
}

export function sortPosts(posts: PlatformPostRow[], sort: PostSort): PlatformPostRow[] {
  if (sort === "date") return posts;
  return [...posts].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.publishedAt.localeCompare(a.publishedAt));
}

/** Seconds → "0:42". */
export function clock(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s) || s < 0) return null;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

export function followersChart(a: Pick<PlatformAnalytics, "followers">): { values: Array<number | null>; known: number } {
  const values = a.followers.map((f) => f.followers);
  return { values, known: values.filter((v) => v != null).length };
}

/** Copy for a platform whose numbers aren't collected (no API on our plan, or none at all). */
export function notCollectedCopy(platform: Platform, reason: string): { headline: string; turnOn: string; meanwhile: string } {
  const first = reason.split(/(?<=\.)\s/)[0] ?? reason;
  if (platform === "tiktok")
    return {
      headline: first,
      turnOn: "Zernio's analytics add-on would bring in views, likes, comments and shares for each post. It may cost money, so it needs your OK in chat first.",
      meanwhile: "Check the numbers in the TikTok app. Entering them by hand here isn't built yet.",
    };
  if (platform === "snapchat")
    return {
      headline: first,
      turnOn: "Nothing can switch this on: Snapchat doesn't offer creators a metrics API.",
      meanwhile: "Spotlight views are in the Snapchat app under your profile.",
    };
  return { headline: first, turnOn: "", meanwhile: "" };
}

// ---------------------------------------------------------------- trial reels (Instagram)

export type VerdictView = { label: string; tone: "accent" | "neutral" | "warn" };
export const VERDICT: Record<TrialRecommendation["verdict"], VerdictView> = {
  share: { label: "Share", tone: "accent" },
  wait: { label: "Wait", tone: "neutral" },
  "dont-share": { label: "Don’t share", tone: "warn" },
};

/** "36 h old · 1,240 views · 1.4× your usual". */
export function trialMeta(t: Pick<TrialRecommendation, "ageHours" | "views" | "viewsVsBaseline">): string {
  const parts = [`${t.ageHours} h old`, t.views === null ? "views not in yet" : `${fmtInt(t.views)} views`];
  if (t.viewsVsBaseline !== null) parts.push(`${ratio(t.viewsVsBaseline)} your usual`);
  return parts.join(" · ");
}
