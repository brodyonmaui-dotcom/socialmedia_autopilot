import { DUPLICATE_CLIP_WINDOW, type ClipSibling, type Platform } from "@autopilot/core";
import type { Queryable } from "./auth-admin.js";

/**
 * The duplicate-clip predicate as ONE SQL fragment (the twin of isDuplicateClip in @autopilot/core, same
 * constants): a batch_items row `alias` that is the same clip on the same platform, not rejected, and either
 * scheduled within ±7 days of `at` or published in the last 14 days before `now`. Arguments are SQL
 * expressions (normally placeholders such as "$1::uuid"); `at` may evaluate to null (untimed: only the
 * published rule applies). Used by every writer that creates batch items and by the calendar's sibling query.
 */
export function duplicateClipSql(a: { alias?: string; mediaId: string; platform: string; at: string; now: string; excludeId?: string }): string {
  const t = a.alias ?? "bi";
  const { scheduledDays, publishedDays } = DUPLICATE_CLIP_WINDOW;
  return `(${t}.media_id = ${a.mediaId} and ${t}.platform = ${a.platform} and ${t}.status <> 'rejected'${a.excludeId ? ` and ${t}.id <> ${a.excludeId}` : ""}
     and ((${t}.scheduled_for is not null and (${a.at}) is not null
           and ${t}.scheduled_for between (${a.at}) - interval '${scheduledDays} days' and (${a.at}) + interval '${scheduledDays} days')
          or (${t}.status = 'published' and coalesce(${t}.scheduled_for, ${t}.updated_at) >= (${a.now}) - interval '${publishedDays} days')))`;
}

/** The published-at expression the predicate uses (for selects that feed isDuplicateClip). */
export const CLIP_PUBLISHED_AT_SQL = (alias = "bi") => `coalesce(${alias}.scheduled_for, ${alias}.updated_at)`;

export interface DuplicateClipQuery {
  mediaId: string;
  platform: Platform;
  /** ISO or null (untimed). */
  scheduledFor: string | null;
  now: Date;
  excludeId?: string;
}

/** The first existing item that makes this one a duplicate clip, or null. One query. */
export async function findDuplicateClipRow(db: Queryable, q: DuplicateClipQuery): Promise<ClipSibling | null> {
  const params: unknown[] = [q.mediaId, q.platform, q.scheduledFor, q.now.toISOString()];
  const excludeId = q.excludeId ? `$${params.push(q.excludeId)}::uuid` : undefined;
  const { rows } = await db.query(
    `select bi.id, bi.media_id, bi.platform, bi.status, bi.scheduled_for, ${CLIP_PUBLISHED_AT_SQL()} as published_at
       from batch_items bi
      where ${duplicateClipSql({ mediaId: "$1::uuid", platform: "$2::text", at: "$3::timestamptz", now: "$4::timestamptz", excludeId })}
      order by (bi.status = 'published') desc, bi.scheduled_for asc nulls last
      limit 1`,
    params,
  );
  const r = rows[0];
  return r ? clipSiblingOf(r) : null;
}

const iso = (v: unknown): string | null => (v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString());

/** A batch_items row (id, media_id, platform, status, scheduled_for, published_at) → ClipSibling. */
export function clipSiblingOf(r: Record<string, unknown>): ClipSibling {
  return {
    id: String(r.id),
    mediaId: String(r.media_id),
    platform: r.platform as Platform,
    status: String(r.status),
    scheduledFor: iso(r.scheduled_for),
    publishedAt: iso(r.published_at),
  };
}
