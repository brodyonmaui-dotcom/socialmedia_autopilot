// Server-only: the three cheap, read-only counts behind the frame's badges. Home runs the same queries.
import type { Pool } from "pg";
import type { FrameCounts } from "./app-nav.js";

export const FRAME_COUNT_SQL = {
  draftBatches: "select count(*)::int as n from batches where status = 'draft'",
  flagged: "select count(*)::int as n from comment_triage where bucket in ('flag', 'hide_flag') and handled_at is null",
  openAlerts: "select count(*)::int as n from alerts where acknowledged_at is null",
} as const;

const n = (rows: Array<Record<string, unknown>>): number => Number(rows[0]?.n ?? 0);

/** Badge counts; a failing query leaves its badge off (the page itself still renders). */
export async function loadFrameCounts(pool: Pool): Promise<FrameCounts> {
  const [d, f, a] = await Promise.allSettled([
    pool.query(FRAME_COUNT_SQL.draftBatches),
    pool.query(FRAME_COUNT_SQL.flagged),
    pool.query(FRAME_COUNT_SQL.openAlerts),
  ]);
  return {
    draftBatches: d.status === "fulfilled" ? n(d.value.rows) : undefined,
    flagged: f.status === "fulfilled" ? n(f.value.rows) : undefined,
    openAlerts: a.status === "fulfilled" ? n(a.value.rows) : undefined,
  };
}
