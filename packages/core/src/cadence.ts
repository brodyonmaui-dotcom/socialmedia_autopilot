import type { PostingWindow } from "./types.js";

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Checks a "HH:MM" wall-clock time (already in the creator's local time) against the posting windows. */
export function isWithinAnyWindow(hhmm: string, windows: PostingWindow[]): boolean {
  const t = toMinutes(hhmm);
  return windows.some((w) => t >= toMinutes(w.start) && t <= toMinutes(w.end));
}

/** Same check for a full Date, given the "HH:MM" already resolved in the creator's local time zone. */
export function isWithinAnyWindowAt(date: Date, windows: PostingWindow[], timeZone: string): boolean {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return isWithinAnyWindow(hhmm, windows);
}
