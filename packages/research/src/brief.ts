import type { Platform } from "@autopilot/core";
import type { Creator, Pillar } from "./types.js";
import { lintText } from "./voice-lint.js";

/**
 * One creator's recent public posts, already normalized. The fetcher that fills this from
 * Instagram Business Discovery is NOT built yet: research.md confirms Business Discovery works
 * at Standard Access, but doesn't record the field list, so the mapping is a stub (see
 * fetchCreatorSnapshot) until a day session verifies it against the official docs.
 */
export interface SnapshotPost {
  id: string;
  caption: string;
  likes: number;
  comments: number;
  views: number | null;
  mediaType: "reel" | "video" | "image" | "carousel";
  postedAt: string;
}
export interface CreatorSnapshot {
  creatorId: string;
  followers: number | null;
  posts: SnapshotPost[];
}

export type HookPattern = "question" | "number" | "contrarian" | "pov" | "how-why" | "list" | "story" | "deadpan" | "other";

export function classifyHook(hook: string): HookPattern[] {
  const h = hook.trim();
  const tags: HookPattern[] = [];
  if (/\?\s*\S{0,3}$/u.test(h)) tags.push("question");
  if (/\b\d+\s+(things|tips|ways|mistakes|exercises|meals|rules|reasons)\b/i.test(h)) tags.push("list");
  else if (/\d/.test(h)) tags.push("number");
  if (/^(most people|stop\b|you don'?t need|nobody|unpopular opinion|don'?t)/i.test(h)) tags.push("contrarian");
  if (/^pov\b/i.test(h)) tags.push("pov");
  if (/^(how (i|to)|why\b)/i.test(h)) tags.push("how-why");
  if (/^(i\b|i'm\b|my\b|today\b|yesterday\b)/i.test(h)) tags.push("story");
  if (/(…|\.\.)\s*\S{0,3}$/u.test(h)) tags.push("deadpan");
  return tags.length ? tags : ["other"];
}

export function firstLine(caption: string): string {
  const line = caption.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const clean = line.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim();
  return [...clean].length > 120 ? [...clean].slice(0, 117).join("") + "..." : clean;
}

export interface BriefPost {
  creatorHandle: string;
  platform: Platform;
  pillar: Pillar | null;
  hook: string;
  patterns: HookPattern[];
  /** (likes + comments) / followers; null when follower count is unknown. */
  engagementRate: number | null;
  postedAt: string;
}

export interface ResearchBrief {
  generatedAt: string;
  windowDays: number;
  creatorsCovered: number;
  creatorsSkipped: number;
  postsConsidered: number;
  /** Hooks dropped because they named a place or real-time whereabouts (location boundary). */
  droppedForPrivacy: number;
  topPosts: BriefPost[];
  patternCounts: Record<HookPattern, number>;
  byPillar: Array<{ pillar: Pillar | "unsorted"; posts: number; medianEngagementRate: number | null }>;
  markdown: string;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

export interface BriefOptions {
  now?: Date;
  windowDays?: number;
  top?: number;
  blocklist?: string[];
}

export function buildResearchBrief(creators: Creator[], snapshots: CreatorSnapshot[], opts: BriefOptions = {}): ResearchBrief {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? 14;
  const since = now.getTime() - windowDays * 86_400_000;
  const snapById = new Map(snapshots.map((s) => [s.creatorId, s]));

  let creatorsCovered = 0;
  let creatorsSkipped = 0;
  let droppedForPrivacy = 0;
  const posts: BriefPost[] = [];

  for (const c of creators) {
    const snap = snapById.get(c.id);
    if (!c.active || !snap) {
      creatorsSkipped++;
      continue;
    }
    creatorsCovered++;
    const followers = snap.followers ?? c.followers;
    for (const p of snap.posts) {
      const t = Date.parse(p.postedAt);
      if (!Number.isFinite(t) || t < since || t > now.getTime()) continue;
      const hook = firstLine(p.caption);
      if (!hook) continue;
      const lint = lintText({ text: hook, kind: "hook", blocklist: opts.blocklist });
      if (lint.issues.some((i) => i.rule.startsWith("privacy."))) {
        droppedForPrivacy++;
        continue;
      }
      posts.push({
        creatorHandle: c.handle,
        platform: c.platform,
        pillar: c.pillar,
        hook,
        patterns: classifyHook(hook),
        engagementRate: followers && followers > 0 ? (p.likes + p.comments) / followers : null,
        postedAt: p.postedAt,
      });
    }
  }

  // Unknown engagement sorts last; ties break by recency so output is deterministic.
  posts.sort((a, b) => (b.engagementRate ?? -1) - (a.engagementRate ?? -1) || b.postedAt.localeCompare(a.postedAt));
  const topPosts = posts.slice(0, opts.top ?? 10);

  const patternCounts = { question: 0, number: 0, contrarian: 0, pov: 0, "how-why": 0, list: 0, story: 0, deadpan: 0, other: 0 } as Record<HookPattern, number>;
  for (const p of topPosts) for (const tag of p.patterns) patternCounts[tag]++;

  const pillarMap = new Map<Pillar | "unsorted", number[]>();
  const pillarPosts = new Map<Pillar | "unsorted", number>();
  for (const p of posts) {
    const k = p.pillar ?? "unsorted";
    pillarPosts.set(k, (pillarPosts.get(k) ?? 0) + 1);
    if (p.engagementRate !== null) pillarMap.set(k, [...(pillarMap.get(k) ?? []), p.engagementRate]);
  }
  const byPillar = [...pillarPosts.entries()]
    .map(([pillar, n]) => ({ pillar, posts: n, medianEngagementRate: median(pillarMap.get(pillar) ?? []) }))
    .sort((a, b) => b.posts - a.posts || String(a.pillar).localeCompare(String(b.pillar)));

  const lines = [
    `# Research brief (${now.toISOString().slice(0, 10)}, last ${windowDays} days)`,
    "",
    `${creatorsCovered} creator(s) covered, ${creatorsSkipped} skipped, ${posts.length} post(s) considered, ${droppedForPrivacy} hook(s) dropped for privacy.`,
    "",
    "## Top hooks",
    ...(topPosts.length
      ? topPosts.map((p, i) => `${i + 1}. "${p.hook}" (@${p.creatorHandle}, ${p.pillar ?? "unsorted"}, ER ${pct(p.engagementRate)}, ${p.patterns.join("+")})`)
      : ["(none in this window)"]),
    "",
    "## Hook patterns in the top posts",
    ...Object.entries(patternCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## By pillar",
    ...byPillar.map((b) => `- ${b.pillar}: ${b.posts} post(s), median ER ${pct(b.medianEngagementRate)}`),
    "",
    "Use these as patterns, not copies: rewrite in his voice (docs/voice.md), never reuse another creator's line verbatim.",
  ];

  return {
    generatedAt: now.toISOString(),
    windowDays,
    creatorsCovered,
    creatorsSkipped,
    postsConsidered: posts.length,
    droppedForPrivacy,
    topPosts,
    patternCounts,
    byPillar,
    markdown: lines.join("\n") + "\n",
  };
}

/**
 * Stub: Business Discovery fetch. Not implemented until the field list is verified against
 * Meta's docs and recorded in docs/research.md (needsAttention in the night log). Use
 * fixtures/manual snapshots meanwhile.
 */
export async function fetchCreatorSnapshot(_creator: Creator): Promise<CreatorSnapshot> {
  throw new Error("fetchCreatorSnapshot: Business Discovery mapping not verified yet (see docs/research.md); use --fixture");
}
