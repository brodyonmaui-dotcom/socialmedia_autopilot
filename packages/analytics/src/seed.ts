import type { Platform } from "@autopilot/core";
import type { PostRecord } from "./types.js";

/**
 * Deterministic synthetic posts for demos (skill --demo, the analytics page without data).
 * Invented numbers; never shown as real. Built-in "truth": gym deadpan one-liners and short
 * clips do better, trading posts do worse, so the report has something to find.
 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const CAPTIONS: Record<string, string[]> = {
  gym: ["My lats are not a fan of this pull day…", "Just stacking days is all 🙂‍↕️…", "Definitely due for a deload…"],
  trading: ["November P/L +$120, took the 1:1R. Not financial advice.", "Welp, I was the liquidity today 🥀"],
  meal: ["Weekly Meal Prep 🥣\nKeeping it simple, high protein, and consistent."],
  tip: ["Most people don't need more back days. They need better reps.", "Why your bench stalls?"],
};

export function syntheticPosts(opts: { weekStart: string; weeks?: number; seed?: number }): PostRecord[] {
  const rnd = lcg(opts.seed ?? 7);
  const weeks = opts.weeks ?? 4;
  const end = Date.parse(opts.weekStart + "T00:00:00Z") + 7 * 86_400_000;
  const start = end - weeks * 7 * 86_400_000;
  const platforms: Platform[] = ["instagram", "youtube", "tiktok"];
  const pillars = Object.keys(CAPTIONS);
  const posts: PostRecord[] = [];
  let n = 0;
  for (let t = start; t < end; t += 86_400_000) {
    for (let k = 0; k < 2; k++) {
      const pillar = pillars[Math.floor(rnd() * pillars.length)]!;
      const caps = CAPTIONS[pillar]!;
      const caption = caps[Math.floor(rnd() * caps.length)]!;
      const durationS = Math.round(8 + rnd() * 70);
      const hourUtc = k === 0 ? 16 : 23;
      for (const platform of platforms) {
        const isTrial = platform === "instagram" && k === 0;
        let base = platform === "tiktok" ? 900 : platform === "youtube" ? 500 : 300;
        if (pillar === "gym") base *= 1.8;
        if (pillar === "trading") base *= 0.6;
        if (durationS < 15) base *= 1.4;
        if (isTrial) base *= 1.2;
        const views = Math.round(base * (0.7 + rnd() * 0.6));
        const postedAt = new Date(t + hourUtc * 3_600_000).toISOString();
        const recent = end - Date.parse(postedAt) < 2 * 86_400_000;
        posts.push({
          batchItemId: `demo-${++n}`,
          platform,
          pillar,
          caption,
          durationS,
          postedAt,
          isTrial,
          trialSharedAt: isTrial && !recent && rnd() < 0.5 ? postedAt : null,
          metrics: {
            views,
            reach: Math.round(views * 0.8),
            likes: Math.round(views * (0.03 + rnd() * 0.04)),
            comments: Math.round(views * 0.004),
            saves: platform === "instagram" ? Math.round(views * 0.01) : null,
            shares: Math.round(views * 0.005),
            avgWatchTime: platform === "instagram" ? Math.round(3000 + rnd() * 4000) : null,
            skipRate: platform === "instagram" ? Math.round(30 + rnd() * 30) : null,
          },
          capturedAt: new Date(end).toISOString(),
        });
      }
    }
  }
  return posts;
}
