import type { Platform } from "@autopilot/core";
import type { IgCheckResult } from "./ig-check.js";
import { allTicked } from "./reset.js";
import type { BatchItemView, ItemStatus } from "./types.js";

/**
 * Pure view helpers for the v2 batch screens (list rows, post cards, the F11 reset sheet).
 * Type-only imports, so client components can use this file without pulling server code in.
 */

export type BadgeToneView = "neutral" | "accent" | "warn" | "danger" | "solid";
export interface BadgeView {
  tone: BadgeToneView;
  label: string;
}

/** Batch status → Badge. Approved is the accent badge; a draft batch is neutral. */
export function batchStatusBadge(status: "draft" | "approved"): BadgeView {
  return status === "approved" ? { tone: "accent", label: "Approved" } : { tone: "neutral", label: "Draft" };
}

const ITEM_BADGE: Record<ItemStatus, BadgeView> = {
  draft: { tone: "neutral", label: "Draft" },
  approved: { tone: "accent", label: "Approved" },
  queued: { tone: "accent", label: "Queued" },
  publishing: { tone: "solid", label: "Publishing" },
  published: { tone: "solid", label: "Published" },
  failed: { tone: "danger", label: "Failed" },
  unknown: { tone: "warn", label: "Unknown" },
  rejected: { tone: "neutral", label: "Rejected" },
};

/** Item status → Badge. Failed = danger, unknown = warn (both carry the alert icon in Badge). */
export function itemStatusBadge(status: ItemStatus): BadgeView {
  return ITEM_BADGE[status];
}

/** Items that need the creator: the outbox gave up (failed) or doesn't know (unknown). */
export function needsYouCount(counts: Record<ItemStatus, number>): number {
  return (counts.failed ?? 0) + (counts.unknown ?? 0);
}

/** "8 posts · 6 draft · 2 approved": live (non-rejected) total first, then the non-zero buckets. */
export function countsMeta(counts: Record<ItemStatus, number>): string {
  const live = Object.entries(counts).reduce((n, [s, c]) => (s === "rejected" ? n : n + c), 0);
  const parts = [`${live} post${live === 1 ? "" : "s"}`];
  const add = (n: number, label: string) => {
    if (n > 0) parts.push(`${n} ${label}`);
  };
  add(counts.draft, "draft");
  add(counts.approved + counts.queued, "approved");
  add(counts.publishing, "publishing");
  add(counts.published, "published");
  add(needsYouCount(counts), "need you");
  add(counts.rejected, "rejected");
  return parts.join(" · ");
}

/** ISO-8601 week number of a "YYYY-MM-DD" date (calendar date, no zone). */
export function isoWeek(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the Thursday of this week decides the year
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86_400_000));
}

/** "W47" (two digits at least). */
export function weekIndex(ymd: string): string {
  return `W${String(isoWeek(ymd)).padStart(2, "0")}`;
}

/** The F11 panel (status, attempts, last error, the two buttons) applies instead of the hand-off line. */
export function isStuck(status: ItemStatus): boolean {
  return status === "failed" || status === "unknown";
}

/**
 * The one-line hand-off text for statuses the worker owns, other than failed/unknown (those get the
 * F11 panel). null when the card shows something else (a link, buttons, or nothing).
 */
export function handoffText(item: Pick<BatchItemView, "status" | "handedOff">, hasUrl: boolean): string | null {
  if (!item.handedOff || isStuck(item.status)) return null;
  if (item.status === "published" && hasUrl) return null;
  return "scheduled on the platform; change it in Studio/TikTok";
}

/** "key …abc123" (only ever the tail; the full key is never sent to the page). */
export function keyTailLabel(tail: string | null | undefined): string {
  return tail ? `key …${tail}` : "key not available";
}

export type AutoCheckState = "checking" | IgCheckResult["result"];
export interface AutoCheckView {
  tone: "neutral" | "accent" | "warn";
  text: string;
}

/** The four plain states of a post that should be on the platform (F19 S6). */
export type VerifyLabel = "Waiting to post" | "Posted (confirmed)" | "Not found yet" | "Can't check automatically";

/**
 * The IG automatic-check line (a Chip) as one of the four states. "Not found yet" (we looked, it isn't
 * in the last 50 posts) is NOT "Can't check automatically" (Instagram or our token didn't answer, so we
 * know nothing). A hit → accent. n/a (not Instagram) → nothing.
 */
export function autoCheckText(state: AutoCheckState): AutoCheckView | null {
  switch (state) {
    case "checking":
      return { tone: "neutral", text: "Checking your last 50 posts…" };
    case "not-found":
      return { tone: "neutral", text: "Not found yet: it isn't in your last 50 Instagram posts" };
    case "found":
      return { tone: "accent", text: "Posted (confirmed): found on Instagram" };
    case "error":
      return { tone: "warn", text: "Can't check automatically: Instagram didn't answer" };
    case "n/a":
      return null;
  }
}

/** The state label for a post: waiting (approved/queued/publishing), confirmed (published), else the check result. */
export function verifyLabel(status: ItemStatus, check: AutoCheckState = "n/a"): VerifyLabel {
  if (status === "published" || check === "found") return "Posted (confirmed)";
  if (status === "approved" || status === "queued" || status === "publishing") return "Waiting to post";
  return check === "error" ? "Can't check automatically" : "Not found yet";
}

/** The "record it" confirm sentence: platform + post title + 12-hour scheduled time; nothing is sent. */
export function recordConfirmText(opts: { platform: string; title: string; scheduled: string }): string {
  return `Mark the ${opts.platform} post "${opts.title}" (${opts.scheduled}) as posted? This only marks it as posted in the app. Nothing is sent again.`;
}

/**
 * "Confirm reset" enables: every box for the platform ticked (allTicked), and for IG the automatic
 * check has finished without a hit (a hit means record it instead). The server re-checks both.
 */
export function canConfirmReset(opts: { platform: Platform; checked: readonly string[]; check: AutoCheckState }): boolean {
  if (!allTicked(opts.platform, opts.checked)) return false;
  if (opts.platform === "instagram" && (opts.check === "checking" || opts.check === "found")) return false;
  return true;
}

export interface StuckActions {
  /** "Not posted, send it again" (back to draft): only when the server says canReset. */
  reset: boolean;
  /** "It's there → record it": every failed/unknown item except Snapchat (its URL rule refuses). */
  record: boolean;
  /** Snapchat is assisted: a one-line note pointing at /handoff instead of the buttons. */
  handoffNote: boolean;
}

/** Which F11 actions a card shows. Record is never gated on canReset (a row with a post id can still be recorded). */
export function stuckActions(item: Pick<BatchItemView, "status" | "platform" | "canReset">): StuckActions {
  if (!isStuck(item.status)) return { reset: false, record: false, handoffNote: false };
  const snap = item.platform === "snapchat";
  return { reset: !snap && item.canReset === true, record: !snap, handoffNote: snap };
}

export const PAST_TIME_TEXT = "Past time: pick a new time before approving";

/** A draft whose time has passed (a reset item lands here): the warn chip text, else null. */
export function pastTimeChip(item: Pick<BatchItemView, "status" | "scheduledFor">, now: Date): string | null {
  if (item.status !== "draft" || !item.scheduledFor) return null;
  const ms = Date.parse(item.scheduledFor);
  if (Number.isNaN(ms) || ms > now.getTime()) return null;
  return PAST_TIME_TEXT;
}

/** The card's warning lines: the "time.past" block is dropped when the past-time chip already says it. */
export function cardWarnings<W extends { code: string }>(warnings: readonly W[], pastTime: boolean): W[] {
  return pastTime ? warnings.filter((w) => w.code !== "time.past") : [...warnings];
}

/** Approved or further along (queued, publishing, published), out of the live (non-rejected) total. */
export function approvalProgress(counts: Record<ItemStatus, number>): { done: number; total: number } {
  const done = counts.approved + counts.queued + counts.publishing + counts.published;
  const total = Object.entries(counts).reduce((n, [s, c]) => (s === "rejected" ? n : n + c), 0);
  return { done, total };
}
