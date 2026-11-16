// Server-only: the cheap, read-only counts behind the shell's badges, plus the newest open alerts for
// the Notifications pop-over.
import type { Pool } from "pg";
import type { FrameCounts } from "./app-nav.js";

export const FRAME_COUNT_SQL = {
  draftPosts: "select count(*)::int as n from batch_items where status = 'draft'",
  flagged: "select count(*)::int as n from comment_triage where bucket in ('flag', 'hide_flag') and handled_at is null",
  dmsOpen: "select count(*)::int as n from dm_threads where handled_at is null and last_inbound_at > now() - interval '24 hours'",
  openAlerts: "select count(*)::int as n from alerts where acknowledged_at is null",
} as const;

const n = (rows: Array<Record<string, unknown>>): number => Number(rows[0]?.n ?? 0);

/** Badge counts; a failing query leaves its badge off (the page itself still renders). */
export async function loadFrameCounts(pool: Pool): Promise<FrameCounts> {
  const [d, f, m, a] = await Promise.allSettled([
    pool.query(FRAME_COUNT_SQL.draftPosts),
    pool.query(FRAME_COUNT_SQL.flagged),
    pool.query(FRAME_COUNT_SQL.dmsOpen),
    pool.query(FRAME_COUNT_SQL.openAlerts),
  ]);
  return {
    draftPosts: d.status === "fulfilled" ? n(d.value.rows) : undefined,
    flagged: f.status === "fulfilled" ? n(f.value.rows) : undefined,
    dmsOpen: m.status === "fulfilled" ? n(m.value.rows) : undefined,
    openAlerts: a.status === "fulfilled" ? n(a.value.rows) : undefined,
  };
}
