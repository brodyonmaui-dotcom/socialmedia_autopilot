/**
 * F26 stream B: the hashtag bank. Niche sets per caption group + a few broad tags, picked deterministically per post.
 * Instagram 3-5 (hard max 5), TikTok 3-5, YouTube 2-3 including #shorts (YouTube shows 3, ignores all above 60).
 * Never the same set as one of the platform's last posts (`recentSets`). Hashtags live in the caption tail.
 * Tags are from the creator's real set (docs/voice.md) plus close neighbours; no brand tags, no place tags.
 */
import type { CaptionGroup } from "./caption-templates.js";
import type { Platform } from "./types.js";

export const NICHE_HASHTAGS: Record<CaptionGroup, readonly string[]> = {
  // gym / hypertrophy + physique
  gym: ["gym", "gymbro", "hypertrophy", "physique", "bodybuilding", "weightlifting", "lifting", "gymlife", "strengthtraining", "musclebuilding", "discipline", "collegefitness"],
  running: ["running", "runner", "runningmotivation", "cardio", "easyrun", "runningcommunity", "collegefitness", "discipline", "slowrun", "dailyrun"],
  // meal prep
  meal: ["mealprep", "highproteinmeals", "fulldayofeating", "proteinmeals", "mealprepideas", "collegefitness", "healthyeating", "easymeals", "cuttingmeals", "bulkingmeals"],
  // lifestyle / discipline / college
  lifestyle: ["discipline", "collegefitness", "collegelife", "dayinmylife", "gym", "consistency", "habits", "studentlife", "routine", "selfimprovement"],
};

/** Broad tags: allowed, but never the only tags (the judge wants at least one niche tag). */
export const BROAD_HASHTAGS: readonly string[] = ["fitness", "fitnessmotivation", "workout", "motivation", "lifestyle", "health", "fyp", "shorts", "reels"];

const h32 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

export const normTag = (t: string): string => t.replace(/^#/, "").toLowerCase();
/** Order-insensitive identity of a tag set. */
export const tagSetKey = (tags: readonly string[]): string => [...new Set(tags.map(normTag))].sort().join(" ");

/** Hashtags (with `#`) found in a text. */
export function extractHashtags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Deterministic: same (group, platform, seed, recentSets) gives the same tags. Returns lowercase `#tags`.
 * `recentSets` = the tag sets of the platform's last posts; only the newest 5 matter.
 */
export function pickHashtags(group: CaptionGroup, platform: Platform, seed: string, recentSets: ReadonlyArray<readonly string[]> = []): string[] {
  const avoid = new Set(recentSets.slice(0, 5).map(tagSetKey));
  const niche = NICHE_HASHTAGS[group];
  const broad = BROAD_HASHTAGS.filter((b) => b !== "shorts" && b !== "reels" && b !== "fyp");
  let last: string[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const base = `${seed}|${platform}|${attempt}`;
    const total = platform === "youtube" ? 2 + (h32(base + "n") % 2) : platform === "snapchat" ? 1 + (h32(base + "n") % 2) : 3 + (h32(base + "n") % 3);
    const wantShorts = platform === "youtube";
    const wantBroad = platform === "snapchat" ? 0 : total >= 4 ? 1 : h32(base + "b") % 3 === 0 ? 1 : 0;
    const nicheCount = Math.max(1, total - (wantShorts ? 1 : 0) - wantBroad);
    const ranked = [...niche].sort((a, b) => h32(`${base}|${a}`) - h32(`${base}|${b}`)).slice(0, nicheCount);
    const picked = [...ranked];
    if (wantBroad) picked.push([...broad].sort((a, b) => h32(`${base}|${a}`) - h32(`${base}|${b}`))[0]!);
    if (wantShorts) picked.push("shorts");
    last = picked.map((t) => `#${t}`);
    if (!avoid.has(tagSetKey(last))) return last;
  }
  return last;
}
