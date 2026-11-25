// Server only: the calendar's one read path. Loads every batch with an item in the window (plus untimed
// drafts) through PgBatchStore.loadBatch, fills fresh warnings exactly as the batch screen did
// (loadWarningContext + computeWarnings), and groups the items into entries. Read-only.
import type { Pool } from "pg";
import { addCalendarDays, assertTimeZone, localDate, type ClipSibling } from "@autopilot/core";
import { CLIP_PUBLISHED_AT_SQL, clipSiblingOf, duplicateClipSql } from "@autopilot/db";
import { loadWarningContext } from "../batches/context.js";
import { PgBatchStore } from "../batches/pg-store.js";
import type { BatchItemView, BatchView } from "../batches/types.js";
import { computeWarnings, type WarningContext } from "../batches/warnings.js";
import { groupEntries, type Entry } from "./model.js";

export const CALENDAR_SQL = {
  batches: `select distinct batch_id from batch_items
             where (scheduled_for >= $1 and scheduled_for < $2) or (scheduled_for is null and status = 'draft')`,
  /**
   * Duplicate-clip siblings for many items in ONE query: every other batch_items row that the shared
   * duplicateClipSql predicate matches for any of the (id, media, platform, time) tuples.
   */
  clipSiblings: `select distinct on (bi.id) bi.id, bi.media_id, bi.platform, bi.status, bi.scheduled_for, ${CLIP_PUBLISHED_AT_SQL("bi")} as published_at
      from unnest($1::uuid[], $2::uuid[], $3::text[], $4::timestamptz[]) as t(id, media_id, platform, at)
      join batch_items bi on ${duplicateClipSql({ alias: "bi", mediaId: "t.media_id", platform: "t.platform", at: "t.at", now: "$5::timestamptz", excludeId: "t.id" })}`,
} as const;

/** Items the duplicate-clip warning applies to (it only checks draft/approved items). */
const clipCheckable = (i: BatchItemView) => i.status === "draft" || i.status === "approved";

/** Every other item (any batch, any status but rejected) that makes one of `items` a duplicate clip. One query; none when nothing to check. */
export async function loadClipSiblings(pool: Pick<Pool, "query">, items: BatchItemView[], now: Date): Promise<ClipSibling[]> {
  const check = items.filter(clipCheckable);
  if (check.length === 0) return [];
  const { rows } = await pool.query(CALENDAR_SQL.clipSiblings, [
    check.map((i) => i.id),
    check.map((i) => i.mediaId),
    check.map((i) => i.platform),
    check.map((i) => i.scheduledFor),
    now.toISOString(),
  ]);
  return (rows as Array<Record<string, unknown>>).map(clipSiblingOf);
}

/** Server-side warnings for an already loaded batch (siblings: preloaded for many batches, else one query). */
async function freshen(pool: Pool, batch: BatchView, now: Date, env: NodeJS.ProcessEnv | undefined, siblings?: ClipSibling[]) {
  const ctx = await loadWarningContext({ pool, weekStart: batch.weekStart, batchId: batch.id, now, ...(env ? { env } : {}) });
  ctx.clipSiblings = siblings ?? (await loadClipSiblings(pool, batch.items, now));
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  return ctx;
}

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
  return { batch, ctx: await freshen(pool, batch, now, env) };
}

/** `from` / `to`: inclusive creator-local days. A ±1 day UTC margin is fetched, then cut by local day. */
export async function loadCalendar(pool: Pool, opts: { from: string; to: string; now: Date; showRejected?: boolean }): Promise<CalendarData> {
  const { rows } = await pool.query(CALENDAR_SQL.batches, [new Date(`${addCalendarDays(opts.from, -1)}T00:00:00Z`), new Date(`${addCalendarDays(opts.to, 2)}T00:00:00Z`)]);
  const batches: BatchView[] = [];
  const ctxByBatch = new Map<string, WarningContext>();
  const { timeZone, source: timeZoneSource } = creatorZone();
  const store = new PgBatchStore(pool);
  for (const r of rows as Array<{ batch_id: string }>) {
    const batch = await store.loadBatch(r.batch_id);
    if (batch) batches.push(batch);
  }
  // One sibling query for every batch in view (not one per batch).
  const siblings = await loadClipSiblings(pool, batches.flatMap((b) => b.items), opts.now);
  for (const batch of batches) ctxByBatch.set(batch.id, await freshen(pool, batch, opts.now, undefined, siblings));
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
  const store = new PgBatchStore(pool);
  const loaded: BatchView[] = [];
  for (const r of rows as Array<{ batch_id: string }>) {
    const batch = await store.loadBatch(r.batch_id);
    if (batch) loaded.push(batch);
  }
  const siblings = await loadClipSiblings(pool, loaded.flatMap((b) => b.items), now);
  const items = [];
  for (const batch of loaded) {
    await freshen(pool, batch, now, undefined, siblings);
    items.push(...batch.items.filter((i) => i.origin === "editor" && i.status === "draft"));
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
