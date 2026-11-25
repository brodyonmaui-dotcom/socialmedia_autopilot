import { addCalendarDays, localDate, weekdayIndex } from "./time.js";

/** Library folder labels (media.folder, migration 0016): free text, shown as a section title. */
export const FOLDER_MAX = 60;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type FolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/** Trim, 1 to 60 chars, no slashes/backslashes (it is a label, never a path) and no control characters. */
export function checkFolderLabel(raw: unknown): FolderCheck {
  if (typeof raw !== "string") return { ok: false, reason: "folder must be text" };
  const folder = raw.trim().replace(/\s+/g, " ");
  if (!folder) return { ok: false, reason: "folder name is empty" };
  if (folder.length > FOLDER_MAX) return { ok: false, reason: `folder name is longer than ${FOLDER_MAX} characters` };
  if (/[\\/]/.test(folder)) return { ok: false, reason: "folder name can't contain slashes" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(folder)) return { ok: false, reason: "folder name has invalid characters" };
  return { ok: true, folder };
}

/** Monday (YYYY-MM-DD) of the week holding `ymd`. */
export const weekMonday = (ymd: string): string => addCalendarDays(ymd, -weekdayIndex(ymd));

/** "Week of Nov 23" for a Monday date. */
export function weekLabelOfMonday(monday: string): string {
  return `Week of ${MON[Number(monday.slice(5, 7)) - 1]} ${Number(monday.slice(8, 10))}`;
}

/** "Week of Nov 23" for the Monday-start week holding an instant, in `timeZone` (creator-local, else pass "UTC"). */
export function weekFolderLabel(at: Date, timeZone: string): string {
  return weekLabelOfMonday(weekMonday(localDate(at, timeZone)));
}
