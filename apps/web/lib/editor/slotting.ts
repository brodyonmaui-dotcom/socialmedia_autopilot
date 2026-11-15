import type { Pool } from "pg";
import { addCalendarDays, assignSlots, localDate, localToUtc, PLATFORMS, type CadenceSettings, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { parseEditorMeta } from "../batches/types.js";
import { PLATFORM_SHORT } from "./view.js";

/** What re-slotting needs to know about one item (read from the DB, never from the form). */
export interface SlotItem {
  id: string;
  platform: Platform;
  status: string;
  origin: string | null;
  /** trial.editor.earliest (ISO) or null. */
  earliest: string | null;
}

export type SlotResult = { ok: true; slots: Record<string, string> } | { ok: false; error: string };

/** Creator-local "tomorrow" as [notBefore, notAfter) instants. */
export function tomorrowWindow(now: Date, timeZone: string): { date: string; notBefore: Date; notAfter: Date } {
  const date = addCalendarDays(localDate(now, timeZone), 1);
  return { date, notBefore: localToUtc(date, "00:00", timeZone), notAfter: localToUtc(addCalendarDays(date, 1), "00:00", timeZone) };
}

// Fable to review: F15 "Move to tomorrow" slotting (window = tomorrow, sameDay, existing posts, caps)
/**
 * Pure: a slot tomorrow for every item, or an error and no slots at all (all-or-nothing, so one render
 * never ends up half moved). Each item is its own ScheduleItem (key = item id, one platform) with
 * `window` = tomorrow in the creator zone (narrowed by trial.editor.earliest) and `sameDay: true`, so
 * stagger is ignored and the flex grid is the fallback. `existing` = every other live post (drafts
 * included, so two editor drafts don't land on one time); caps come from the stored cadence.
 */
export function planTomorrow(items: SlotItem[], ctx: { now: Date; timeZone: string; cadence: CadenceSettings; existing: Array<{ platform: Platform; scheduledFor: string }> }): SlotResult {
  if (items.length === 0) return { ok: false, error: "nothing to move" };
  for (const i of items) {
    if (i.origin !== "editor") return { ok: false, error: "only editor drafts can be moved to tomorrow" };
    if (i.status !== "draft") return { ok: false, error: `can't move: ${PLATFORM_SHORT[i.platform] ?? i.platform} is ${i.status}, not draft` };
    if (!(PLATFORMS as readonly string[]).includes(i.platform)) return { ok: false, error: "unknown platform" };
  }
  const { date, notBefore, notAfter } = tomorrowWindow(ctx.now, ctx.timeZone);
  const res = assignSlots({
    weekStart: date,
    days: 1,
    items: items.map((i) => {
      const earliest = i.earliest ? Date.parse(i.earliest) : NaN;
      const start = Number.isFinite(earliest) && earliest > notBefore.getTime() ? new Date(earliest) : notBefore;
      return { key: i.id, platforms: [i.platform], sameDay: true, window: { notBefore: start.toISOString(), notAfter: notAfter.toISOString() } };
    }),
    cadence: ctx.cadence,
    timeZone: ctx.timeZone,
    existing: ctx.existing,
    now: ctx.now,
  });
  if (res.unplaced.length > 0) {
    const u = res.unplaced[0]!;
    const why = u.reason === "cap" ? `${PLATFORM_SHORT[u.platform]} is at its daily cap tomorrow` : `no free ${PLATFORM_SHORT[u.platform]} time tomorrow`;
    return { ok: false, error: `${why}; nothing changed` };
  }
  const slots: Record<string, string> = {};
  for (const a of res.assignments) slots[a.key] = a.scheduledFor;
  for (const i of items) if (!slots[i.id]) return { ok: false, error: "couldn't place every platform; nothing changed" };
  return { ok: true, slots };
}

/** Server-side: loads the items, cadence and existing posts, then planTomorrow. Read-only (the action writes via planTransition). */
export async function slotTomorrow(pool: Pool, itemIds: string[], now: Date, timeZone: string): Promise<SlotResult> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return { ok: false, error: "nothing to move" };
  const { rows } = await pool.query(`select id, platform, status, origin, trial from batch_items where id = any($1::uuid[])`, [ids]);
  if (rows.length !== ids.length) return { ok: false, error: "item not found, reload" };
  const items: SlotItem[] = rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    status: r.status,
    origin: r.origin ?? null,
    earliest: parseEditorMeta(r.trial)?.earliest ?? null,
  }));
  const { notBefore, notAfter } = tomorrowWindow(now, timeZone);
  const [cadence, existing] = await Promise.all([
    loadCadence(pool),
    pool.query(
      `select platform, scheduled_for from batch_items
        where scheduled_for is not null and status not in ('rejected', 'failed') and not (id = any($1::uuid[]))
          and scheduled_for >= $2 and scheduled_for < $3`,
      [ids, new Date(notBefore.getTime() - 86_400_000), new Date(notAfter.getTime() + 86_400_000)],
    ),
  ]);
  return planTomorrow(items, {
    now,
    timeZone,
    cadence,
    existing: existing.rows.map((r) => ({ platform: r.platform as Platform, scheduledFor: (r.scheduled_for instanceof Date ? r.scheduled_for : new Date(r.scheduled_for)).toISOString() })),
  });
}
// End of F15 "Move to tomorrow" slotting.

/** One item: its new time tomorrow, or why not. */
export async function moveToTomorrow(pool: Pool, itemId: string, now: Date, timeZone: string): Promise<{ scheduledFor: string } | { error: string }> {
  const r = await slotTomorrow(pool, [itemId], now, timeZone);
  return r.ok ? { scheduledFor: r.slots[itemId]! } : { error: r.error };
}
