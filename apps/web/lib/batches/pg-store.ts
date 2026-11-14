import type { Pool } from "pg";
import type { Platform } from "@autopilot/core";
import { canResetItem, countByStatus, deriveFlags, parseEditorMeta, type BatchItemView, type BatchView, type ItemStatus } from "./types.js";
import type { ItemChange } from "./transitions.js";
import { ConflictError, type BatchStore, type BatchSummary, type LibraryMedia } from "./store.js";

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** basename of source_path without its extension, else the first 8 chars of the id. */
export function mediaLabel(sourcePath: string | null, id: string): string {
  const base = sourcePath?.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "");
  return base ? base : id.slice(0, 8);
}

function qaWarnings(qa: unknown): string[] {
  const w = (qa as { warnings?: unknown } | null)?.warnings;
  return Array.isArray(w) ? w.map(String) : [];
}

export class PgBatchStore implements BatchStore {
  constructor(private pool: Pool) {}

  async listBatches(limit = 20): Promise<BatchSummary[]> {
    const { rows } = await this.pool.query(
      `select id, week_start::text as week_start, status, approved_at from batches order by week_start desc, created_at desc limit $1`,
      [limit],
    );
    if (rows.length === 0) return [];
    const counted = await this.pool.query(
      `select batch_id, status, count(*)::int as n from batch_items where batch_id = any($1::uuid[]) group by batch_id, status`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => {
      const counts = countByStatus([]);
      for (const c of counted.rows) if (c.batch_id === r.id) counts[c.status as ItemStatus] = c.n;
      return { id: r.id, weekStart: r.week_start, status: r.status, approvedAt: iso(r.approved_at), counts };
    });
  }

  async loadBatch(id: string): Promise<BatchView | null> {
    const b = await this.pool.query(`select id, week_start::text as week_start, status, approved_at from batches where id = $1`, [id]);
    const batch = b.rows[0];
    if (!batch) return null;
    const { rows } = await this.pool.query(
      `select bi.id, bi.batch_id, bi.media_id, bi.platform, bi.caption, bi.title, bi.scheduled_for, bi.status, bi.trial,
              bi.platform_post_id, bi.platform_post_url, bi.approved_at, bi.attempts, bi.last_error, bi.origin, bi.created_at,
              right(bi.idempotency_key::text, 6) as key_tail, m.source_path, m.r2_key, m.duration_s, m.pillar, m.qa
         from batch_items bi join media m on m.id = bi.media_id
        where bi.batch_id = $1
        order by bi.scheduled_for asc nulls last, bi.platform, bi.created_at`,
      [id],
    );
    const items: BatchItemView[] = rows.map((r) => {
      const status = r.status as ItemStatus;
      const platformPostId = (r.platform_post_id as string | null) ?? null;
      const platform = r.platform as Platform;
      return {
        id: r.id,
        batchId: r.batch_id,
        mediaId: r.media_id,
        platform,
        caption: r.caption ?? "",
        title: r.title ?? null,
        scheduledFor: iso(r.scheduled_for),
        status,
        tiktokDraft: (r.trial as { tiktokDraft?: unknown } | null)?.tiktokDraft === true,
        platformPostId,
        approvedAt: iso(r.approved_at),
        attempts: Number(r.attempts ?? 0),
        lastError: (r.last_error as string | null) ?? null,
        keyTail: (r.key_tail as string | null) ?? null,
        platformPostUrl: (r.platform_post_url as string | null) ?? null,
        canReset: canResetItem({ status, platformPostId, platform }),
        media: {
          label: mediaLabel(r.source_path, r.media_id),
          durationS: num(r.duration_s),
          pillar: r.pillar ?? null,
          hasCleanFile: r.r2_key != null,
          qaWarnings: qaWarnings(r.qa),
        },
        createdAt: iso(r.created_at) ?? undefined,
        origin: r.origin === "editor" ? "editor" : null,
        editor: r.origin === "editor" ? parseEditorMeta(r.trial) : null,
        warnings: [],
        ...deriveFlags({ status, platformPostId }),
      };
    });
    return { id: batch.id, weekStart: batch.week_start, status: batch.status, approvedAt: iso(batch.approved_at), items, counts: countByStatus(items) };
  }

  async apply(batchId: string, changes: ItemChange[], batchStatus: "draft" | "approved", sessionId: string | null, now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const c of changes) {
        // Fable to review: F11 reset / record-published SQL (double-post risk)
        // Explicit, separate statements on purpose (not the patch loop below). Both stay conditional on the
        // status the plan saw AND on failed|unknown; the reset also on platform_post_id is null. Neither
        // touches the idempotency key: a reset row keeps its key, and attempts >= 1 keeps the engine's
        // existence check before the next send. The matching alert is acknowledged in the same transaction.
        if (c.eventKind === "reset-checked" || c.eventKind === "record-published") {
          const p = c.patch ?? {};
          let res;
          if (c.eventKind === "reset-checked") {
            // attempts 0 would skip the engine's existence check (attempts > 0) before the resend: refuse.
            if (c.to !== "draft" || typeof p.attempts !== "number" || !Number.isInteger(p.attempts) || p.attempts < 1) {
              throw new Error("reset-checked: bad change (needs to=draft and attempts >= 1)");
            }
            res = await client.query(
              `update batch_items set status = 'draft', updated_at = $2, approved_at = null, approved_session = null,
                      attempts = $3, last_error = null, next_attempt_at = null
                where id = $1 and batch_id = $4 and status = $5 and status in ('failed', 'unknown') and platform_post_id is null
                returning id`,
              [c.itemId, now, p.attempts, batchId, c.from],
            );
          } else {
            if (c.to !== "published" || typeof p.platform_post_url !== "string" || p.platform_post_url === "") {
              throw new Error("record-published: bad change (needs to=published and a platform_post_url)");
            }
            res = await client.query(
              `update batch_items set status = 'published', updated_at = $2, platform_post_url = $3,
                      platform_post_id = coalesce($4::text, platform_post_id), next_attempt_at = null
                where id = $1 and batch_id = $5 and status = $6 and status in ('failed', 'unknown')
                returning id`,
              [c.itemId, now, p.platform_post_url, p.platform_post_id ?? null, batchId, c.from],
            );
          }
          if (res.rowCount !== 1) throw new ConflictError();
          await client.query(
            `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [c.itemId, c.eventKind, c.from, c.to, JSON.stringify(c.detail ?? c.patch ?? null), sessionId, now],
          );
          await client.query(
            `update alerts set acknowledged_at = $2, acknowledged_session = $3
              where batch_item_id = $1 and kind in ('final-failure', 'unknown-outcome') and acknowledged_at is null`,
            [c.itemId, now, sessionId],
          );
          continue;
        }
        // SET list built from the patch keys present; values always go in as parameters.
        const params: unknown[] = [c.to, now, sessionId, c.itemId, c.from];
        const sets = [
          "status = $1::text",
          "updated_at = $2",
          "approved_at = case when $1::text = 'approved' then $2::timestamptz when $1::text in ('draft', 'rejected') then null else approved_at end",
          "approved_session = case when $1::text = 'approved' then $3::uuid when $1::text in ('draft', 'rejected') then null else approved_session end",
        ];
        const p = c.patch ?? {};
        if (p.caption !== undefined) sets.push(`caption = $${params.push(p.caption)}`);
        if (p.title !== undefined) sets.push(`title = $${params.push(p.title)}`);
        if (p.scheduled_for !== undefined) sets.push(`scheduled_for = $${params.push(p.scheduled_for)}::timestamptz`);
        const res = await client.query(`update batch_items set ${sets.join(", ")} where id = $4 and batch_id = $${params.push(batchId)} and status = $5 returning id`, params);
        if (res.rowCount !== 1) throw new ConflictError();
        const detail = c.detail ?? c.patch;
        await client.query(
          `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [c.itemId, c.eventKind, c.from, c.to, detail ? JSON.stringify(detail) : null, sessionId, now],
        );
      }
      const b = await client.query(
        `update batches set status = $2::text,
                approved_at = case when $2::text = 'approved' then coalesce(approved_at, $3::timestamptz) else null end,
                updated_at = $3
          where id = $1 returning id`,
        [batchId, batchStatus, now],
      );
      if (b.rowCount !== 1) throw new ConflictError("batch not found, reload");
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async addItem(batchId: string, mediaId: string, platform: Platform, sessionId: string | null, now: Date): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const b = await client.query(`select status from batches where id = $1 for update`, [batchId]);
      const status = b.rows[0]?.status as string | undefined;
      if (!status) throw new Error("batch not found");
      if (status !== "draft" && status !== "approved") throw new Error(`can't add to a ${status} batch`);
      const m = await client.query(`select 1 from media where id = $1`, [mediaId]);
      if (m.rowCount !== 1) throw new Error("media not found");
      const ins = await client.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, created_at, updated_at)
         values ($1, $2, $3, '', null, null, 'draft', $4, $4) returning id`,
        [batchId, mediaId, platform, now],
      );
      const id = ins.rows[0].id as string;
      await client.query(
        `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, $3, $4)`,
        [id, JSON.stringify({ mediaId, platform }), sessionId, now],
      );
      await client.query("commit");
      return id;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listLibraryMedia(limit = 50): Promise<LibraryMedia[]> {
    const { rows } = await this.pool.query(
      `select id, source_path, pillar, duration_s, r2_key from media order by created_at desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.id, label: mediaLabel(r.source_path, r.id), pillar: r.pillar ?? null, durationS: num(r.duration_s), hasCleanFile: r.r2_key != null }));
  }
}
