"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { PgBatchStore } from "../../lib/batches/pg-store.js";
import { ConflictError } from "../../lib/batches/store.js";
import { planTransition } from "../../lib/batches/transitions.js";
import { approveRender } from "../../lib/editor/approve.js";
import { planEdits } from "../../lib/editor/move.js";
import { loadBatchWithWarnings } from "../../lib/editor/queries.js";
import { slotTomorrow } from "../../lib/editor/slotting.js";
import { handoffContext } from "../../lib/handoff/store.js";

/**
 * F15 "From your editors" card actions. Every write goes through planTransition + PgBatchStore.apply on a
 * batch freshly loaded with server-side warnings; nothing here approves, edits or rejects any other way.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (xs: unknown): string[] => (Array.isArray(xs) ? [...new Set(xs.map(String).filter((id) => UUID.test(id)))] : []);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

class UserError extends Error {
  override name = "UserError";
}

/** Back to Home ("home") or the batch page (anything else). */
const pathFor = (from: string, batchId: string) => (from === "home" ? "/" : `/batches/${batchId}`);

async function run(batchId: string, from: string, fn: () => Promise<string | undefined>): Promise<void> {
  if (!UUID.test(batchId)) redirect(`/?error=${encodeURIComponent("unknown batch")}`);
  const path = pathFor(from, batchId);
  let error: string | undefined;
  let note: string | undefined;
  try {
    note = await fn();
  } catch (err) {
    const e = err as Error;
    if (e instanceof ConflictError) error = "changed underneath you, reload";
    else if (e instanceof UserError) error = e.message;
    else {
      console.error(`editor action failed: ${e.name}`);
      error = "something went wrong";
    }
  }
  revalidatePath("/");
  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/batches");
  const q = error ? `?error=${encodeURIComponent(error)}` : note ? `?note=${encodeURIComponent(note)}` : "";
  redirect(`${path}${q}${path === "/" ? "#editors" : ""}`);
}

async function fresh(batchId: string, now: Date) {
  const loaded = await loadBatchWithWarnings(getPool(), batchId, now);
  if (!loaded) throw new UserError("batch not found");
  return loaded;
}

/** Approve & schedule: approves the render's items that have no block warning; the note says which stayed and why. */
export async function approveEditorRender(batchId: string, itemIds: string[], from: string): Promise<void> {
  const session = await requireSession();
  await run(batchId, from, async () => {
    const list = ids(itemIds);
    if (list.length === 0) throw new UserError("no items selected");
    const now = new Date();
    const store = new PgBatchStore(getPool());
    const res = await approveRender({ load: async (id) => (await fresh(id, now)).batch, store }, batchId, list, session.id, now);
    if (res.approved.length === 0) throw new UserError(res.note);
    return res.note;
  });
}

/** Form fields: batchId, from, itemId (one per item), caption:<itemId>, title:<itemId> (YouTube). The existing edit transition. */
export async function editCaptionAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  const batchId = str(fd, "batchId");
  await run(batchId, str(fd, "from"), async () => {
    const list = ids(fd.getAll("itemId"));
    if (list.length === 0) throw new UserError("no items selected");
    const now = new Date();
    const { batch } = await fresh(batchId, now);
    const patches = list.map((itemId) => {
      const patch: { caption?: string; title?: string | null } = {};
      if (fd.has(`caption:${itemId}`)) patch.caption = str(fd, `caption:${itemId}`).replace(/\r\n/g, "\n");
      if (fd.has(`title:${itemId}`)) patch.title = str(fd, `title:${itemId}`).trim() || null;
      return { itemId, patch };
    });
    const plan = planEdits(batch, patches, now);
    if (!plan.ok) throw new UserError(plan.reason);
    if (plan.changes.length === 0) return "nothing changed";
    await new PgBatchStore(getPool()).apply(batchId, plan.changes, plan.batchStatus, session.id, now);
    return `caption saved (${plan.changes.length})`;
  });
}

/** Move to tomorrow: assignSlots inside tomorrow (creator zone) for every item, then one edit {scheduledFor} each. All or nothing. */
export async function moveToTomorrowAction(batchId: string, itemIds: string[], from: string): Promise<void> {
  const session = await requireSession();
  await run(batchId, from, async () => {
    const list = ids(itemIds);
    if (list.length === 0) throw new UserError("no items selected");
    const tz = handoffContext().timeZone;
    if (!tz) throw new UserError("set TZ_CREATOR first: \"tomorrow\" needs your time zone");
    const now = new Date();
    const pool = getPool();
    const { batch } = await fresh(batchId, now);
    const inBatch = new Set(batch.items.map((i) => i.id));
    if (list.some((id) => !inBatch.has(id))) throw new UserError("item is not in this batch, reload");
    const slots = await slotTomorrow(pool, list, now, tz);
    if (!slots.ok) throw new UserError(slots.error);
    const plan = planEdits(batch, list.map((itemId) => ({ itemId, patch: { scheduledFor: slots.slots[itemId]! } })), now);
    if (!plan.ok) throw new UserError(plan.reason);
    if (plan.changes.length === 0) return "already on those times";
    await new PgBatchStore(pool).apply(batchId, plan.changes, plan.batchStatus, session.id, now);
    return `moved to tomorrow (${plan.changes.length})`;
  });
}

/** Reject (after the confirm sheet): the existing reject transition. Rows stay; nothing is deleted. */
export async function rejectRenderAction(batchId: string, itemIds: string[], from: string): Promise<void> {
  const session = await requireSession();
  await run(batchId, from, async () => {
    const list = ids(itemIds);
    if (list.length === 0) throw new UserError("no items selected");
    const now = new Date();
    const { batch } = await fresh(batchId, now);
    const plan = planTransition(batch, { kind: "reject", itemIds: list }, now);
    if (!plan.ok) throw new UserError(plan.reason);
    await new PgBatchStore(getPool()).apply(batchId, plan.changes, plan.batchStatus, session.id, now);
    return `rejected ${plan.changes.length}: kept in the batch's rejected list`;
  });
}
