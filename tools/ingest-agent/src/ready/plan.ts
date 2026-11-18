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
  type ScheduleResult,
  type UnplacedReason,
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

// Reviewed in run 4 (2026-11-16): F15 editor slotting (plan)
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

/**
 * Every instant `planReadyItems` may place into: the `when` window, and for `today` also tomorrow
 * (the whole-item fallback). Use it for the `existing` range.
 */
export function planningWindow(sidecar: Pick<Sidecar, "when" | "earliest">, now: Date, timeZone: string): { notBefore: Date; notAfter: Date } {
  const win = readyWindow(sidecar, now, timeZone);
  if (sidecar.when !== "today") return win;
  return { notBefore: win.notBefore, notAfter: readyWindow({ ...sidecar, when: "tomorrow" }, now, timeZone).notAfter };
}

/** Unplaced reasons that send a `today` item to tomorrow. */
const ROLL_TO_TOMORROW: ReadonlySet<UnplacedReason> = new Set(["cap", "no-slot", "buffer"]);

function slotWindow(i: ReadyInput, when: Sidecar["when"]): { startDate: string; result: ScheduleResult } {
  const { sidecar, timeZone } = i;
  const win = readyWindow({ when, earliest: sidecar.earliest }, i.now, timeZone);
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
  return { startDate, result };
}

/**
 * `today` = the next free slot after now within today's caps and spacing. If ANY platform can't be
 * placed today (cap / no-slot / buffer), the WHOLE item is re-planned as `tomorrow` (from the local
 * day start or `earliest`) so every platform stays on one day; if tomorrow also leaves a platform
 * unplaced, the tomorrow plan stands and that platform gets `no-slot`.
 */
export function planReadyItems(i: ReadyInput): PlannedItem[] {
  const { sidecar, timeZone } = i;
  let { startDate, result } = slotWindow(i, sidecar.when);
  if (sidecar.when === "today" && result.unplaced.some((u) => ROLL_TO_TOMORROW.has(u.reason))) {
    ({ startDate, result } = slotWindow(i, "tomorrow"));
  }
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
