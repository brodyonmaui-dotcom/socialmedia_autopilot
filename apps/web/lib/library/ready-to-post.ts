/**
 * "Ready to post" (F23 U2, server only): clips from uploads finished in the last 7 days, plus Studio renders (F24,
 * done `media_edits` of kind 'studio', last 14 days), that have no non-rejected calendar item yet, each with the template caption it would get (same pick as the worker's daily-instagram).
 * Read-only.
 */
import { pickCaptionTemplate } from "@autopilot/core";
import { hasFolderColumn, type Db } from "./data.js";
import { mediaLabel } from "../batches/pg-store.js";

export const READY_DAYS = 7;
export const STUDIO_READY_DAYS = 14;
const CAPTION_REPEAT_DAYS = 14;

export interface ReadyClip {
  mediaId: string;
  uploadId: string;
  label: string;
  hasPoster: boolean;
  durationS: number | null;
  folder: string | null;
  /** Template caption to start from; "" when none is left. */
  suggestion: string;
}

export async function loadReadyToPost(db: Db, now: Date): Promise<ReadyClip[]> {
  const folders = await hasFolderColumn(db, now.getTime());
  const since = new Date(now.getTime() - READY_DAYS * 86_400_000).toISOString();
  // The page must not crash before migration 0017 is applied: no uploads table → only Studio renders are listed.
  const hasUploads = (await db.query(`select to_regclass('public.uploads') is not null as ok`)).rows[0]?.ok === true;
  const { rows } = (hasUploads ? await db.query(
    `select distinct on (m.id) u.id as upload_id, m.id, m.source_path, m.duration_s, m.pillar, m.poster_key, ${folders ? "m.folder" : "null::text as folder"}, coalesce(u.finished_at, u.updated_at) as done_at
       from uploads u
       join media m on m.id = u.media_id
      where u.status = 'done' and coalesce(u.finished_at, u.updated_at) >= $1::timestamptz
        and m.status <> 'archived' and coalesce(m.r2_key, '') <> ''
        and not exists (select 1 from batch_items bi where bi.media_id = m.id and bi.status <> 'rejected')
      order by m.id, done_at desc`,
    [since],
  ) : { rows: [] }) as { rows: Array<{ upload_id: string; id: string; source_path: string | null; duration_s: string | number | null; pillar: string | null; poster_key: string | null; folder: string | null; done_at: Date }> };
  // Studio outputs: the render's result media, not yet on the calendar. `upload_id` is "" (no upload row).
  const studioSince = new Date(now.getTime() - STUDIO_READY_DAYS * 86_400_000).toISOString();
  const studio = (await db.query(
    `select distinct on (m.id) e.id as edit_id, m.id, m.source_path, m.duration_s, m.pillar, m.poster_key, ${folders ? "m.folder" : "null::text as folder"}, coalesce(e.finished_at, e.requested_at) as done_at
       from media_edits e
       join media m on m.id = e.result_media_id
      where e.kind = 'studio' and e.status = 'done' and coalesce(e.finished_at, e.requested_at) >= $1::timestamptz
        and m.status <> 'archived' and coalesce(m.r2_key, '') <> ''
        and not exists (select 1 from batch_items bi where bi.media_id = m.id and bi.status <> 'rejected')
      order by m.id, done_at desc`,
    [studioSince],
  )) as { rows: Array<{ edit_id: string; id: string; source_path: string | null; duration_s: string | number | null; pillar: string | null; poster_key: string | null; folder: string | null; done_at: Date }> };
  const seen = new Set(rows.map((r) => r.id));
  for (const r of studio.rows) if (!seen.has(r.id)) rows.push({ upload_id: String(r.edit_id), id: r.id, source_path: r.source_path, duration_s: r.duration_s, pillar: r.pillar, poster_key: r.poster_key, folder: r.folder, done_at: new Date(r.done_at) });
  rows.sort((a, b) => b.done_at.getTime() - a.done_at.getTime() || a.id.localeCompare(b.id));
  const used = new Set<string>(
    ((await db.query(`select distinct caption from batch_items where platform = 'instagram' and caption <> '' and created_at >= $1::timestamptz`, [new Date(now.getTime() - CAPTION_REPEAT_DAYS * 86_400_000).toISOString()])).rows as Array<{ caption: string }>).map((r) => String(r.caption)),
  );
  return rows.map((r) => {
    const suggestion = (pickCaptionTemplate(r.pillar, `ready:${r.id}`, used) as string | null) ?? ""; // null = templates exhausted: no suggestion
    if (suggestion) used.add(suggestion); // two clips in one list don't get the same suggestion
    const d = r.duration_s == null ? null : Number(r.duration_s);
    return { mediaId: r.id, uploadId: r.upload_id, label: mediaLabel(r.source_path, r.id), hasPoster: !!r.poster_key, durationS: d != null && Number.isFinite(d) ? d : null, folder: r.folder, suggestion };
  });
}
