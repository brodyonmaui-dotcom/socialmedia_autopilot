// Fable to review
// "Editor approval counts" (Settings, OFF by default): the pure gate that decides whether an editor render's
// draft may be approved without a second tap here. Non-negotiable 2 (nothing public without approval) rests
// on this function, so it is default-deny: every condition must hold, and any unexpected shape says no.
// Tested in __tests__/auto-approve.test.ts (one test per condition + fast-check properties).
import type { BatchItemView, Warning } from "../batches/types.js";

/** Renders from these editing chats only; "manual" and anything else always need the tap. */
export const AUTO_APPROVE_SOURCES: readonly string[] = ["trade-recaps", "workout-assembly"];
/** Platforms the outbox posts directly. Snapchat is assisted (tap-to-post), never auto-approved. */
const DIRECT_PLATFORMS: readonly string[] = ["instagram", "youtube", "tiktok"];
/** The scheduled time must be strictly later than now + this, so a push can still pull it back. */
export const AUTO_APPROVE_LEAD_MS = 2 * 60_000;
/** An ISO 8601 instant with a time (Date.parse alone accepts "1", "true"-ish oddities). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

export type AutoApproveDecision = { approve: true } | { approve: false; reason: string };

export interface AutoApproveContext {
  /** settings.editor.approvalCounts, exactly true. */
  approvalCounts: boolean;
  now: Date;
}

const no = (reason: string): AutoApproveDecision => ({ approve: false, reason });

function validInstant(s: unknown): boolean {
  return typeof s === "string" && ISO_INSTANT.test(s) && Number.isFinite(Date.parse(s));
}

/**
 * Approve ONLY if all hold: the setting is on; an editor item (origin 'editor' + trial.editor) in 'draft' and
 * not handed off; source exactly trade-recaps | workout-assembly; approvedInEditor is an ISO instant (true or
 * missing is not enough); zero warnings of any severity (the setting promises "zero warnings"; this includes
 * every block) on both the given list and the item; no editor flag, known or unknown (lint error, location,
 * QA, needs-caption, no-slot, sound…); no media QA warnings and a clean file; not a TikTok inbox draft; a valid
 * time later than now + 2 min; a direct platform (never Snapchat).
 */
export function autoApproveDecision(item: BatchItemView, warnings: Warning[], ctx: AutoApproveContext): AutoApproveDecision {
  try {
    if (!ctx || ctx.approvalCounts !== true) return no("editor approval counts is off");
    const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : Number.NaN;
    if (!Number.isFinite(nowMs)) return no("no valid clock");
    if (!item || typeof item !== "object") return no("not an item");

    if (item.origin !== "editor") return no("not from an editor");
    const e = item.editor;
    if (!e || typeof e !== "object") return no("no editor details");
    if (item.status !== "draft") return no(`item is ${String(item.status)}, not draft`);
    if (item.platformPostId != null || item.handedOff === true) return no("already handed to the platform");
    if (typeof item.platform !== "string" || !DIRECT_PLATFORMS.includes(item.platform)) return no("not a direct-post platform");

    if (typeof e.source !== "string" || !AUTO_APPROVE_SOURCES.includes(e.source)) return no("not from an editing chat");
    if (e.approvedInEditor !== true || !validInstant(e.approvedInEditorAt)) return no("no editor approval time");

    if (!Array.isArray(warnings) || !Array.isArray(item.warnings)) return no("warnings unknown");
    if (warnings.length > 0 || item.warnings.length > 0) {
      const all = [...warnings, ...item.warnings];
      return no(all.some((w) => !w || w.severity !== "warn") ? "has a block warning" : "has a warning");
    }

    if (!Array.isArray(e.flags) || e.flags.length > 0) return no("editor flagged it");
    if (e.unknownFlags !== 0) return no("editor flagged it");
    const m = item.media;
    if (!m || m.hasCleanFile !== true || !Array.isArray(m.qaWarnings) || m.qaWarnings.length > 0) return no("media check didn't pass");
    if (item.tiktokDraft !== false) return no("TikTok inbox draft needs the app");

    if (typeof item.scheduledFor !== "string") return no("no time set");
    const at = Date.parse(item.scheduledFor);
    if (!Number.isFinite(at)) return no("time is not a valid date");
    if (at <= nowMs + AUTO_APPROVE_LEAD_MS) return no("time is less than 2 minutes away");

    return { approve: true };
  } catch {
    return no("unexpected shape");
  }
}
