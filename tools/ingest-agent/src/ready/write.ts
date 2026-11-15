import type { Platform } from "@autopilot/core";
import type { PlannedItem, ReadyExisting } from "./plan.js";
import type { Sidecar } from "./sidecar.js";

/**
 * F15 DB side of `ingest:ready`. Inserts and updates only: there is no delete statement in this
 * file (a static test checks), and nothing here approves: items land as 'draft' and the batch
 * status is never written (see writeReadyItems).
 */

/** pg.Pool, a PoolClient or a test fake. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ConnectPool extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

export interface MediaRow {
  contentHash: string;
  sourcePath: string;
  r2Key: string;
  durationS: number | null;
  width: number | null;
  height: number | null;
  pillar: string;
  qa: unknown;
  capturedAt: string | null;
}

/**
 * Upsert by content hash. A row from the old ingest keeps its values; only a missing r2_key is filled.
 * `returning` yields no row when the `where` blocks the update, so then the id is selected.
 */
export async function upsertMedia(db: Queryable, m: MediaRow): Promise<string> {
  const ins = await db.query(
    `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8::jsonb, $9)
     on conflict (content_hash) do update set r2_key = excluded.r2_key, updated_at = now() where media.r2_key is null
     returning id`,
    [m.contentHash, m.sourcePath, m.r2Key, m.durationS, m.width, m.height, m.pillar, JSON.stringify(m.qa ?? null), m.capturedAt],
  );
  if (ins.rows[0]?.id) return ins.rows[0].id as string;
  const sel = await db.query(`select id from media where content_hash = $1`, [m.contentHash]);
  const id = sel.rows[0]?.id as string | undefined;
  if (!id) throw new Error("media row not found after upsert");
  return id;
}

/** Ingest keys (of `keys`) that already have a batch_items row, whatever its status (a rejected item keeps its key). */
export async function existingIngestKeys(db: Queryable, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const { rows } = await db.query(`select ingest_key from batch_items where ingest_key = any($1::text[])`, [keys]);
  return rows.map((r) => r.ingest_key as string);
}

/** Non-rejected items with a time in [from, to): the posts slotting must route around. */
export async function existingPosts(db: Queryable, from: string, to: string): Promise<ReadyExisting[]> {
  const { rows } = await db.query(
    `select platform, scheduled_for, trial from batch_items
      where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz and scheduled_for < $2::timestamptz`,
    [from, to],
  );
  return rows.map((r) => ({
    platform: r.platform as Platform,
    scheduledFor: new Date(r.scheduled_for).toISOString(),
    tiktokDraft: (r.trial as { tiktokDraft?: unknown } | null)?.tiktokDraft === true,
  }));
}

export interface WriteInput {
  mediaId: string;
  sidecar: Sidecar;
  items: PlannedItem[];
  now: Date;
}

export interface WriteResult {
  /** Rows this call created (a conflict on ingest_key creates nothing). */
  inserted: Array<{ id: string; platform: Platform; batchId: string }>;
  /** Items whose key already existed (re-run, second laptop, race). */
  existing: Platform[];
}

/** Trial jsonb in the shape PgBatchStore reads: `trial.tiktokDraft === true` plus F15's `trial.editor`. */
export function trialJson(sidecar: Sidecar, item: PlannedItem): string {
  const editor = {
    source: sidecar.source,
    pillar: sidecar.pillar,
    when: sidecar.when,
    earliest: sidecar.earliest ?? null,
    approvedInEditor: sidecar.approvedInEditor,
    flags: item.flags,
  };
  return JSON.stringify(item.tiktokDraft ? { tiktokDraft: true, editor } : { editor });
}

/** Push text: source, pillar and platform only (no caption text, no place). */
export function alertMessage(sidecar: Sidecar, platform: Platform): string {
  return `New from ${sidecar.source}: ${sidecar.pillar} · ${platform}`;
}

// Fable to review: F15 editor item write (idempotency)
/**
 * One transaction per render:
 *  1. Per week (sorted, so two writers never lock in opposite orders): pg_advisory_xact_lock on
 *     'batch-week:<weekStart>', then the newest non-archived batch for that week, else a new 'draft' batch.
 *  2. Each item: insert ... on conflict (ingest_key) where ingest_key is not null do nothing returning id.
 *     The partial unique index (0009) is the idempotency guarantee; the lock only keeps the batch single.
 *  3. Each newly inserted item: an 'add' event and one 'ready-for-approval' alert (unique (kind, batch_item_id)).
 * Batch status is left as it is: PgBatchStore.apply derives it as "approved iff any item is outside
 * draft/rejected" (transitions.ts batchStatusAfter), and adding a draft item can't change that value,
 * so the stored status already equals the recomputed one. Only updated_at is touched.
 */
export async function writeReadyItems(pool: ConnectPool, input: WriteInput): Promise<WriteResult> {
  const client = await pool.connect();
  const result: WriteResult = { inserted: [], existing: [] };
  try {
    await client.query("begin");
    const weeks = [...new Set(input.items.map((i) => i.weekStart))].sort();
    const batchFor = new Map<string, string>();
    for (const week of weeks) {
      await client.query(`select pg_advisory_xact_lock(hashtext('batch-week:' || $1::text))`, [week]);
      const found = await client.query(
        `select id from batches where week_start = $1::date and status <> 'archived' order by created_at desc, id desc limit 1`,
        [week],
      );
      let batchId = found.rows[0]?.id as string | undefined;
      if (!batchId) {
        const ins = await client.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [week]);
        batchId = ins.rows[0].id as string;
      }
      batchFor.set(week, batchId);
    }

    for (const item of input.items) {
      const batchId = batchFor.get(item.weekStart)!;
      const ins = await client.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::timestamptz, 'draft', 'editor', $7, $8::jsonb, $9, $9)
         on conflict (ingest_key) where ingest_key is not null do nothing
         returning id`,
        [batchId, input.mediaId, item.platform, item.caption, item.title, item.scheduledFor, item.ingestKey, trialJson(input.sidecar, item), input.now],
      );
      const id = ins.rows[0]?.id as string | undefined;
      if (!id) {
        result.existing.push(item.platform);
        continue;
      }
      result.inserted.push({ id, platform: item.platform, batchId });
      await client.query(
        `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, null, $3)`,
        [id, JSON.stringify({ origin: "editor", source: input.sidecar.source, ingestKey: item.ingestKey, flags: item.flags }), input.now],
      );
      await client.query(
        `insert into alerts (kind, batch_item_id, platform, message, created_at) values ('ready-for-approval', $1, $2, $3, $4)
         on conflict (kind, batch_item_id) do nothing`,
        [id, item.platform, alertMessage(input.sidecar, item.platform), input.now],
      );
    }

    const touched = [...new Set(result.inserted.map((r) => r.batchId))];
    if (touched.length) await client.query(`update batches set updated_at = $2 where id = any($1::uuid[])`, [touched, input.now]);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
// End of F15 editor item write.
