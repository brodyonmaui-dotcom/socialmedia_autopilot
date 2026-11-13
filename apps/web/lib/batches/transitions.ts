import type { BatchItemEventKind } from "@autopilot/db";
import { deriveFlags, type BatchItemView, type BatchView, type ItemStatus } from "./types.js";
import { AUTO_CHECKS, isResettablePlatform, POST_ID_RE, RESET_CHECKLIST, validatePostUrl, type AutoCheck, type ResetEventKind } from "./reset.js";

export type BatchAction =
  | { kind: "approve"; itemIds: string[] }
  | { kind: "approve-all" }
  | { kind: "reject"; itemIds: string[] }
  | { kind: "unapprove"; itemIds: string[] }
  | { kind: "edit"; itemId: string; patch: { caption?: string; title?: string | null; scheduledFor?: string | null } }
  /** F11: "I checked, it's not on the platform" → back to draft (never approves). */
  | { kind: "reset-checked"; itemId: string; checked: string[]; autoCheck: AutoCheck }
  /** F11: "I checked, it IS there" → published, with the URL as evidence. */
  | { kind: "record-published"; itemId: string; url: string; platformPostId?: string };

export interface ItemChange {
  itemId: string;
  from: ItemStatus;
  to: ItemStatus;
  eventKind: BatchItemEventKind | ResetEventKind;
  /**
   * Column names as stored (snake case). The outbox fields are set only by reset-checked /
   * record-published. There is deliberately no idempotency_key field: nothing here may change it.
   */
  patch?: {
    caption?: string;
    title?: string | null;
    scheduled_for?: string | null;
    attempts?: number;
    last_error?: string | null;
    next_attempt_at?: string | null;
    platform_post_url?: string;
    platform_post_id?: string;
  };
  /** Event detail for batch_item_events.detail when it isn't just the patch (reset-checked / record-published). */
  detail?: Record<string, unknown>;
}

export type TransitionResult =
  | { ok: true; changes: ItemChange[]; batchStatus: "draft" | "approved"; skipped: Array<{ itemId: string; reasons: string[] }> }
  | { ok: false; reason: string; itemId?: string };

type Fail = Extract<TransitionResult, { ok: false }>;

const blocksOf = (i: BatchItemView) => i.warnings.filter((w) => w.severity === "block");

/** "approved" if any item would sit outside draft/rejected after the changes; else "draft". */
function batchStatusAfter(items: BatchItemView[], changes: ItemChange[]): "draft" | "approved" {
  const to = new Map(changes.map((c) => [c.itemId, c.to]));
  return items.some((i) => {
    const s = to.get(i.id) ?? i.status;
    return s !== "draft" && s !== "rejected";
  })
    ? "approved"
    : "draft";
}

function resolveIds(batch: BatchView, ids: string[]): BatchItemView[] | Fail {
  if (ids.length === 0) return { ok: false, reason: "no items selected" };
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  const out: BatchItemView[] = [];
  for (const id of new Set(ids)) {
    const item = byId.get(id);
    if (!item) return { ok: false, reason: `item ${id} is not in this batch`, itemId: id };
    out.push(item);
  }
  return out;
}

/** Why `item` can't be approved right now, or null. Re-checks the time too, in case warnings are stale. */
function approveBlocker(item: BatchItemView, now: Date): string | null {
  if (item.status !== "draft") return `can't approve: item is ${item.status}, not draft`;
  const first = blocksOf(item)[0];
  if (first) return first.message;
  if (deriveFlags(item).handedOff) return "can't approve: already handed to the platform";
  if (item.scheduledFor == null) return "no time set";
  const ms = new Date(item.scheduledFor).getTime();
  if (Number.isNaN(ms)) return "time is not a valid date";
  if (ms <= now.getTime()) return "time is in the past";
  return null;
}

const OUTBOX_DONE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["failed", "unknown"]);

function findItem(batch: BatchView, itemId: string): BatchItemView | Fail {
  return batch.items.find((i) => i.id === itemId) ?? { ok: false, reason: `item ${itemId} is not in this batch`, itemId };
}

/** Why `item` can't be reset to draft with these ticks, or null. */
function resetBlocker(item: BatchItemView, checked: string[], autoCheck: AutoCheck): string | null {
  if (!OUTBOX_DONE.has(item.status)) return `can't reset: item is ${item.status}, not failed or unknown`;
  if (item.platformPostId != null) return "can't reset: the platform already has an id for this post; record it as published";
  if (!isResettablePlatform(item.platform)) return `can't reset: ${item.platform} posts never go through the outbox`;
  const list = RESET_CHECKLIST[item.platform];
  const ticked = new Set(Array.isArray(checked) ? checked : []);
  for (const c of ticked) if (!list.includes(c)) return "can't reset: unexpected checklist entry, reload";
  if (list.some((c) => !ticked.has(c))) return "can't reset: tick every checklist box first";
  if (!AUTO_CHECKS.includes(autoCheck)) return "can't reset: unknown automatic-check result";
  if (item.platform === "instagram") {
    if (autoCheck === "n/a") return "can't reset: the Instagram automatic check didn't run";
  } else if (autoCheck !== "n/a") {
    return `can't reset: ${item.platform} has no automatic check`;
  }
  return null;
}

/** Plans a status change for the batch screen. Pure: the caller writes `changes` + audit events. */
export function planTransition(batch: BatchView, action: BatchAction, now: Date): TransitionResult {
  const done = (changes: ItemChange[], skipped: Array<{ itemId: string; reasons: string[] }> = []): TransitionResult => ({
    ok: true,
    changes,
    batchStatus: batchStatusAfter(batch.items, changes),
    skipped,
  });

  switch (action.kind) {
    case "approve": {
      const items = resolveIds(batch, action.itemIds);
      if (!Array.isArray(items)) return items;
      for (const item of items) {
        const why = approveBlocker(item, now);
        if (why) return { ok: false, reason: why, itemId: item.id };
      }
      return done(items.map((i) => ({ itemId: i.id, from: i.status, to: "approved", eventKind: "approve" })));
    }

    case "approve-all": {
      const changes: ItemChange[] = [];
      const skipped: Array<{ itemId: string; reasons: string[] }> = [];
      for (const item of batch.items) {
        if (item.status !== "draft") continue;
        const blocks = blocksOf(item).map((w) => w.message);
        const why = blocks.length ? null : approveBlocker(item, now);
        if (blocks.length || why) skipped.push({ itemId: item.id, reasons: blocks.length ? blocks : [why!] });
        else changes.push({ itemId: item.id, from: "draft", to: "approved", eventKind: "approve-all" });
      }
      return done(changes, skipped);
    }

    case "reject": {
      const items = resolveIds(batch, action.itemIds);
      if (!Array.isArray(items)) return items;
      for (const item of items) {
        if (deriveFlags(item).handedOff) return { ok: false, reason: `can't reject: already handed to the platform (${item.status})`, itemId: item.id };
        if (item.status !== "draft" && item.status !== "approved") return { ok: false, reason: `can't reject: item is ${item.status}`, itemId: item.id };
      }
      return done(items.map((i) => ({ itemId: i.id, from: i.status, to: "rejected", eventKind: "reject" })));
    }

    case "unapprove": {
      const items = resolveIds(batch, action.itemIds);
      if (!Array.isArray(items)) return items;
      for (const item of items) {
        if (deriveFlags(item).handedOff) return { ok: false, reason: `can't unapprove: already handed to the platform (${item.status})`, itemId: item.id };
        if (item.status !== "approved" && item.status !== "queued") {
          return { ok: false, reason: `can't unapprove: item is ${item.status}, not approved or queued`, itemId: item.id };
        }
      }
      return done(items.map((i) => ({ itemId: i.id, from: i.status, to: "draft", eventKind: "unapprove" })));
    }

    case "edit": {
      const item = batch.items.find((i) => i.id === action.itemId);
      if (!item) return { ok: false, reason: `item ${action.itemId} is not in this batch`, itemId: action.itemId };
      if (deriveFlags(item).handedOff) return { ok: false, reason: `can't edit: already handed to the platform (${item.status})`, itemId: item.id };
      if (item.status !== "draft" && item.status !== "approved") return { ok: false, reason: `can't edit: item is ${item.status}`, itemId: item.id };

      const { caption, title, scheduledFor } = action.patch;
      const patch: NonNullable<ItemChange["patch"]> = {};
      if (caption !== undefined && caption !== item.caption) patch.caption = caption;
      if (title !== undefined && title !== item.title) patch.title = title;
      if (scheduledFor !== undefined) {
        let next: string | null = null;
        if (scheduledFor !== null) {
          const ms = new Date(scheduledFor).getTime();
          if (Number.isNaN(ms)) return { ok: false, reason: "time is not a valid date", itemId: item.id };
          next = new Date(ms).toISOString();
        }
        const cur = item.scheduledFor == null ? null : new Date(item.scheduledFor).getTime();
        const nextMs = next == null ? null : new Date(next).getTime();
        if (cur !== nextMs) patch.scheduled_for = next;
      }
      if (Object.keys(patch).length === 0) return { ok: false, reason: "nothing changed", itemId: item.id };
      return done([{ itemId: item.id, from: item.status, to: "draft", eventKind: "edit", patch }]);
    }

    case "reset-checked": {
      const item = findItem(batch, action.itemId);
      if ("ok" in item) return item;
      const why = resetBlocker(item, action.checked, action.autoCheck);
      if (why) return { ok: false, reason: why, itemId: item.id };
      const list = RESET_CHECKLIST[item.platform as keyof typeof RESET_CHECKLIST];
      // approved_at / approved_session are cleared by the store on any → draft, as for unapprove/edit.
      return done([{
        itemId: item.id,
        from: item.status,
        to: "draft",
        eventKind: "reset-checked",
        patch: { attempts: 1, last_error: null, next_attempt_at: null },
        detail: { attemptsBefore: item.attempts ?? null, lastError: item.lastError ?? null, checked: [...list], autoCheck: action.autoCheck },
      }]);
    }

    case "record-published": {
      const item = findItem(batch, action.itemId);
      if ("ok" in item) return item;
      if (!OUTBOX_DONE.has(item.status)) return { ok: false, reason: `can't record: item is ${item.status}, not failed or unknown`, itemId: item.id };
      const url = validatePostUrl(item.platform, action.url);
      if (url == null) return { ok: false, reason: `can't record: not an https link to a ${item.platform} post`, itemId: item.id };
      const id = typeof action.platformPostId === "string" ? action.platformPostId.trim() : "";
      if (id !== "" && !POST_ID_RE.test(id)) return { ok: false, reason: "can't record: the post id has unexpected characters", itemId: item.id };
      if (id !== "" && item.platformPostId != null && id !== item.platformPostId) {
        return { ok: false, reason: "can't record: the item already has a different platform post id", itemId: item.id };
      }
      const patch: NonNullable<ItemChange["patch"]> = { platform_post_url: url, next_attempt_at: null };
      if (id !== "") patch.platform_post_id = id;
      return done([{
        itemId: item.id,
        from: item.status,
        to: "published",
        eventKind: "record-published",
        patch,
        detail: { url, platformPostId: id !== "" ? id : item.platformPostId, attemptsBefore: item.attempts ?? null, lastError: item.lastError ?? null },
      }]);
    }
  }
}
