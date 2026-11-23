import type { QaResult } from "./qa.js";

/**
 * The one way a clean clip becomes a `media` row, shared by the laptop ingest (tools/ingest-agent) and the
 * worker's touch-up fix (apps/worker media-fix). Status is always 'ready': the file is already clean.
 */
export interface NewMediaRow {
  contentHash: string;
  sourcePath: string | null;
  r2Key: string;
  durationS: number | null;
  width: number | null;
  height: number | null;
  pillar: string | null;
  qa: QaResult;
  capturedAt: string | null;
  posterKey: string | null;
  /** Touch-up: the original this clip was fixed from (migration 0014). */
  derivedFrom?: string | null;
  /** Library folder label (migration 0016); null/absent leaves the column unset (the UI buckets by week). */
  folder?: string | null;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * The ingest agent's 10 insert params, in its SQL's order: content_hash, source_path, r2_key, duration_s,
 * width, height, pillar, qa json, captured_at, poster_key.
 */
export function mediaInsertParams(r: NewMediaRow): unknown[] {
  return [r.contentHash, r.sourcePath, r.r2Key, r.durationS, r.width, r.height, r.pillar, JSON.stringify(r.qa), r.capturedAt, r.posterKey];
}

/**
 * Insert with `derived_from` and `qa_checked_at` (needs migration 0014). Idempotent on content_hash: a retry
 * that produced the same bytes returns the existing row (inserted = false), never a second row.
 */
export const MEDIA_INSERT_SQL = `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at, poster_key, derived_from, qa_checked_at)
  values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8::jsonb, $9, $10, $11, now())
  on conflict (content_hash) do nothing
  returning id`;

/** Same insert plus `folder` ($12). Only used when a folder is given, so pre-0016 databases keep working. */
export const MEDIA_INSERT_FOLDER_SQL = MEDIA_INSERT_SQL.replace("derived_from, qa_checked_at)", "derived_from, qa_checked_at, folder)").replace("$11, now())", "$11, now(), $12)");

export async function insertMediaRow(db: Queryable, r: NewMediaRow): Promise<{ id: string; inserted: boolean }> {
  const base = [...mediaInsertParams(r), r.derivedFrom ?? null];
  const ins = r.folder ? await db.query(MEDIA_INSERT_FOLDER_SQL, [...base, r.folder]) : await db.query(MEDIA_INSERT_SQL, base);
  if (ins.rows[0]) return { id: String(ins.rows[0].id), inserted: true };
  const existing = await db.query("select id from media where content_hash = $1", [r.contentHash]);
  if (!existing.rows[0]) throw new Error("media insert: no row and no existing row for this hash");
  return { id: String(existing.rows[0].id), inserted: false };
}
