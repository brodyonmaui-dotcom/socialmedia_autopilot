import { planTransition, type ItemChange } from "../batches/transitions.js";
import type { BatchView } from "../batches/types.js";
import { batchStatusOf } from "../batches/view-model.js";

/**
 * Pure: the `edit {scheduledFor}` changes for a set of new slots, each planned by planTransition 'edit'
 * on the fresh batch (so handed-off or non-draft items refuse exactly as on the batch screen). All or
 * nothing: the first refusal returns the reason and no changes.
 */
export function planEdits(
  batch: BatchView,
  patches: Array<{ itemId: string; patch: { caption?: string; title?: string | null; scheduledFor?: string | null } }>,
  now: Date,
): { ok: true; changes: ItemChange[]; batchStatus: "draft" | "approved" } | { ok: false; reason: string } {
  const changes: ItemChange[] = [];
  for (const { itemId, patch } of patches) {
    const plan = planTransition(batch, { kind: "edit", itemId, patch }, now);
    if (!plan.ok) {
      if (plan.reason === "nothing changed") continue;
      return { ok: false, reason: plan.reason };
    }
    changes.push(...plan.changes);
  }
  const to = new Map(changes.map((c) => [c.itemId, c.to]));
  const batchStatus = batchStatusOf(batch.items.map((i) => ({ status: to.get(i.id) ?? i.status })));
  return { ok: true, changes, batchStatus };
}
