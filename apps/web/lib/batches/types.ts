import type { Platform } from "@autopilot/core";
import type { BatchItemStatus } from "@autopilot/db";

/**
 * View types for the batch-approval screen. Pure: type-only imports from @autopilot/db, so a client
 * component can import this file without pulling pg into the bundle.
 */
export type ItemStatus = BatchItemStatus;

/** Mirrors BATCH_ITEM_STATUSES in @autopilot/db (kept local so this module has no runtime db import). */
export const ITEM_STATUSES = [
  "draft", "approved", "queued", "publishing", "published", "failed", "unknown", "rejected",
] as const satisfies readonly ItemStatus[];

export type WarningCode =
  | "lint.error"
  | "lint.warn"
  | "placeholder"
  | "time.past"
  | "time.missing"
  | "cap.breach"
  | "duplicate.caption"
  | "duplicate.media"
  | "media.qa"
  | "media.no-clean-file"
  | "tiktok.needs-sound"
  | "yt.over-60s";

export interface Warning {
  code: WarningCode;
  /** "block" = can't be approved until fixed; "warn" = shown, he decides. */
  severity: "block" | "warn";
  message: string;
  field?: "caption" | "title" | "time";
}

export interface BatchItemView {
  id: string;
  batchId: string;
  mediaId: string;
  platform: Platform;
  caption: string;
  title: string | null;
  /** ISO UTC. */
  scheduledFor: string | null;
  status: ItemStatus;
  tiktokDraft: boolean;
  platformPostId: string | null;
  approvedAt: string | null;
  /** Outbox send attempts (batch_items.attempts). Optional until loadBatch selects it (F11 T2). */
  attempts?: number;
  /** Sanitised last outbox error (batch_items.last_error; sanitised at write time). Optional until loaded (F11 T2). */
  lastError?: string | null;
  media: { label: string; durationS: number | null; pillar: string | null; hasCleanFile: boolean; qaWarnings: string[] };
  /** Filled by computeWarnings. */
  warnings: Warning[];
  /** status draft|approved and not handedOff. */
  editable: boolean;
  /** platformPostId != null or status in publishing|published|unknown|failed. */
  handedOff: boolean;
}

export interface BatchView {
  id: string;
  weekStart: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  items: BatchItemView[];
  counts: Record<ItemStatus, number>;
}

const HANDED_OFF_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["publishing", "published", "unknown", "failed"]);

/** Once the worker has touched a post (or the platform has an id for it), the app stops editing it. */
export function deriveFlags(i: Pick<BatchItemView, "status" | "platformPostId">): { editable: boolean; handedOff: boolean } {
  const handedOff = i.platformPostId != null || HANDED_OFF_STATUSES.has(i.status);
  const editable = !handedOff && (i.status === "draft" || i.status === "approved");
  return { editable, handedOff };
}

/** Every status key present, 0 by default. */
export function countByStatus(items: Pick<BatchItemView, "status">[]): Record<ItemStatus, number> {
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return counts;
}
