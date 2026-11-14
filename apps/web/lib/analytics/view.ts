/**
 * Pure view logic for /analytics (design system v2): week maths, number formatting, the numbers band,
 * the weekly views series, the platform donut, the top-insight statement and row labels.
 * No React, no DB — tested in __tests__/view.test.ts. Every number comes from the PostRecords / WeeklyReport
 * the page already loads; nothing is estimated (a missing metric stays "n/a").
 */
import type { PostRecord, Recommendation, TrialRecommendation, WeeklyReport } from "@autopilot/analytics";

export type Platform = PostRecord["platform"];

const DAY = 86_400_000;

export const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };
export const platformName = (p: string) => PLATFORM_LABEL[p] ?? p;

/** Monday of the last complete week (UTC), same rule as the weekly-report skill. */
export function lastCompleteWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
}

export const shiftWeek = (w: string, days: number) => new Date(Date.parse(w + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);

/** ISO-8601 week number of a YYYY-MM-DD date (UTC). */
export function isoWeekOf(day: string): number {
  const d = new Date(Date.parse(day + "T00:00:00Z"));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday decides the ISO year
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return 1 + Math.floor((d.getTime() - jan1) / (7 * DAY));
}

/** Compact count for big tiles: 9,999 stays exact, then 12.4K / 1.2M. null → "n/a". */
export function compact(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  const v = Math.round(n);
  if (Math.abs(v) < 10_000) return v.toLocaleString("en-US");
  if (Math.abs(v) < 1_000_000) return `${trim1(v / 1000)}K`;
  return `${trim1(v / 1_000_000)}M`;
}
const trim1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, "");

/** "×1.25" multiplier, "n/a" when unknown. */
export const times = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : `×${x.toFixed(2)}`);

/** "2026-11-02 → 11-08" (end is inclusive, so the exclusive weekEnd minus a day). */
export function rangeLabel(weekStart: string, weekEndExclusive: string): string {
  const end = shiftWeek(weekEndExclusive, -1);
  return `${weekStart} → ${end.slice(0, 4) === weekStart.slice(0, 4) ? end.slice(5) : end}`;
}

const inWeek = (p: PostRecord, weekStart: string) => {
  const a = Date.parse(weekStart + "T00:00:00Z");
  const t = Date.parse(p.postedAt);
  return t >= a && t < a + 7 * DAY;
};

/** Sum of one metric over posts; null when no post reports it (missing ≠ 0). */
function sumMetric(posts: PostRecord[], key: keyof PostRecord["metrics"]): number | null {
  const vals = posts.map((p) => p.metrics[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export type Totals = { posts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null };

/** Totals for the report week (latest snapshot per post). */
export function weekTotals(posts: PostRecord[], weekStart: string): Totals {
  const week = posts.filter((p) => inWeek(p, weekStart));
  return {
    posts: week.length,
    views: sumMetric(week, "views"),
    likes: sumMetric(week, "likes"),
    comments: sumMetric(week, "comments"),
    shares: sumMetric(week, "shares"),
  };
}

/** All platforms' views this week ÷ last week (from the report's per-platform sums); null if either side is unknown. */
export function overallWeekOverWeek(r: Pick<WeeklyReport, "platforms">): number | null {
  const cur = r.platforms.map((p) => p.views).filter((v): v is number => v !== null);
  const prev = r.platforms.map((p) => p.prevViews).filter((v): v is number => v !== null);
  if (!cur.length || !prev.length) return null;
  const p = prev.reduce((a, b) => a + b, 0);
  return p > 0 ? cur.reduce((a, b) => a + b, 0) / p : null;
}

export type WeekPoint = { weekStart: string; label: string; views: number; posts: number };

/**
 * Views per posting week for the `weeks` weeks ending with the report week (by postedAt, latest snapshot).
 * Leading weeks with no posts are dropped (they're before the account had data), but at least 2 stay.
 */
export function weeklyViews(posts: PostRecord[], weekStart: string, weeks = 5): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const w = shiftWeek(weekStart, -7 * i);
    const mine = posts.filter((p) => inWeek(p, w));
    out.push({ weekStart: w, label: `W${isoWeekOf(w)}`, views: sumMetric(mine, "views") ?? 0, posts: mine.length });
  }
  while (out.length > 2 && out[0]!.posts === 0) out.shift();
  return out;
}

export type DonutTone = "accent" | "hi" | "gray1" | "gray2" | "gray3";
export type ShareSegment = { label: string; value: number; tone: DonutTone; pct: number };

/** Tones by rank: the largest share gets the one accent, the rest grays (ds-line is skipped: it's decorative, < 3:1). */
const RANK_TONES: DonutTone[] = ["accent", "hi", "gray1", "gray2"];

/**
 * Share of the week's posts by platform (posts, not views: views aren't comparable across platforms).
 * Sorted largest first; ties keep platform order. Percentages are whole numbers that sum to 100.
 */
export function platformShare(r: Pick<WeeklyReport, "platforms">): ShareSegment[] {
  const rows = r.platforms.filter((p) => p.posts > 0).map((p, i) => ({ p, i }));
  rows.sort((a, b) => b.p.posts - a.p.posts || a.i - b.i);
  const total = rows.reduce((a, b) => a + b.p.posts, 0);
  const pcts = roundTo100(rows.map((x) => (total ? (x.p.posts / total) * 100 : 0)));
  return rows.map((x, k) => ({
    label: platformName(x.p.platform),
    value: x.p.posts,
    tone: RANK_TONES[Math.min(k, RANK_TONES.length - 1)]!,
    pct: pcts[k]!,
  }));
}

/** Largest-remainder rounding so whole percentages add up to exactly 100 (or all 0). */
export function roundTo100(xs: number[]): number[] {
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum <= 0) return xs.map(() => 0);
  const floors = xs.map((x) => Math.floor(x));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = xs.map((x, i) => ({ i, rem: x - Math.floor(x) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]! += 1;
    left--;
  }
  return floors;
}

/** Group label for a recommendation row (mirrors the report's wording). */
export function groupLabel(rec: Pick<Recommendation, "dimension" | "group">): string {
  switch (rec.dimension) {
    case "hook":
      return `“${rec.group}” hooks`;
    case "length":
      return `${rec.group} videos`;
    case "trial":
      return rec.group === "trial" ? "Trial reels" : "Regular reels";
    default:
      return `${rec.group} posts`;
  }
}

const cap1 = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export type RecRow = { key: string; platform: Platform; title: string; meta: string; lift: string; direction: "up" | "down"; action: string };

/** One list row per recommendation: title = group, mono meta with the sample size, trailing lift. */
export function recRows(recs: Recommendation[]): RecRow[] {
  return recs.map((r) => ({
    key: r.text,
    platform: r.platform,
    title: cap1(groupLabel(r)),
    meta: `${platformName(r.platform)} · n=${r.n} · ${r.dimension}`,
    lift: times(r.lift),
    direction: r.kind === "more" ? "up" : "down",
    action: r.kind === "more" ? "Do more" : "Rework",
  }));
}

/**
 * The Statement line: the strongest recommendation as one editorial sentence, plus its caps source
 * (sample size + "correlation, not cause"). null when nothing stands out.
 */
export function topInsight(recs: Recommendation[]): { text: string; source: string } | null {
  const r = recs[0];
  if (!r) return null;
  const verb = r.lift >= 1 ? `got ${times(r.lift)} your median views` : `got only ${times(r.lift)} your median views`;
  return {
    text: `${cap1(groupLabel(r))} ${verb} on ${platformName(r.platform)}.`,
    source: `Top insight · n=${r.n} · last 28 days · correlation, not cause`,
  };
}

export type VerdictView = { label: string; tone: "accent" | "neutral" | "warn" };
export const VERDICT: Record<TrialRecommendation["verdict"], VerdictView> = {
  share: { label: "Share", tone: "accent" },
  wait: { label: "Wait", tone: "neutral" },
  "dont-share": { label: "Don’t share", tone: "warn" },
};

/** Mono meta for a trial row: age + views (sample basis lives in the reason text). */
export function trialMeta(t: Pick<TrialRecommendation, "ageHours" | "views" | "viewsVsBaseline">): string {
  const parts = [`${t.ageHours} h`, `${t.views === null ? "n/a" : Math.round(t.views).toLocaleString("en-US")} views`];
  if (t.viewsVsBaseline !== null) parts.push(`${times(t.viewsVsBaseline)} baseline`);
  return parts.join(" · ");
}

/** Hero display lines: "WEEK 45" (stroke) / "in review" (serif) / views (solid). */
export function heroLines(weekStart: string, views: number | null): Array<{ text: string; style: "solid" | "stroke" | "serif" }> {
  return [
    { text: `WEEK ${isoWeekOf(weekStart)}`, style: "stroke" },
    { text: "in review", style: "serif" },
    { text: `${compact(views)}`, style: "solid" },
  ];
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
