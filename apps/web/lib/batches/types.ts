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
  /** Same clip on the same platform: another live item within ±7 days, or published in the last 14 days. Blocks. */
  | "duplicate.clip"
  | "media.qa"
  | "media.no-clean-file"
  | "tiktok.needs-sound"
  | "yt.over-60s"
  /** F15: empty caption (IG/TikTok/YouTube) or empty YouTube title. Never Snapchat. */
  | "caption.missing"
  /** F15: editor flag add-sound-in-app (the sound is added in the platform app). */
  | "sound.in-app"
  /** F15: editor flag tiktok-draft-limit (TikTok's 5 pending inbox drafts per 24 h). */
  | "tiktok.draft-limit";

export interface Warning {
  code: WarningCode;
  /** "block" = can't be approved until fixed; "warn" = shown, he decides. */
  severity: "block" | "warn";
  message: string;
  field?: "caption" | "title" | "time";
}

/** F15 editor flags (trial.editor.flags), set by the laptop ingest. */
export const EDITOR_FLAGS = ["needs-caption", "add-sound-in-app", "no-slot", "lint-error", "tiktok-draft-limit"] as const;
export type EditorFlag = (typeof EDITOR_FLAGS)[number];

/** F15: batch_items.trial.editor, written by `pnpm ingest:ready` on the laptop. Parsed defensively (jsonb). */
export interface EditorMeta {
  /** The editor tool / app the render came from (a short label, never a path). */
  source: string | null;
  pillar: string | null;
  /** The sidecar's "when" (e.g. "today", "tomorrow", "this-week"). */
  when: string | null;
  /** HH:MM creator-local (or a legacy ISO instant); not before this time. */
  earliest: string | null;
  /** The ingest writes the approval instant (ISO) or true; both mean "approved in the editor". */
  approvedInEditor: boolean;
  /**
   * The raw approval value when it is a non-empty string (the ingest's ISO instant), else null. Unvalidated:
   * the auto-approve gate (lib/editor/auto-approve.ts) checks it. Optional so older fixtures can omit it.
   */
  approvedInEditorAt?: string | null;
  flags: EditorFlag[];
  /** How many trial.editor.flags entries were not known EDITOR_FLAGS (dropped from `flags`). Optional for fixtures. */
  unknownFlags?: number;
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
  /** Outbox send attempts (batch_items.attempts). Set by loadBatch; optional so test fixtures can omit it. */
  attempts?: number;
  /** Sanitised last outbox error (batch_items.last_error; sanitised at write time). Set by loadBatch. */
  lastError?: string | null;
  /** Last 6 characters of the idempotency key (for matching a TikTok/Zernio post by hand). Never the full key. */
  keyTail?: string | null;
  /** batch_items.platform_post_url (set once published or recorded). */
  platformPostUrl?: string | null;
  /** F11: failed|unknown, no platform post id, and an outbox platform: the reset / record sheet applies. */
  canReset?: boolean;
  media: { label: string; durationS: number | null; pillar: string | null; hasCleanFile: boolean; qaWarnings: string[] };
  /** batch_items.created_at (ISO). Set by loadBatch; optional so fixtures can omit it. */
  createdAt?: string;
  /** F15: 'editor' for items from the laptop ingest, null for the weekly batch. Optional so fixtures can omit it. */
  origin?: "editor" | null;
  /** F15: trial.editor, only when origin = 'editor'. */
  editor?: EditorMeta | null;
  /** Rejected items only: detail.reason of the latest reject event ("already-posted" = dropped because it's already on the platform). */
  rejectReason?: string | null;
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

/** F11: the "Not on the platform → back to draft" / "It's there → record it" buttons apply. */
export function canResetItem(i: Pick<BatchItemView, "status" | "platformPostId" | "platform">): boolean {
  return (i.status === "failed" || i.status === "unknown") && i.platformPostId == null && i.platform !== "snapchat";
}

/** Every status key present, 0 by default. */
export function countByStatus(items: Pick<BatchItemView, "status">[]): Record<ItemStatus, number> {
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return counts;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, 120) : null);

/** trial.editor → EditorMeta, or null when absent/not an object. Unknown flags are dropped. */
export function parseEditorMeta(trial: unknown): EditorMeta | null {
  const e = (trial as { editor?: unknown } | null)?.editor;
  if (typeof e !== "object" || e === null || Array.isArray(e)) return null;
  const o = e as Record<string, unknown>;
  const flags = Array.isArray(o.flags) ? o.flags.filter((f): f is EditorFlag => (EDITOR_FLAGS as readonly unknown[]).includes(f)) : [];
  // A flags value that isn't an array counts as one unknown flag (default-deny for the auto-approve gate).
  const unknownFlags = Array.isArray(o.flags) ? o.flags.length - flags.length : o.flags === undefined ? 0 : 1;
  const at = typeof o.approvedInEditor === "string" && o.approvedInEditor.trim() !== "" ? o.approvedInEditor.trim().slice(0, 64) : null;
  return {
    source: str(o.source),
    pillar: str(o.pillar),
    when: str(o.when),
    earliest: str(o.earliest),
    approvedInEditor: o.approvedInEditor === true || (typeof o.approvedInEditor === "string" && o.approvedInEditor.trim() !== ""),
    approvedInEditorAt: at,
    flags: [...new Set(flags)],
    unknownFlags,
  };
}
