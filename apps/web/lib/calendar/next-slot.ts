// "Next open <platform> slot" for the Move dialog. Reuses the scheduler (assignSlots) exactly like the
// missed-post reschedule: one item, one platform, sameDay = earliest free time, window [after, after + 7 days),
// against every non-rejected timed post (minus the movers) so caps, gaps and taken slots are respected.
import type { Pool } from "pg";
import { assignSlots, localDate, type ExistingPost, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";

export const NEXT_SLOT_HORIZON_MS = 7 * 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO of the earliest open slot for `platform` after `after` (within 7 days), or null. Read-only. */
export async function nextAvailableSlot(pool: Pool, platform: Platform, after: Date, timeZone: string, excludeItemIds: string[] = []): Promise<string | null> {
  const exclude = excludeItemIds.filter((i) => UUID.test(i));
  const notAfter = new Date(after.getTime() + NEXT_SLOT_HORIZON_MS);
  const [cadence, rows] = await Promise.all([
    loadCadence(pool),
    pool.query(
      `select platform, scheduled_for from batch_items
        where scheduled_for is not null and status <> 'rejected' and not (id = any($1::uuid[]))
          and scheduled_for >= $2 and scheduled_for < $3`,
      [exclude, new Date(after.getTime() - 86_400_000), new Date(notAfter.getTime() + 86_400_000)],
    ),
  ]);
  const existing: ExistingPost[] = rows.rows.map((r) => ({ platform: r.platform as Platform, scheduledFor: new Date(r.scheduled_for as Date | string).toISOString() }));
  const key = "next-slot";
  const res = assignSlots({
    weekStart: localDate(after, timeZone),
    days: 8,
    items: [{ key, platforms: [platform], window: { notBefore: after.toISOString(), notAfter: notAfter.toISOString() }, sameDay: true }],
    cadence,
    timeZone,
    existing,
    now: after,
  });
  return res.assignments.find((a) => a.key === key && a.platform === platform)?.scheduledFor ?? null;
}
