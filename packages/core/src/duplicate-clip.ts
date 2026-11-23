import type { Platform } from "./types.js";

/**
 * Duplicate-clip guard: the same clip (media_id) on the same platform twice. A clip counts as already
 * there when another non-rejected item for it on that platform (any status, any batch) is scheduled
 * within ±7 days of this one, or was published in the last 14 days. The SQL twin is
 * `duplicateClipSql` in @autopilot/db (built from these same constants); keep the two in step.
 */
export const DUPLICATE_CLIP_WINDOW = { scheduledDays: 7, publishedDays: 14 } as const;

const DAY_MS = 86_400_000;

export interface ClipTarget {
  /** The item itself, when it exists (so it never matches itself). */
  id?: string;
  mediaId: string;
  platform: Platform;
  /** ISO, or null when untimed (then only the published rule applies). */
  scheduledFor: string | null;
}

export interface ClipSibling {
  id: string;
  mediaId: string;
  platform: Platform;
  status: string;
  scheduledFor: string | null;
  /** When it went out: scheduled_for, else updated_at (the SQL twin uses the same coalesce). Only read when published. */
  publishedAt?: string | null;
}

const ms = (iso: string | null | undefined): number => (iso == null ? NaN : new Date(iso).getTime());

/** Pure: does `other` make `target` a duplicate clip post (see DUPLICATE_CLIP_WINDOW)? */
export function isDuplicateClip(target: ClipTarget, other: ClipSibling, now: Date): boolean {
  if (other.id === target.id || other.mediaId !== target.mediaId || other.platform !== target.platform || other.status === "rejected") return false;
  const at = ms(target.scheduledFor);
  const theirs = ms(other.scheduledFor);
  if (Number.isFinite(at) && Number.isFinite(theirs) && Math.abs(theirs - at) <= DUPLICATE_CLIP_WINDOW.scheduledDays * DAY_MS) return true;
  if (other.status === "published") {
    const out = ms(other.publishedAt ?? other.scheduledFor);
    if (Number.isFinite(out) && out >= now.getTime() - DUPLICATE_CLIP_WINDOW.publishedDays * DAY_MS) return true;
  }
  return false;
}

/** The sibling to name in the warning: published first, then the earliest scheduled. null when none matches. */
export function findDuplicateClip<S extends ClipSibling>(target: ClipTarget, siblings: readonly S[], now: Date): S | null {
  const hits = siblings.filter((s) => isDuplicateClip(target, s, now));
  if (hits.length === 0) return null;
  const rank = (s: S) => (s.status === "published" ? 0 : 1);
  return [...hits].sort((a, b) => rank(a) - rank(b) || (ms(a.scheduledFor) || Infinity) - (ms(b.scheduledFor) || Infinity))[0]!;
}
