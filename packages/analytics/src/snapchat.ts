import type { PostRecord } from "./types.js";
import { median } from "./stats.js";

/**
 * Snapchat is assisted: 1 Spotlight a day, picked from the previous 48 h's best performer on
 * Instagram/TikTok (decisions.md §3). Pure logic, no UI, no posting.
 *
 * "Best" = views relative to that platform's own median (a TikTok with 2× TikTok's median beats an
 * IG reel with 1.5× IG's median, even if the IG reel has more raw views). The median comes from a
 * longer baseline window (default 28 days) so one quiet weekend doesn't distort it. A clip already
 * sent to Snapchat is never picked again, whichever platform it did well on.
 */

export interface SnapchatPick {
  /** The clip to send (mediaId, or the batch item id when the record has no mediaId). */
  clipKey: string;
  mediaId: string | null;
  batchItemId: string;
  platform: "instagram" | "tiktok";
  views: number;
  platformMedian: number;
  /** views / platformMedian. */
  score: number;
  postedAt: string;
}

export interface SnapchatPickOptions {
  now?: Date;
  /** Clips (mediaId or batch item id) already sent to Snapchat. */
  alreadySent?: Iterable<string>;
  windowHours?: number;
  baselineDays?: number;
  /** Minimum posts per platform in the baseline for its median to count (default 3). */
  minBaseline?: number;
}

const H = 3_600_000;
const SOURCES = new Set(["instagram", "tiktok"]);

export function pickSnapchatDaily(posts: PostRecord[], opts: SnapchatPickOptions = {}): SnapchatPick | null {
  const now = (opts.now ?? new Date()).getTime();
  const windowStart = now - (opts.windowHours ?? 48) * H;
  const baselineStart = now - (opts.baselineDays ?? 28) * 24 * H;
  const minBaseline = opts.minBaseline ?? 3;
  const sent = new Set(opts.alreadySent ?? []);
  const keyOf = (p: PostRecord) => p.mediaId ?? p.batchItemId;

  const eligible = posts.filter((p) => {
    const t = Date.parse(p.postedAt);
    return SOURCES.has(p.platform) && typeof p.metrics.views === "number" && t < now;
  });

  const medians = new Map<string, number>();
  for (const platform of SOURCES) {
    const views = eligible.filter((p) => p.platform === platform && Date.parse(p.postedAt) >= baselineStart).map((p) => p.metrics.views!);
    const m = views.length >= minBaseline ? median(views) : null;
    if (m !== null && m > 0) medians.set(platform, m);
  }

  let best: SnapchatPick | null = null;
  for (const p of eligible) {
    const t = Date.parse(p.postedAt);
    if (t < windowStart || sent.has(keyOf(p))) continue;
    const med = medians.get(p.platform);
    if (med === undefined) continue; // no trustworthy baseline yet for this platform
    const pick: SnapchatPick = {
      clipKey: keyOf(p),
      mediaId: p.mediaId ?? null,
      batchItemId: p.batchItemId,
      platform: p.platform as SnapchatPick["platform"],
      views: p.metrics.views!,
      platformMedian: med,
      score: p.metrics.views! / med,
      postedAt: p.postedAt,
    };
    // Higher score wins; ties → more raw views → older post (it's had its 48 h) → id, so it's deterministic.
    if (
      !best ||
      pick.score > best.score ||
      (pick.score === best.score && (pick.views > best.views || (pick.views === best.views && (pick.postedAt < best.postedAt || (pick.postedAt === best.postedAt && pick.batchItemId < best.batchItemId)))))
    ) {
      best = pick;
    }
  }
  return best;
}
