import type { Platform, PostingWindow } from "./types.js";
import { hhmmFromMinutes, localHHMM, minutesOfDay } from "./time.js";

/** Checks a "HH:MM" wall-clock time (already in the creator's local time) against the posting windows. */
export function isWithinAnyWindow(hhmm: string, windows: PostingWindow[]): boolean {
  const t = minutesOfDay(hhmm);
  return windows.some((w) => t >= minutesOfDay(w.start) && t <= minutesOfDay(w.end));
}

/** Same check for a full Date, given the "HH:MM" already resolved in the creator's local time zone. */
export function isWithinAnyWindowAt(date: Date, windows: PostingWindow[], timeZone: string): boolean {
  return isWithinAnyWindow(localHHMM(date, timeZone), windows);
}

/** How a platform's copy of a video is placed relative to the Instagram anchor slot. */
export interface StaggerRule {
  /** Calendar days after the anchor day (0 = same day). */
  days: number;
  /** Slot positions after the anchor slot on that day (wraps to the next day when it runs out). */
  slots: number;
}

/**
 * Editable cadence (Settings → cadence, `settings.cadence`). Only wall-clock times and counts live
 * here; the time zone that makes them meaningful is TZ_CREATOR in .env (location boundary).
 */
export interface CadenceSettings {
  /** Posting windows in local wall-clock time; slots are spread across them. */
  windows: PostingWindow[];
  /** Slot positions per day (the "4-slot" grid). */
  slotsPerDay: number;
  /** Hard per-platform, per-local-day limits. The scheduler never exceeds them; the outbox refuses to. */
  dailyCaps: Record<Platform, number>;
  /** Where each platform's copy lands relative to the anchor (Instagram) slot. */
  stagger: Record<Platform, StaggerRule>;
  /**
   * Days a clip must age before it can be scheduled, by pillar (voice.md "gym/outdoor post buffer",
   * default off = 0). Measured from the clip's captured date in the creator's zone.
   */
  bufferDays: Partial<Record<string, number>>;
  /** Minimum minutes between two posts on the same platform (keeps slots from collapsing). */
  minGapMinutes: number;
}

/**
 * Defaults, each traceable to docs:
 *  - windows: the 0002_settings.sql seed.
 *  - slotsPerDay 4: decisions.md §5 (3 trials + 1 regular reel a day).
 *  - dailyCaps 5 (IG/YT/TikTok): 3 weekly + 2 same-day; a stored cadence row overrides this (F15).
 *    All well under the platform limits in CAP_LIMITS. Weekly items still use only the 4 grid slots;
 *    the 5th post a day comes from an editor (sameDay) item on the flex grid.
 *  - Snapchat cap 1: decisions.md §3, 1 Spotlight a day (assisted; the scheduler never fires it).
 *  - stagger: Instagram anchors; YouTube the next slot the same day; TikTok the next day's matching
 *    slot; Snapchat two days later (it's the proven performer per decisions.md §3).
 */
export const DEFAULT_CADENCE: CadenceSettings = {
  windows: [
    { start: "09:30", end: "11:45" },
    { start: "12:00", end: "14:00" },
    { start: "15:00", end: "18:00" },
    { start: "20:00", end: "21:00" },
  ],
  slotsPerDay: 4,
  dailyCaps: { instagram: 5, youtube: 5, tiktok: 5, snapchat: 1 }, // 3 weekly + 2 same-day; a stored cadence row overrides this
  stagger: {
    instagram: { days: 0, slots: 0 },
    youtube: { days: 0, slots: 1 },
    tiktok: { days: 1, slots: 0 },
    snapchat: { days: 2, slots: 0 },
  },
  bufferDays: {},
  minGapMinutes: 30,
};

export const PLATFORMS: readonly Platform[] = ["instagram", "youtube", "tiktok", "snapchat"] as const;

/**
 * Highest daily cap the Settings page (and normalizeCadence) accepts per platform: the platform
 * limits in docs/research.md, with margin.
 *  - instagram 25: Graph API content publishing allows 100 API-published posts per 24 h.
 *  - youtube 10: videos.insert has its own bucket of 100 uploads/day.
 *  - tiktok 15: Zernio's TikTok lane allows 15 videos/24 h (and 5 pending Creator Inbox drafts/24 h).
 *  - snapchat 1: 1 Spotlight a day (decisions.md §3; assisted).
 */
export const CAP_LIMITS: Record<Platform, number> = { instagram: 25, youtube: 10, tiktok: 15, snapchat: 1 };

function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s) && minutesOfDay(s) < 1440;
}

/**
 * Merges a stored (possibly partial or malformed) settings value over the defaults and validates
 * the result, so a bad Settings edit can never produce an impossible grid. Throws on invalid input.
 */
export function normalizeCadence(input: unknown, base: CadenceSettings = DEFAULT_CADENCE): CadenceSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof CadenceSettings, unknown>>;
  const out: CadenceSettings = {
    windows: [...base.windows],
    slotsPerDay: base.slotsPerDay,
    dailyCaps: { ...base.dailyCaps },
    stagger: { ...base.stagger },
    bufferDays: { ...base.bufferDays },
    minGapMinutes: base.minGapMinutes,
  };

  if (Array.isArray(raw.windows)) {
    out.windows = raw.windows.map((w) => {
      const win = w as Partial<PostingWindow>;
      if (!isHHMM(win.start) || !isHHMM(win.end) || minutesOfDay(win.start) >= minutesOfDay(win.end)) {
        throw new Error(`cadence.windows: invalid window ${JSON.stringify(w)}`);
      }
      return { start: win.start, end: win.end };
    });
  }
  out.windows.sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
  for (let i = 1; i < out.windows.length; i++) {
    if (minutesOfDay(out.windows[i]!.start) < minutesOfDay(out.windows[i - 1]!.end)) throw new Error("cadence.windows: windows overlap");
  }
  if (out.windows.length === 0) throw new Error("cadence.windows: at least one window is required");

  if (raw.slotsPerDay !== undefined) {
    if (!Number.isInteger(raw.slotsPerDay) || (raw.slotsPerDay as number) < 1 || (raw.slotsPerDay as number) > 24) throw new Error("cadence.slotsPerDay: 1..24");
    out.slotsPerDay = raw.slotsPerDay as number;
  }
  if (raw.dailyCaps && typeof raw.dailyCaps === "object") {
    for (const p of PLATFORMS) {
      const v = (raw.dailyCaps as Record<string, unknown>)[p];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || (v as number) < 0) throw new Error(`cadence.dailyCaps.${p}: non-negative integer`);
      if ((v as number) > CAP_LIMITS[p]) throw new Error(`cadence.dailyCaps.${p}: at most ${CAP_LIMITS[p]} (platform limit, research.md)`);
      out.dailyCaps[p] = v as number;
    }
  }
  if (raw.stagger && typeof raw.stagger === "object") {
    for (const p of PLATFORMS) {
      const v = (raw.stagger as Record<string, unknown>)[p] as Partial<StaggerRule> | undefined;
      if (v === undefined) continue;
      const days = v.days ?? out.stagger[p].days;
      const slots = v.slots ?? out.stagger[p].slots;
      if (!Number.isInteger(days) || days < 0 || days > 14 || !Number.isInteger(slots) || slots < 0) throw new Error(`cadence.stagger.${p}: days 0..14, slots >= 0`);
      out.stagger[p] = { days, slots };
    }
  }
  if (raw.bufferDays && typeof raw.bufferDays === "object") {
    for (const [pillar, v] of Object.entries(raw.bufferDays as Record<string, unknown>)) {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 60) throw new Error(`cadence.bufferDays.${pillar}: 0..60`);
      out.bufferDays[pillar] = v as number;
    }
  }
  if (raw.minGapMinutes !== undefined) {
    if (!Number.isInteger(raw.minGapMinutes) || (raw.minGapMinutes as number) < 0) throw new Error("cadence.minGapMinutes: non-negative integer");
    out.minGapMinutes = raw.minGapMinutes as number;
  }
  // The anchor platform must sit at offset zero or nothing else is "relative" to it.
  out.stagger.instagram = { days: 0, slots: 0 };
  return out;
}

/**
 * The daily slot grid as "HH:MM" wall-clock times. One slot per window (each window's midpoint)
 * when slotsPerDay equals the number of windows — the common "4 windows, 4 posts" case, so no
 * window goes unused. Otherwise `slotsPerDay` midpoints of equal segments across the total window
 * minutes (same spread as generateCatchUpSlots). Snapped to whole minutes.
 */
export function daySlotTimes(cadence: Pick<CadenceSettings, "windows" | "slotsPerDay">): string[] {
  const ranges = [...cadence.windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start)).map((w) => [minutesOfDay(w.start), minutesOfDay(w.end)] as const);
  const total = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
  if (total <= 0 || cadence.slotsPerDay <= 0) return [];
  if (cadence.slotsPerDay === ranges.length) return ranges.map(([s, e]) => hhmmFromMinutes((s + e) / 2));
  const at = (fraction: number): number => {
    let target = fraction * total;
    for (const [s, e] of ranges) {
      if (target <= e - s) return s + target;
      target -= e - s;
    }
    return ranges[ranges.length - 1]![1];
  };
  return Array.from({ length: cadence.slotsPerDay }, (_, i) => hhmmFromMinutes(at((i + 0.5) / cadence.slotsPerDay)));
}
