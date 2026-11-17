import type { Platform } from "@autopilot/core";
import type { MatchedBy } from "./account-types.js";
import { stripMentions } from "./sources/common.js";

/**
 * Links an account post to the app item that produced it (pure). Order:
 *  1. same platform_post_id as a batch item            → 'id'
 *  2. same platform, normalised caption/title equal, published within ±36 h of scheduled_for → 'caption'
 *  3. otherwise unmatched (posted by hand)             → null
 * An existing 'id' match is never replaced by a caption match (or dropped).
 */
export const CAPTION_MATCH_WINDOW_MS = 36 * 3_600_000;

export interface MatchCandidate {
  batchItemId: string;
  platform: Platform;
  platformPostId: string | null;
  caption: string | null;
  title: string | null;
  scheduledFor: string;
}

export interface MatchInput {
  platform: Platform;
  platformPostId: string;
  caption: string | null;
  title: string | null;
  publishedAt: string;
}

export interface MatchResult {
  batchItemId: string | null;
  matchedBy: MatchedBy | null;
}

/** NFC, @handles masked (same rule as storage), hashtags kept, whitespace collapsed, lower-cased. */
export function normaliseText(s: string | null | undefined): string {
  if (!s) return "";
  return stripMentions(s.normalize("NFC")).replace(/\s+/gu, " ").trim().toLowerCase();
}

/** The texts an app item can show up as: caption, title, and the YouTube fallback title (caption's first line, 60 chars). */
function itemTexts(c: MatchCandidate): string[] {
  const out = [c.caption, c.title];
  if (c.platform === "youtube" && !c.title && c.caption) out.push(c.caption.split("\n")[0]!.slice(0, 60));
  return [...new Set(out.map(normaliseText).filter(Boolean))];
}

export function matchAccountPost(post: MatchInput, candidates: MatchCandidate[], existing?: MatchResult | null): MatchResult {
  if (existing?.matchedBy === "id" && existing.batchItemId) return existing;
  const byId = candidates.find((c) => c.platform === post.platform && c.platformPostId === post.platformPostId);
  if (byId) return { batchItemId: byId.batchItemId, matchedBy: "id" };
  if (existing?.matchedBy === "caption" && existing.batchItemId) return existing;

  const texts = new Set([normaliseText(post.caption), normaliseText(post.title)].filter(Boolean));
  if (!texts.size) return { batchItemId: null, matchedBy: null };
  const at = Date.parse(post.publishedAt);
  let best: { c: MatchCandidate; d: number } | null = null;
  for (const c of candidates) {
    if (c.platform !== post.platform) continue;
    // An item that already has its own post id belongs to that post, not to this one.
    if (c.platformPostId && c.platformPostId !== post.platformPostId) continue;
    const d = Math.abs(at - Date.parse(c.scheduledFor));
    if (!(d <= CAPTION_MATCH_WINDOW_MS)) continue;
    if (!itemTexts(c).some((t) => texts.has(t))) continue;
    if (!best || d < best.d || (d === best.d && c.batchItemId < best.c.batchItemId)) best = { c, d };
  }
  return best ? { batchItemId: best.c.batchItemId, matchedBy: "caption" } : { batchItemId: null, matchedBy: null };
}

/**
 * Matches a run's posts in one go: an item is claimed by at most one post (id matches first, then the
 * closest caption match), so two identical captions don't both land on one item.
 */
export function matchAccountPosts(posts: MatchInput[], candidates: MatchCandidate[], existing: Map<string, MatchResult> = new Map()): MatchResult[] {
  const claimed = new Set<string>();
  const out: MatchResult[] = posts.map(() => ({ batchItemId: null, matchedBy: null }));
  // Pass 1: id matches (incl. kept ones).
  posts.forEach((p, i) => {
    const prev = existing.get(p.platformPostId) ?? null;
    const r = matchAccountPost(p, candidates, prev?.matchedBy === "id" ? prev : null);
    if (r.matchedBy === "id" && r.batchItemId) {
      out[i] = r;
      claimed.add(r.batchItemId);
    }
  });
  // Pass 2: caption matches over the remaining items.
  posts.forEach((p, i) => {
    if (out[i]!.matchedBy === "id") return;
    const prev = existing.get(p.platformPostId) ?? null;
    if (prev?.matchedBy === "caption" && prev.batchItemId && !claimed.has(prev.batchItemId)) {
      out[i] = prev;
      claimed.add(prev.batchItemId);
      return;
    }
    const r = matchAccountPost(p, candidates.filter((c) => !claimed.has(c.batchItemId)), null);
    if (r.batchItemId) claimed.add(r.batchItemId);
    out[i] = r;
  });
  return out;
}
