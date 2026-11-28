/**
 * F26 stream B: the pre-publish judge. Pure: no I/O, no clock. Scores one post (caption/title, hashtags, duration,
 * similarity to recent posts, the duplicate-video verdict from stream A) and says what to fix.
 * Platform facts (docs/research.md, 2026-11-28): Instagram <= 5 hashtags (hard); YouTube shows 3 and ignores all above 60;
 * Instagram and TikTok rank repeated content lower [INF for TikTok hashtags: nothing official].
 */
import { BROAD_HASHTAGS, extractHashtags, normTag, tagSetKey } from "./hashtags.js";
import { maxSimilarity, SIMILAR_BLOCK, SIMILAR_WARN } from "./caption-compose.js";
import type { Platform } from "./types.js";

export type JudgeLevel = "pass" | "warn" | "block";
export interface JudgeCheck {
  id: string;
  level: JudgeLevel;
  message: string;
  fix?: string;
}
export interface JudgeResult {
  /** 0-100: 100 minus 40 per block and 10 per warn. */
  score: number;
  checks: JudgeCheck[];
}

/** Optional location/voice lint, injected so core stays free of the research package (pass `lintText` there). */
export type JudgeLint = (text: string, kind: "caption" | "title") => Array<{ severity: "error" | "warn"; message: string }>;

export interface JudgeInput {
  platform: Platform;
  caption: string;
  title?: string | null;
  durationS?: number | null;
  recent?: { captions?: readonly string[]; hashtagSets?: ReadonlyArray<readonly string[]> };
  duplicate?: { level: "pass" | "warn" | "block"; message: string } | null;
  lint?: JudgeLint;
}

export const JUDGE_LIMITS = {
  caption: { instagram: 2200, tiktok: 2200, youtube: 5000, snapchat: 250 } as Record<Platform, number>,
  youtubeTitle: 100,
  hookLine: 125,
  /** [INF] seconds; outside = warn. Reels/Shorts up to 3 min, TikTok API posts up to 10 min but short clips are the plan. */
  duration: { instagram: { min: 3, max: 180 }, tiktok: { min: 3, max: 180 }, youtube: { min: 1, max: 180 }, snapchat: { min: 5, max: 60 } } as Record<Platform, { min: number; max: number }>,
  igHashtags: 5,
  ytHashtagsShown: 3,
  ytHashtagsIgnoredAbove: 60,
};

const BROAD = new Set(BROAD_HASHTAGS);
const pass = (id: string, message: string): JudgeCheck => ({ id, level: "pass", message });

export function judgePost(input: JudgeInput): JudgeResult {
  const { platform } = input;
  const caption = input.caption ?? "";
  const title = (input.title ?? "").trim();
  const recentCaps = input.recent?.captions ?? [];
  const recentSets = input.recent?.hashtagSets ?? [];
  const checks: JudgeCheck[] = [];
  const tags = [...extractHashtags(caption), ...(platform === "youtube" ? extractHashtags(title) : [])].map(normTag);
  const unique = [...new Set(tags)];

  // caption present
  if (platform !== "snapchat" && caption.trim() === "") checks.push({ id: "caption.empty", level: "block", message: "The caption is empty.", fix: "Write a caption or recompose it." });
  else checks.push(pass("caption.empty", "Has a caption."));

  // hashtag limits
  if (platform === "instagram") {
    checks.push(unique.length > JUDGE_LIMITS.igHashtags
      ? { id: "hashtags.limit", level: "block", message: `${unique.length} hashtags: Instagram allows 5.`, fix: "Cut to 5 or fewer." }
      : pass("hashtags.limit", `${unique.length} hashtags (max 5).`));
  } else if (platform === "youtube") {
    checks.push(unique.length > JUDGE_LIMITS.ytHashtagsIgnoredAbove
      ? { id: "hashtags.limit", level: "block", message: `${unique.length} hashtags: YouTube ignores all of them above 60.`, fix: "Use 3 or fewer." }
      : unique.length > JUDGE_LIMITS.ytHashtagsShown
        ? { id: "hashtags.limit", level: "warn", message: `${unique.length} hashtags: YouTube only shows 3.`, fix: "Use 3 or fewer." }
        : pass("hashtags.limit", `${unique.length} hashtags (YouTube shows 3).`));
  } else if (platform === "tiktok") {
    checks.push(unique.length > 5 ? { id: "hashtags.limit", level: "warn", message: `${unique.length} hashtags: 3-5 is the plan for TikTok.`, fix: "Trim to 5." } : pass("hashtags.limit", `${unique.length} hashtags.`));
  }

  // at least one niche tag
  if (platform !== "snapchat" && caption.trim() !== "") {
    const niche = unique.filter((t) => !BROAD.has(t));
    checks.push(niche.length === 0 ? { id: "hashtags.niche", level: "warn", message: "No niche hashtag (only broad or none).", fix: "Add one topic tag, e.g. #gym or #mealprep." } : pass("hashtags.niche", "Has a niche hashtag."));
  }

  // same set as a recent post
  if (unique.length > 0) {
    const key = tagSetKey(unique);
    const same = recentSets.slice(0, 5).some((s) => tagSetKey(s) === key);
    checks.push(same ? { id: "hashtags.repeat", level: "warn", message: "Same hashtag set as one of the last 5 posts.", fix: "Swap a tag or two." } : pass("hashtags.repeat", "Hashtag set is fresh."));
  }

  // near-duplicate of recent captions
  if (caption.trim() !== "") {
    const sim = maxSimilarity(caption, recentCaps);
    checks.push(sim >= SIMILAR_BLOCK
      ? { id: "caption.similar", level: "block", message: `Almost the same words as a recent post (${Math.round(sim * 100)}% match).`, fix: "Recompose the caption." }
      : sim >= SIMILAR_WARN
        ? { id: "caption.similar", level: "warn", message: `Very close to a recent caption (${Math.round(sim * 100)}% match).`, fix: "Recompose the caption." }
        : pass("caption.similar", "Caption is different from recent posts."));
  }

  // first line works alone
  if (caption.trim() !== "") {
    const first = caption.split(/\r?\n/).find((l) => l.trim()) ?? "";
    checks.push([...first].length > JUDGE_LIMITS.hookLine ? { id: "caption.hook", level: "warn", message: `First line is ${[...first].length} characters; it gets cut in the feed after about 125.`, fix: "Shorten the first line." } : pass("caption.hook", "First line fits."));
  }

  // length limits
  const max = JUDGE_LIMITS.caption[platform];
  checks.push([...caption].length > max ? { id: "caption.length", level: "block", message: `Caption is ${[...caption].length} characters (max ${max}).`, fix: "Shorten it." } : pass("caption.length", "Caption length fits."));
  if (platform === "youtube") {
    if (title === "") checks.push({ id: "title.empty", level: "block", message: "The title is empty.", fix: "Write a title." });
    else checks.push([...title].length > JUDGE_LIMITS.youtubeTitle ? { id: "title.length", level: "block", message: `Title is ${[...title].length} characters (max 100).`, fix: "Shorten it." } : pass("title.length", "Title length fits."));
  }

  // duration
  const d = input.durationS;
  if (d != null && Number.isFinite(d)) {
    const b = JUDGE_LIMITS.duration[platform];
    checks.push(d < b.min || d > b.max ? { id: "duration", level: "warn", message: `Clip is ${d.toFixed(0)} s; ${platform} works best between ${b.min} and ${b.max} s.`, fix: "Trim or pick another clip." } : pass("duration", "Length is fine."));
  }

  // location / voice lint (injected)
  if (input.lint) {
    const found = [...(caption.trim() ? input.lint(caption, "caption") : []), ...(platform === "youtube" && title ? input.lint(title, "title") : [])];
    const err = found.find((f) => f.severity === "error");
    const warn = found.find((f) => f.severity === "warn");
    checks.push(err ? { id: "lint", level: "block", message: err.message } : warn ? { id: "lint", level: "warn", message: warn.message } : pass("lint", "Voice and location check passed."));
  }

  // duplicate video (stream A's verdict)
  if (input.duplicate) checks.push(input.duplicate.level === "pass" ? pass("duplicate", input.duplicate.message) : { id: "duplicate", level: input.duplicate.level, message: input.duplicate.message });

  return { score: scoreOf(checks), checks };
}

export function scoreOf(checks: readonly JudgeCheck[]): number {
  let s = 100;
  for (const c of checks) s -= c.level === "block" ? 40 : c.level === "warn" ? 10 : 0;
  return Math.max(0, s);
}

/** The shape of warnings.ts `Warning` (code reuses the existing lint codes, so no change to its type is needed). */
export interface JudgeWarning {
  code: "lint.error" | "lint.warn";
  severity: "block" | "warn";
  message: string;
  field?: "caption" | "title";
}

/** Checks warnings.ts does not already make (it covers empty caption/title, hashtag limits, lint, duplicates). */
const NEW_CHECKS = new Set(["hashtags.niche", "hashtags.repeat", "caption.similar", "caption.hook", "caption.length", "title.length", "duration"]);

/**
 * Judge findings (warn/block only) as warnings.ts warnings. Wiring, one line in the per-item loop of warnings.ts:
 *   ws.push(...judgeWarnings({ platform: item.platform, caption: item.caption, title: item.title, durationS: item.media.durationS, recent: { captions, hashtagSets } }));
 */
export function judgeWarnings(input: JudgeInput): JudgeWarning[] {
  const out: JudgeWarning[] = [];
  for (const c of judgePost({ ...input, duplicate: null, lint: undefined }).checks) {
    if (c.level === "pass" || !NEW_CHECKS.has(c.id)) continue;
    out.push({ code: c.level === "block" ? "lint.error" : "lint.warn", severity: c.level, message: c.fix ? `${c.message} ${c.fix}` : c.message, field: c.id.startsWith("title") ? "title" : "caption" });
  }
  return out;
}
