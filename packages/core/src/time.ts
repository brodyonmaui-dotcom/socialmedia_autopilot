/**
 * DST-safe time helpers. Rules that keep this correct across clock changes:
 *  - Calendar dates ("YYYY-MM-DD" in the creator's zone) are moved with pure date arithmetic on a
 *    UTC-midnight counter, never by adding 24 h to a real instant.
 *  - A local wall-clock time becomes an instant only through zonedTimeToUtc (two-pass offset fix).
 *  - The time zone is always a parameter (TZ_CREATOR from .env); nothing here hard-codes one.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock parts of an instant in `timeZone`. Throws on an unknown zone. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** "YYYY-MM-DD" of an instant in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" of an instant in `timeZone`. */
export function localHHMM(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function parseYMD(ymd: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${ymd}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Pure calendar arithmetic: never touches a real instant, so DST can't shorten or stretch a day. */
export function addCalendarDays(ymd: string, days: number): string {
  const { year, month, day } = parseYMD(ymd);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (both "YYYY-MM-DD"); negative when b is earlier. */
export function diffCalendarDays(a: string, b: string): number {
  const pa = parseYMD(a);
  const pb = parseYMD(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayIndex(ymd: string): number {
  const { year, month, day } = parseYMD(ymd);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`not an HH:MM time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hhmmFromMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Resolves "HH:MM on YYYY-MM-DD in timeZone" to the real UTC instant (two-pass offset correction).
 * On a spring-forward gap (e.g. 02:30 that never happens) the result lands on the valid instant
 * one hour later; on a fall-back repeat the first occurrence wins. Both are deterministic.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const seen = localParts(new Date(guess), timeZone);
  const seenUTC = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  let result = new Date(guess - (seenUTC - guess));
  // Second pass: the first correction can overshoot when the offset changed between guess and result.
  const check = localParts(result, timeZone);
  const checkUTC = Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute, check.second);
  if (checkUTC !== guess) {
    const second = new Date(result.getTime() - (checkUTC - guess));
    const p2 = localParts(second, timeZone);
    const p2UTC = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second);
    // Keep whichever candidate lands on (or, in a gap, just past) the requested wall-clock time.
    if (p2UTC === guess || p2UTC > checkUTC) result = second;
  }
  return result;
}

/** "YYYY-MM-DD" + "HH:MM" in `timeZone` → instant. */
export function localToUtc(ymd: string, hhmm: string, timeZone: string): Date {
  const { year, month, day } = parseYMD(ymd);
  const mins = minutesOfDay(hhmm);
  return zonedTimeToUtc(year, month, day, Math.floor(mins / 60), mins % 60, timeZone);
}

/** UTC offset of `timeZone` at `date`, in minutes. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60_000);
}

/** Does the UTC offset change anywhere inside [from, to]? (Used to pick a DST-crossing simulation week.) */
export function hasOffsetChange(from: Date, to: Date, timeZone: string): boolean {
  const start = offsetMinutes(from, timeZone);
  for (let t = from.getTime(); t <= to.getTime(); t += 3_600_000) {
    if (offsetMinutes(new Date(t), timeZone) !== start) return true;
  }
  return offsetMinutes(to, timeZone) !== start;
}

export function assertTimeZone(timeZone: string | undefined, source = "TZ_CREATOR"): string {
  if (!timeZone) throw new Error(`${source} is not set — the creator's time zone lives in .env only (never in git)`);
  try {
    formatter(timeZone);
  } catch {
    throw new Error(`${source} is not a valid IANA time zone`);
  }
  return timeZone;
}
