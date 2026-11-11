import type { Platform } from "@autopilot/core";
import { classifyHook, firstLine } from "@autopilot/research";
import { engagementRate, fmtInt, fmtPct, fmtX, lengthBucket, localHour, median, timeBucket } from "./stats.js";
import { recommendTrialShares, type TrialRecommendation } from "./trials.js";
import type { PostRecord } from "./types.js";

/** Group size below which we say "too early to tell" instead of recommending. */
export const MIN_GROUP = 3;
/** Posts per platform (in the comparison window) before any recommendation is made. */
export const MIN_PLATFORM = 6;
export const LIFT_UP = 1.25;
export const LIFT_DOWN = 0.75;
export const COMPARISON_DAYS = 28;

export type Dimension = "pillar" | "hook" | "length" | "time" | "trial";
export interface GroupStat {
  platform: Platform;
  dimension: Dimension;
  group: string;
  n: number;
  medianViews: number | null;
  medianEr: number | null;
  /** group median views / platform median views. */
  lift: number | null;
}
export interface Recommendation {
  platform: Platform;
  kind: "more" | "less";
  text: string;
  dimension: Dimension;
  group: string;
  n: number;
  lift: number;
}
export interface PlatformWeek {
  platform: Platform;
  posts: number;
  withMetrics: number;
  views: number | null;
  prevViews: number | null;
  /** this week's total views / last week's; null when either side has no data. */
  weekOverWeek: number | null;
  top: Array<{ batchItemId: string; hook: string; views: number | null; er: number | null }>;
}
export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  platforms: PlatformWeek[];
  groups: GroupStat[];
  recommendations: Recommendation[];
  tooEarly: Platform[];
  trials: { baselineN: number; recommendations: TrialRecommendation[] };
  dataGaps: string[];
  markdown: string;
}

const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];
const DAY = 86_400_000;

function dimensionValues(p: PostRecord, timeZone: string): Array<[Dimension, string]> {
  const out: Array<[Dimension, string]> = [
    ["pillar", p.pillar ?? "unsorted"],
    ["length", lengthBucket(p.durationS)],
    ["time", timeBucket(localHour(p.postedAt, timeZone))],
  ];
  const hook = firstLine(p.caption);
  if (hook) for (const tag of classifyHook(hook)) out.push(["hook", tag]);
  if (p.platform === "instagram") out.push(["trial", p.isTrial ? "trial" : "regular"]);
  return out;
}

const LABEL: Record<Dimension, (g: string) => string> = {
  pillar: (g) => `${g} posts`,
  hook: (g) => `"${g}" hooks`,
  length: (g) => `${g} videos`,
  time: (g) => `${g} posts`,
  trial: (g) => (g === "trial" ? "trial reels" : "regular reels"),
};

export interface ReportOptions {
  /** Monday (or any day) the report week starts, YYYY-MM-DD, interpreted as 00:00 UTC. */
  weekStart: string;
  /** Creator's zone for time-of-day buckets (TZ_CREATOR). Never printed. */
  timeZone: string;
  now?: Date;
}

export function buildWeeklyReport(posts: PostRecord[], opts: ReportOptions): WeeklyReport {
  const start = Date.parse(opts.weekStart + "T00:00:00Z");
  if (!Number.isFinite(start)) throw new Error("weekStart must be YYYY-MM-DD");
  const end = start + 7 * DAY;
  const now = opts.now ?? new Date(end);
  const inRange = (p: PostRecord, a: number, b: number) => {
    const t = Date.parse(p.postedAt);
    return t >= a && t < b;
  };

  // ---- this week vs last week, per platform ----
  const platforms: PlatformWeek[] = [];
  for (const platform of PLATFORMS) {
    const mine = posts.filter((p) => p.platform === platform);
    const week = mine.filter((p) => inRange(p, start, end));
    const prev = mine.filter((p) => inRange(p, start - 7 * DAY, start));
    if (!week.length && !prev.length) continue;
    const sumViews = (xs: PostRecord[]) => {
      const v = xs.map((p) => p.metrics.views).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const views = sumViews(week);
    const prevViews = sumViews(prev);
    platforms.push({
      platform,
      posts: week.length,
      withMetrics: week.filter((p) => p.metrics.views !== null).length,
      views,
      prevViews,
      weekOverWeek: views !== null && prevViews ? views / prevViews : null,
      top: [...week]
        .filter((p) => p.metrics.views !== null)
        .sort((a, b) => b.metrics.views! - a.metrics.views! || a.postedAt.localeCompare(b.postedAt))
        .slice(0, 3)
        .map((p) => ({ batchItemId: p.batchItemId, hook: firstLine(p.caption), views: p.metrics.views, er: engagementRate(p.metrics) })),
    });
  }

  // ---- comparisons over a rolling window ending with the report week ----
  const windowPosts = posts.filter((p) => inRange(p, end - COMPARISON_DAYS * DAY, end) && p.metrics.views !== null);
  const groups: GroupStat[] = [];
  const recommendations: Recommendation[] = [];
  const tooEarly: Platform[] = [];
  for (const platform of PLATFORMS) {
    const mine = windowPosts.filter((p) => p.platform === platform);
    if (!mine.length) continue;
    const platformMedian = median(mine.map((p) => p.metrics.views!));
    const buckets = new Map<string, PostRecord[]>();
    for (const p of mine) {
      for (const [dim, g] of dimensionValues(p, opts.timeZone)) {
        const k = `${dim}\u0000${g}`;
        buckets.set(k, [...(buckets.get(k) ?? []), p]);
      }
    }
    for (const [k, xs] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [dimension, group] = k.split("\u0000") as [Dimension, string];
      const mv = median(xs.map((p) => p.metrics.views!));
      groups.push({
        platform,
        dimension,
        group,
        n: xs.length,
        medianViews: mv,
        medianEr: median(xs.map((p) => engagementRate(p.metrics)).filter((x): x is number => x !== null)),
        lift: mv !== null && platformMedian ? mv / platformMedian : null,
      });
    }
    if (mine.length < MIN_PLATFORM) {
      tooEarly.push(platform);
      continue;
    }
    for (const g of groups.filter((x) => x.platform === platform && x.n >= MIN_GROUP && x.lift !== null && x.n < mine.length)) {
      if (g.group === "unknown" || g.group === "unsorted" || g.group === "other") continue;
      if (g.lift! >= LIFT_UP || g.lift! <= LIFT_DOWN) {
        const kind = g.lift! >= LIFT_UP ? "more" : "less";
        recommendations.push({
          platform,
          kind,
          dimension: g.dimension,
          group: g.group,
          n: g.n,
          lift: g.lift!,
          text: `${platform}: ${LABEL[g.dimension](g.group)} got ${fmtX(g.lift)} your median views (n=${g.n}) → ${kind === "more" ? "do more" : "do fewer or rework"}`,
        });
      }
    }
  }
  recommendations.sort((a, b) => Math.abs(Math.log(b.lift)) - Math.abs(Math.log(a.lift)) || a.text.localeCompare(b.text));

  const trials = recommendTrialShares(posts, now);

  // ---- data gaps: say what's missing instead of guessing ----
  const dataGaps: string[] = [];
  for (const pw of platforms) {
    if (pw.posts > pw.withMetrics) dataGaps.push(`${pw.platform}: ${pw.posts - pw.withMetrics} of ${pw.posts} post(s) this week have no metrics yet`);
  }
  if (platforms.some((p) => p.platform === "snapchat")) dataGaps.push("snapchat: assisted posting, no metrics API; check the app");

  const lines: string[] = [];
  lines.push(`# Weekly report: ${opts.weekStart} → ${new Date(end - DAY).toISOString().slice(0, 10)}`, "");
  lines.push("## This week");
  if (!platforms.length) lines.push("- No posts this week or last.");
  for (const p of platforms) {
    lines.push(`- **${p.platform}**: ${p.posts} post(s), ${fmtInt(p.views)} views (last week ${fmtInt(p.prevViews)}, ${p.weekOverWeek === null ? "no comparison" : fmtX(p.weekOverWeek)})`);
    for (const t of p.top) lines.push(`  - "${t.hook}": ${fmtInt(t.views)} views, ER ${fmtPct(t.er)}`);
  }
  lines.push("", `## What worked (last ${COMPARISON_DAYS} days, within each platform)`);
  if (recommendations.length) for (const r of recommendations) lines.push(`- ${r.text}`);
  else lines.push("- Nothing stands out yet.");
  if (tooEarly.length) lines.push(`- Too early to tell on ${tooEarly.join(", ")} (fewer than ${MIN_PLATFORM} posts with metrics).`);
  lines.push("", `Groups need n≥${MIN_GROUP} and a lift of ≥${fmtX(LIFT_UP)} or ≤${fmtX(LIFT_DOWN)}. These are correlations, not causes.`);
  lines.push("", "## Trial reels (share manually in the Instagram app)");
  if (!trials.recommendations.length) lines.push("- No unshared trial reels.");
  for (const t of trials.recommendations) {
    const verdict = t.verdict === "share" ? "SHARE" : t.verdict === "dont-share" ? "DON'T SHARE" : "WAIT";
    lines.push(`- **${verdict}** "${firstLine(t.caption)}" (${t.ageHours} h, ${fmtInt(t.views)} views): ${t.reason}`);
  }
  if (dataGaps.length) {
    lines.push("", "## Data gaps");
    for (const g of dataGaps) lines.push(`- ${g}`);
  }

  return {
    weekStart: opts.weekStart,
    weekEnd: new Date(end).toISOString().slice(0, 10),
    platforms,
    groups,
    recommendations,
    tooEarly,
    trials,
    dataGaps,
    markdown: lines.join("\n") + "\n",
  };
}
