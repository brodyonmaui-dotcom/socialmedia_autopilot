// F10 Snapchat handoff: DB access (server only). See docs/design/F10.md.
// Every write is a conditional `update … where id=$1 and platform='snapchat' and status='approved'`
// (plus approved_at set and the batch approved); 0 rows → refuse. Nothing is ever deleted.
import type { Pool, PoolClient } from "pg";
import { SNAPCHAT_CHECKLIST, snapchatCaption } from "@autopilot/adapters";
import { addCalendarDays, assertTimeZone, localDate, localToUtc } from "@autopilot/core";
import { blocklistFromEnv } from "@autopilot/research";
import { mediaLabel } from "../batches/pg-store.js";
import { bucketFor, handoffBlocks, skipTarget } from "./logic.js";
import type { HandoffItem, HandoffList } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

export const RELOAD = "changed underneath you, reload";

export interface HandoffContext {
  /** Creator zone from TZ_CREATOR; null when unset or invalid (the page says "TZ_CREATOR not set" and lists nothing). Never guessed. */
  timeZone: string | null;
  blocklist: string[];
}

/** TZ_CREATOR + PRIVACY_BLOCKLIST from .env. Unlike the batch page there is no UTC fallback: a wrong "today" means a double share. */
export function handoffContext(env: Record<string, string | undefined> = process.env): HandoffContext {
  let timeZone: string | null = null;
  if (env.TZ_CREATOR) {
    try {
      timeZone = assertTimeZone(env.TZ_CREATOR);
    } catch {
      timeZone = null;
    }
  }
  return { timeZone, blocklist: blocklistFromEnv(env) };
}

/** First instant of the creator-local day after `today`: anything before it is due. */
const dueBefore = (today: string, timeZone: string): Date => localToUtc(addCalendarDays(today, 1), "00:00", timeZone);

/** The shared "listed on /handoff" condition (bi = batch_items, b = batches). */
const LISTED = `bi.platform = 'snapchat' and bi.status = 'approved' and bi.approved_at is not null and b.status = 'approved' and bi.scheduled_for is not null`;

/** Snapchat items due today (creator-local) or earlier and still approved. Today first, then missed, each by time. */
export async function listHandoff(pool: Pool, now: Date, timeZone: string, blocklist: string[]): Promise<HandoffList> {
  const today = localDate(now, timeZone);
  const { rows } = await pool.query(
    `select bi.id, bi.batch_id, bi.media_id, bi.caption, bi.scheduled_for, m.source_path, m.r2_key, m.duration_s
       from batch_items bi
       join batches b on b.id = bi.batch_id
       join media m on m.id = bi.media_id
      where ${LISTED} and bi.scheduled_for < $1
      order by bi.scheduled_for asc, bi.created_at asc`,
    [dueBefore(today, timeZone)],
  );
  const out: HandoffList = { today: [], missed: [] };
  for (const r of rows) {
    const scheduledFor = iso(r.scheduled_for);
    const bucket = bucketFor(scheduledFor, today, timeZone);
    if (bucket === "future") continue; // belt and braces: the SQL bound already excludes these
    const caption = snapchatCaption(r.caption ?? "");
    const hasCleanFile = r.r2_key != null;
    const item: HandoffItem = {
      id: r.id,
      batchId: r.batch_id,
      mediaId: r.media_id,
      label: mediaLabel(r.source_path, r.media_id),
      ...(r.duration_s != null ? { durationS: Number(r.duration_s) } : {}),
      scheduledFor,
      localDay: localDate(new Date(scheduledFor), timeZone),
      bucket,
      caption,
      checklist: [...SNAPCHAT_CHECKLIST],
      hasCleanFile,
      blocks: handoffBlocks(caption, hasCleanFile, blocklist),
    };
    out[bucket].push(item);
  }
  return out;
}

/** The clean file's key, only for a listed item that is due and has one. Never returns source_path. */
export async function loadShareable(pool: Pool, itemId: string, now: Date, timeZone: string): Promise<{ r2Key: string } | null> {
  if (!UUID.test(itemId)) return null;
  const today = localDate(now, timeZone);
  const { rows } = await pool.query(
    `select bi.scheduled_for, m.r2_key
       from batch_items bi
       join batches b on b.id = bi.batch_id
       join media m on m.id = bi.media_id
      where bi.id = $1 and ${LISTED} and bi.scheduled_for < $2 and m.r2_key is not null`,
    [itemId, dueBefore(today, timeZone)],
  );
  const r = rows[0];
  if (!r || typeof r.r2_key !== "string" || r.r2_key === "") return null;
  if (bucketFor(iso(r.scheduled_for), today, timeZone) === "future") return null;
  return { r2Key: r.r2_key };
}

/** An optional pasted Spotlight link: https and a snapchat.com host, else null (dropped, not stored). */
export function cleanSpotlightUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "snapchat.com" && !host.endsWith(".snapchat.com")) return null;
  return u.toString();
}

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Rolls back the transaction with a refusal (thrown so inTx rolls back, caught by the caller). */
class Refuse extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

async function refusable<T extends { ok: true }>(p: Promise<T>): Promise<T | { ok: false; reason: string }> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Refuse) return { ok: false, reason: err.reason };
    throw err;
  }
}

const insertEvent = (c: PoolClient | Pool, itemId: string, kind: string, from: string, to: string, detail: unknown, sessionId: string, now: Date) =>
  c.query(
    `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [itemId, kind, from, to, detail == null ? null : JSON.stringify(detail), sessionId, now],
  );

/** The conditional-write guard on batch_items (alias-free, for `update batch_items … where`). */
const WRITABLE = `id = $1 and platform = 'snapchat' and status = 'approved' and approved_at is not null
  and exists (select 1 from batches b where b.id = batch_items.batch_id and b.status = 'approved')`;

/** approved → published after the creator shared it. A second call (or a changed row) is refused. */
export async function markPosted(pool: Pool, itemId: string, sessionId: string, url: string | null, now: Date): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!UUID.test(itemId)) return { ok: false, reason: "unknown item" };
  const link = cleanSpotlightUrl(url);
  return refusable(
    inTx(pool, async (c) => {
      const res = await c.query(`update batch_items set status = 'published', updated_at = $2, platform_post_url = $3 where ${WRITABLE} returning id`, [itemId, now, link]);
      if (res.rowCount !== 1) throw new Refuse(RELOAD);
      await insertEvent(c, itemId, "snap-posted", "approved", "published", { link: link != null }, sessionId, now);
      return { ok: true as const };
    }),
  );
}

/** Advisory-lock key that serialises Snapchat skips (exported for the race test). */
export const SKIP_LOCK_KEY = "autopilot:handoff:snapchat-skip";

/** Statuses that hold a creator-local Snapchat day (cap 1/day). */
const HOLDS_DAY = `('approved', 'queued', 'publishing', 'published', 'unknown')`;

/**
 * Moves a due item to the next creator-local day with no other Snapchat item, same local time.
 * One transaction: an advisory lock serialises skips, and the Snapchat rows are locked `for update`,
 * so two concurrent skips can never land two items on one day. Returns the new local day.
 */
export async function skipToNextDay(pool: Pool, itemId: string, sessionId: string, timeZone: string, now: Date): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  if (!UUID.test(itemId)) return { ok: false, reason: "unknown item" };
  const today = localDate(now, timeZone);
  return refusable(
    inTx(pool, async (c) => {
      await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [SKIP_LOCK_KEY]);
      const { rows } = await c.query(
        `select id, status, scheduled_for from batch_items
          where platform = 'snapchat' and status in ${HOLDS_DAY} and scheduled_for is not null
          order by id for update`,
      );
      const self = rows.find((r) => r.id === itemId && r.status === "approved");
      if (!self) throw new Refuse(RELOAD);
      const fromIso = iso(self.scheduled_for);
      if (bucketFor(fromIso, today, timeZone) === "future") throw new Refuse("not due yet");
      const taken = new Set<string>(rows.filter((r) => r.id !== itemId).map((r) => localDate(new Date(iso(r.scheduled_for)), timeZone)));
      const target = skipTarget({ scheduledFor: fromIso }, taken, timeZone, today);
      if (!target) throw new Refuse("no free day in the next 14 days");
      // The row is locked above, so its time can't have moved since we read it.
      const res = await c.query(`update batch_items set scheduled_for = $2, updated_at = $3 where ${WRITABLE} returning id`, [itemId, target.scheduledFor, now]);
      if (res.rowCount !== 1) throw new Refuse(RELOAD);
      await insertEvent(c, itemId, "snap-skip", "approved", "approved", { from: fromIso, to: target.scheduledFor }, sessionId, now);
      return { ok: true as const, to: target.localDay };
    }),
  );
}

/**
 * F2 reject semantics: status 'rejected', approval cleared (approved_at / approved_session null), and
 * the batch drops back to draft when nothing in it sits outside draft/rejected any more.
 */
export async function dropItem(pool: Pool, itemId: string, sessionId: string, now: Date): Promise<{ ok: boolean; reason?: string }> {
  if (!UUID.test(itemId)) return { ok: false, reason: "unknown item" };
  return refusable(
    inTx(pool, async (c) => {
      const res = await c.query(
        `update batch_items set status = 'rejected', approved_at = null, approved_session = null, updated_at = $2 where ${WRITABLE} returning batch_id`,
        [itemId, now],
      );
      if (res.rowCount !== 1) throw new Refuse(RELOAD);
      await insertEvent(c, itemId, "snap-drop", "approved", "rejected", null, sessionId, now);
      await c.query(
        `update batches set status = 'draft', approved_at = null, updated_at = $2
          where id = $1 and status = 'approved'
            and not exists (select 1 from batch_items bi where bi.batch_id = $1 and bi.status not in ('draft', 'rejected'))`,
        [res.rows[0].batch_id, now],
      );
      return { ok: true as const };
    }),
  );
}
