/**
 * "Approve & schedule" (F23 U2, server only). Step 1: addToCalendar writes DRAFT items with the caption/title the creator
 * typed. Step 2: the items it just created go through the normal approve path (planApproveSome → PgBatchStore.apply),
 * so a block warning (empty caption, duplicate, lint) leaves that item a draft. Only ids addToCalendar created are ever
 * approved: nothing else in the calendar is touched. No new publish path.
 */
import type { Platform } from "@autopilot/core";
import type { Pool } from "pg";
import { PgBatchStore } from "../batches/pg-store.js";
import { loadBatchFresh } from "../calendar/load.js";
import { planApproveSome } from "../calendar/plan.js";
import { addToCalendar, type ClipText } from "./add-to-calendar.js";

const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };

export interface ScheduleResult {
  /** Posts approved (they publish at their time). */
  scheduled: number;
  /** Drafts that stayed drafts, with the reason in plain words. */
  stayed: Array<{ itemId: string; platform: Platform; reason: string }>;
  /** Left out by the calendar rules (already scheduled, no slot, clip unavailable). */
  skipped: number;
}

export async function approveAndSchedule(
  pool: Pool,
  o: { mediaIds: readonly string[]; platforms: readonly Platform[]; overrides: Readonly<Record<string, ClipText>>; now: Date; timeZone: string; sessionId: string; approve: boolean },
): Promise<ScheduleResult> {
  const added = await addToCalendar(pool, { mediaIds: o.mediaIds, platforms: o.platforms, now: o.now, timeZone: o.timeZone, sessionId: o.sessionId, overrides: o.overrides });
  const result: ScheduleResult = { scheduled: 0, stayed: [], skipped: added.skipped.length };
  if (!o.approve || added.created.length === 0) return result;
  const byBatch = new Map<string, string[]>();
  for (const c of added.created) (byBatch.get(c.batchId) ?? byBatch.set(c.batchId, []).get(c.batchId)!).push(c.itemId);
  const store = new PgBatchStore(pool);
  for (const [batchId, ids] of byBatch) {
    const loaded = await loadBatchFresh(pool, batchId, o.now);
    if (!loaded) continue;
    const plan = planApproveSome(loaded.batch, ids, o.now);
    if (plan.changes.length > 0) await store.apply(batchId, plan.changes, plan.batchStatus, o.sessionId, o.now);
    result.scheduled += plan.approved.length;
    result.stayed.push(...plan.stayed);
  }
  return result;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Scheduled 5 posts · 1 left as a draft (needs a caption)". */
export function scheduleNote(r: ScheduleResult, approve = true): string {
  if (!approve) return r.skipped && r.stayed.length === 0 ? `Saved as drafts · ${plural(r.skipped, "post")} skipped` : "Saved as drafts. Approve them in the calendar.";
  const parts = [r.scheduled === 0 ? "Nothing scheduled" : `Scheduled ${plural(r.scheduled, "post")}`];
  if (r.stayed.length > 0) {
    const why = [...new Set(r.stayed.map((s) => reasonOf(s.reason, s.platform)))].slice(0, 2).join("; ");
    parts.push(`${r.stayed.length} left as ${r.stayed.length === 1 ? "a draft" : "drafts"} (${why})`);
  }
  if (r.skipped > 0) parts.push(`${r.skipped} skipped (already scheduled)`);
  return parts.join(" · ");
}

function reasonOf(reason: string, platform: Platform): string {
  const r = reason.replace(/^can't approve: /, "").replace(/\.$/, "");
  return /^(needs|is|has|too|no)\b/i.test(r) ? r.toLowerCase() : `${NAME[platform]}: ${r.toLowerCase()}`;
}
