// F19 S1: reschedule missed posts. An approved post the worker held back (more than an hour past its
// time, see isMissedSlot) gets a new free time and STAYS approved: the creator's tap on a confirm that
// shows the new time is the approval of that time. The idempotency key is never touched (the post was
// never sent: the missed-slot guard holds it before any claim).
//
// Data integrity (CLAUDE.md non-negotiables 2-3):
//  - One transaction under pg_advisory_xact_lock(hashtext('reschedule-missed')), so two taps never plan
//    against the same free slots. The preview is advisory: rows are re-selected `for update`, re-checked
//    as missed and re-planned inside the lock.
//  - Each write is optimistic: `where status = 'approved' and scheduled_for = <the time we saw>`; 0 rows
//    → that item is skipped, never forced.
//  - Same transaction: one batch_item_events 'move' row and the item's open missed-slot alert acknowledged.
import type { Pool, PoolClient } from "pg";
import { assignSlots, localDate, PLATFORMS, seriesOf, type CadenceSettings, type ExistingPost, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { isMissedSlot, MISSED_GRACE_MS } from "../status/posting.js";

export interface ReschedulePlanRow {
  id: string;
  platform: Platform;
  /** Current time (ISO). */
  from: string;
  /** New time (ISO), or null when the item is left as it is (see reason). */
  to: string | null;
  series: { key: string; day: number } | null;
  title: string;
  reason?: "no-slot" | "not-missed";
}

/** What the planner needs about one item (always read from the DB). */
export interface RescheduleCandidate {
  id: string;
  platform: Platform;
  status: string;
  batchStatus: string;
  scheduledFor: string | null;
  title: string | null;
  caption: string;
}

/** New times start this far from now (time to see the confirm and for the worker to pick it up)… */
export const RESCHEDULE_LEAD_MS = 10 * 60_000;
/** …and must land within this horizon, else "no-slot". */
export const RESCHEDULE_HORIZON_MS = 7 * 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_SQL = `select pg_advisory_xact_lock(hashtext('reschedule-missed'))`;

/** Missed = approved item in an approved batch, not Snapchat, more than the grace past its time (one definition: isMissedSlot). */
export function isRescheduleable(c: RescheduleCandidate, now: Date): boolean {
  return c.batchStatus === "approved" && (PLATFORMS as readonly string[]).includes(c.platform) && isMissedSlot(c, now);
}

function label(c: RescheduleCandidate): string {
  const text = (c.title?.trim() || c.caption.trim()).split("\n")[0]!.trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/**
 * Pure. Series rows first (by series key, then day ascending: Day 10 gets the earliest slot and Day 11 can't
 * land before it on the same platform), then evergreen rows by original time. Each row is placed alone with
 * assignSlots (one platform, sameDay = earliest free time, window [now + 10 min, now + 7 days)) against `existing` plus every assignment
 * already made here. Rows that aren't missed come back with `to: null, reason: "not-missed"`, after the rest.
 */
export function planReschedule(
  candidates: RescheduleCandidate[],
  ctx: { now: Date; timeZone: string; cadence: CadenceSettings; existing: ExistingPost[] },
): ReschedulePlanRow[] {
  const rows = candidates.map((c) => ({ c, series: seriesOf(c.title?.trim() || c.caption) }));
  const missed = rows.filter((r) => isRescheduleable(r.c, ctx.now));
  const notMissed = rows.filter((r) => !isRescheduleable(r.c, ctx.now));
  const byTime = (a: RescheduleCandidate, b: RescheduleCandidate) => ms(a.scheduledFor) - ms(b.scheduledFor) || a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id);
  missed.sort((a, b) => {
    if (a.series && b.series) return a.series.key.localeCompare(b.series.key) || a.series.day - b.series.day || byTime(a.c, b.c);
    if (a.series || b.series) return a.series ? -1 : 1;
    return byTime(a.c, b.c);
  });

  const notBefore = new Date(ctx.now.getTime() + RESCHEDULE_LEAD_MS);
  const notAfter = new Date(ctx.now.getTime() + RESCHEDULE_HORIZON_MS);
  const window = { notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() };
  const weekStart = localDate(notBefore, ctx.timeZone);
  const existing = [...ctx.existing];
  const out: ReschedulePlanRow[] = [];
  for (const { c, series } of missed) {
    const res = assignSlots({
      weekStart,
      days: 8, // the 7-day window can touch 8 local dates
      // sameDay = earliest free time first (grid, then the flex grid), not the weekly least-loaded-day spread:
      // that is what keeps Day 11 at or after Day 10. Still capped, gapped and inside the window.
      items: [{ key: c.id, platforms: [c.platform], window, sameDay: true }],
      cadence: ctx.cadence,
      timeZone: ctx.timeZone,
      existing,
      now: ctx.now,
    });
    const to = res.assignments.find((a) => a.key === c.id && a.platform === c.platform)?.scheduledFor ?? null;
    if (to) existing.push({ platform: c.platform, scheduledFor: to });
    out.push({ id: c.id, platform: c.platform, from: c.scheduledFor!, to, series, title: label(c), ...(to ? {} : { reason: "no-slot" as const }) });
  }
  for (const { c, series } of notMissed) {
    out.push({ id: c.id, platform: c.platform, from: c.scheduledFor ?? "", to: null, series, title: label(c), reason: "not-missed" });
  }
  return out;
}

/** The action's returnTo: a same-origin relative path ("/…", never "//host", no backslashes or whitespace), else the calendar. */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 500) return "/calendar";
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\s\\]/.test(raw)) return "/calendar";
  return raw;
}

// ---------------------------------------------------------------- DB

type Q = Pick<PoolClient, "query">;

interface LoadedCandidate extends RescheduleCandidate {
  /** scheduled_for exactly as Postgres prints it (microseconds kept) for the optimistic `scheduled_for = $from` check. */
  fromRaw: string | null;
}

const SELECT_COLS = `bi.id, bi.platform, bi.status, b.status as batch_status, bi.scheduled_for, bi.scheduled_for::text as from_raw, bi.title, bi.caption`;

async function loadCandidates(q: Q, itemIds: string[] | "all", now: Date, forUpdate: boolean): Promise<LoadedCandidate[]> {
  const lock = forUpdate ? " for update of bi" : "";
  const { rows } =
    itemIds === "all"
      ? await q.query(
          `select ${SELECT_COLS} from batch_items bi join batches b on b.id = bi.batch_id
            where bi.status = 'approved' and b.status = 'approved' and bi.platform <> 'snapchat' and bi.scheduled_for < $1
            order by bi.scheduled_for, bi.id${lock}`,
          [new Date(now.getTime() - MISSED_GRACE_MS)], // a pre-filter; the planner re-checks each row with isMissedSlot
        )
      : await q.query(`select ${SELECT_COLS} from batch_items bi join batches b on b.id = bi.batch_id where bi.id = any($1::uuid[]) order by bi.id${lock}`, [itemIds]);
  return rows.map((r) => ({
    id: r.id as string,
    platform: r.platform as Platform,
    status: r.status as string,
    batchStatus: r.batch_status as string,
    scheduledFor: r.scheduled_for ? new Date(r.scheduled_for as Date | string).toISOString() : null,
    fromRaw: (r.from_raw as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    caption: (r.caption as string | null) ?? "",
  }));
}

/** Every non-rejected timed post on any platform around the window (a day either side, for caps and gaps), minus the movers. */
async function loadExisting(q: Q, now: Date, excludeIds: string[]): Promise<ExistingPost[]> {
  const from = new Date(now.getTime() + RESCHEDULE_LEAD_MS - 86_400_000);
  const to = new Date(now.getTime() + RESCHEDULE_HORIZON_MS + 86_400_000);
  const { rows } = await q.query(
    `select platform, scheduled_for from batch_items
      where scheduled_for is not null and status <> 'rejected' and not (id = any($1::uuid[]))
        and scheduled_for >= $2 and scheduled_for < $3`,
    [excludeIds, from, to],
  );
  return rows.map((r) => ({ platform: r.platform as Platform, scheduledFor: new Date(r.scheduled_for as Date | string).toISOString() }));
}

const cleanIds = (ids: string[]): string[] => [...new Set(ids.filter((i) => typeof i === "string" && UUID.test(i)))];

/** Read-only: what a reschedule would do now. Advisory only; rescheduleMissed re-plans inside its lock. */
export async function previewRescheduleMissed(pool: Pool, itemIds: string[] | "all", now: Date, timeZone: string): Promise<ReschedulePlanRow[]> {
  const ids = itemIds === "all" ? "all" : cleanIds(itemIds);
  if (ids !== "all" && ids.length === 0) return [];
  const candidates = await loadCandidates(pool, ids, now, false);
  const [cadence, existing] = await Promise.all([loadCadence(pool), loadExisting(pool, now, candidates.map((c) => c.id))]);
  return planReschedule(candidates, { now, timeZone, cadence, existing });
}

/**
 * Moves the given missed posts to new free times, all in one transaction (see the header). Returns the
 * plan as written: a row with `to` was moved; `to: null` was left untouched (its `reason` says why).
 */
export async function rescheduleMissed(pool: Pool, itemIds: string[], now: Date, timeZone: string, sessionId: string | null): Promise<ReschedulePlanRow[]> {
  const ids = cleanIds(itemIds);
  if (ids.length === 0) return [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(LOCK_SQL);
    const candidates = await loadCandidates(client, ids, now, true);
    const cadence = await loadCadence(client);
    const existing = await loadExisting(client, now, candidates.map((c) => c.id));
    const plan = planReschedule(candidates, { now, timeZone, cadence, existing });
    const raw = new Map(candidates.map((c) => [c.id, c.fromRaw]));
    const out: ReschedulePlanRow[] = [];
    for (const row of plan) {
      if (!row.to) {
        out.push(row);
        continue;
      }
      const res = await client.query(
        `update batch_items set scheduled_for = $2, approved_at = $3, updated_at = $3
          where id = $1 and status = 'approved' and scheduled_for = $4::timestamptz`,
        [row.id, row.to, now, raw.get(row.id)],
      );
      if (res.rowCount !== 1) {
        out.push({ ...row, to: null, reason: "not-missed" });
        continue;
      }
      await client.query(
        `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at)
         values ($1, 'move', 'approved', 'approved', $2::jsonb, $3, $4)`,
        [row.id, JSON.stringify({ reason: "missed-reschedule", from: row.from, to: row.to }), sessionId, now],
      );
      await client.query(
        // Resolved: remove the row (alerts are unique per kind + item), so a later miss of the new time raises a fresh one.
        `delete from alerts where kind = 'missed-slot' and batch_item_id = $1`,
        [row.id],
      );
      out.push(row);
    }
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
