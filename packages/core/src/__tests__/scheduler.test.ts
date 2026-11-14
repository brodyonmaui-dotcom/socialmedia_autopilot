import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, daySlotTimes, isWithinAnyWindow, normalizeCadence } from "../cadence.js";
import { assignSlots, findCapBreaches, type ScheduleItem } from "../scheduler.js";
import { addCalendarDays, localDate, localHHMM, localToUtc } from "../time.js";
import type { Platform } from "../types.js";

const TZ = "America/New_York"; // fixture zone (DST-observing), not the creator's
// Pinned to the pre-F15 caps (4/day) so these grid tests keep exercising the cap at the grid size.
const cadence = normalizeCadence({ dailyCaps: { instagram: 4, youtube: 4, tiktok: 4, snapchat: 1 } });

function clips(n: number, platforms: ScheduleItem["platforms"] = ["instagram", "youtube", "tiktok"]): ScheduleItem[] {
  return Array.from({ length: n }, (_, i) => ({ key: `clip-${i + 1}`, pillar: "gym", platforms }));
}

describe("assignSlots", () => {
  it("places 7×4 clips on the grid: 4 IG anchors a day, every slot inside a window", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(28), cadence, timeZone: TZ });
    expect(r.unplaced).toEqual([]);
    expect(r.assignments).toHaveLength(84);
    const grid = daySlotTimes(cadence);
    for (const a of r.assignments) {
      const hhmm = localHHMM(new Date(a.scheduledFor), TZ);
      expect(grid, `${a.key}/${a.platform} at ${hhmm}`).toContain(hhmm);
      expect(isWithinAnyWindow(hhmm, cadence.windows)).toBe(true);
    }
    const igDays = new Map<string, number>();
    for (const a of r.assignments) if (a.platform === "instagram") igDays.set(a.localDate, (igDays.get(a.localDate) ?? 0) + 1);
    expect([...igDays.values()]).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(findCapBreaches(r.assignments, cadence, TZ)).toEqual([]);
  });

  it("staggers one video: YouTube next slot, TikTok next day, Snapchat two days later", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "v", platforms: ["instagram", "youtube", "tiktok", "snapchat"] }], cadence, timeZone: TZ });
    const by = Object.fromEntries(r.assignments.map((a) => [a.platform, a]));
    expect(by.instagram!.localDate).toBe("2026-11-09");
    expect(by.instagram!.slotIndex).toBe(0);
    expect(by.youtube!.localDate).toBe("2026-11-09");
    expect(by.youtube!.slotIndex).toBe(1);
    expect(by.tiktok!.localDate).toBe("2026-11-10");
    expect(by.tiktok!.slotIndex).toBe(0);
    expect(by.snapchat!.localDate).toBe("2026-11-11");
  });

  it("never exceeds a per-platform daily cap, counting existing commitments", () => {
    const existing = [
      { platform: "instagram" as const, scheduledFor: "2026-11-09T15:00:00Z" },
      { platform: "instagram" as const, scheduledFor: "2026-11-09T16:00:00Z" },
      { platform: "instagram" as const, scheduledFor: "2026-11-09T17:00:00Z" },
    ];
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(25, ["instagram"]), cadence, timeZone: TZ, existing });
    const all = [...existing, ...r.assignments];
    expect(findCapBreaches(all, cadence, TZ)).toEqual([]);
    expect(r.unplaced).toEqual([]);
    const monday = r.assignments.filter((a) => a.localDate === "2026-11-09");
    expect(monday).toHaveLength(1); // 3 existing + 1 = cap 4; the other 24 fill Tue..Sun
  });

  it("refuses the same video twice on one platform", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "v", platforms: ["instagram"] }, { key: "v", platforms: ["instagram", "tiktok"] }], cadence, timeZone: TZ });
    expect(r.unplaced).toEqual([{ key: "v", platform: "instagram", reason: "duplicate", detail: expect.any(String) }]);
    expect(r.assignments.map((a) => a.platform).sort()).toEqual(["instagram", "tiktok"]);
  });

  it("keeps pinned times, counts them toward caps, and refuses a pinned time that breaks the cap", () => {
    const pin = "2026-11-10T18:00:00Z";
    const r = assignSlots({
      weekStart: "2026-11-09",
      items: [{ key: "a", platforms: ["instagram"], pinned: { instagram: pin } }, { key: "b", platforms: ["instagram"], pinned: { instagram: pin } }],
      cadence: normalizeCadence({ dailyCaps: { instagram: 1 } }),
      timeZone: TZ,
    });
    expect(r.assignments).toEqual([expect.objectContaining({ key: "a", pinned: true, scheduledFor: "2026-11-10T18:00:00.000Z", slotIndex: -1 })]);
    expect(r.unplaced[0]).toMatchObject({ key: "b", reason: "pinned-cap" });
  });

  it("applies the per-pillar buffer from the captured date (default off)", () => {
    const captured = "2026-11-10T20:00:00Z"; // Tue evening local
    const off = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence, timeZone: TZ });
    expect(off.assignments[0]!.localDate).toBe("2026-11-09"); // no buffer: earliest day
    const on = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence: normalizeCadence({ bufferDays: { gym: 2 } }), timeZone: TZ });
    expect(on.assignments[0]!.localDate).toBe("2026-11-12"); // captured Tue + 2 days = Thu
    const past = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence: normalizeCadence({ bufferDays: { gym: 10 } }), timeZone: TZ });
    expect(past.unplaced[0]).toMatchObject({ reason: "buffer" });
  });

  it("skips slots at or before `now`", () => {
    const now = new Date("2026-11-09T20:00:00Z"); // Monday 15:00 local: the 10:38 and 13:00 slots are gone
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(1, ["instagram"]), cadence, timeZone: TZ, now });
    expect(r.assignments[0]!.localDate).toBe("2026-11-09");
    expect(r.assignments[0]!.slotIndex).toBe(2);
  });

  it("keeps wall-clock slot times through a DST change (fall-back week)", () => {
    const weekStart = "2026-10-26"; // US fall-back on 2026-11-01 (Sunday of this week)
    const r = assignSlots({ weekStart, items: clips(28), cadence, timeZone: TZ });
    const grid = daySlotTimes(cadence);
    for (const a of r.assignments) expect(grid).toContain(localHHMM(new Date(a.scheduledFor), TZ));
    const sundayIG = r.assignments.filter((a) => a.platform === "instagram" && a.localDate === "2026-11-01").map((a) => a.scheduledFor);
    expect(sundayIG).toHaveLength(4);
    // After the change the same wall-clock slot is one UTC hour later than the day before.
    const satIG = r.assignments.filter((a) => a.platform === "instagram" && a.localDate === "2026-10-31").map((a) => a.scheduledFor);
    expect(Date.parse(sundayIG[0]!) - Date.parse(satIG[0]!)).toBe(25 * 3_600_000);
  });

  it("falls back to the first wanted platform as anchor when Instagram isn't wanted", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "y", platforms: ["youtube", "tiktok"] }], cadence, timeZone: TZ });
    const by = Object.fromEntries(r.assignments.map((a) => [a.platform, a]));
    expect(by.youtube!.localDate).toBe("2026-11-09");
    expect(by.tiktok!.localDate).toBe(addCalendarDays(by.youtube!.localDate, 1));
  });

  it("findCapBreaches reports the day and count over the cap in the creator's zone", () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({ platform: "tiktok" as const, scheduledFor: `2026-11-10T${15 + i}:00:00Z` }));
    expect(findCapBreaches(posts, cadence, TZ)).toEqual([{ platform: "tiktok", localDate: localDate(new Date(posts[0]!.scheduledFor), TZ), count: 5, cap: 4 }]);
  });
});

describe("assignSlots: F15 editor slotting (window / sameDay / flex grid)", () => {
  const caps5 = DEFAULT_CADENCE; // 5/day IG/YT/TikTok
  const TUE = "2026-11-10";
  const day = (ymd: string, from = "00:00") => ({ notBefore: localToUtc(ymd, from, TZ).toISOString(), notAfter: localToUtc(addCalendarDays(ymd, 1), "00:00", TZ).toISOString() });
  const gridPosts = (ymd: string, platform: Platform) => daySlotTimes(caps5).map((t) => ({ platform, scheduledFor: localToUtc(ymd, t, TZ).toISOString() }));

  it("window excludes slots outside it (stagger copy that lands outside is unplaced)", () => {
    const window = { notBefore: localToUtc(TUE, "12:00", TZ).toISOString(), notAfter: localToUtc(TUE, "18:00", TZ).toISOString() };
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "w", platforms: ["instagram", "youtube", "tiktok"], window }], cadence: caps5, timeZone: TZ });
    const by = Object.fromEntries(r.assignments.map((a) => [a.platform, a]));
    expect(by.instagram).toMatchObject({ localDate: TUE, localTime: "13:00" });
    expect(by.youtube).toMatchObject({ localDate: TUE, localTime: "16:30" });
    for (const a of r.assignments) {
      expect(Date.parse(a.scheduledFor)).toBeGreaterThanOrEqual(Date.parse(window.notBefore));
      expect(Date.parse(a.scheduledFor)).toBeLessThan(Date.parse(window.notAfter));
    }
    expect(r.unplaced).toEqual([{ key: "w", platform: "tiktok", reason: "no-slot", detail: expect.any(String) }]);
  });

  it("sameDay ignores stagger: TikTok and YouTube post the same day as Instagram", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "s", platforms: ["instagram", "youtube", "tiktok"], window: day(TUE), sameDay: true }], cadence: caps5, timeZone: TZ });
    expect(r.unplaced).toEqual([]);
    for (const a of r.assignments) expect(a).toMatchObject({ localDate: TUE, slotIndex: 0, localTime: "10:38" });
  });

  it("earliest within a window is respected (no slot before notBefore, earliest one after it)", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "e", platforms: ["instagram", "tiktok"], window: day(TUE, "14:00"), sameDay: true }], cadence: caps5, timeZone: TZ });
    expect(r.assignments.map((a) => [a.platform, a.localDate, a.localTime])).toEqual([["instagram", TUE, "16:30"], ["tiktok", TUE, "16:30"]]);
  });

  it("5th same-day post on a day with 4 grid slots taken uses the flex grid", () => {
    const existing = gridPosts(TUE, "instagram");
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "f", platforms: ["instagram"], window: day(TUE), sameDay: true }], cadence: caps5, timeZone: TZ, existing });
    expect(r.unplaced).toEqual([]);
    const a = r.assignments[0]!;
    expect(a).toMatchObject({ localDate: TUE, localTime: "09:30", slotIndex: -1, pinned: false, flex: true });
    expect(localHHMM(new Date(a.scheduledFor), TZ)).toBe("09:30");
    for (const e of existing) expect(Math.abs(Date.parse(e.scheduledFor) - Date.parse(a.scheduledFor))).toBeGreaterThanOrEqual(caps5.minGapMinutes * 60_000);
    expect(isWithinAnyWindow(a.localTime, caps5.windows)).toBe(true);
    expect(findCapBreaches([...existing, ...r.assignments], caps5, TZ)).toEqual([]);
  });

  it("cap 5 holds: the 6th same-day post is unplaced with reason cap", () => {
    const existing = gridPosts(TUE, "instagram");
    const r = assignSlots({
      weekStart: "2026-11-09",
      items: [{ key: "f5", platforms: ["instagram"], window: day(TUE), sameDay: true }, { key: "f6", platforms: ["instagram"], window: day(TUE), sameDay: true }],
      cadence: caps5,
      timeZone: TZ,
      existing,
    });
    expect(r.assignments.map((a) => a.key)).toEqual(["f5"]);
    expect(r.unplaced).toEqual([{ key: "f6", platform: "instagram", reason: "cap", detail: expect.any(String) }]);
    expect(findCapBreaches([...existing, ...r.assignments], caps5, TZ)).toEqual([]);
  });

  it("a window with no time left (all past `now`) is unplaced no-slot, never rolled to another day", () => {
    const now = localToUtc(TUE, "21:30", TZ);
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "late", platforms: ["instagram"], window: day(TUE), sameDay: true }], cadence: caps5, timeZone: TZ, now });
    expect(r.assignments).toEqual([]);
    expect(r.unplaced[0]).toMatchObject({ key: "late", reason: "no-slot" });
  });

  it("keeps wall-clock times in a DST-change week with a window (fall-back Sunday, grid + flex)", () => {
    const SUN = "2026-11-01"; // US fall-back day: 25 h long
    const existing = gridPosts(SUN, "instagram");
    const r = assignSlots({
      weekStart: "2026-10-26",
      items: [{ key: "g", platforms: ["youtube"], window: day(SUN, "12:00"), sameDay: true }, { key: "x", platforms: ["instagram"], window: day(SUN), sameDay: true }],
      cadence: caps5,
      timeZone: TZ,
      existing,
    });
    expect(r.unplaced).toEqual([]);
    const by = Object.fromEntries(r.assignments.map((a) => [a.key, a]));
    expect(by.g!.scheduledFor).toBe("2026-11-01T18:00:00.000Z"); // 13:00 EST (UTC-5)
    expect(by.x!.scheduledFor).toBe("2026-11-01T14:30:00.000Z"); // flex 09:30 EST
    for (const a of r.assignments) expect(a.localDate).toBe(SUN);
  });
});
