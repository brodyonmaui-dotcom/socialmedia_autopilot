/**
 * Library "Add to calendar…" (server only). Plans the next open slot per selected clip and platform, then writes
 * DRAFT calendar items. Nothing here approves or publishes: every item is 'draft', origin 'library', and only
 * Instagram gets a template caption (the others show "needs a caption"). Same rules as the worker's weekly-draft:
 * a transaction-scoped advisory lock on 'batch-week:<monday>', the newest non-archived batch of the week (else a new
 * draft batch), the duplicate-clip guard, `ingest_key` + on conflict do nothing, an 'add' event per item.
 * No delete statement in this file.
 */
import { captionGroupFor, localDate, localClock12, pickCaptionTemplate, type Platform } from "@autopilot/core";
import { findDuplicateClipRow } from "@autopilot/db";
import type { Pool } from "pg";
import { mediaLabel } from "../batches/pg-store.js";
import { dayLabel } from "../batches/view-model.js";
import { mondayOf } from "../calendar/model.js";
import { createSlotPicker } from "../calendar/next-slot.js";
import { isUuid, MARK_PLATFORMS, type Db } from "./data.js";

/** Instagram, YouTube, TikTok: the platforms scheduled from the library, in the order they are planned. */
export const ADD_PLATFORMS: readonly Platform[] = MARK_PLATFORMS;
export const MAX_ADD_CLIPS = 60;
/** A template caption used by an Instagram item in the last N days is not picked again (same as daily-instagram). */
const CAPTION_REPEAT_DAYS = 14;

export const libraryIngestKey = (mediaId: string, platform: Platform, date: string): string => `library:${mediaId}:${platform}:${date}`;

export interface PlanLine {
  mediaId: string;
  label: string;
  platform: Platform;
  /** ISO instant. */
  scheduledFor: string;
  /** "Tue 24 Nov, 6:00 PM" in the creator's zone. */
  when: string;
}

export type SkipReason = "duplicate" | "no-slot" | "unavailable";
export interface PlanSkip {
  mediaId: string;
  label: string;
  platform: Platform | null;
  reason: SkipReason;
}

export interface AddPlan {
  lines: PlanLine[];
  skipped: PlanSkip[];
}

export function parsePlatforms(raw: readonly unknown[]): Platform[] {
  const set = new Set(raw.map(String));
  return ADD_PLATFORMS.filter((p) => set.has(p));
}

interface ClipInfo {
  id: string;
  label: string;
  pillar: string | null;
}

/** Selected clips that can be scheduled: they exist, have a clean file, are not archived and not hidden by a touch-up fix. */
async function loadClips(db: Db, ids: string[]): Promise<Map<string, ClipInfo>> {
  const { rows } = (await db.query(
    `select m.id, m.source_path, m.pillar from media m
      where m.id = any($1::uuid[]) and m.status <> 'archived' and coalesce(m.r2_key, '') <> ''
        and not (exists (select 1 from media_fixes hf where hf.fixed_media_id = m.id and hf.status in ('queued','running','done','discarded','failed'))
              or exists (select 1 from media_fixes hk where hk.media_id = m.id and hk.status = 'kept'))`,
    [ids],
  )) as { rows: Array<{ id: string; source_path: string | null; pillar: string | null }> };
  return new Map(rows.map((r) => [r.id, { id: r.id, label: mediaLabel(r.source_path, r.id), pillar: r.pillar }]));
}

/**
 * Read-only. Clips in the order given; per clip, platforms in ADD_PLATFORMS order. A slot already given to an earlier
 * pick counts as taken (caps and gaps hold across the selection). A pick that the duplicate-clip guard rejects gives its
 * slot back. `db` may be a transaction client (then the plan matches what the write will do).
 */
export async function planAddToCalendar(db: Db, o: { mediaIds: readonly string[]; platforms: readonly Platform[]; now: Date; timeZone: string }): Promise<AddPlan> {
  const ids = [...new Set(o.mediaIds.filter(isUuid))].slice(0, MAX_ADD_CLIPS);
  const platforms = ADD_PLATFORMS.filter((p) => o.platforms.includes(p));
  const plan: AddPlan = { lines: [], skipped: [] };
  if (ids.length === 0 || platforms.length === 0) return plan;
  const clips = await loadClips(db, ids);
  const names = new Map(((await db.query(`select id, source_path from media where id = any($1::uuid[])`, [ids])).rows as Array<{ id: string; source_path: string | null }>).map((r) => [r.id, mediaLabel(r.source_path, r.id)]));
  const picker = await createSlotPicker(db as Pool, o.now, o.timeZone);
  for (const id of ids) {
    const clip = clips.get(id);
    if (!clip) {
      plan.skipped.push({ mediaId: id, label: names.get(id) ?? id.slice(0, 8), platform: null, reason: "unavailable" });
      continue;
    }
    for (const platform of platforms) {
      const at = picker.pick(platform);
      if (!at) {
        plan.skipped.push({ mediaId: id, label: clip.label, platform, reason: "no-slot" });
        continue;
      }
      if (await findDuplicateClipRow(db as Pool, { mediaId: id, platform, scheduledFor: at, now: o.now })) {
        picker.release(platform, at);
        plan.skipped.push({ mediaId: id, label: clip.label, platform, reason: "duplicate" });
        continue;
      }
      plan.lines.push({ mediaId: id, label: clip.label, platform, scheduledFor: at, when: whenText(at, o.timeZone) });
    }
  }
  return plan;
}

/** "Tue 24 Nov, 6:00 PM". */
export function whenText(iso: string, timeZone: string): string {
  const d = new Date(iso);
  return `${dayLabel(localDate(d, timeZone))}, ${localClock12(d, timeZone)}`;
}

export interface AddResult {
  added: number;
  /** Existing items hit by the ingest_key (a repeat submit) or the duplicate guard. */
  skipped: PlanSkip[];
  /** Monday (YYYY-MM-DD) of the earliest added item's week, or null when nothing was added. */
  firstWeek: string | null;
  /** The draft items this call inserted (not the skipped ones), for approving them next. */
  created: Array<{ itemId: string; batchId: string; mediaId: string; platform: Platform }>;
}

/** Text the creator typed for a clip: replaces the template caption (all platforms) and sets the YouTube title. */
export interface ClipText {
  caption?: string;
  title?: string;
}

/**
 * One transaction: lock the affected weeks (sorted, so two runs never deadlock) → re-plan against what is there NOW →
 * per week the newest non-archived batch, else a new draft batch → draft items + 'add' events. A second submit finds the
 * clips already scheduled (duplicate guard) and inserts nothing.
 */
export async function addToCalendar(
  pool: Pool,
  o: { mediaIds: readonly string[]; platforms: readonly Platform[]; now: Date; timeZone: string; sessionId: string | null; overrides?: Readonly<Record<string, ClipText>> },
): Promise<AddResult> {
  const first = await planAddToCalendar(pool, o);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const weekOf = (iso: string) => mondayOf(localDate(new Date(iso), o.timeZone));
    const locked = new Set<string>();
    const lock = async (weeks: Iterable<string>) => {
      for (const w of [...new Set(weeks)].filter((w) => !locked.has(w)).sort()) {
        await client.query(`select pg_advisory_xact_lock(hashtext('batch-week:' || $1::text))`, [w]);
        locked.add(w);
      }
    };
    await lock(first.lines.map((l) => weekOf(l.scheduledFor)));
    const plan = await planAddToCalendar(client, o); // after the lock: what is really there
    await lock(plan.lines.map((l) => weekOf(l.scheduledFor)));

    const pillar = new Map<string, string | null>();
    if (plan.lines.length) {
      const { rows } = await client.query(`select id, pillar from media where id = any($1::uuid[])`, [[...new Set(plan.lines.map((l) => l.mediaId))]]);
      for (const r of rows as Array<{ id: string; pillar: string | null }>) pillar.set(r.id, r.pillar);
    }
    const since = new Date(o.now.getTime() - CAPTION_REPEAT_DAYS * 86_400_000);
    const avoid = new Set<string>(
      ((await client.query(`select distinct caption from batch_items where platform = 'instagram' and caption <> '' and created_at >= $1::timestamptz`, [since.toISOString()])).rows as Array<{ caption: string }>).map((r) => String(r.caption)),
    );

    const batches = new Map<string, string>();
    const batchFor = async (week: string): Promise<string> => {
      const have = batches.get(week);
      if (have) return have;
      const found = await client.query(`select id from batches where week_start = $1::date and status <> 'archived' order by created_at desc, id desc limit 1`, [week]);
      const id = (found.rows[0]?.id as string | undefined) ?? ((await client.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [week])).rows[0].id as string);
      batches.set(week, id);
      return id;
    };

    const result: AddResult = { added: 0, skipped: [...plan.skipped], firstWeek: null, created: [] };
    let firstAt: string | null = null;
    const touched = new Set<string>();
    for (const l of [...plan.lines].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.platform.localeCompare(b.platform))) {
      const week = weekOf(l.scheduledFor);
      const batchId = await batchFor(week);
      const key = libraryIngestKey(l.mediaId, l.platform, localDate(new Date(l.scheduledFor), o.timeZone));
      const over = o.overrides?.[l.mediaId];
      const typed = over?.caption === undefined ? undefined : over.caption.trim();
      const caption = typed !== undefined ? typed : l.platform === "instagram" ? (pickCaptionTemplate(pillar.get(l.mediaId), key, avoid) ?? "") : "";
      const title = l.platform === "youtube" ? (over?.title?.trim() ?? "") : null;
      const ins = await client.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::timestamptz, 'draft', 'library', $7, null, $8, $8)
         on conflict (ingest_key) where ingest_key is not null do nothing
         returning id`,
        [batchId, l.mediaId, l.platform, caption, title, l.scheduledFor, key, o.now],
      );
      const id = ins.rows[0]?.id as string | undefined;
      if (!id) {
        result.skipped.push({ mediaId: l.mediaId, label: l.label, platform: l.platform, reason: "duplicate" });
        continue;
      }
      if (caption && typed === undefined) avoid.add(caption);
      result.created.push({ itemId: id, batchId, mediaId: l.mediaId, platform: l.platform });
      await client.query(
        `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, $3, $4)`,
        [id, JSON.stringify({ origin: "library", group: captionGroupFor(pillar.get(l.mediaId)) }), o.sessionId && isUuid(o.sessionId) ? o.sessionId : null, o.now],
      );
      touched.add(batchId);
      result.added++;
      if (firstAt == null || l.scheduledFor < firstAt) {
        firstAt = l.scheduledFor;
        result.firstWeek = week;
      }
    }
    for (const b of touched) await client.query(`update batches set updated_at = $2 where id = $1`, [b, o.now]);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** "Added 6 posts as drafts. Approve them in the calendar." (plus a skipped count when some were left out). */
export function addedNote(added: number, skipped: number): string {
  const head = added === 0 ? "Nothing added" : `Added ${added === 1 ? "1 post" : `${added} posts`} as drafts. Approve ${added === 1 ? "it" : "them"} in the calendar.`;
  return skipped ? `${head} ${skipped === 1 ? "1 was" : `${skipped} were`} skipped.` : head;
}
