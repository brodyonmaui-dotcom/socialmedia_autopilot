// Server only: the calendar's one read path. Loads every batch with an item in the window (plus untimed
// drafts) through PgBatchStore.loadBatch, fills fresh warnings exactly as the batch screen did
// (loadWarningContext + computeWarnings), and groups the items into entries. Read-only.
import type { Pool } from "pg";
import { addCalendarDays, assertTimeZone, localDate } from "@autopilot/core";
import { loadWarningContext } from "../batches/context.js";
import { PgBatchStore } from "../batches/pg-store.js";
import type { BatchView } from "../batches/types.js";
import { computeWarnings, type WarningContext } from "../batches/warnings.js";
import { groupEntries, type Entry } from "./model.js";

export const CALENDAR_SQL = {
  batches: `select distinct batch_id from batch_items
             where (scheduled_for >= $1 and scheduled_for < $2) or (scheduled_for is null and status = 'draft')`,
} as const;

export interface CalendarData {
  entries: Entry[];
  /** Untimed drafts ("No time yet"). */
  untimed: Entry[];
  /** The batches behind the entries, with warnings filled (actions re-load their own; this is for summaries). */
  batches: BatchView[];
  ctxByBatch: Map<string, WarningContext>;
  timeZone: string;
  timeZoneSource: "env" | "fallback";
}

/** The creator zone the calendar uses: TZ_CREATOR when valid, else UTC (flagged as a fallback). Same rule as loadWarningContext. */
export function creatorZone(env: NodeJS.ProcessEnv = process.env): { timeZone: string; source: "env" | "fallback" } {
  if (env.TZ_CREATOR) {
    try {
      return { timeZone: assertTimeZone(env.TZ_CREATOR), source: "env" };
    } catch {
      /* invalid zone: UTC fallback */
    }
  }
  return { timeZone: "UTC", source: "fallback" };
}

/** A batch freshly loaded with server-side warnings (the form's view is never trusted). */
export async function loadBatchFresh(
  pool: Pool,
  batchId: string,
  now: Date,
  env?: NodeJS.ProcessEnv,
): Promise<{ batch: BatchView; ctx: WarningContext & { timeZoneSource: "env" | "fallback" } } | null> {
  const batch = await new PgBatchStore(pool).loadBatch(batchId);
  if (!batch) return null;
  const ctx = await loadWarningContext({ pool, weekStart: batch.weekStart, batchId, now, ...(env ? { env } : {}) });
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  return { batch, ctx };
}

/** `from` / `to`: inclusive creator-local days. A ±1 day UTC margin is fetched, then cut by local day. */
export async function loadCalendar(pool: Pool, opts: { from: string; to: string; now: Date; showRejected?: boolean }): Promise<CalendarData> {
  const { rows } = await pool.query(CALENDAR_SQL.batches, [new Date(`${addCalendarDays(opts.from, -1)}T00:00:00Z`), new Date(`${addCalendarDays(opts.to, 2)}T00:00:00Z`)]);
  const batches: BatchView[] = [];
  const ctxByBatch = new Map<string, WarningContext>();
  const { timeZone, source: timeZoneSource } = creatorZone();
  for (const r of rows as Array<{ batch_id: string }>) {
    const fresh = await loadBatchFresh(pool, r.batch_id, opts.now);
    if (!fresh) continue;
    batches.push(fresh.batch);
    ctxByBatch.set(fresh.batch.id, fresh.ctx);
  }
  const items = batches.flatMap((b) => b.items).filter((i) => {
    if (!i.scheduledFor) return i.status === "draft";
    const d = localDate(new Date(i.scheduledFor), timeZone);
    return d >= opts.from && d <= opts.to;
  });
  const all = groupEntries(items, { timeZone, now: opts.now, showRejected: opts.showRejected });
  return { entries: all.filter((e) => e.day), untimed: all.filter((e) => !e.day), batches, ctxByBatch, timeZone, timeZoneSource };
}

/**
 * Home "From your editors": editor drafts (origin 'editor', status draft) as calendar entries, newest
 * first, with fresh warnings. Read-only. `total` = all such entries; `entries` = the first `limit`.
 */
export async function loadEditorEntries(pool: Pool, now: Date, limit = 4): Promise<{ entries: Entry[]; total: number }> {
  const { rows } = await pool.query(
    `select batch_id, max(created_at) as newest from batch_items where origin = 'editor' and status = 'draft' group by batch_id order by newest desc limit 8`,
  );
  const { timeZone } = creatorZone();
  const items = [];
  for (const r of rows as Array<{ batch_id: string }>) {
    const fresh = await loadBatchFresh(pool, r.batch_id, now);
    if (fresh) items.push(...fresh.batch.items.filter((i) => i.origin === "editor" && i.status === "draft"));
  }
  const newest = new Map<string, string>();
  for (const i of items) {
    const k = i.mediaId;
    const c = i.createdAt ?? "";
    if (!newest.has(k) || c > newest.get(k)!) newest.set(k, c);
  }
  const entries = groupEntries(items, { timeZone, now }).sort((a, b) => (newest.get(b.mediaId) ?? "").localeCompare(newest.get(a.mediaId) ?? ""));
  return { entries: entries.slice(0, limit), total: entries.length };
}
