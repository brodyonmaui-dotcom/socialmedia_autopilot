import type { Platform } from "@autopilot/core";
import type { BatchStore } from "../batches/store.js";
import { planTransition, type ItemChange } from "../batches/transitions.js";
import type { BatchView } from "../batches/types.js";
import { approveNote, chipLabel } from "./view.js";

export interface RenderApprovePlan {
  /** The approve changes (planTransition 'approve' on the unblocked ids), or null when nothing is approvable. */
  changes: ItemChange[] | null;
  batchStatus: "draft" | "approved";
  approved: Array<{ itemId: string; platform: Platform }>;
  stayed: Array<{ itemId: string; platform: Platform; reason: string }>;
}

// Fable to review: F15 "Approve & schedule" (one tap, only items without a block warning)
/**
 * Pure. `batch` must carry fresh warnings (computeWarnings on the server, never the form's). Each id is
 * checked with planTransition 'approve' on its own, so the exact same block path as the batch screen
 * decides; the ones that pass are then approved together through planTransition again. Block
 * warnings are never skipped; anything that isn't an editor draft stays too.
 */
export function planRenderApprove(batch: BatchView, itemIds: string[], now: Date): RenderApprovePlan {
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  const ok: string[] = [];
  const stayed: RenderApprovePlan["stayed"] = [];
  for (const id of new Set(itemIds)) {
    const item = byId.get(id);
    if (!item) continue; // not in this batch: nothing to say about it, nothing to approve
    if (item.origin !== "editor") {
      stayed.push({ itemId: id, platform: item.platform, reason: "not an editor draft" });
      continue;
    }
    const single = planTransition(batch, { kind: "approve", itemIds: [id] }, now);
    if (single.ok) ok.push(id);
    else {
      const block = item.warnings.find((w) => w.severity === "block");
      stayed.push({ itemId: id, platform: item.platform, reason: block ? chipLabel(block) : single.reason });
    }
  }
  if (ok.length === 0) return { changes: null, batchStatus: batch.status, approved: [], stayed };
  const plan = planTransition(batch, { kind: "approve", itemIds: ok }, now);
  if (!plan.ok) {
    // Can't happen (each id passed alone), but never approve on a failed plan.
    const item = plan.itemId ? byId.get(plan.itemId) : undefined;
    return { changes: null, batchStatus: batch.status, approved: [], stayed: [...stayed, ...(item ? [{ itemId: item.id, platform: item.platform, reason: plan.reason }] : [])] };
  }
  return {
    changes: plan.changes,
    batchStatus: plan.batchStatus,
    approved: plan.changes.map((c) => ({ itemId: c.itemId, platform: byId.get(c.itemId)!.platform })),
    stayed,
  };
}

/**
 * Loads (with warnings) → plans → applies in one store transaction. Returns the note for the page:
 * "approved IG, YT · stayed: TT (Needs caption)".
 */
export async function approveRender(
  deps: { load: (batchId: string) => Promise<BatchView | null>; store: Pick<BatchStore, "apply"> },
  batchId: string,
  itemIds: string[],
  sessionId: string | null,
  now: Date,
): Promise<RenderApprovePlan & { note: string }> {
  const batch = await deps.load(batchId);
  if (!batch) throw new Error("batch not found");
  const plan = planRenderApprove(batch, itemIds, now);
  if (plan.changes && plan.changes.length > 0) await deps.store.apply(batchId, plan.changes, plan.batchStatus, sessionId, now);
  return { ...plan, note: approveNote(plan.approved.map((a) => a.platform), plan.stayed) };
}
// End of F15 "Approve & schedule".
