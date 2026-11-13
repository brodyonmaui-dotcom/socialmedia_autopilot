"use server";

import { PLATFORMS, type Platform } from "@autopilot/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { loadWarningContext } from "../../../lib/batches/context.js";
import { fillTimesChanges, planFillTimes } from "../../../lib/batches/fill-times.js";
import { PgBatchStore } from "../../../lib/batches/pg-store.js";
import { ConflictError } from "../../../lib/batches/store.js";
import { planTransition, type BatchAction } from "../../../lib/batches/transitions.js";
import type { BatchView } from "../../../lib/batches/types.js";
import { batchStatusOf, fromDatetimeLocal } from "../../../lib/batches/view-model.js";
import { computeWarnings } from "../../../lib/batches/warnings.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** A message that is safe to show on the page (ours, not a DB error). */
class UserError extends Error {
  override name = "UserError";
}

/**
 * Same shape as research/actions.ts run(): do the work, then revalidate and redirect back to the batch
 * with ?error=… or ?note=…. redirect() throws, so it stays outside the try.
 */
async function run(batchId: string, fn: () => Promise<string | undefined>): Promise<void> {
  if (!UUID.test(batchId)) redirect(`/batches?error=${encodeURIComponent("unknown batch")}`);
  const path = `/batches/${batchId}`;
  let error: string | undefined;
  let note: string | undefined;
  try {
    note = await fn();
  } catch (err) {
    const e = err as Error;
    if (e instanceof ConflictError) error = "changed underneath you, reload";
    else if (e instanceof UserError) error = e.message;
    else {
      console.error(`batch action failed: ${e.name}`);
      error = "something went wrong";
    }
  }
  revalidatePath(path);
  revalidatePath("/batches");
  const q = error ? `?error=${encodeURIComponent(error)}` : note ? `?note=${encodeURIComponent(note)}` : "";
  redirect(`${path}${q}`);
}

/** Fresh batch + context + warnings from the DB: the client's warning state is never trusted. */
async function load(batchId: string): Promise<{ store: PgBatchStore; batch: BatchView; ctx: Awaited<ReturnType<typeof loadWarningContext>> }> {
  const pool = getPool();
  const store = new PgBatchStore(pool);
  const batch = await store.loadBatch(batchId);
  if (!batch) throw new UserError("batch not found");
  const ctx = await loadWarningContext({ pool, weekStart: batch.weekStart, batchId });
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  return { store, batch, ctx };
}

async function transition(batchId: string, sessionId: string, action: BatchAction): Promise<string | undefined> {
  const { store, batch } = await load(batchId);
  const now = new Date();
  const plan = planTransition(batch, action, now);
  if (!plan.ok) {
    if (action.kind === "edit" && plan.reason === "nothing changed") return "nothing changed";
    throw new UserError(plan.reason);
  }
  if (plan.changes.length > 0) await store.apply(batchId, plan.changes, plan.batchStatus, sessionId, now);
  if (action.kind === "approve-all") return `approved ${plan.changes.length}, skipped ${plan.skipped.length}`;
  return undefined;
}

const ids = (itemIds: string[]) => itemIds.filter((id) => UUID.test(id));

export async function approveAction(batchId: string, itemIds: string[]): Promise<void> {
  const session = await requireSession();
  await run(batchId, () => transition(batchId, session.id, { kind: "approve", itemIds: ids(itemIds) }));
}

export async function approveAllAction(batchId: string): Promise<void> {
  const session = await requireSession();
  await run(batchId, () => transition(batchId, session.id, { kind: "approve-all" }));
}

export async function rejectAction(batchId: string, itemIds: string[]): Promise<void> {
  const session = await requireSession();
  await run(batchId, () => transition(batchId, session.id, { kind: "reject", itemIds: ids(itemIds) }));
}

export async function unapproveAction(batchId: string, itemIds: string[]): Promise<void> {
  const session = await requireSession();
  await run(batchId, () => transition(batchId, session.id, { kind: "unapprove", itemIds: ids(itemIds) }));
}

/** Form fields: batchId, itemId, caption, title (youtube only), scheduledLocal (datetime-local in the creator's zone). */
export async function editAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  const batchId = str(fd, "batchId");
  await run(batchId, async () => {
    const { ctx } = await load(batchId);
    const patch: { caption?: string; title?: string | null; scheduledFor?: string | null } = {};
    if (fd.has("caption")) patch.caption = str(fd, "caption").replace(/\r\n/g, "\n");
    if (fd.has("title")) patch.title = str(fd, "title").trim() || null;
    if (fd.has("scheduledLocal")) {
      const raw = str(fd, "scheduledLocal").trim();
      if (raw === "") patch.scheduledFor = null;
      else {
        const iso = fromDatetimeLocal(raw, ctx.timeZone);
        if (!iso) throw new UserError("that time isn't a valid date");
        patch.scheduledFor = iso;
      }
    }
    return transition(batchId, session.id, { kind: "edit", itemId: str(fd, "itemId"), patch });
  });
}

export async function fillTimesAction(batchId: string): Promise<void> {
  const session = await requireSession();
  await run(batchId, async () => {
    const { store, batch, ctx } = await load(batchId);
    const now = new Date();
    const plan = planFillTimes(batch, { cadence: ctx.cadence, timeZone: ctx.timeZone, existing: ctx.existing, now });
    const changes = fillTimesChanges(batch, plan.patches);
    if (changes.length === 0 && plan.unplaced.length === 0) return "no drafts without a time";
    if (changes.length > 0) await store.apply(batchId, changes, batchStatusOf(batch.items), session.id, now);
    const first = plan.unplaced[0];
    if (first) throw new UserError(`timed ${changes.length}; ${plan.unplaced.length} couldn't be placed (${first.reason})`);
    return `timed ${changes.length}`;
  });
}

/** Form fields: batchId, mediaId, platforms (one or more checkboxes). */
export async function addItemAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  const batchId = str(fd, "batchId");
  await run(batchId, async () => {
    const mediaId = str(fd, "mediaId");
    if (!UUID.test(mediaId)) throw new UserError("pick a clip");
    const platforms = [...new Set(fd.getAll("platforms").map(String))].filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
    if (platforms.length === 0) throw new UserError("pick at least one platform");
    const store = new PgBatchStore(getPool());
    const now = new Date();
    for (const platform of platforms) {
      try {
        await store.addItem(batchId, mediaId, platform, session.id, now);
      } catch (err) {
        const m = (err as Error).message;
        if (/^(batch not found|media not found|can't add)/.test(m)) throw new UserError(m);
        throw err;
      }
    }
    return `added ${platforms.length} draft(s): write the caption, then fill missing times`;
  });
}
