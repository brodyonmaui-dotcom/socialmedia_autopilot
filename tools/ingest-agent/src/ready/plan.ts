import {
  addCalendarDays,
  assignSlots,
  diffCalendarDays,
  localDate,
  localToUtc,
  weekdayIndex,
  type CadenceSettings,
  type ExistingPost,
  type Platform,
} from "@autopilot/core";
import type { LintResult } from "@autopilot/research";
import type { Sidecar } from "./sidecar.js";

/**
 * Pure planning for one editor render (F15 "Laptop side" step 4): sidecar → one PlannedItem per
 * platform with caption/title, a slot inside the creator's `when`/`earliest` window, and flags.
 * Never approves anything; a missing caption is flagged, never generated (AI split).
 */

/** An already-committed post. `tiktokDraft` (from batch_items.trial) feeds the 5-pending-drafts check. */
export type ReadyExisting = ExistingPost & { tiktokDraft?: boolean };

export interface ReadyInput {
  sidecar: Sidecar;
  contentHash: string;
  mediaId: string;
  now: Date;
  timeZone: string;
  cadence: CadenceSettings;
  existing: ReadyExisting[];
  lint: (text: string, kind: "caption" | "title", platform: Platform) => LintResult;
}

export type EditorFlag = "needs-caption" | "add-sound-in-app" | "no-slot" | "lint-error" | "tiktok-draft-limit";

export interface PlannedItem {
  platform: Platform;
  ingestKey: string;
  caption: string;
  title: string | null;
  scheduledFor: string | null;
  weekStart: string;
  tiktokDraft: boolean;
  flags: EditorFlag[];
}

/** Zernio allows 5 pending TikTok Creator Inbox drafts per 24 h. */
export const TIKTOK_DRAFT_LIMIT = 5;

export function ingestKey(contentHash: string, platform: Platform): string {
  return `${contentHash}:${platform}`;
}

/** Local Monday ("YYYY-MM-DD") of a local date. */
export function mondayOf(ymd: string): string {
  return addCalendarDays(ymd, -weekdayIndex(ymd));
}

// Fable to review: F15 editor slotting (plan)
/**
 * `when` → [notBefore, notAfter) as instants, all through localToUtc on calendar dates (DST-safe):
 *  - today:     [max(now, today earliest), start of tomorrow)
 *  - tomorrow:  [tomorrow earliest (or 00:00), start of the day after)
 *  - this-week: [max(now, today earliest), start of the Monday after the local Sunday)
 */
export function readyWindow(sidecar: Pick<Sidecar, "when" | "earliest">, now: Date, timeZone: string): { notBefore: Date; notAfter: Date } {
  const today = localDate(now, timeZone);
  const at = (ymd: string, hhmm: string) => localToUtc(ymd, hhmm, timeZone);
  const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
  switch (sidecar.when) {
    case "today":
      return { notBefore: later(now, at(today, sidecar.earliest ?? "00:00")), notAfter: at(addCalendarDays(today, 1), "00:00") };
    case "tomorrow": {
      const tomorrow = addCalendarDays(today, 1);
      return { notBefore: at(tomorrow, sidecar.earliest ?? "00:00"), notAfter: at(addCalendarDays(tomorrow, 1), "00:00") };
    }
    case "this-week": {
      const nextMonday = addCalendarDays(mondayOf(today), 7);
      return { notBefore: later(now, at(today, sidecar.earliest ?? "00:00")), notAfter: at(nextMonday, "00:00") };
    }
  }
}

/**
 * Range of `existing` posts the plan needs: the window's local weeks (Monday 00:00 of the start's
 * week to Monday 00:00 after the end's week), widened by 24 h back for the TikTok draft-limit look-back.
 */
export function existingRange(window: { notBefore: Date; notAfter: Date }, timeZone: string): { from: string; to: string } {
  const startMonday = mondayOf(localDate(window.notBefore, timeZone));
  const endMonday = addCalendarDays(mondayOf(localDate(new Date(window.notAfter.getTime() - 1), timeZone)), 7);
  const from = new Date(localToUtc(startMonday, "00:00", timeZone).getTime() - 24 * 3_600_000);
  return { from: from.toISOString(), to: localToUtc(endMonday, "00:00", timeZone).toISOString() };
}

function textsFor(sidecar: Sidecar, platform: Platform): { caption: string; title: string | null } {
  const c = sidecar.caption;
  switch (platform) {
    case "youtube":
      return { caption: c.youtube?.description ?? "", title: c.youtube?.title ?? "" };
    case "instagram":
      return { caption: c.instagram ?? "", title: null };
    case "tiktok":
      return { caption: c.tiktok ?? "", title: null };
    case "snapchat":
      return { caption: c.snapchat ?? "", title: null };
  }
}

export function planReadyItems(i: ReadyInput): PlannedItem[] {
  const { sidecar, timeZone } = i;
  const win = readyWindow(sidecar, i.now, timeZone);
  const startDate = localDate(win.notBefore, timeZone);
  const endDate = localDate(new Date(Math.max(win.notBefore.getTime(), win.notAfter.getTime() - 1)), timeZone);

  // One sameDay item per render: every platform independently takes its earliest free time in the
  // window (grid first, then the flex grid); nothing is ever placed outside the window.
  const result = assignSlots({
    weekStart: startDate,
    days: diffCalendarDays(startDate, endDate) + 1,
    items: [{ key: i.contentHash, platforms: [...sidecar.platforms], window: { notBefore: win.notBefore.toISOString(), notAfter: win.notAfter.toISOString() }, sameDay: true }],
    cadence: i.cadence,
    timeZone,
    existing: i.existing.map((e) => ({ platform: e.platform, scheduledFor: e.scheduledFor })),
    now: i.now,
  });
  const slotOf = new Map(result.assignments.map((a) => [a.platform, a.scheduledFor]));

  return sidecar.platforms.map((platform): PlannedItem => {
    const flags = new Set<EditorFlag>();
    const { caption, title } = textsFor(sidecar, platform);
    if (caption.trim() === "" || (platform === "youtube" && (title ?? "").trim() === "")) flags.add("needs-caption");

    const tiktokDraft = platform === "tiktok" && sidecar.soundInApp;
    if (sidecar.soundInApp && (platform === "instagram" || platform === "youtube")) flags.add("add-sound-in-app");

    const scheduledFor = slotOf.get(platform) ?? null;
    if (!scheduledFor) flags.add("no-slot");

    if (tiktokDraft && scheduledFor) {
      const slot = Date.parse(scheduledFor);
      const pending = i.existing.filter((e) => {
        if (e.platform !== "tiktok" || e.tiktokDraft !== true) return false;
        const t = Date.parse(e.scheduledFor);
        return t >= slot - 24 * 3_600_000 && t < slot;
      }).length;
      if (pending >= TIKTOK_DRAFT_LIMIT) flags.add("tiktok-draft-limit");
    }

    const lintFails =
      (caption.trim() !== "" && !i.lint(caption, "caption", platform).ok) ||
      (title !== null && title.trim() !== "" && !i.lint(title, "title", platform).ok);
    if (lintFails) flags.add("lint-error");

    const weekStart = mondayOf(scheduledFor ? localDate(new Date(scheduledFor), timeZone) : startDate);
    return { platform, ingestKey: ingestKey(i.contentHash, platform), caption, title, scheduledFor, weekStart, tiktokDraft, flags: [...flags] };
  });
}
// End of F15 editor slotting (plan).
