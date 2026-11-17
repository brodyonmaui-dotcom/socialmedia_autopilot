// Server only: the Snapchat page's extra reads (moved from the old /handoff page). Read-only.
import type { Pool } from "pg";
import { loadPostRecords, pickSnapchatDaily, type SnapchatPick } from "@autopilot/analytics";
import { mediaLabel } from "../batches/pg-store.js";

/**
 * "What to send next" when nothing is due (F10 OQ2): the daily pick over the last 28 days of published
 * posts. Read-only: turning it into a post goes through the calendar and an approval, never from here.
 */
export async function snapchatSuggestion(pool: Pool, now: Date): Promise<(SnapchatPick & { label: string }) | null> {
  const [posts, sent] = await Promise.all([
    loadPostRecords(pool, new Date(now.getTime() - 28 * 86_400_000)),
    pool.query("select distinct media_id from batch_items where platform = 'snapchat' and status in ('approved', 'published') and media_id is not null"),
  ]);
  const pick = pickSnapchatDaily(posts, { now, alreadySent: sent.rows.map((r) => r.media_id as string) });
  if (!pick) return null;
  const m = pick.mediaId ? (await pool.query("select source_path from media where id = $1", [pick.mediaId])).rows[0] : undefined;
  return { ...pick, label: mediaLabel((m?.source_path as string | null | undefined) ?? null, pick.mediaId ?? pick.batchItemId) };
}
