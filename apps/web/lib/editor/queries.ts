import type { Pool } from "pg";
import type { Platform } from "@autopilot/core";
import { loadWarningContext } from "../batches/context.js";
import { mediaLabel, PgBatchStore } from "../batches/pg-store.js";
import { parseEditorMeta, type BatchView, type EditorMeta } from "../batches/types.js";
import { computeWarnings } from "../batches/warnings.js";
import { groupRenders, type EditorRender } from "./view.js";

/** One editor draft as listed (no warnings yet: those need the whole batch, see loadEditorRenders). */
export interface EditorDraftRow {
  itemId: string;
  batchId: string;
  weekStart: string;
  mediaId: string;
  platform: Platform;
  caption: string;
  title: string | null;
  /** ISO UTC or null. */
  scheduledFor: string | null;
  createdAt: string;
  editor: EditorMeta | null;
  media: { label: string; durationS: number | null; pillar: string | null; hasCleanFile: boolean };
}

const iso = (v: unknown): string | null => (v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString());

/** Read-only: origin = 'editor' and status = 'draft', newest first. `batchId` narrows to one batch. */
export async function listEditorDrafts(pool: Pool, opts: { batchId?: string; limit?: number } = {}): Promise<EditorDraftRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const { rows } = await pool.query(
    `select bi.id, bi.batch_id, b.week_start::text as week_start, bi.media_id, bi.platform, bi.caption, bi.title, bi.scheduled_for,
            bi.created_at, bi.trial, m.source_path, m.r2_key, m.duration_s, m.pillar
       from batch_items bi
       join batches b on b.id = bi.batch_id
       join media m on m.id = bi.media_id
      where bi.origin = 'editor' and bi.status = 'draft' and ($1::uuid is null or bi.batch_id = $1::uuid)
      order by bi.created_at desc, bi.platform
      limit $2`,
    [opts.batchId ?? null, limit],
  );
  return rows.map((r) => ({
    itemId: r.id,
    batchId: r.batch_id,
    weekStart: r.week_start,
    mediaId: r.media_id,
    platform: r.platform as Platform,
    caption: r.caption ?? "",
    title: r.title ?? null,
    scheduledFor: iso(r.scheduled_for),
    createdAt: iso(r.created_at)!,
    editor: parseEditorMeta(r.trial),
    media: { label: mediaLabel(r.source_path, r.media_id), durationS: r.duration_s == null ? null : Number(r.duration_s), pillar: r.pillar ?? null, hasCleanFile: r.r2_key != null },
  }));
}

/** Editor renders from an already-loaded batch whose warnings are filled (the batch page has it in hand). */
export function rendersOfBatch(batch: BatchView, now: Date, timeZone: string): EditorRender[] {
  return groupRenders(batch.items, now, timeZone);
}

/**
 * Home: every batch with editor drafts, loaded whole so warnings (caps, duplicates) see the full batch,
 * then grouped into renders. Read-only.
 */
export async function loadEditorRenders(
  pool: Pool,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ renders: EditorRender[]; timeZone: string; timeZoneSource: "env" | "fallback" }> {
  const drafts = await listEditorDrafts(pool);
  const batchIds = [...new Set(drafts.map((d) => d.batchId))];
  const store = new PgBatchStore(pool);
  let timeZone = "UTC";
  let timeZoneSource: "env" | "fallback" = "fallback";
  const renders: EditorRender[] = [];
  for (const id of batchIds) {
    const batch = await store.loadBatch(id);
    if (!batch) continue;
    const ctx = await loadWarningContext({ pool, weekStart: batch.weekStart, batchId: batch.id, now, env });
    timeZone = ctx.timeZone;
    timeZoneSource = ctx.timeZoneSource;
    const ws = computeWarnings(batch.items, ctx);
    for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
    renders.push(...rendersOfBatch(batch, now, ctx.timeZone));
  }
  renders.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0));
  // No drafts → the card is hidden on Home, so the UTC fallback here is never shown.
  return { renders, timeZone, timeZoneSource };
}

/** Fresh batch + warnings from the DB (the form's view is never trusted). Null when the batch is gone. */
export async function loadBatchWithWarnings(pool: Pool, batchId: string, now: Date = new Date()): Promise<{ batch: BatchView; timeZone: string; timeZoneSource: "env" | "fallback" } | null> {
  const batch = await new PgBatchStore(pool).loadBatch(batchId);
  if (!batch) return null;
  const ctx = await loadWarningContext({ pool, weekStart: batch.weekStart, batchId: batch.id, now });
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  return { batch, timeZone: ctx.timeZone, timeZoneSource: ctx.timeZoneSource };
}
