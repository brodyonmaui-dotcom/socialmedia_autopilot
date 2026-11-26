/**
 * "Ready to post" (F23 U2, server only): clips from uploads finished in the last 7 days that have no non-rejected
 * calendar item yet, each with the template caption it would get (same pick as the worker's daily-instagram).
 * Read-only.
 */
import { pickCaptionTemplate } from "@autopilot/core";
import { hasFolderColumn, type Db } from "./data.js";
import { mediaLabel } from "../batches/pg-store.js";

export const READY_DAYS = 7;
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
  const { rows } = (await db.query(
    `select distinct on (m.id) u.id as upload_id, m.id, m.source_path, m.duration_s, m.pillar, m.poster_key, ${folders ? "m.folder" : "null::text as folder"}, coalesce(u.finished_at, u.updated_at) as done_at
       from uploads u
       join media m on m.id = u.media_id
      where u.status = 'done' and coalesce(u.finished_at, u.updated_at) >= $1::timestamptz
        and m.status <> 'archived' and coalesce(m.r2_key, '') <> ''
        and not exists (select 1 from batch_items bi where bi.media_id = m.id and bi.status <> 'rejected')
      order by m.id, done_at desc`,
    [since],
  )) as { rows: Array<{ upload_id: string; id: string; source_path: string | null; duration_s: string | number | null; pillar: string | null; poster_key: string | null; folder: string | null; done_at: Date }> };
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
