import type { Platform } from "./types.js";
import { daySlotTimes, PLATFORMS, type CadenceSettings } from "./cadence.js";
import { addCalendarDays, diffCalendarDays, hhmmFromMinutes, localDate, localToUtc, minutesOfDay } from "./time.js";

/** One video that wants to go out on some platforms this week. */
export interface ScheduleItem {
  /** Stable id for the video (mediaId, or a label in drafts). Used for duplicate detection. */
  key: string;
  pillar?: string;
  platforms: Platform[];
  /** When the clip was filmed (ISO); drives the per-pillar buffer when one is configured. */
  capturedAt?: string;
  /** Times already fixed by hand (ISO with offset). Kept verbatim, still counted toward caps. */
  pinned?: Partial<Record<Platform, string>>;
  /** F15: ISO instants; this item is only placed inside [notBefore, notAfter). Never rolled outside it. */
  window?: { notBefore: string; notAfter: string };
  /**
   * F15 editor item: ignore stagger (every platform takes its earliest free time in the window) and,
   * when no grid slot is free, fall back to the flex grid (see assignSlots).
   */
  sameDay?: boolean;
}

/** A post already committed outside this run (other batches), so caps and gaps account for it. */
export interface ExistingPost {
  platform: Platform;
  scheduledFor: string;
}

export interface ScheduleInput {
  /** First local calendar day of the plan ("YYYY-MM-DD" in `timeZone`). */
  weekStart: string;
  /** Days in the plan (default 7). Staggered copies may spill past it, caps still hold there. */
  days?: number;
  items: ScheduleItem[];
  cadence: CadenceSettings;
  /** TZ_CREATOR. Required; never defaulted. */
  timeZone: string;
  existing?: ExistingPost[];
  /** Slots at or before this instant are unusable (default: none are excluded). */
  now?: Date;
}

export interface Assignment {
  key: string;
  platform: Platform;
  /** UTC instant, ISO 8601 with Z. */
  scheduledFor: string;
  localDate: string;
  localTime: string;
  /** Day index relative to weekStart (can exceed `days` for staggered copies). */
  dayIndex: number;
  /** Slot position on that day, or -1 for a pinned time. */
  slotIndex: number;
  pinned: boolean;
  /** F15: placed on the flex grid (slotIndex -1, not pinned). Only set for sameDay items. */
  flex?: true;
}

export type UnplacedReason = "cap" | "no-slot" | "buffer" | "duplicate" | "pinned-cap" | "pinned-invalid";

export interface Unplaced {
  key: string;
  platform: Platform;
  reason: UnplacedReason;
  detail: string;
}

export interface ScheduleResult {
  assignments: Assignment[];
  unplaced: Unplaced[];
  warnings: string[];
}

export interface CapBreach {
  platform: Platform;
  localDate: string;
  count: number;
  cap: number;
}

/** Counts posts per platform per local day and reports anything over the cap. Pure; reused by simulate-week and the outbox. */
export function findCapBreaches(posts: Array<{ platform: Platform; scheduledFor: string }>, cadence: CadenceSettings, timeZone: string): CapBreach[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const day = localDate(new Date(p.scheduledFor), timeZone);
    const k = `${p.platform}|${day}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const breaches: CapBreach[] = [];
  for (const [k, count] of counts) {
    const [platform, day] = k.split("|") as [Platform, string];
    const cap = cadence.dailyCaps[platform];
    if (count > cap) breaches.push({ platform, localDate: day, count, cap });
  }
  return breaches.sort((a, b) => a.localDate.localeCompare(b.localDate) || a.platform.localeCompare(b.platform));
}

/** Spill room past the plan so staggered copies of the last day still find a slot. */
const SPILL_DAYS = 7;

/**
 * Assigns every (item, platform) pair a slot on the cadence grid.
 *
 *  - Instagram anchors a video (or its first listed platform when Instagram isn't wanted). The
 *    anchor goes to the least-loaded day in the plan, earliest first, next free slot.
 *  - Other platforms follow the stagger rule (days + slots after the anchor), then slide forward
 *    to the next free slot if that one is taken, capped or in the past.
 *  - A day is "free" only under the per-platform daily cap, counting existing commitments.
 *  - Buffer: a clip's earliest day is captured-date + bufferDays[pillar] (local calendar days).
 *  - Pinned times are kept as-is and counted; a pinned time that breaks a cap is refused, not bent.
 *  - The same video twice on one platform is a duplicate: the second copy is refused.
 * All instants come from localToUtc on calendar dates, so a DST change never shifts a slot's wall-clock time.
 */
export function assignSlots(input: ScheduleInput): ScheduleResult {
  const { cadence, timeZone, items } = input;
  const days = input.days ?? 7;
  const slotTimes = daySlotTimes(cadence);
  const nowMs = input.now?.getTime() ?? -Infinity;
  const warnings: string[] = [];
  const unplaced: Unplaced[] = [];
  const assignments: Assignment[] = [];

  const dayCount = new Map<string, number>(); // `${platform}|${date}` -> posts that day
  const taken = new Set<string>(); // `${platform}|${dayIndex}|${slotIndex}`
  const instants = new Map<Platform, number[]>(); // per platform, for the min-gap check
  for (const p of PLATFORMS) instants.set(p, []);

  const dateOf = (dayIndex: number): string => addCalendarDays(input.weekStart, dayIndex);
  const bump = (platform: Platform, date: string, instantMs: number): void => {
    const k = `${platform}|${date}`;
    dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
    instants.get(platform)!.push(instantMs);
  };
  const underCap = (platform: Platform, date: string): boolean => (dayCount.get(`${platform}|${date}`) ?? 0) < cadence.dailyCaps[platform];
  const gapOk = (platform: Platform, instantMs: number): boolean => {
    const gap = cadence.minGapMinutes * 60_000;
    return instants.get(platform)!.every((t) => Math.abs(t - instantMs) >= gap);
  };

  for (const e of input.existing ?? []) {
    const t = Date.parse(e.scheduledFor);
    if (!Number.isFinite(t)) continue;
    bump(e.platform, localDate(new Date(t), timeZone), t);
  }

  const slotInstant = (dayIndex: number, slotIndex: number): Date => localToUtc(dateOf(dayIndex), slotTimes[slotIndex]!, timeZone);

  /** Next usable (day, slot) at or after the given position for a platform, within the spill limit. */
  function nextFree(platform: Platform, fromDay: number, fromSlot: number, minDay: number, allow?: (at: Date) => boolean): { dayIndex: number; slotIndex: number; at: Date } | null {
    if (slotTimes.length === 0) return null;
    let day = Math.max(fromDay, minDay);
    let slot = day === fromDay ? fromSlot : 0;
    while (day < days + SPILL_DAYS) {
      for (; slot < slotTimes.length; slot++) {
        const date = dateOf(day);
        if (!underCap(platform, date)) break; // the whole day is full for this platform
        if (taken.has(`${platform}|${day}|${slot}`)) continue;
        const at = slotInstant(day, slot);
        if (at.getTime() <= nowMs) continue;
        if (!gapOk(platform, at.getTime())) continue;
        if (allow && !allow(at)) continue;
        return { dayIndex: day, slotIndex: slot, at };
      }
      day++;
      slot = 0;
    }
    return null;
  }

  function place(key: string, platform: Platform, dayIndex: number, slotIndex: number, at: Date): void {
    taken.add(`${platform}|${dayIndex}|${slotIndex}`);
    const date = dateOf(dayIndex);
    bump(platform, date, at.getTime());
    assignments.push({ key, platform, scheduledFor: at.toISOString(), localDate: date, localTime: slotTimes[slotIndex]!, dayIndex, slotIndex, pinned: false });
  }

  // Fable to review: F15 editor slotting (window/sameDay/flex grid)
  // Everything from here to the matching end marker only runs for items with `window` or `sameDay`;
  // items without them never reach it, so the weekly batch keeps its exact pre-F15 placement.
  const gapMs = cadence.minGapMinutes * 60_000;
  const flexStep = Math.max(1, cadence.minGapMinutes);

  /** Local calendar dates the window touches (first to last, inclusive). */
  function windowDates(w: { start: number; end: number }): string[] {
    if (!(w.end > w.start)) return [];
    const first = localDate(new Date(w.start), timeZone);
    const last = localDate(new Date(w.end - 1), timeZone);
    const out: string[] = [];
    for (let d = first; d <= last; d = addCalendarDays(d, 1)) out.push(d);
    return out;
  }

  /** Flex candidates on one local day: every minGapMinutes from each posting window's start, up to its end (inclusive, like isWithinAnyWindow). */
  function flexTimes(): string[] {
    const out: string[] = [];
    for (const w of cadence.windows) {
      for (let m = minutesOfDay(w.start); m <= minutesOfDay(w.end); m += flexStep) out.push(hhmmFromMinutes(m));
    }
    return out;
  }
  const FLEX_TIMES = flexTimes();

  /**
   * Places one (item, platform) inside the window: grid slots first (earliest), then, for sameDay
   * items, the flex grid. Returns the unplaced reason when nothing fits: "cap" when every usable
   * time in the window sat on a day already at the cap, otherwise "no-slot".
   */
  function placeInWindow(key: string, platform: Platform, w: { start: number; end: number }, minDay: number, useFlex: boolean): Unplaced | null {
    const usable = (at: Date): boolean => at.getTime() >= w.start && at.getTime() < w.end && at.getTime() > nowMs;
    let sawCandidate = false;
    let sawUnderCap = false;
    const dates = windowDates(w).filter((d) => diffCalendarDays(input.weekStart, d) >= minDay);
    // Grid slots, earliest first.
    for (const date of dates) {
      const dayIndex = diffCalendarDays(input.weekStart, date);
      for (let slot = 0; slot < slotTimes.length; slot++) {
        const at = localToUtc(date, slotTimes[slot]!, timeZone);
        if (!usable(at)) continue;
        sawCandidate = true;
        if (!underCap(platform, date)) break;
        sawUnderCap = true;
        if (taken.has(`${platform}|${dayIndex}|${slot}`)) continue;
        if (!gapOk(platform, at.getTime())) continue;
        place(key, platform, dayIndex, slot, at);
        return null;
      }
    }
    // Flex grid: first candidate >= notBefore that keeps the gap to every post and the day under the cap.
    if (useFlex) {
      for (const date of dates) {
        const dayIndex = diffCalendarDays(input.weekStart, date);
        for (const hhmm of FLEX_TIMES) {
          const at = localToUtc(date, hhmm, timeZone);
          if (!usable(at)) continue;
          sawCandidate = true;
          if (!underCap(platform, date)) break;
          sawUnderCap = true;
          if (!gapOk(platform, at.getTime())) continue;
          if (gapMs === 0 && instants.get(platform)!.includes(at.getTime())) continue; // never two posts at one instant
          bump(platform, date, at.getTime());
          assignments.push({ key, platform, scheduledFor: at.toISOString(), localDate: date, localTime: hhmm, dayIndex, slotIndex: -1, pinned: false, flex: true });
          return null;
        }
      }
    }
    const capBlocked = sawCandidate && !sawUnderCap;
    return capBlocked
      ? { key, platform, reason: "cap", detail: `every ${platform} time in the window is on a day already at the cap of ${cadence.dailyCaps[platform]}` }
      : { key, platform, reason: "no-slot", detail: `no free ${platform} time inside the window` };
  }

  /** The item's window as epoch ms; sameDay without a window falls back to the plan's days. */
  function windowOf(item: ScheduleItem): { start: number; end: number } | null {
    if (item.window) {
      const start = Date.parse(item.window.notBefore);
      const end = Date.parse(item.window.notAfter);
      return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : { start: 0, end: 0 };
    }
    if (item.sameDay) return { start: localToUtc(input.weekStart, "00:00", timeZone).getTime(), end: localToUtc(dateOf(days), "00:00", timeZone).getTime() };
    return null;
  }
  // End of F15 editor slotting helpers.

  /** F15 (Fable to review): "cap" when every future grid time in the window is on a capped day, else "no-slot". */
  function windowReason(platform: Platform, w: { start: number; end: number }, minDay: number): UnplacedReason {
    let saw = false;
    for (const date of windowDates(w)) {
      if (diffCalendarDays(input.weekStart, date) < minDay) continue;
      for (const t of slotTimes) {
        const at = localToUtc(date, t, timeZone).getTime();
        if (at < w.start || at >= w.end || at <= nowMs) continue;
        saw = true;
        if (underCap(platform, date)) return "no-slot";
      }
    }
    return saw ? "cap" : "no-slot";
  }

  const seen = new Set<string>();

  for (const item of items) {
    const platforms = [...new Set(item.platforms)];
    if (platforms.length === 0) continue;

    // Buffer: earliest plan day this clip may post on.
    let minDay = 0;
    const buffer = item.pillar ? (cadence.bufferDays[item.pillar] ?? 0) : 0;
    if (buffer > 0 && item.capturedAt) {
      const captured = localDate(new Date(item.capturedAt), timeZone);
      minDay = Math.max(0, diffCalendarDays(input.weekStart, addCalendarDays(captured, buffer)));
    }

    // Pinned copies first: they're fixed, so everything else routes around them.
    const wanted: Platform[] = [];
    for (const platform of platforms) {
      const dup = `${item.key}|${platform}`;
      if (seen.has(dup)) {
        unplaced.push({ key: item.key, platform, reason: "duplicate", detail: "same video already scheduled on this platform" });
        continue;
      }
      seen.add(dup);
      const pin = item.pinned?.[platform];
      if (!pin) {
        wanted.push(platform);
        continue;
      }
      const t = Date.parse(pin);
      if (!Number.isFinite(t)) {
        unplaced.push({ key: item.key, platform, reason: "pinned-invalid", detail: `pinned time "${pin}" is not ISO 8601` });
        continue;
      }
      const date = localDate(new Date(t), timeZone);
      if (!underCap(platform, date)) {
        unplaced.push({ key: item.key, platform, reason: "pinned-cap", detail: `pinned ${pin} would exceed the ${platform} cap of ${cadence.dailyCaps[platform]} on ${date}` });
        continue;
      }
      bump(platform, date, t);
      assignments.push({
        key: item.key,
        platform,
        scheduledFor: new Date(t).toISOString(),
        localDate: date,
        localTime: new Date(t).toISOString().slice(11, 16),
        dayIndex: diffCalendarDays(input.weekStart, date),
        slotIndex: -1,
        pinned: true,
      });
    }
    if (wanted.length === 0) continue;

    if (minDay >= days) {
      for (const platform of wanted) unplaced.push({ key: item.key, platform, reason: "buffer", detail: `buffer of ${buffer} day(s) pushes it past the plan` });
      continue;
    }

    // F15 (Fable to review): editor items. sameDay ignores stagger: each platform independently, earliest first.
    const win = windowOf(item);
    if (win && item.sameDay) {
      for (const platform of wanted) {
        const miss = placeInWindow(item.key, platform, win, minDay, true);
        if (miss) unplaced.push(miss);
      }
      continue;
    }
    const allow = win ? (at: Date): boolean => at.getTime() >= win.start && at.getTime() < win.end : undefined;

    // Anchor: Instagram if wanted, else the first wanted platform.
    const anchorPlatform: Platform = wanted.includes("instagram") ? "instagram" : wanted[0]!;
    const anchorIsIG = anchorPlatform === "instagram";

    // Least-loaded day first (ties: earliest), so a week fills evenly instead of Monday-first.
    const dayOrder = Array.from({ length: days - minDay }, (_, i) => i + minDay).sort((a, b) => {
      const la = dayCount.get(`${anchorPlatform}|${dateOf(a)}`) ?? 0;
      const lb = dayCount.get(`${anchorPlatform}|${dateOf(b)}`) ?? 0;
      return la - lb || a - b;
    });
    let anchor: { dayIndex: number; slotIndex: number; at: Date } | null = null;
    for (const d of dayOrder) {
      const candidate = nextFree(anchorPlatform, d, 0, minDay, allow);
      if (candidate && candidate.dayIndex === d) {
        anchor = candidate;
        break;
      }
    }
    if (!anchor) anchor = nextFree(anchorPlatform, minDay, 0, minDay, allow); // spill past the plan rather than drop
    if (!anchor && win) {
      // F15 (Fable to review): a window item never spills outside its window; same reasons as sameDay.
      const why = windowReason(anchorPlatform, win, minDay);
      for (const platform of wanted) unplaced.push({ key: item.key, platform, reason: why, detail: `no ${anchorPlatform} slot inside the window` });
      continue;
    }
    if (!anchor) {
      for (const platform of wanted) unplaced.push({ key: item.key, platform, reason: "cap", detail: `no ${anchorPlatform} slot under the daily cap in ${days + SPILL_DAYS} days` });
      continue;
    }
    place(item.key, anchorPlatform, anchor.dayIndex, anchor.slotIndex, anchor.at);
    if (anchor.dayIndex >= days) warnings.push(`${item.key}: ${anchorPlatform} spilled to day ${anchor.dayIndex + 1}, past the ${days}-day plan`);

    for (const platform of wanted) {
      if (platform === anchorPlatform) continue;
      // Stagger is defined relative to the Instagram anchor; without IG, treat the first platform as day 0 / slot 0.
      const rule = anchorIsIG ? cadence.stagger[platform] : { days: cadence.stagger[platform].days - cadence.stagger[anchorPlatform].days, slots: 0 };
      let day = anchor.dayIndex + Math.max(0, rule.days);
      let slot = anchor.slotIndex + Math.max(0, rule.slots);
      while (slotTimes.length > 0 && slot >= slotTimes.length) {
        slot -= slotTimes.length;
        day++;
      }
      const spot = nextFree(platform, day, slot, minDay, allow);
      if (!spot && win) {
        unplaced.push({ key: item.key, platform, reason: windowReason(platform, win, minDay), detail: `no ${platform} slot inside the window after the stagger` });
        continue;
      }
      if (!spot) {
        unplaced.push({ key: item.key, platform, reason: "no-slot", detail: `no ${platform} slot under the daily cap after day ${day + 1}` });
        continue;
      }
      if (spot.dayIndex !== day || spot.slotIndex !== slot) warnings.push(`${item.key}: ${platform} slid from day ${day + 1} slot ${slot + 1} to day ${spot.dayIndex + 1} slot ${spot.slotIndex + 1}`);
      place(item.key, platform, spot.dayIndex, spot.slotIndex, spot.at);
    }
  }

  assignments.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.platform.localeCompare(b.platform));
  return { assignments, unplaced, warnings };
}
