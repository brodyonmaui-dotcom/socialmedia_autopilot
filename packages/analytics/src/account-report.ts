import { localDate, type Platform } from "@autopilot/core";
import { classifyHook, firstLine, type HookPattern } from "@autopilot/research";
import { engagementRate, lengthBucket, localHour, median, timeBucket, type LengthBucket, type TimeBucket } from "./stats.js";
import { EMPTY_METRICS } from "./types.js";
import type { AccountMetrics, AccountPostRecord, AccountSnapshotRow } from "./account-types.js";

/**
 * "What worked" over every post on the account (matched to an app item or posted by hand).
 * Each finding compares one group with the rest of the posts it is compared against, on median views
 * and median engagement rate = (likes + comments + shares + saves) / views. Groups need FINDING_MIN_N
 * posts on both sides; below that the finding is returned as `insufficient` with its n.
 * Views are only compared within one platform, except the explicit "by platform" finding.
 */
export const FINDING_MIN_N = 5;
/** Ratios at or beyond these count as a real difference; in between the finding says "about the same". */
export const FINDING_UP = 1.25;
export const FINDING_DOWN = 0.8;
export const FINDINGS_MAX = 8;
export const FINDINGS_INSUFFICIENT_MAX = 3;

export type FindingDimension = "platform" | "pillar" | "hook" | "duration" | "hour";
export type AccountPillar = "gym" | "trading" | "other";

export interface Finding {
  key: string;
  /** The platform compared within; for dimension "platform" the platform the group is (rest = other platforms). */
  platform: Platform;
  dimension: FindingDimension;
  group: string;
  status: "ok" | "insufficient";
  n: number;
  restN: number;
  minN: number;
  metric: "median views";
  medianViews: number | null;
  restMedianViews: number | null;
  /** group median views / rest median views. */
  viewsRatio: number | null;
  medianEr: number | null;
  restMedianEr: number | null;
  erRatio: number | null;
  direction: "up" | "down" | "same" | null;
  /** One plain sentence, e.g. "Instagram: clips under 15 s got 1.8× the median views (n = 14 vs 22)." */
  text: string;
}

const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };

/** Conservative keyword rule for posts with no app pillar: one clear side wins, anything else is "other". */
const GYM_RE = /(#?\b(gym|gymbro|workout|lift(s|ing)?|squats?|deadlifts?|bench|hypertrophy|deload|reps?|sets?|lats|biceps|triceps|glutes|cardio|bulk(ing)?|cut(ting)?|protein|pr)\b|\b(pull|push|leg|back|chest|arm|shoulder) day\b)/iu;
const TRADING_RE = /(#?\b(trad(e|es|ed|ing|er)|daytrad\w*|p\/l|pnl|stocks?|options|futures|forex|crypto|charts?|candles?|liquidity|scalp(ing)?|breakout|entry|stop ?loss|nfa)\b|not financial advice|\b\d+:\d+\s?r\b)/iu;

export function classifyPillar(text: string | null | undefined): AccountPillar {
  const t = text ?? "";
  const gym = GYM_RE.test(t);
  const trading = TRADING_RE.test(t);
  if (gym && !trading) return "gym";
  if (trading && !gym) return "trading";
  return "other";
}

/** The pillar a post counts under: the matched clip's pillar, else the caption rule. */
export function pillarOf(p: Pick<AccountPostRecord, "pillar" | "caption" | "title">): string {
  if (p.pillar) return p.pillar;
  return classifyPillar([p.title, p.caption].filter(Boolean).join("\n"));
}

export function accountEngagementRate(m: AccountMetrics | null): number | null {
  if (!m) return null;
  return engagementRate({ ...EMPTY_METRICS, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves });
}

/** Hook text: the title on YouTube (what viewers see first), else the caption's first line. */
export function hookText(p: Pick<AccountPostRecord, "title" | "caption">): string {
  return firstLine(p.title || p.caption || "");
}

const HOUR_RANGE: Record<TimeBucket, string> = { morning: "5–11 h", midday: "11–14 h", afternoon: "14–18 h", evening: "18–22 h", late: "22–5 h" };
const HOOK_LABEL: Record<HookPattern, string> = {
  question: "question hooks",
  number: "hooks with a number",
  contrarian: "contrarian hooks",
  pov: "POV hooks",
  "how-why": "how/why hooks",
  list: "list hooks",
  story: "story hooks (I / my / today)",
  deadpan: "deadpan one-liners",
  other: "other hooks",
};
const DURATION_LABEL: Record<LengthBucket, string> = { "<15s": "clips under 15 s", "15–30s": "15–30 s clips", "30–60s": "30–60 s clips", ">60s": "clips over 60 s", unknown: "clips of unknown length" };

export function groupLabel(dimension: FindingDimension, group: string): string {
  switch (dimension) {
    case "platform":
      return `${NAME[group as Platform] ?? group} posts`;
    case "pillar":
      return `${group} posts`;
    case "hook":
      return HOOK_LABEL[group as HookPattern] ?? `"${group}" hooks`;
    case "duration":
      return DURATION_LABEL[group as LengthBucket] ?? `${group} clips`;
    case "hour": {
      const range = HOUR_RANGE[group as TimeBucket] ?? "?";
      if (group === "midday") return `posts at midday (${range})`;
      if (group === "late") return `late-night posts (${range})`;
      return `posts in the ${group} (${range})`;
    }
  }
}

const fmtRatio = (x: number) => `${x.toFixed(1)}×`;

function sentence(f: Omit<Finding, "text">): string {
  const subject = groupLabel(f.dimension, f.group);
  const prefix = f.dimension === "platform" ? "" : `${NAME[f.platform]}: `;
  const cap = (s: string) => (prefix ? s : s[0]!.toUpperCase() + s.slice(1));
  const vs = f.dimension === "platform" ? " of the other platforms" : "";
  if (f.status === "insufficient") return `${prefix}${cap(subject)}: not enough posts yet (n = ${f.n} vs ${f.restN}, need ${f.minN} each).`;
  const r = f.viewsRatio!;
  const n = `(n = ${f.n} vs ${f.restN})`;
  if (f.direction === "same") return `${prefix}${cap(subject)} got about the same median views${vs} (${fmtRatio(r)}, n = ${f.n} vs ${f.restN}).`;
  return `${prefix}${cap(subject)} got ${f.direction === "down" ? "only " : ""}${fmtRatio(r)} the median views${vs} ${n}.`;
}

function compare(platform: Platform, dimension: FindingDimension, group: string, xs: AccountPostRecord[], rest: AccountPostRecord[]): Finding {
  const views = (ps: AccountPostRecord[]) => ps.map((p) => p.metrics!.views!);
  const ers = (ps: AccountPostRecord[]) => ps.map((p) => accountEngagementRate(p.metrics)).filter((x): x is number => x !== null);
  const status = xs.length >= FINDING_MIN_N && rest.length >= FINDING_MIN_N ? "ok" : "insufficient";
  const mv = median(views(xs));
  const rmv = median(views(rest));
  const me = median(ers(xs));
  const rme = median(ers(rest));
  const viewsRatio = mv !== null && rmv ? mv / rmv : null;
  const direction = status !== "ok" || viewsRatio === null ? null : viewsRatio >= FINDING_UP ? "up" : viewsRatio <= FINDING_DOWN ? "down" : "same";
  const base: Omit<Finding, "text"> = {
    key: `${platform}:${dimension}:${group}`,
    platform,
    dimension,
    group,
    status: status === "ok" && viewsRatio === null ? "insufficient" : status,
    n: xs.length,
    restN: rest.length,
    minN: FINDING_MIN_N,
    metric: "median views",
    medianViews: mv,
    restMedianViews: rmv,
    viewsRatio,
    medianEr: me,
    restMedianEr: rme,
    erRatio: me !== null && rme ? me / rme : null,
    direction,
  };
  return { ...base, text: sentence(base) };
}

export interface FindingsOptions {
  /** The creator's zone (TZ_CREATOR) for posting-hour buckets. Never printed. */
  timeZone: string;
  /** Limit to one platform (the platform page); "by platform" is skipped then. */
  platform?: Platform;
}

/**
 * Every group finding, in a stable order (dimension, platform, group). Only posts with a views number
 * count. "other" pillar/hook and unknown duration are not groups of their own (they stay in the rest).
 */
export function buildFindings(posts: AccountPostRecord[], opts: FindingsOptions): Finding[] {
  const withViews = posts.filter((p) => p.metrics?.views != null && (!opts.platform || p.platform === opts.platform));
  const platforms = [...new Set(withViews.map((p) => p.platform))].sort();
  const out: Finding[] = [];

  if (!opts.platform && platforms.length > 1) {
    for (const pl of platforms) out.push(compare(pl, "platform", pl, withViews.filter((p) => p.platform === pl), withViews.filter((p) => p.platform !== pl)));
  }
  const dims: Array<[FindingDimension, (p: AccountPostRecord) => string[]]> = [
    ["pillar", (p) => [pillarOf(p)].filter((g) => g !== "other" && g !== "unsorted")],
    ["duration", (p) => [lengthBucket(p.durationS)].filter((g) => g !== "unknown")],
    ["hour", (p) => [timeBucket(localHour(p.publishedAt, opts.timeZone))]],
    ["hook", (p) => {
      const h = hookText(p);
      return h ? classifyHook(h).filter((t) => t !== "other") : [];
    }],
  ];
  for (const [dim, groupsOf] of dims) {
    for (const pl of platforms) {
      const mine = withViews.filter((p) => p.platform === pl);
      const byGroup = new Map<string, Set<AccountPostRecord>>();
      for (const p of mine) for (const g of groupsOf(p)) (byGroup.get(g) ?? byGroup.set(g, new Set()).get(g)!).add(p);
      for (const g of [...byGroup.keys()].sort()) {
        const set = byGroup.get(g)!;
        out.push(compare(pl, dim, g, [...set], mine.filter((p) => !set.has(p))));
      }
    }
  }
  return out;
}

/**
 * What a "What worked" card shows: up to `max` ok findings, real differences first (strongest ratio),
 * then "about the same" ones; then up to FINDINGS_INSUFFICIENT_MAX insufficient ones (largest n first)
 * so the UI can say "not enough posts yet".
 */
export function selectFindings(findings: Finding[], max = FINDINGS_MAX): Finding[] {
  const strength = (f: Finding) => Math.abs(Math.log(f.viewsRatio ?? 1));
  const ok = findings.filter((f) => f.status === "ok");
  const notable = ok.filter((f) => f.direction !== "same").sort((a, b) => strength(b) - strength(a) || b.n - a.n || a.key.localeCompare(b.key));
  const same = ok.filter((f) => f.direction === "same").sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  const insufficient = findings
    .filter((f) => f.status === "insufficient" && f.n > 0)
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
    .slice(0, FINDINGS_INSUFFICIENT_MAX);
  return [...[...notable, ...same].slice(0, max), ...insufficient];
}

// ---------------------------------------------------------------- per-day view gains

/**
 * Views gained per local day for each post, from snapshot differences: the first snapshot's views go
 * to the publish day (also when it's the only one); each later snapshot adds max(0, Δ) on its capture
 * day. Snapshots without a views number are skipped. Returns postId → (YYYY-MM-DD → views).
 */
export function viewGainsByDay(
  posts: Array<Pick<AccountPostRecord, "id" | "publishedAt">>,
  snapshots: AccountSnapshotRow[],
  timeZone: string,
): Map<string, Map<string, number>> {
  const byPost = new Map<string, AccountSnapshotRow[]>();
  for (const s of snapshots) if (s.views !== null) (byPost.get(s.accountPostId) ?? byPost.set(s.accountPostId, []).get(s.accountPostId)!).push(s);
  const out = new Map<string, Map<string, number>>();
  for (const p of posts) {
    const snaps = (byPost.get(p.id) ?? []).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    if (!snaps.length) continue;
    const days = new Map<string, number>();
    const add = (day: string, v: number) => days.set(day, (days.get(day) ?? 0) + v);
    add(localDate(new Date(p.publishedAt), timeZone), snaps[0]!.views!);
    for (let i = 1; i < snaps.length; i++) {
      const d = snaps[i]!.views! - snaps[i - 1]!.views!;
      if (d > 0) add(localDate(new Date(snaps[i]!.capturedAt), timeZone), d);
    }
    out.set(p.id, days);
  }
  return out;
}
