import {
  addCalendarDays,
  assignSlots,
  captionGroupFor,
  INSTAGRAM_DAILY_MIN_KEY,
  localDate,
  localToUtc,
  parseInstagramDailyMin,
  hashtagSetsOf,
  weekdayIndex,
  type ScheduleItem,
} from "@autopilot/core";
import { blocklistFromEnv, composeCaption } from "@autopilot/research";
import { blockedVideoIds, getSetting, loadCadence, loadVideoIndex, recentVideoUse } from "@autopilot/db";
import { QUEUES } from "../queue.js";
import {
  loadLibraryClips,
  pickClips,
  RECENT_USE_DAYS,
  type ConnectPool,
  type CronBoss,
  type LibraryClipRow,
  type Queryable,
} from "./weekly-draft.js";

/**
 * F20 stream D `daily-instagram`: every day 17:00 creator-local, tops TOMORROW up to `instagram_daily_min`
 * (settings, default 2) non-rejected Instagram posts with library clips as Instagram-only 'draft' items,
 * origin 'daily', and template captions (packages/core caption-templates: no AI, no places, 2-4 hashtags).
 * Nothing is approved: only origin 'editor' can auto-approve and listDue needs approved_at, so the creator
 * still taps Approve in the calendar. Own tables only, no platform call: runs in dry-run too.
 *
 * Same discipline as weekly-draft: the transaction-scoped advisory lock 'batch-week:<weekStart>' (the week
 * holding tomorrow), the newest non-archived batch for that week else a new draft batch, every read that
 * decides what to add after the lock, ingest_key 'daily:<date>:<mediaId>:instagram' + the partial unique
 * index as the idempotency guarantee. No delete statement in this file.
 */
export const DAILY_INSTAGRAM_CRON = "0 17 * * *"; // 17:00 in TZ_CREATOR (pg-boss `tz`)
export const DAILY_NO_TZ_LINE = "[daily-instagram] TZ_CREATOR not set: daily-instagram not scheduled";
/** A template caption used by an Instagram item created in the last N days is not picked again (while others remain). */
export const CAPTION_REPEAT_DAYS = 14;
/** Clips from these pillars are skipped: a generic caption would not fit (trading needs real numbers from the creator). */
const SKIP_PILLARS = new Set(["trade-recap", "trading"]);
const GYM_PILLARS = new Set(["workout-log", "single-set", "physique", "gym"]);

export function dailyIngestKey(date: string, mediaId: string): string {
  return `daily:${date}:${mediaId}:instagram`;
}

/** Counts and the date only: no clip names, paths, captions, ids or places. */
export function dailyReadyMessage(date: string, n: number): string {
  return `Tomorrow (${date}): ${n} Instagram post${n === 1 ? "" : "s"} drafted with captions. Approve ${n === 1 ? "it" : "them"} in the calendar.`;
}

/** Gym pillars first (round-robin among them), then every other non-trading pillar (round-robin) for what's still missing. */
export function pickDailyClips(rows: readonly LibraryClipRow[], opts: { count: number; recentlyUsed: Iterable<string> }): LibraryClipRow[] {
  const used = [...opts.recentlyUsed];
  const usable = rows.filter((r) => !SKIP_PILLARS.has(r.pillar ?? ""));
  const gym = pickClips(usable.filter((r) => GYM_PILLARS.has(r.pillar ?? "")), { count: opts.count, recentlyUsed: used });
  if (gym.length >= opts.count) return gym;
  const taken = new Set(gym.map((r) => r.id));
  const rest = pickClips(usable.filter((r) => !GYM_PILLARS.has(r.pillar ?? "")), { count: opts.count - gym.length, recentlyUsed: [...used, ...taken] });
  return [...gym, ...rest];
}

export interface DailyInstagramResult {
  /** Tomorrow, creator-local. */
  date: string | null;
  min: number;
  /** Non-rejected Instagram items tomorrow when the run looked (after the lock). */
  existing: number;
  postsInserted: number;
  unplaced: number;
  existingKeys: number;
  /** Clips skipped by the duplicate-clip guard (already on Instagram within ±7 days, or published in 14). */
  duplicates: number;
  batchId: string | null;
  alertRaised: boolean;
  skipped: null | "no-tz" | "enough" | "no-clips" | "no-slots";
}

export interface DailyInstagramOptions {
  timeZone: string | undefined;
  now?: Date;
  log?: (line: string) => void;
  /** Library source (default loadLibraryClips); tests narrow it to their fixtures. */
  loadLibrary?: (db: Queryable) => Promise<LibraryClipRow[]>;
  /** ANTHROPIC_API_KEY for AI captions (F26 B); absent = template bank only. The register function passes the env value. */
  anthropicKey?: string;
}

const empty = (date: string | null, skipped: DailyInstagramResult["skipped"], min = 0, existing = 0): DailyInstagramResult => ({
  date,
  min,
  existing,
  postsInserted: 0,
  unplaced: 0,
  existingKeys: 0,
  duplicates: 0,
  batchId: null,
  alertRaised: false,
  skipped,
});

export function formatDailyInstagramLine(r: DailyInstagramResult): string {
  if (r.skipped === "no-tz") return DAILY_NO_TZ_LINE;
  const why = r.skipped ? ` · ${r.skipped}` : "";
  return `[daily-instagram] ${r.date}: min ${r.min} · have ${r.existing} · posts ${r.postsInserted} · unplaced ${r.unplaced} · existing ${r.existingKeys}${r.duplicates ? ` · duplicates ${r.duplicates}` : ""} · alert ${r.alertRaised ? "raised" : "none"}${why}`;
}

/** One transaction: lock the week of tomorrow → count → pick → slot → batch → items + 'add' events → one alert. */
export async function runDailyInstagramOnce(pool: ConnectPool, opts: DailyInstagramOptions): Promise<DailyInstagramResult> {
  const log = opts.log ?? console.log;
  const timeZone = opts.timeZone;
  if (!timeZone) {
    log(DAILY_NO_TZ_LINE);
    return empty(null, "no-tz");
  }
  const now = opts.now ?? new Date();
  const date = addCalendarDays(localDate(now, timeZone), 1);
  const weekStart = addCalendarDays(date, -weekdayIndex(date));

  const loadLibrary = opts.loadLibrary ?? loadLibraryClips;
  // F26 B: AI captions are composed BEFORE the locked transaction (a network call must not hold the week lock). The
  // pre-pass runs the same picking without the lock and rolls back; the locked pass re-picks, uses a pre-composed caption
  // only for a clip it still picks, and composes a template caption (no network) for anything else.
  const precomposed = new Map<string, string>();
  if (opts.anthropicKey) {
    const pre = await pool.connect();
    try {
      await pre.query("begin");
      await draftLocked(pre, { date, weekStart, now, timeZone, loadLibrary, anthropicKey: opts.anthropicKey, log, aiDb: pool, collect: precomposed });
    } catch (err) {
      log(`[daily-instagram] caption pre-pass failed (${err instanceof Error ? err.name : "error"}), templates used`);
      precomposed.clear();
    } finally {
      await pre.query("rollback").catch(() => {});
      pre.release();
    }
  }

  const client = await pool.connect();
  let result: DailyInstagramResult;
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext('batch-week:' || $1::text))`, [weekStart]);
    result = await draftLocked(client, { date, weekStart, now, timeZone, loadLibrary, log, precomposed });
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  log(formatDailyInstagramLine(result));
  return result;
}

async function draftLocked(
  db: Queryable,
  c: { date: string; weekStart: string; now: Date; timeZone: string; loadLibrary: (db: Queryable) => Promise<LibraryClipRow[]>; anthropicKey?: string; log?: (l: string) => void;
    /** Pre-pass only: the pool for the AI spend row (autocommit, survives the rollback) and where captions are collected. */
    aiDb?: Queryable; collect?: Map<string, string>;
    /** Locked pass: captions composed before the lock, by media id. */
    precomposed?: Map<string, string>;
  },
): Promise<DailyInstagramResult> {
  const { date, weekStart, now, timeZone } = c;
  const min = parseInstagramDailyMin(await getSetting<unknown>(db, INSTAGRAM_DAILY_MIN_KEY));
  const from = localToUtc(date, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(date, 1), "00:00", timeZone);

  // Every non-rejected timed post tomorrow, any platform and origin: counts toward caps; Instagram ones toward the minimum.
  const day = await db.query(
    `select platform, scheduled_for from batch_items
      where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz and scheduled_for < $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  );
  const existing = day.rows.map((r) => ({ platform: r.platform as "instagram", scheduledFor: new Date(r.scheduled_for).toISOString() }));
  const have = existing.filter((e) => e.platform === "instagram").length;
  const missing = min - have;
  if (missing <= 0) return empty(date, "enough", min, have);

  const since = new Date(now.getTime() - RECENT_USE_DAYS * 86_400_000);
  const recent = await db.query(
    `select distinct media_id from batch_items where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz`,
    [since.toISOString()],
  );
  // F26 A: also skip every clip that is the same video (lineage / fingerprint / name) as one on Instagram within 90 days.
  const videoIndex = await loadVideoIndex(db);
  const blocked = await blockedVideoIds(db, { platform: "instagram", now, at: from.toISOString(), index: videoIndex });
  const picked = pickDailyClips(await c.loadLibrary(db), { count: missing, recentlyUsed: [...recent.rows.map((r) => String(r.media_id)), ...blocked] });
  if (picked.length === 0) return empty(date, "no-clips", min, have);

  const cadence = await loadCadence(db);
  const items: ScheduleItem[] = picked.map((clip) => ({
    key: clip.id,
    pillar: clip.pillar ?? undefined,
    platforms: ["instagram"],
    capturedAt: clip.capturedAt ?? undefined,
    window: { notBefore: from.toISOString(), notAfter: to.toISOString() },
    sameDay: true,
  }));
  const plan = assignSlots({ weekStart: date, days: 1, items, cadence, timeZone, existing, now });
  const assignments = [...plan.assignments].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.key.localeCompare(b.key));
  if (assignments.length === 0) return { ...empty(date, "no-slots", min, have), unplaced: plan.unplaced.length };

  const found = await db.query(
    `select id from batches where week_start = $1::date and status <> 'archived' order by created_at desc, id desc limit 1`,
    [weekStart],
  );
  let batchId = found.rows[0]?.id as string | undefined;
  if (!batchId) batchId = (await db.query(`insert into batches (week_start, status) values ($1::date, 'draft') returning id`, [weekStart])).rows[0].id as string;

  const since14 = new Date(now.getTime() - CAPTION_REPEAT_DAYS * 86_400_000);
  const avoid = new Set<string>(
    (await db.query(`select distinct caption from batch_items where platform = 'instagram' and caption <> '' and created_at >= $1::timestamptz`, [since14.toISOString()])).rows.map((r) => String(r.caption)),
  );
  // F26 B: the last 30 days of Instagram captions (similarity) and the newest ones (hashtag-set repeats), plus each clip's folder + file name.
  const recentRows = (await db.query(`select caption from batch_items where platform = 'instagram' and caption <> '' and created_at >= $1::timestamptz order by created_at desc limit 200`, [new Date(now.getTime() - 30 * 86_400_000).toISOString()])).rows;
  const recentCaps: string[] = recentRows.map((r) => String(r.caption));
  const clipContext = await loadClipContext(db, picked.map((p) => p.id));
  const blocklist = blocklistFromEnv();
  const pillarOf = new Map(picked.map((p) => [p.id, p.pillar]));

  const inserted: string[] = [];
  let existingKeys = 0;
  let duplicates = 0;
  for (const a of assignments) {
    // Duplicate guard v2 (recentVideoUse): never the same video twice on Instagram within 90 days (this run's own inserts included).
    if ((await recentVideoUse(db, { mediaId: a.key, platform: "instagram", at: a.scheduledFor, now, index: videoIndex })).level === "block") {
      duplicates++;
      continue;
    }
    const key = dailyIngestKey(date, a.key);
    const pre = c.precomposed?.get(a.key);
    const composed = pre !== undefined
      ? { caption: pre || null }
      : await composeCaption(
          { group: captionGroupFor(pillarOf.get(a.key)), platform: "instagram", clipContext: clipContext.get(a.key) ?? null, recentCaptions: recentCaps, recentHashtagSets: hashtagSetsOf(recentCaps.slice(0, 5)), seed: key },
          { apiKey: c.collect ? c.anthropicKey : undefined, db: c.aiDb ?? db, now, log: c.log, blocklist },
        );
    const caption = composed.caption ?? ""; // nothing fresh left → "needs a caption"
    if (c.collect) {
      // pre-pass: remember the caption, write nothing
      c.collect.set(a.key, caption);
      if (caption) recentCaps.unshift(caption);
      continue;
    }
    const ins = await db.query(
      `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, created_at, updated_at)
       values ($1, $2, 'instagram', $3, null, $4::timestamptz, 'draft', 'daily', $5, null, $6, $6)
       on conflict (ingest_key) where ingest_key is not null do nothing
       returning id`,
      [batchId, a.key, caption, a.scheduledFor, key, now],
    );
    const id = ins.rows[0]?.id as string | undefined;
    if (!id) {
      existingKeys++;
      continue;
    }
    if (caption) {
      avoid.add(caption);
      recentCaps.unshift(caption);
    }
    inserted.push(id);
    await db.query(
      `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'add', null, 'draft', $2::jsonb, null, $3)`,
      [id, JSON.stringify({ origin: "daily", group: captionGroupFor(pillarOf.get(a.key)) }), now],
    );
  }

  let alertRaised = false;
  if (inserted.length > 0) {
    await db.query(`update batches set updated_at = $2 where id = $1`, [batchId, now]);
    const message = dailyReadyMessage(date, inserted.length);
    const raised = await db.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at)
       select 'batch-ready', $1, 'instagram', $2, $3
        where not exists (select 1 from alerts where kind = 'batch-ready' and message = $2)
       returning id`,
      [inserted[0], message, now],
    );
    alertRaised = raised.rows.length === 1;
  }
  return { date, min, existing: have, postsInserted: inserted.length, unplaced: plan.unplaced.length, existingKeys, duplicates, batchId, alertRaised, skipped: null };
}

/** Folder + file name per media id ("Upper body sets"); folder is migration 0016, so the name alone without it. */
async function loadClipContext(db: Queryable, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const name = (p: unknown) => String(p ?? "").split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "") ?? "";
  const hasFolder = (await db.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'media' and column_name = 'folder'`)).rows.length > 0;
  const { rows } = await db.query(`select id, source_path, ${hasFolder ? "folder" : "null::text as folder"} from media where id = any($1::uuid[])`, [ids]);
  for (const r of rows) out.set(String(r.id), [r.folder, name(r.source_path)].filter(Boolean).join(" "));
  return out;
}

/** Daily 17:00 creator-local. No TZ_CREATOR → one log line, nothing registered. */
export async function registerDailyInstagramJob(boss: CronBoss, pool: ConnectPool, timeZone: string | undefined, log: (l: string) => void = console.log): Promise<boolean> {
  if (!timeZone) {
    log(DAILY_NO_TZ_LINE);
    return false;
  }
  await boss.createQueue(QUEUES.dailyInstagram);
  await boss.work(QUEUES.dailyInstagram, async () => {
    return await runDailyInstagramOnce(pool, { timeZone, log, anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined }); // stored as the pg-boss job output (diagnose-week reads it)
  });
  await boss.schedule(QUEUES.dailyInstagram, DAILY_INSTAGRAM_CRON, {}, { tz: timeZone });
  return true;
}
