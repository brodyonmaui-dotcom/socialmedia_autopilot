import type { CreatorSnapshot, SnapshotPost } from "../brief.js";
import { hookLine } from "./hook-line.js";

export interface RankedMedia {
  creatorId: string;
  post: SnapshotPost;
  /** Cleaned, privacy-linted first line (never null here: posts without one can't become ideas). */
  hookLine: string;
  /** (likes + comments) / this creator's median over the fetched window. */
  ratio: number;
  /** ratio × recency weight; what the top-N is picked by. */
  score: number;
}

export interface RankOptions {
  now?: Date;
  /** Media ids already turned into ideas (skipped). */
  exclude?: ReadonlySet<string>;
  /** Kept per creator per run (default 3). */
  top?: number;
  /** Only media at least this many × their usual engagement count as "working" (default 1.25). */
  minRatio?: number;
  /** Recency half-life in days (default 14): a post 14 days old weighs half as much as one from today. */
  halfLifeDays?: number;
  blocklist?: string[];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export const engagementOf = (p: Pick<SnapshotPost, "likes" | "comments">): number | null => (p.likes === null ? null : p.likes + p.comments);

/**
 * One creator's snapshot → their best recent posts, relative to their own usual (so a small creator's
 * breakout counts as much as a big one's). Posts with hidden likes are left out of both the median and
 * the ranking (we never estimate). Deterministic: ties break by recency, then id.
 */
export function rankMedia(snapshot: CreatorSnapshot, opts: RankOptions = {}): RankedMedia[] {
  const now = (opts.now ?? new Date()).getTime();
  const halfLife = opts.halfLifeDays ?? 14;
  const minRatio = opts.minRatio ?? 1.25;
  const counted = snapshot.posts.filter((p) => engagementOf(p) !== null && Number.isFinite(Date.parse(p.postedAt)));
  const med = median(counted.map((p) => engagementOf(p)!));
  if (med === null || med <= 0) return [];
  const out: RankedMedia[] = [];
  for (const post of counted) {
    if (opts.exclude?.has(post.id)) continue;
    const ratio = engagementOf(post)! / med;
    if (ratio < minRatio) continue;
    const line = hookLine(post.caption, opts.blocklist);
    if (!line) continue;
    const ageDays = Math.max(0, (now - Date.parse(post.postedAt)) / 86_400_000);
    const score = ratio * Math.pow(0.5, ageDays / halfLife);
    out.push({ creatorId: snapshot.creatorId, post, hookLine: line, ratio, score });
  }
  out.sort((a, b) => b.score - a.score || b.post.postedAt.localeCompare(a.post.postedAt) || a.post.id.localeCompare(b.post.id));
  return out.slice(0, opts.top ?? 3);
}
