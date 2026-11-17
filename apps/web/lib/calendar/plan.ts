// Calendar action planning (pure). Every change is planned by the existing planTransition on a batch
// that carries fresh server-side warnings; nothing here writes. Tested in __tests__/plan.test.ts.
import { addCalendarDays, localDate, localHHMM, type Platform } from "@autopilot/core";
import { planTransition, type ItemChange } from "../batches/transitions.js";
import type { BatchView } from "../batches/types.js";
import { fromDatetimeLocal } from "../batches/view-model.js";
import { computeWarnings, type WarningContext } from "../batches/warnings.js";
import { planEdits } from "../editor/move.js";

const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };

export interface ApprovePlan {
  changes: ItemChange[];
  batchStatus: "draft" | "approved";
  approved: Array<{ itemId: string; platform: Platform }>;
  stayed: Array<{ itemId: string; platform: Platform; reason: string }>;
}

/**
 * Approve what can be approved among `itemIds`: each id is first planned on its own with planTransition
 * 'approve' (the same block path as everywhere else: block warnings, past time, no time, handed off),
 * then the passing ones are approved together through planTransition again. A block-warning item is never
 * approved; it is reported in `stayed`. Ids that aren't in the batch are ignored.
 */
export function planApproveSome(batch: BatchView, itemIds: string[], now: Date): ApprovePlan {
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  const ok: string[] = [];
  const stayed: ApprovePlan["stayed"] = [];
  for (const id of new Set(itemIds)) {
    const item = byId.get(id);
    if (!item || item.status !== "draft") continue;
    const single = planTransition(batch, { kind: "approve", itemIds: [id] }, now);
    if (single.ok) ok.push(id);
    else stayed.push({ itemId: id, platform: item.platform, reason: item.warnings.find((w) => w.severity === "block")?.message ?? single.reason });
  }
  if (ok.length === 0) return { changes: [], batchStatus: batch.status, approved: [], stayed };
  const plan = planTransition(batch, { kind: "approve", itemIds: ok }, now);
  if (!plan.ok) return { changes: [], batchStatus: batch.status, approved: [], stayed: [...stayed, { itemId: plan.itemId ?? ok[0]!, platform: byId.get(plan.itemId ?? ok[0]!)!.platform, reason: plan.reason }] };
  return { changes: plan.changes, batchStatus: plan.batchStatus, approved: plan.changes.map((c) => ({ itemId: c.itemId, platform: byId.get(c.itemId)!.platform })), stayed };
}

/** "Approved 3. 1 stayed: TikTok needs a caption" (sentence case, plain words). */
export function approveNote(approved: number, stayed: Array<{ platform: Platform; reason: string }>): string {
  const head = approved === 0 ? "Nothing approved" : `Approved ${approved}`;
  if (stayed.length === 0) return `${head}. Nothing goes out before its time.`;
  const why = stayed.slice(0, 2).map((s) => `${NAME[s.platform]} ${s.reason.replace(/^can't approve: /, "")}`).join("; ");
  return `${head}. ${stayed.length} stayed: ${why}${stayed.length > 2 ? "; …" : ""}`;
}

/** Per-platform counts for the Approve-all confirm: what will be approved and what stays (with why). */
export function approveAllSummary(batches: BatchView[], itemIds: Set<string>, now: Date) {
  const will: Partial<Record<Platform, number>> = {};
  const stays: Array<{ platform: Platform; title: string; reason: string }> = [];
  for (const b of batches) {
    const ids = b.items.filter((i) => itemIds.has(i.id)).map((i) => i.id);
    const plan = planApproveSome(b, ids, now);
    for (const a of plan.approved) will[a.platform] = (will[a.platform] ?? 0) + 1;
    for (const s of plan.stayed) {
      const item = b.items.find((i) => i.id === s.itemId)!;
      stays.push({ platform: s.platform, title: item.title?.trim() || item.media.label, reason: s.reason });
    }
  }
  return { will, total: Object.values(will).reduce((a, n) => a + (n ?? 0), 0), stays };
}

export type MovePlan = { ok: true; changes: ItemChange[]; batchStatus: "draft" | "approved" } | { ok: false; reason: string };

/**
 * Move items to `date` (YYYY-MM-DD, creator zone). Each keeps its own local time unless `time` ("HH:MM") is
 * given. Planned as an edit of the time through planTransition (via planEdits: handed-off items refuse), then
 * re-validated: the warnings are recomputed with the new times (caps, past time, …) and any new time block
 * on a moved item refuses the whole move with that reason. All or nothing; nothing changes on a refusal.
 */
export function planMove(batch: BatchView, ctx: WarningContext, itemIds: string[], date: string, time: string | null, now: Date): MovePlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "pick a date" };
  if (time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, reason: "that time isn't valid" };
  const items = batch.items.filter((i) => itemIds.includes(i.id));
  if (items.length === 0) return { ok: false, reason: "nothing to move" };
  const patches: Array<{ itemId: string; patch: { scheduledFor: string } }> = [];
  for (const i of items) {
    const hhmm = time ?? (i.scheduledFor ? localHHMM(new Date(i.scheduledFor), ctx.timeZone) : null);
    if (!hhmm) return { ok: false, reason: `${NAME[i.platform]} has no time yet: pick one` };
    const iso = fromDatetimeLocal(`${date}T${hhmm}`, ctx.timeZone);
    if (!iso) return { ok: false, reason: "that date isn't valid" };
    patches.push({ itemId: i.id, patch: { scheduledFor: iso } });
  }
  const plan = planEdits(batch, patches, now);
  if (!plan.ok) return { ok: false, reason: plan.reason.replace(/^can't edit/, "can't move") };
  if (plan.changes.length === 0) return { ok: false, reason: "already on that day" };
  // Re-validate with the new times.
  const moved = new Map(patches.map((p) => [p.itemId, p.patch.scheduledFor]));
  const next = batch.items.map((i) => (moved.has(i.id) ? { ...i, scheduledFor: moved.get(i.id)!, status: "draft" as const } : i));
  const ws = computeWarnings(next, { ...ctx, now });
  for (const id of moved.keys()) {
    const block = (ws.get(id) ?? []).find((w) => w.severity === "block" && w.field === "time");
    if (block) return { ok: false, reason: `can't move there: ${block.message}` };
  }
  return plan;
}

/** "Tomorrow" in the creator zone (for the quick option label). */
export const tomorrowOf = (now: Date, timeZone: string) => addCalendarDays(localDate(now, timeZone), 1);
