import { engagementRate, median } from "./stats.js";
import type { PostRecord } from "./types.js";

/**
 * Trial-share recommendations (decisions.md #5: MANUAL by default — the report recommends, he
 * taps "share" in the Instagram app). Conservative on purpose: "share" needs the trial to beat
 * his own regular-reel baseline on views AND not lose on engagement/skip rate; anything uncertain
 * is "wait". Thresholds are product calls (listed in the PR), not platform facts.
 */
export type TrialVerdict = "share" | "wait" | "dont-share";
export interface TrialRecommendation {
  batchItemId: string;
  caption: string;
  postedAt: string;
  ageHours: number;
  verdict: TrialVerdict;
  reason: string;
  views: number | null;
  /** views / baseline median views. */
  viewsVsBaseline: number | null;
}

export const TRIAL_RULES = {
  /** Too early to judge before this. */
  minAgeHours: 24,
  /** After this, a clearly weak trial gets "don't share". */
  decideByHours: 72,
  /** Regular reels needed in the baseline before any trial gets a verdict. */
  minBaseline: 3,
  /** Baseline window. */
  baselineDays: 28,
  weakRatio: 0.5,
  /** Older unshared trials drop off the list (counted, not shown): sharing a stale trial isn't the point. */
  listDays: 14,
} as const;

export function recommendTrialShares(
  posts: PostRecord[],
  now = new Date(),
): { baselineN: number; olderUnshared: number; recommendations: TrialRecommendation[] } {
  const since = now.getTime() - TRIAL_RULES.baselineDays * 86_400_000;
  const regular = posts.filter(
    (p) => p.platform === "instagram" && !p.isTrial && p.metrics.views !== null && Date.parse(p.postedAt) >= since && Date.parse(p.postedAt) <= now.getTime(),
  );
  const baseViews = median(regular.map((p) => p.metrics.views!));
  const baseEr = median(regular.map((p) => engagementRate(p.metrics)).filter((x): x is number => x !== null));
  const baseSkip = median(regular.map((p) => p.metrics.skipRate).filter((x): x is number => x !== null));

  const listFrom = now.getTime() - TRIAL_RULES.listDays * 86_400_000;
  const unshared = posts.filter((p) => p.platform === "instagram" && p.isTrial && !p.trialSharedAt && Date.parse(p.postedAt) <= now.getTime());
  const trials = unshared.filter((p) => Date.parse(p.postedAt) >= listFrom).sort((a, b) => a.postedAt.localeCompare(b.postedAt));

  const recommendations = trials.map((t): TrialRecommendation => {
    const ageHours = Math.floor((now.getTime() - Date.parse(t.postedAt)) / 3_600_000);
    const views = t.metrics.views;
    const ratio = views !== null && baseViews ? views / baseViews : null;
    const base = { batchItemId: t.batchItemId, caption: t.caption, postedAt: t.postedAt, ageHours, views, viewsVsBaseline: ratio };
    const say = (verdict: TrialVerdict, reason: string) => ({ ...base, verdict, reason });

    if (ageHours < TRIAL_RULES.minAgeHours) return say("wait", `only ${ageHours} h old; check after ${TRIAL_RULES.minAgeHours} h`);
    if (views === null) return say("wait", "no trial insights yet (whether the API returns them is still open in research.md); check views in the app");
    if (regular.length < TRIAL_RULES.minBaseline || !baseViews) {
      return say("wait", `not enough regular reels to compare (n=${regular.length}, need ${TRIAL_RULES.minBaseline})`);
    }
    const er = engagementRate(t.metrics);
    const erOk = er === null || baseEr === null || er >= baseEr;
    const skipOk = t.metrics.skipRate === null || baseSkip === null || t.metrics.skipRate <= baseSkip;
    if (ratio! >= 1 && erOk && skipOk) {
      return say("share", `views ${ratio!.toFixed(2)}× your regular-reel median (n=${regular.length}), engagement and skip rate hold up`);
    }
    if (ageHours >= TRIAL_RULES.decideByHours && ratio! < TRIAL_RULES.weakRatio) {
      return say("dont-share", `after ${ageHours} h, views are ${ratio!.toFixed(2)}× your regular-reel median (n=${regular.length})`);
    }
    if (ratio! >= 1) return say("wait", `views ${ratio!.toFixed(2)}× median but ${!erOk ? "engagement" : "skip rate"} is worse than usual`);
    return say("wait", `views ${ratio!.toFixed(2)}× your regular-reel median so far (n=${regular.length})`);
  });

  return { baselineN: regular.length, olderUnshared: unshared.length - trials.length, recommendations };
}
