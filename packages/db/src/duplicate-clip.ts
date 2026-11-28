import {
  buildVideoIndex,
  classifyVideoUse,
  editSecondsOf,
  VIDEO_REPEAT,
  videoFamily,
  useStatus,
  type ClipSibling,
  type Platform,
  type VideoIdentity,
  type VideoIndex,
  type VideoMatchWhy,
  type VideoRelation,
  type VideoUse,
} from "@autopilot/core";
import type { Queryable } from "./auth-admin.js";

/**
 * Duplicate guard v2 (F26 A), the db side of packages/core duplicate-clip.ts: loads the media identities (lineage,
 * fingerprint, name) and the platform's uses, then classifies with the pure rule. `recentVideoUse` is the ONE helper
 * every picker (daily-instagram, weekly-draft, media-reel, add-to-calendar, the weekly-batch skill), the calendar's
 * warnings loader and the outbox's last check go through. Needs migration 0018 (media.fingerprint).
 */

/** Latest reject event says "already-posted" (the calendar's "Already posted on <Platform>: drop it"). */
export const ALREADY_POSTED_SQL = (alias = "bi") =>
  `(${alias}.status = 'rejected' and (select e.detail->>'reason' from batch_item_events e
     where e.batch_item_id = ${alias}.id and e.kind = 'reject' order by e.at desc, e.id desc limit 1) = 'already-posted')`;

/** The published-at expression the guard uses. */
export const CLIP_PUBLISHED_AT_SQL = (alias = "bi") => `coalesce(${alias}.scheduled_for, ${alias}.updated_at)`;

/** Every media row's identity: lineage (derived_from + the Studio edit's clips), fingerprint, name, duration, new edits. */
export const VIDEO_INDEX_SQL = `select m.id, m.derived_from, m.fingerprint, m.source_path, m.duration_s,
       e.kind as edit_kind, e.params as edit_params, e.sound_id as edit_sound_id, src.duration_s as edit_source_duration_s
  from media m
  left join lateral (select me.kind, me.params, me.sound_id, me.source_media_id from media_edits me
                      where me.result_media_id = m.id order by (me.status = 'done') desc, me.finished_at desc nulls last limit 1) e on true
  left join media src on src.id = e.source_media_id`;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function videoIdentityOf(r: Record<string, unknown>): VideoIdentity {
  const durationS = num(r.duration_s);
  let parents: string[] = [];
  let newEdits = false;
  if (r.edit_kind != null) {
    const params = r.edit_params as Record<string, unknown> | null;
    if (r.edit_kind === "studio" && Array.isArray(params?.clips)) {
      parents = [...new Set((params!.clips as Array<{ mediaId?: unknown }>).map((c) => (typeof c?.mediaId === "string" ? c.mediaId : "")).filter(Boolean))];
    }
    newEdits =
      editSecondsOf({ kind: String(r.edit_kind), params, soundId: (r.edit_sound_id as string | null) ?? null, sourceDurationS: num(r.edit_source_duration_s), outputDurationS: durationS }) >=
      VIDEO_REPEAT.newEditS;
  }
  return {
    id: String(r.id),
    derivedFrom: (r.derived_from as string | null) ?? null,
    parents,
    fingerprint: (r.fingerprint as string | null) ?? null,
    sourcePath: (r.source_path as string | null) ?? null,
    durationS,
    newEdits,
  };
}

export async function loadVideoIndex(db: Queryable): Promise<VideoIndex> {
  const { rows } = await db.query(VIDEO_INDEX_SQL);
  return buildVideoIndex((rows as Array<Record<string, unknown>>).map(videoIdentityOf));
}

const iso = (v: unknown): string | null => (v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString());

/** A batch_items row (id, media_id, platform, status, scheduled_for, published_at[, already_posted]) → ClipSibling. */
export function clipSiblingOf(r: Record<string, unknown>): ClipSibling {
  return {
    id: String(r.id),
    mediaId: String(r.media_id),
    platform: r.platform as Platform,
    status: String(r.status),
    scheduledFor: iso(r.scheduled_for),
    publishedAt: iso(r.published_at),
    alreadyPosted: r.already_posted === true,
  };
}

/** Every item that can count as a use (not failed, not a plain reject) of these media on these platforms. Any time. */
export async function loadVideoUses(db: Queryable, q: { mediaIds: readonly string[]; platforms: readonly Platform[] }): Promise<ClipSibling[]> {
  if (q.mediaIds.length === 0 || q.platforms.length === 0) return [];
  const { rows } = await db.query(
    `select bi.id, bi.media_id, bi.platform, bi.status, bi.scheduled_for, ${CLIP_PUBLISHED_AT_SQL()} as published_at, ${ALREADY_POSTED_SQL()} as already_posted
       from batch_items bi
      where bi.media_id = any($1::uuid[]) and bi.platform = any($2::text[]) and bi.status <> 'failed'
        and (bi.status <> 'rejected' or ${ALREADY_POSTED_SQL()})`,
    [[...q.mediaIds], [...q.platforms]],
  );
  return (rows as Array<Record<string, unknown>>).map(clipSiblingOf);
}

export type VideoFamily = Map<string, { relation: VideoRelation; why: VideoMatchWhy }>;

export interface VideoUseQuery {
  platform: Platform;
  now: Date;
  /** The target's time (ISO); null/absent = now. */
  at?: string | null;
  /** The target item itself (never matches itself). */
  excludeItemId?: string;
  /** Outbox: only uses that went out (published / publishing / unknown / rejected as already posted). */
  wentOutOnly?: boolean;
}

export interface VideoUseResult extends VideoUse {
  /** Same-video and derived media of the target (self included): lets a planner check its own not-yet-written picks. */
  family: VideoFamily;
}

/** recentVideoUse for many clips at once (one index load, one uses query). Keyed by media id. */
export async function recentVideoUses(db: Queryable, q: VideoUseQuery & { mediaIds: readonly string[]; index?: VideoIndex }): Promise<Map<string, VideoUseResult>> {
  const ix = q.index ?? (await loadVideoIndex(db));
  const families = new Map<string, VideoFamily>();
  const related = new Set<string>();
  for (const id of new Set(q.mediaIds)) {
    const f = videoFamily(ix, id);
    families.set(id, f);
    for (const k of f.keys()) related.add(k);
  }
  const uses = await loadVideoUses(db, { mediaIds: [...related], platforms: [q.platform] });
  const out = new Map<string, VideoUseResult>();
  for (const [id, family] of families) {
    const use = classifyVideoUse({ id: q.excludeItemId, mediaId: id, platform: q.platform, scheduledFor: q.at ?? null }, uses, (m) => family.get(m) ?? null, q.now, {
      wentOutOnly: q.wentOutOnly,
    });
    out.set(id, { ...use, family });
  }
  return out;
}

/**
 * THE duplicate check: how this video (by lineage, fingerprint or name) is already used on `platform`. level "block" =
 * the same video is scheduled or went out within 90 days of `at`; "warn" = older, or derived footage; null = clear.
 */
export async function recentVideoUse(db: Queryable, q: VideoUseQuery & { mediaId: string; index?: VideoIndex }): Promise<VideoUseResult> {
  return (await recentVideoUses(db, { ...q, mediaIds: [q.mediaId] })).get(q.mediaId)!;
}

/**
 * Pickers: every media id that would be blocked on `platform` at `at` (the same video scheduled or out within 90 days),
 * computed from the uses side in one pass. Equivalent to recentVideoUse(...).level === "block" for each id.
 */
export async function blockedVideoIds(db: Queryable, q: { platform: Platform; now: Date; at?: string | null; index?: VideoIndex }): Promise<Set<string>> {
  const ix = q.index ?? (await loadVideoIndex(db));
  const ref = q.at ? Date.parse(q.at) : q.now.getTime();
  const { rows } = await db.query(
    `select bi.id, bi.media_id, bi.platform, bi.status, bi.scheduled_for, ${CLIP_PUBLISHED_AT_SQL()} as published_at, ${ALREADY_POSTED_SQL()} as already_posted
       from batch_items bi
      where bi.platform = $1 and bi.status <> 'failed' and (bi.status <> 'rejected' or ${ALREADY_POSTED_SQL()})
        and ${CLIP_PUBLISHED_AT_SQL()} between $2::timestamptz - interval '${VIDEO_REPEAT.blockDays} days' and $2::timestamptz + interval '${VIDEO_REPEAT.blockDays} days'`,
    [q.platform, new Date(ref).toISOString()],
  );
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const s of (rows as Array<Record<string, unknown>>).map(clipSiblingOf)) {
    if (!useStatus(s) || (s.scheduledFor == null && s.status !== "published")) continue;
    if (seen.has(s.mediaId)) continue;
    seen.add(s.mediaId);
    for (const [m, r] of videoFamily(ix, s.mediaId)) if (r.relation === "same") out.add(m);
  }
  return out;
}

/** Fingerprint write (best effort, never overwrites an existing value). */
export async function storeFingerprint(db: Queryable, mediaId: string, fingerprint: string | null): Promise<void> {
  await db.query(`update media set fingerprint = coalesce(fingerprint, $2), fingerprint_at = now() where id = $1`, [mediaId, fingerprint]);
}
