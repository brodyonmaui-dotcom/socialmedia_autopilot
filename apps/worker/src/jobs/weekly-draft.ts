import {
  addCalendarDays,
  assignSlots,
  localDate,
  localToUtc,
  weekdayIndex,
  type Platform,
  type ScheduleItem,
} from "@autopilot/core";
import { findDuplicateClipRow, loadCadence } from "@autopilot/db";
import { QUEUES } from "../queue.js";

/**
 * F14 Sunday `weekly-draft` (docs/design/F14.md): tops up NEXT week (the creator-local Monday after
 * the run) with one library clip per day that has no post yet, as 'draft' items for Instagram,
 * YouTube and TikTok, captions and titles empty (captions are the weekly-batch skill's job, never
 * generated here). Nothing is approved: empty captions block approval, auto-approve only takes
 * origin 'editor', and listDue needs approved_at. No platform call, no LLM: own tables only, so it
 * runs in dry-run too (private drafts + one private alert), like analytics-ingest.
 *
 * Safe next to the editor pipeline (tools/ingest-agent/src/ready/write.ts): the same transaction-scoped
 * advisory lock on 'batch-week:<weekStart>' and the same "newest non-archived batch, else a new draft
 * batch" rule; every read that decides what to add happens after the lock, so two runs (or a run and
 * an editor write) serialise. ingest_key 'weekly:<weekStart>:<mediaId>:<platform>' + the partial
 * unique index (0009) is the idempotency guarantee. No delete statement in this file.
 */
export const WEEKLY_DRAFT_CRON = "0 18 * * 0"; // Sunday 18:00 in TZ_CREATOR (pg-boss `tz`)
export const WEEKLY_PLATFORMS: readonly Platform[] = ["instagram", "youtube", "tiktok"];
/** A clip with a non-rejected item scheduled at or after now − this many days (future included) is "recently used". */
export const RECENT_USE_DAYS = 28;
export const WEEKLY_NO_TZ_LINE = "[weekly-draft] TZ_CREATOR not set: weekly-draft not scheduled";

/** pg.Pool, a PoolClient or a test fake. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ConnectPool extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

/** The pg-boss surface these cron jobs use (pg-boss 10.4: schedule(name, cron, data?, { tz })). */
export interface CronBoss {
  createQueue(name: string): Promise<unknown>;
  work(name: string, handler: (jobs: unknown) => Promise<unknown>): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<unknown>;
}

/** The creator-local Monday after `now` (on a Monday: next week's Monday, never today). */
export function nextWeekStart(now: Date, timeZone: string): string {
  const today = localDate(now, timeZone);
  return addCalendarDays(today, 7 - weekdayIndex(today));
}

/** One media row as the job needs it; `hidden*` mirror the library's visibility rule (apps/web/lib/library/data.ts HIDDEN). */
export interface LibraryClipRow {
  id: string;
  pillar: string | null;
  status: string;
  r2Key: string | null;
  capturedAt: string | null;
  createdAt: string;
  /** An original whose touch-up fix was kept (0014): the fixed copy replaces it in the library. */
  supersededByKeptFix: boolean;
  /** A fixed copy still waiting for a decision, or one that was discarded / failed: hidden in the library. */
  undecidedFixCopy: boolean;
}

/** Library visibility + a clean file: not archived, a non-empty r2_key, not hidden by a fix (0014). */
export function isEligibleClip(r: LibraryClipRow): boolean {
  return r.status !== "archived" && !!r.r2Key && !r.supersededByKeptFix && !r.undecidedFixCopy;
}

const ms = (iso: string | null): number => {
  const t = iso == null ? NaN : Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity; // unknown capture time sorts after every known one
};

/**
 * Pure and deterministic. Eligible clips (isEligibleClip, not in recentlyUsed), newest first
 * (captured_at desc, then created_at desc, then id), then round-robin across pillars in order of
 * first appearance in that list, up to `count`.
 */
export function pickClips(rows: readonly LibraryClipRow[], opts: { count: number; recentlyUsed: Iterable<string> }): LibraryClipRow[] {
  const used = new Set(opts.recentlyUsed);
  const sorted = rows
    .filter((r) => isEligibleClip(r) && !used.has(r.id))
    .sort((a, b) => ms(b.capturedAt) - ms(a.capturedAt) || ms(b.createdAt) - ms(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, LibraryClipRow[]>();
  for (const r of sorted) {
    const k = r.pillar ?? "";
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: LibraryClipRow[] = [];
  const lists = [...groups.values()];
  for (let round = 0; out.length < opts.count; round++) {
    let any = false;
    for (const g of lists) {
      if (round < g.length) {
        any = true;
        if (out.length < opts.count) out.push(g[round]!);
      }
    }
    if (!any) break;
  }
  return out;
}

export function weeklyIngestKey(weekStart: string, mediaId: string, platform: Platform): string {
  return `weekly:${weekStart}:${mediaId}:${platform}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Counts and the week date only: no clip names, paths, captions, ids or places. */
export function batchReadyMessage(weekStart: string, clips: number, needCaptions: number): string {
  return `Next week (from ${weekStart}): ${plural(clips, "clip")} added, ${plural(needCaptions, "post")} need${needCaptions === 1 ? "s" : ""} captions`;
}

/** Every media row with the library-visibility flags (same predicates as the library's HIDDEN). */
export async function loadLibraryClips(db: Queryable): Promise<LibraryClipRow[]> {
  const { rows } = await db.query(
    `select m.id, m.pillar, m.status, m.r2_key, m.captured_at, m.created_at,
            exists (select 1 from media_fixes hk where hk.media_id = m.id and hk.status = 'kept') as superseded,
            exists (select 1 from media_fixes hf where hf.fixed_media_id = m.id and hf.status in ('queued','running','done','discarded','failed')) as undecided
       from media m`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    pillar: (r.pillar as string | null) ?? null,
    status: String(r.status),
    r2Key: (r.r2_key as string | null) ?? null,
    capturedAt: r.captured_at == null ? null : new Date(r.captured_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    supersededByKeptFix: r.superseded === true,
    undecidedFixCopy: r.undecided === true,
  }));
}

export interface WeeklyDraftResult {
  weekStart: string | null;
  /** Local days of the week that had no non-rejected post when the run looked (after the lock). */
  uncoveredDays: string[];
  /** Distinct clips with at least one item inserted by this run. */
  clipsAdded: number;
  postsInserted: number;
  /** (clip, platform) pairs assignSlots couldn't place: dropped. */
  unplaced: number;
  /** Items whose ingest_key already existed (a rejected weekly item keeps its key). */
  existingKeys: number;
  /** (clip, platform) pairs skipped by the duplicate-clip guard (already on that platform within ±7 days, or published in 14). */
  duplicates: number;
  batchId: string | null;
  alertRaised: boolean;
  skipped: null | "no-tz" | "covered" | "no-clips" | "no-slots";
}

export interface WeeklyDraftOptions {
  timeZone: string | undefined;
  now?: Date;
  log?: (line: string) => void;
  /** Library source (default loadLibraryClips); tests narrow it to their fixtures. */
  loadLibrary?: (db: Queryable) => Promise<LibraryClipRow[]>;
}

function emptyResult(weekStart: string | null, skipped: WeeklyDraftResult["skipped"], uncoveredDays: string[] = []): WeeklyDraftResult {
  return { weekStart, uncoveredDays, clipsAdded: 0, postsInserted: 0, unplaced: 0, existingKeys: 0, duplicates: 0, batchId: null, alertRaised: false, skipped };
}

export function formatWeeklyDraftLine(r: WeeklyDraftResult): string {
  if (r.skipped === "no-tz") return WEEKLY_NO_TZ_LINE;
  const why = r.skipped ? ` · ${r.skipped}` : "";
  return `[weekly-draft] week ${r.weekStart}: uncovered ${r.uncoveredDays.length} · clips ${r.clipsAdded} · posts ${r.postsInserted} · unplaced ${r.unplaced} · existing ${r.existingKeys}${r.duplicates ? ` · duplicates ${r.duplicates}` : ""} · alert ${r.alertRaised ? "raised" : "none"}${why}`;
}

/** Draft items of the week (timed by their time, untimed by their batch's week) with an empty caption or an empty YouTube title. */
async function countNeedCaptions(db: Queryable, weekStart: string, from: Date, to: Date): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from batch_items bi join batches b on b.id = bi.batch_id
      where bi.status = 'draft'
        and (bi.caption = '' or (bi.platform = 'youtube' and coalesce(bi.title, '') = ''))
        and ((bi.scheduled_for >= $2::timestamptz and bi.scheduled_for < $3::timestamptz)
             or (bi.scheduled_for is null and b.week_start = $1::date and b.status <> 'archived'))`,
    [weekStart, from.toISOString(), to.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

// F14 weekly-draft write (idempotency + editor-pipeline lock)
/**
 * One transaction: lock the week → covered days → library pick → assignSlots → batch (reuse newest
 * non-archived, else insert 'draft') → items (on conflict (ingest_key) do nothing) + 'add' events →
 * one 'batch-ready' alert (not-exists on kind + message, so a re-run raises nothing). The batch status
 * is left as it is (see writeReadyItems: adding a draft item can't change the derived status).
 */
export async function runWeeklyDraftOnce(pool: ConnectPool, opts: WeeklyDraftOptions): Promise<WeeklyDraftResult> {
  const log = opts.log ?? console.log;
  const timeZone = opts.timeZone;
  if (!timeZone) {
    log(WEEKLY_NO_TZ_LINE);
    return emptyResult(null, "no-tz");
  }
  const now = opts.now ?? new Date();
  const weekStart = nextWeekStart(now, timeZone);
  const days = Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
  const from = localToUtc(weekStart, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(weekStart, 7), "00:00", timeZone);
  const loadLibrary = opts.loadLibrary ?? loadLibraryClips;

  const client = await pool.connect();
  let result: WeeklyDraftResult;
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext('batch-week:' || $1::text))`, [weekStart]);
    result = await draftLocked(client, { weekStart, days, from, to, now, timeZone, loadLibrary });
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  log(formatWeeklyDraftLine(result));
  return result;
}

async function draftLocked(
  db: Queryable,
  c: { weekStart: string; days: string[]; from: Date; to: Date; now: Date; timeZone: string; loadLibrary: (db: Queryable) => Promise<LibraryClipRow[]> },
): Promise<WeeklyDraftResult> {
  const { weekStart, days, from, to, now, timeZone } = c;
  // Every non-rejected timed post of the week, any platform, any origin: covers its day and counts toward caps.
  const week = await db.query(
    `select platform, scheduled_for from batch_items
      where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz and scheduled_for < $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  );
  const existing = week.rows.map((r) => ({ platform: r.platform as Platform, scheduledFor: new Date(r.scheduled_for).toISOString() }));
  const covered = new Set(existing.map((e) => localDate(new Date(e.scheduledFor), timeZone)));
  const uncovered = days.filter((d) => !covered.has(d));
  if (uncovered.length === 0) return emptyResult(weekStart, "covered");

  const since = new Date(now.getTime() - RECENT_USE_DAYS * 86_400_000);
  const recent = await db.query(
    `select distinct media_id from batch_items where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz`,
    [since.toISOString()],
  );
  const picked = pickClips(await c.loadLibrary(db), { count: uncovered.length, recentlyUsed: recent.rows.map((r) => String(r.media_id)) });
  if (picked.length === 0) return emptyResult(weekStart, "no-clips", uncovered);

  const cadence = await loadCadence(db);
  const items: ScheduleItem[] = picked.map((clip, i) => {
    const day = uncovered[i]!;
    return {
      key: clip.id,
      pillar: clip.pillar ?? undefined,
      platforms: [...WEEKLY_PLATFORMS],
      capturedAt: clip.capturedAt ?? undefined,
      window: { notBefore: localToUtc(day, "00:00", timeZone).toISOString(), notAfter: localToUtc(addCalendarDays(day, 1), "00:00", timeZone).toISOString() },
      sameDay: true,
    };
  });
  const plan = assignSlots({ weekStart, days: 7, items, cadence, timeZone, existing, now });
  const assignments = [...plan.assignments].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.platform.localeCompare(b.platform));
  if (assignments.length === 0) return { ...emptyResult(weekStart, "no-slots", uncovered), unplaced: plan.unplaced.length };

  const found = await db.query(
    `select id from batches where week_start = $1::date and status <> 'archived' order by created_at desc, id desc limit 1`,
    [weekStart],
  );
  let batchId = found.rows[0]?.id as string | undefined;
  if (!batchId) batchId = (await db.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [weekStart])).rows[0].id as string;

  const inserted: Array<{ id: string; mediaId: string }> = [];
  let existingKeys = 0;
  let duplicates = 0;
  for (const a of assignments) {
    // Duplicate-clip guard (shared predicate): never a second post of this clip on this platform.
    if (await findDuplicateClipRow(db, { mediaId: a.key, platform: a.platform, scheduledFor: a.scheduledFor, now })) {
      duplicates++;
      continue;
    }
    const ins = await db.query(
      `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, created_at, updated_at)
       values ($1, $2, $3, '', $4, $5::timestamptz, 'draft', 'weekly', $6, null, $7, $7)
       on conflict (ingest_key) where ingest_key is not null do nothing
       returning id`,
      [batchId, a.key, a.platform, a.platform === "youtube" ? "" : null, a.scheduledFor, weeklyIngestKey(weekStart, a.key, a.platform), now],
    );
    const id = ins.rows[0]?.id as string | undefined;
    if (!id) {
      existingKeys++;
      continue;
    }
    inserted.push({ id, mediaId: a.key });
    await db.query(
      `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, null, $3)`,
      [id, JSON.stringify({ origin: "weekly" }), now],
    );
  }

  const clipsAdded = new Set(inserted.map((i) => i.mediaId)).size;
  let alertRaised = false;
  if (inserted.length > 0) {
    await db.query(`update batches set updated_at = $2 where id = $1`, [batchId, now]);
    const message = batchReadyMessage(weekStart, clipsAdded, await countNeedCaptions(db, weekStart, from, to));
    // Linked to the first item added, so /alerts' "Open in calendar" lands on this week (the alerts list joins item → batch).
    const raised = await db.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at)
       select 'batch-ready', $1, 'all', $2, $3
        where not exists (select 1 from alerts where kind = 'batch-ready' and message = $2)
       returning id`,
      [inserted[0]!.id, message, now],
    );
    alertRaised = raised.rows.length === 1;
  }
  return { weekStart, uncoveredDays: uncovered, clipsAdded, postsInserted: inserted.length, unplaced: plan.unplaced.length, existingKeys, duplicates, batchId, alertRaised, skipped: null };
}
// End of F14 weekly-draft write.

/** Sunday 18:00 creator-local. No TZ_CREATOR → one log line, nothing registered (a week has no meaning without the zone). */
export async function registerWeeklyDraftJob(boss: CronBoss, pool: ConnectPool, timeZone: string | undefined, log: (l: string) => void = console.log): Promise<boolean> {
  if (!timeZone) {
    log(WEEKLY_NO_TZ_LINE);
    return false;
  }
  await boss.createQueue(QUEUES.weeklyDraft);
  await boss.work(QUEUES.weeklyDraft, async () => {
    return await runWeeklyDraftOnce(pool, { timeZone, log }); // stored as the pg-boss job output (diagnose-week reads it)
  });
  await boss.schedule(QUEUES.weeklyDraft, WEEKLY_DRAFT_CRON, {}, { tz: timeZone });
  return true;
}
