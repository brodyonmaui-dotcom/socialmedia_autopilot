import type { Platform } from "./types.js";
import { daySlotTimes, PLATFORMS, type CadenceSettings } from "./cadence.js";
import { addCalendarDays, diffCalendarDays, localDate, localToUtc } from "./time.js";

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
  function nextFree(platform: Platform, fromDay: number, fromSlot: number, minDay: number): { dayIndex: number; slotIndex: number; at: Date } | null {
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
      const candidate = nextFree(anchorPlatform, d, 0, minDay);
      if (candidate && candidate.dayIndex === d) {
        anchor = candidate;
        break;
      }
    }
    if (!anchor) anchor = nextFree(anchorPlatform, minDay, 0, minDay); // spill past the plan rather than drop
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
      const spot = nextFree(platform, day, slot, minDay);
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
