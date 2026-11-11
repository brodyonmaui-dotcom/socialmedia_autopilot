import type { PostingWindow } from "./types.js";

function minutesOfDay(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Resolves "HH:MM on Y-M-D in timeZone" to the real UTC instant, via the standard two-pass offset correction. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const seenUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (seenUTC - guess));
}

export interface CatchUpSlotParams {
  /** How many slots to return. */
  count: number;
  /** Target posting cadence, e.g. 3 for "2-3 posts a day". */
  slotsPerDay: number;
  windows: PostingWindow[];
  timeZone: string;
  /** Slots before this instant are dropped (a platform can reject a past scheduledFor). */
  startFrom: Date;
}

/**
 * Evenly spaces `count` future slots across the posting windows, `slotsPerDay` per day,
 * starting from `startFrom`'s calendar date in `timeZone`. Each day's slots sit at the
 * midpoint of `slotsPerDay` equal segments of that day's total window minutes.
 */
export function generateCatchUpSlots(params: CatchUpSlotParams): Date[] {
  const { count, slotsPerDay, windows, timeZone, startFrom } = params;
  if (count <= 0 || slotsPerDay <= 0 || windows.length === 0) return [];

  const ranges = [...windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start)).map((w) => [minutesOfDay(w.start), minutesOfDay(w.end)] as const);
  const totalMinutes = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);

  function pointAtFraction(f: number): number {
    let target = f * totalMinutes;
    for (const [s, e] of ranges) {
      const len = e - s;
      if (target <= len) return s + target;
      target -= len;
    }
    const last = ranges[ranges.length - 1] as (typeof ranges)[number];
    return last[1];
  }
  const dailyOffsets = Array.from({ length: slotsPerDay }, (_, i) => pointAtFraction((i + 0.5) / slotsPerDay));

  const startParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(startFrom).map((p) => [p.type, p.value]),
  );
  // Pure calendar-date arithmetic, never read back as a real instant — DST-safe by construction.
  const base = Date.UTC(Number(startParts.year), Number(startParts.month) - 1, Number(startParts.day));

  const candidates: Date[] = [];
  for (let dayIndex = 0; candidates.length < count + slotsPerDay && dayIndex < 400; dayIndex++) {
    const dayCounter = new Date(base + dayIndex * 86_400_000);
    const dy = dayCounter.getUTCFullYear();
    const dmo = dayCounter.getUTCMonth() + 1;
    const dd = dayCounter.getUTCDate();
    for (const offsetMin of dailyOffsets) {
      candidates.push(zonedTimeToUtc(dy, dmo, dd, Math.floor(offsetMin / 60), Math.round(offsetMin % 60), timeZone));
    }
  }
  return candidates.filter((d) => d.getTime() > startFrom.getTime()).slice(0, count);
}
