"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { fillTimesChanges, planFillTimes } from "../../lib/batches/fill-times.js";
import { checkInstagram, planResetChecked, type IgCheckResult } from "../../lib/batches/ig-check.js";
import { PgBatchStore } from "../../lib/batches/pg-store.js";
import { ConflictError } from "../../lib/batches/store.js";
import { planTransition } from "../../lib/batches/transitions.js";
import { batchStatusOf } from "../../lib/batches/view-model.js";
import { loadBatchFresh } from "../../lib/calendar/load.js";
import { safeBack, withResult } from "../../lib/calendar/model.js";
import { approveNote, planApproveSome, planMove } from "../../lib/calendar/plan.js";
import { planEdits } from "../../lib/editor/move.js";
import { slotTomorrow } from "../../lib/editor/slotting.js";
import { handoffContext } from "../../lib/handoff/store.js";

/**
 * Calendar actions (they replace the batch screen's). Every write is planned by planTransition on a batch
 * freshly loaded with server-side warnings and written by PgBatchStore.apply, as before; nothing here
 * writes batch_items any other way. Each action redirects back to the calendar URL it came from (the
 * `back` field, only /calendar… or Home) with a short ?note= or ?error=.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

class UserError extends Error {
  override name = "UserError";
}

/** "batchId:itemId" form values → item ids per batch (malformed values dropped). */
function itemsByBatch(fd: FormData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of fd.getAll("item").map(String)) {
    const [b, i] = v.split(":");
    if (!b || !i || !UUID.test(b) || !UUID.test(i)) continue;
    const list = out.get(b) ?? out.set(b, []).get(b)!;
    if (!list.includes(i)) list.push(i);
  }
  return out;
}

/** Do the work, then revalidate and redirect back with the result. redirect() throws, so it stays outside the try. */
async function run(fd: FormData, drop: string[], fn: () => Promise<string | undefined>): Promise<void> {
  const back = safeBack(fd.get("back"));
  let error: string | undefined;
  let note: string | undefined;
  try {
    note = await fn();
  } catch (err) {
    const e = err as Error;
    if (e instanceof ConflictError) error = "Changed underneath you: reload and try again.";
    else if (e instanceof UserError) error = e.message;
    else {
      console.error(`calendar action failed: ${e.name}`);
      error = "Something went wrong. Nothing changed.";
    }
  }
  revalidatePath("/calendar");
  revalidatePath("/", "layout");
  redirect(withResult(back, { note, error }, error ? [] : drop));
}

async function fresh(batchId: string, now: Date) {
  const loaded = await loadBatchFresh(getPool(), batchId, now);
  if (!loaded) throw new UserError("That week isn't there any more: reload.");
  return loaded;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Approve the given items that can be approved (block warnings never are). Field: item = "batchId:itemId", repeated. */
export async function approveItemsAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["approve"], async () => {
    const groups = itemsByBatch(fd);
    if (groups.size === 0) throw new UserError("Nothing selected.");
    const now = new Date();
    const store = new PgBatchStore(getPool());
    let approved = 0;
    const stayed: Array<{ platform: import("@autopilot/core").Platform; reason: string }> = [];
    for (const [batchId, ids] of groups) {
      const { batch } = await fresh(batchId, now);
      const plan = planApproveSome(batch, ids, now);
      if (plan.changes.length > 0) await store.apply(batchId, plan.changes, plan.batchStatus, session.id, now);
      approved += plan.approved.length;
      stayed.push(...plan.stayed);
    }
    if (approved === 0 && stayed.length > 0) throw new UserError(approveNote(0, stayed));
    return approveNote(approved, stayed);
  });
}

/** "Approve all N" after its confirm Dialog: the same path as approveItemsAction, for every draft in view. */
export async function approveAllAction(fd: FormData): Promise<void> {
  await requireSession();
  return approveItemsAction(fd);
}

/** Reject (after its confirm): the existing reject transition. Rows stay; nothing is deleted. */
export async function rejectItemsAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["reject", "day"], async () => {
    const groups = itemsByBatch(fd);
    if (groups.size === 0) throw new UserError("Nothing selected.");
    const now = new Date();
    const store = new PgBatchStore(getPool());
    let n = 0;
    for (const [batchId, ids] of groups) {
      const { batch } = await fresh(batchId, now);
      const plan = planTransition(batch, { kind: "reject", itemIds: ids }, now);
      if (!plan.ok) throw new UserError(cap(plan.reason));
      await store.apply(batchId, plan.changes, plan.batchStatus, session.id, now);
      n += plan.changes.length;
    }
    return `Rejected ${n}. Kept under "Show rejected".`;
  });
}

/**
 * Edit text. Fields: item ("batchId:itemId", repeated), caption:<itemId>, title:<itemId> (YouTube). The
 * existing edit transition (an approved post goes back to "Needs approval"). All or nothing per week.
 */
export async function editTextAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["edit"], async () => {
    const groups = itemsByBatch(fd);
    if (groups.size === 0) throw new UserError("Nothing selected.");
    const now = new Date();
    const store = new PgBatchStore(getPool());
    let n = 0;
    let unapproved = false;
    for (const [batchId, ids] of groups) {
      const { batch } = await fresh(batchId, now);
      const patches = ids.map((itemId) => {
        const patch: { caption?: string; title?: string | null } = {};
        if (fd.has(`caption:${itemId}`)) patch.caption = str(fd, `caption:${itemId}`).replace(/\r\n/g, "\n");
        if (fd.has(`title:${itemId}`)) patch.title = str(fd, `title:${itemId}`).trim() || null;
        return { itemId, patch };
      });
      const plan = planEdits(batch, patches, now);
      if (!plan.ok) throw new UserError(cap(plan.reason));
      if (plan.changes.length === 0) continue;
      unapproved ||= plan.changes.some((c) => c.from !== "draft");
      await store.apply(batchId, plan.changes, plan.batchStatus, session.id, now);
      n += plan.changes.length;
    }
    if (n === 0) return "Nothing changed.";
    return `Saved ${n}.${unapproved ? " Approve it again when you're happy." : ""}`;
  });
}

/**
 * Move to a date (each keeps its time unless `time` is given). Fields: item (repeated), date, time (optional).
 * Planned as an edit of the time, then re-validated with the new times (caps, past time); a refusal says
 * why and changes nothing.
 */
export async function moveAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["move"], async () => {
    const groups = itemsByBatch(fd);
    if (groups.size === 0) throw new UserError("Nothing selected.");
    const date = str(fd, "date").trim();
    const time = str(fd, "time").trim() || null;
    const now = new Date();
    const store = new PgBatchStore(getPool());
    // Plan every week first: all or nothing.
    const plans: Array<{ batchId: string; plan: Extract<ReturnType<typeof planMove>, { ok: true }> }> = [];
    for (const [batchId, ids] of groups) {
      const { batch, ctx } = await fresh(batchId, now);
      const plan = planMove(batch, ctx, ids, date, time, now);
      if (!plan.ok) throw new UserError(cap(plan.reason));
      plans.push({ batchId, plan });
    }
    let n = 0;
    for (const { batchId, plan } of plans) {
      await store.apply(batchId, plan.changes, plan.batchStatus, session.id, now);
      n += plan.changes.length;
    }
    return `Moved ${n}. Approve again when you're happy with the new time.`;
  });
}

/** "Tomorrow": the editor slotting (free slots tomorrow in the creator zone), then one edit per item. All or nothing. */
export async function moveTomorrowAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["move"], async () => {
    const groups = itemsByBatch(fd);
    if (groups.size === 0) throw new UserError("Nothing selected.");
    const tz = handoffContext().timeZone;
    if (!tz) throw new UserError("Set your time zone first: \"tomorrow\" needs it.");
    const now = new Date();
    const pool = getPool();
    const store = new PgBatchStore(pool);
    let n = 0;
    for (const [batchId, ids] of groups) {
      const { batch } = await fresh(batchId, now);
      const slots = await slotTomorrow(pool, ids, now, tz);
      if (!slots.ok) throw new UserError(cap(slots.error));
      const plan = planEdits(batch, ids.map((itemId) => ({ itemId, patch: { scheduledFor: slots.slots[itemId]! } })), now);
      if (!plan.ok) throw new UserError(cap(plan.reason));
      if (plan.changes.length) await store.apply(batchId, plan.changes, plan.batchStatus, session.id, now);
      n += plan.changes.length;
    }
    return n ? `Moved ${n} to tomorrow.` : "Already on those times.";
  });
}

/** "Fill times" for untimed drafts. Field: batch (repeated batch ids). */
export async function fillTimesAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, [], async () => {
    const ids = [...new Set(fd.getAll("batch").map(String))].filter((b) => UUID.test(b));
    if (ids.length === 0) throw new UserError("Nothing to time.");
    const now = new Date();
    const store = new PgBatchStore(getPool());
    let timed = 0;
    let unplaced = 0;
    let reason = "";
    for (const batchId of ids) {
      const { batch, ctx } = await fresh(batchId, now);
      const plan = planFillTimes(batch, { cadence: ctx.cadence, timeZone: ctx.timeZone, existing: ctx.existing, now });
      const changes = fillTimesChanges(batch, plan.patches);
      if (changes.length > 0) await store.apply(batchId, changes, batchStatusOf(batch.items), session.id, now);
      timed += changes.length;
      unplaced += plan.unplaced.length;
      reason ||= plan.unplaced[0]?.reason ?? "";
    }
    if (unplaced) throw new UserError(`Timed ${timed}; ${unplaced} couldn't be placed (${reason}).`);
    return timed ? `Timed ${timed}.` : "No drafts without a time.";
  });
}

/**
 * F11 "Not on the platform → back to draft". Fields: back, batchId, itemId, checked (one per ticked box).
 * The IG automatic check runs here, server-side, every time; a hit refuses. Never approves.
 */
export async function resetCheckedAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["reset"], async () => {
    const batchId = str(fd, "batchId");
    const itemId = str(fd, "itemId");
    if (!UUID.test(batchId) || !UUID.test(itemId)) throw new UserError("Unknown post.");
    const now = new Date();
    const { batch } = await fresh(batchId, now);
    const plan = await planResetChecked(batch, { itemId, checked: fd.getAll("checked").map(String) }, now);
    if (!plan.ok) throw new UserError(cap(plan.reason));
    if (plan.changes.length > 0) await new PgBatchStore(getPool()).apply(batchId, plan.changes, plan.batchStatus, session.id, now);
    return "Back to Needs approval: check the time and caption, then approve it again.";
  });
}

/** F11 "It's there → record it". Fields: back, batchId, itemId, url, platformPostId (optional). */
export async function recordPublishedAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  await run(fd, ["reset"], async () => {
    const batchId = str(fd, "batchId");
    const itemId = str(fd, "itemId");
    if (!UUID.test(batchId) || !UUID.test(itemId)) throw new UserError("Unknown post.");
    const now = new Date();
    const { batch } = await fresh(batchId, now);
    const platformPostId = str(fd, "platformPostId").trim();
    const plan = planTransition(batch, { kind: "record-published", itemId, url: str(fd, "url"), platformPostId: platformPostId || undefined }, now);
    if (!plan.ok) throw new UserError(cap(plan.reason));
    await new PgBatchStore(getPool()).apply(batchId, plan.changes, plan.batchStatus, session.id, now);
    return "Recorded as posted.";
  });
}

/** F11: the IG automatic check for the reset sheet (read-only; never posts). Non-IG items → "n/a". */
export async function igCheckAction(batchId: string, itemId: string): Promise<IgCheckResult> {
  await requireSession();
  if (!UUID.test(batchId) || !UUID.test(itemId)) return { result: "error" };
  try {
    const batch = await new PgBatchStore(getPool()).loadBatch(batchId);
    const item = batch?.items.find((i) => i.id === itemId);
    if (!item) return { result: "error" };
    return await checkInstagram(item);
  } catch (err) {
    console.error(`instagram check action failed: ${(err as Error).name}`);
    return { result: "error" };
  }
}
