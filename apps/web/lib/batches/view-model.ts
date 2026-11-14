import { addCalendarDays, localDate, localHHMM, localParts, zonedTimeToUtc } from "@autopilot/core";
import type { BatchItemView, ItemStatus } from "./types.js";
import type { TransitionResult } from "./transitions.js";

/** Pure helpers for the batch screens. All dates/times are creator-local (`timeZone` = TZ_CREATOR or the UTC fallback). */

export interface DayGroup {
  /** "YYYY-MM-DD" creator-local. */
  date: string;
  /** "Mon 16 Nov". */
  label: string;
  items: Array<{ item: BatchItemView; time: string }>;
}

export interface WeekGroups {
  untimed: BatchItemView[];
  days: DayGroup[];
}

/** "Mon 16 Nov" for a calendar date (no zone involved: the date is already local). */
export function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${ymd}T12:00:00Z`))
    .replace(",", "");
}

/** "Mon 16 Nov", plus the year when it isn't the current one ("Mon 5 Jan 2099"). */
export function weekLabel(ymd: string, now: Date): string {
  const year = ymd.slice(0, 4);
  return year === String(now.getUTCFullYear()) ? dayLabel(ymd) : `${dayLabel(ymd)} ${year}`;
}

const validIso = (s: string | null): s is string => s != null && !Number.isNaN(new Date(s).getTime());

/**
 * Items by creator-local day: every day of the plan week in order (empty ones included), plus any
 * day outside it that has items; untimed items (or unparseable times) go in `untimed`. Within a day, by time.
 */
export function groupByLocalDay(items: BatchItemView[], timeZone: string, weekStart: string, days = 7): WeekGroups {
  const untimed: BatchItemView[] = [];
  const byDay = new Map<string, Array<{ item: BatchItemView; time: string; ms: number }>>();
  for (let d = 0; d < days; d++) byDay.set(addCalendarDays(weekStart, d), []);
  for (const item of items) {
    if (!validIso(item.scheduledFor)) {
      untimed.push(item);
      continue;
    }
    const at = new Date(item.scheduledFor);
    const date = localDate(at, timeZone);
    const list = byDay.get(date) ?? [];
    list.push({ item, time: localHHMM(at, timeZone), ms: at.getTime() });
    byDay.set(date, list);
  }
  const out: DayGroup[] = [...byDay.keys()].sort().map((date) => ({
    date,
    label: dayLabel(date),
    items: byDay
      .get(date)!
      .sort((a, b) => a.ms - b.ms || a.item.platform.localeCompare(b.item.platform))
      .map(({ item, time }) => ({ item, time })),
  }));
  return { untimed, days: out };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO UTC → `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM") in `timeZone`; "" when unset/invalid. */
export function toDatetimeLocal(iso: string | null, timeZone: string): string {
  if (!validIso(iso)) return "";
  const p = localParts(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `datetime-local` value in `timeZone` → ISO UTC; null when empty or malformed. DST-safe via zonedTimeToUtc. */
export function fromDatetimeLocal(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = zonedTimeToUtc(y, mo, d, h, mi, timeZone);
  if (Number.isNaN(at.getTime())) return null;
  // Reject dates that rolled over (e.g. 31 Feb): the local date must survive the round trip.
  if (localDate(at, timeZone).slice(0, 10) !== `${y}-${pad(mo)}-${pad(d)}`) return null;
  return at.toISOString();
}

export interface ConfirmCounts {
  approvable: number;
  blocked: number;
  /** Warn-level warnings on the items that would be approved. */
  warnCount: number;
  skipped: Array<{ itemId: string; reasons: string[] }>;
}

/** Numbers for the "Approve all" confirm sheet, from the server-side approve-all plan. */
export function confirmCounts(items: BatchItemView[], plan: TransitionResult): ConfirmCounts {
  if (!plan.ok) return { approvable: 0, blocked: 0, warnCount: 0, skipped: [] };
  const ids = new Set(plan.changes.map((c) => c.itemId));
  const warnCount = items.filter((i) => ids.has(i.id)).reduce((n, i) => n + i.warnings.filter((w) => w.severity === "warn").length, 0);
  return { approvable: plan.changes.length, blocked: plan.skipped.length, warnCount, skipped: plan.skipped };
}

/** Same rule as planTransition: approved if anything sits outside draft/rejected. */
export function batchStatusOf(items: Array<{ status: ItemStatus }>): "draft" | "approved" {
  return items.some((i) => i.status !== "draft" && i.status !== "rejected") ? "approved" : "draft";
}

/** "0:42" / "1:05" from seconds; "" when unknown. */
export function formatDuration(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
}

/** Counts for the batch list: draft / approved / published / rejected / other. */
export function summaryCounts(counts: Record<ItemStatus, number>): { draft: number; approved: number; published: number; rejected: number; other: number } {
  const other = counts.queued + counts.publishing + counts.failed + counts.unknown;
  return { draft: counts.draft, approved: counts.approved, published: counts.published, rejected: counts.rejected, other };
}

/** "Mon 16 Nov · 09:00" in the creator's zone; "no time" when unset/invalid. */
export function scheduledLabel(iso: string | null, timeZone: string): string {
  if (!validIso(iso)) return "no time";
  const at = new Date(iso);
  return `${dayLabel(localDate(at, timeZone))} · ${localHHMM(at, timeZone)}`;
}
