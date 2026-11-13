// F10 Snapchat handoff: pure logic (no DB, no env). See docs/design/F10.md.
import { addCalendarDays, localDate, localHHMM, minutesOfDay, parseYMD, zonedTimeToUtc } from "@autopilot/core";
import { lintText } from "@autopilot/research";
import type { HandoffBucket } from "./types.js";

export const NO_CLEAN_FILE = "no clean file yet (touch-up hasn't uploaded it)";

/** Creator-local day of `scheduledFor` vs `today` (both in `timeZone`). */
export function bucketFor(scheduledFor: string, today: string, timeZone: string): HandoffBucket {
  const day = localDate(new Date(scheduledFor), timeZone);
  if (day === today) return "today";
  return day < today ? "missed" : "future"; // YYYY-MM-DD compares lexically
}

/** First day strictly after `fromLocalDay` that isn't taken, looking at most `maxDays` ahead; null if none. */
export function nextFreeDay(fromLocalDay: string, takenLocalDays: Set<string>, maxDays = 14): string | null {
  for (let i = 1; i <= maxDays; i++) {
    const d = addCalendarDays(fromLocalDay, i);
    if (!takenLocalDays.has(d)) return d;
  }
  return null;
}

/**
 * Same local HH:MM on the next free creator-local day (DST-safe: the wall clock is resolved with
 * zonedTimeToUtc on the target day). `today` (optional) makes a missed item roll forward from today,
 * not from its own old day, so a skip never lands in the past.
 */
export function skipTarget(
  item: { scheduledFor: string },
  taken: Set<string>,
  timeZone: string,
  today?: string,
): { scheduledFor: string; localDay: string } | null {
  const at = new Date(item.scheduledFor);
  const own = localDate(at, timeZone);
  const from = today && today > own ? today : own;
  const day = nextFreeDay(from, taken);
  if (!day) return null;
  const { year, month, day: dd } = parseYMD(day);
  const mins = minutesOfDay(localHHMM(at, timeZone));
  const utc = zonedTimeToUtc(year, month, dd, Math.floor(mins / 60), mins % 60, timeZone);
  return { scheduledFor: utc.toISOString(), localDay: day };
}

/** Reasons Share is disabled: privacy lint errors (re-checked at handoff, C5) + a missing clean file. */
export function handoffBlocks(caption: string, hasCleanFile: boolean, blocklist: string[]): string[] {
  const out = lintText({ text: caption, kind: "caption", platform: "snapchat", blocklist })
    .issues.filter((i) => i.rule.startsWith("privacy."))
    .map((i) => `${i.message} (${i.rule})`);
  if (!hasCleanFile) out.push(NO_CLEAN_FILE);
  return out;
}
